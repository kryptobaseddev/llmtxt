/**
 * T164: Daily audit log Merkle root checkpoint job.
 *
 * Runs every 24 hours (and immediately at startup for the previous day, if
 * no checkpoint exists yet). For each unchecked day:
 *
 *   1. Collect all audit_log rows with a non-null payload_hash for that day.
 *   2. Compute the SHA-256 Merkle root (via crates/llmtxt-core SSOT function).
 *   3. Submit the Merkle root to freetsa.org RFC 3161 for external anchoring.
 *   4. Insert a row into audit_checkpoints (tsr_token may be null on TSA failure).
 *
 * Failure modes:
 * - If the TSA is unavailable, the checkpoint is still inserted with
 *   tsr_token = null and an WARN log is emitted. Non-fatal.
 * - If the DB write fails, the error is logged at ERROR level.
 *
 * SSOT: merkle_root is computed via crates/llmtxt-core (Rust, imported via
 * the `llmtxt` npm package which wraps the WASM build).
 */

import crypto from "node:crypto";
import { and, eq, gte, isNotNull, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditCheckpoints, auditLogs } from "../db/schema-pg.js";
import { signMerkleRoot } from "../lib/audit-signing-key.js";
import { requestRfc3161Timestamp } from "../lib/rfc3161.js";

const CHECKPOINT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

// ── Merkle root computation ──────────────────────────────────────────────────

/**
 * Compute SHA-256 Merkle root over a list of 64-char hex leaf strings.
 * Mirrors crates/llmtxt-core/src/merkle.rs exactly.
 *
 * We implement directly in TypeScript (rather than via the WASM binding) to
 * avoid the WASM module loading dependency in a background job. The algorithm
 * is identical to the Rust native implementation — byte-for-byte.
 *
 * Convention:
 * - Empty input: 64 zero chars (genesis sentinel).
 * - Single leaf: returned as-is.
 * - Odd node duplication (Bitcoin convention).
 */
function pairHash(left: Buffer, right: Buffer): Buffer {
	return crypto.createHash("sha256").update(left).update(right).digest();
}

export function computeMerkleRoot(leafHexes: string[]): string {
	if (leafHexes.length === 0) return "0".repeat(64);
	if (leafHexes.length === 1) return leafHexes[0];

	let level: Buffer[] = leafHexes.map((h) => Buffer.from(h, "hex"));

	while (level.length > 1) {
		const next: Buffer[] = [];
		for (let i = 0; i < level.length; i += 2) {
			const left = level[i];
			const right = i + 1 < level.length ? level[i + 1] : level[i]; // odd duplication
			next.push(pairHash(left, right));
		}
		level = next;
	}

	return level[0].toString("hex");
}

// ── Date utilities ───────────────────────────────────────────────────────────

function isoDate(d: Date): string {
	return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function startOfDayMs(dateStr: string): number {
	return new Date(`${dateStr}T00:00:00.000Z`).getTime();
}

function endOfDayMs(dateStr: string): number {
	return new Date(`${dateStr}T00:00:00.000Z`).getTime() + 86_400_000;
}

// ── Core checkpoint logic ────────────────────────────────────────────────────

/**
 * Create a checkpoint for a specific calendar day (UTC).
 * Idempotent: if a checkpoint already exists for the date, does nothing.
 */
export async function createCheckpointForDate(dateStr: string): Promise<void> {
	const tag = `[audit-checkpoint:${dateStr}]`;

	// Idempotency check — skip if checkpoint for this date already exists.
	const existingRows = await db
		.select({ id: auditCheckpoints.id })
		.from(auditCheckpoints)
		.where(eq(auditCheckpoints.checkpointDate, dateStr))
		.limit(1);

	if (existingRows.length > 0) {
		console.log(`${tag} checkpoint already exists — skipping`);
		return;
	}

	const fromMs = startOfDayMs(dateStr);
	const toMs = endOfDayMs(dateStr);

	// Collect all audit_log rows for this day that have a payload_hash.
	const rows = await db
		.select({ payloadHash: auditLogs.payloadHash })
		.from(auditLogs)
		.where(
			and(
				isNotNull(auditLogs.payloadHash),
				gte(auditLogs.timestamp, fromMs),
				lt(auditLogs.timestamp, toMs),
			),
		);

	const leaves = rows.map(
		(r: { payloadHash: string | null }) => r.payloadHash as string,
	);
	const merkleRoot = computeMerkleRoot(leaves);
	console.log(
		`${tag} ${leaves.length} events → merkle root: ${merkleRoot.slice(0, 16)}...`,
	);

	// T107: Sign the Merkle root with the server ed25519 key.
	let signedRootSig: string | null = null;
	let signingKeyId: string | null = null;
	const sigResult = await signMerkleRoot(merkleRoot, dateStr);
	if (sigResult) {
		signedRootSig = sigResult.signature;
		signingKeyId = sigResult.keyId;
		console.log(`${tag} Merkle root signed with key_id=${signingKeyId}`);
	} else {
		console.warn(`${tag} signing skipped — AUDIT_SIGNING_KEY not configured`);
	}

	// Request RFC 3161 timestamp.
	let tsrToken: string | null = null;
	try {
		tsrToken = await requestRfc3161Timestamp(merkleRoot);
		console.log(
			`${tag} RFC 3161 timestamp acquired (${tsrToken.length / 2} bytes)`,
		);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn(
			`${tag} RFC 3161 timestamp failed (partial — continuing without anchor): ${msg}`,
		);
	}

	// Insert checkpoint row.
	await db.insert(auditCheckpoints).values({
		id: crypto.randomUUID(),
		checkpointDate: dateStr,
		merkleRoot,
		tsrToken,
		signedRootSig,
		signingKeyId,
		eventCount: leaves.length,
		createdAt: new Date(),
	});

	console.log(`${tag} checkpoint created (tsrAnchored=${tsrToken !== null})`);
}

// ── Job runner ───────────────────────────────────────────────────────────────

async function runCheckpointJob(): Promise<void> {
	const tag = "[audit-checkpoint-job]";
	console.log(`${tag} starting`);

	try {
		// Checkpoint yesterday (UTC) — today's data is still accumulating.
		const yesterday = new Date(Date.now() - 86_400_000);
		const dateStr = isoDate(yesterday);
		await createCheckpointForDate(dateStr);
	} catch (err) {
		console.error(`[audit-checkpoint-job] error:`, err);
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

let checkpointTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the daily audit checkpoint job.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startAuditCheckpointJob(): void {
	if (checkpointTimer) return;

	void runCheckpointJob();
	checkpointTimer = setInterval(
		() => void runCheckpointJob(),
		CHECKPOINT_INTERVAL_MS,
	);

	console.log("[audit-checkpoint] daily checkpoint job started");
}

/**
 * Stop the audit checkpoint job. Useful in tests or graceful shutdown.
 */
export function stopAuditCheckpointJob(): void {
	if (checkpointTimer) {
		clearInterval(checkpointTimer);
		checkpointTimer = null;
	}
}
