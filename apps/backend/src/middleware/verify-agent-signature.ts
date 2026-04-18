/**
 * verifyAgentSignature — middleware for Ed25519 agent request signing (T220).
 *
 * Acceptance criteria:
 *   1. Pass-through when no X-Agent-Pubkey-Id header and user has no registered pubkeys.
 *   2. Return 401 SIGNATURE_REQUIRED when user has a registered pubkey but no sig headers.
 *   3. Return 401 SIGNATURE_MISMATCH / SIGNATURE_EXPIRED / SIGNATURE_REPLAYED for
 *      bad signatures, stale timestamps, or replayed nonces.
 *   4. Canonical payload construction: newline-separated
 *      `METHOD\nPATH_AND_QUERY\nTIMESTAMP_MS\nAGENT_ID\nNONCE_HEX\nBODY_HASH_HEX`.
 *   5. Sets request.signatureVerified, request.agentPubkeyId, request.agentFingerprint.
 *
 * Rollout flag: `SIGNATURE_REQUIRED` env var.
 *   - false (default): absent signatures pass; present signatures are verified.
 *   - true: missing or invalid signatures return 401.
 */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq, isNull, lt, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { hashContent, signWebhookPayload } from "llmtxt";
import {
	buildCanonicalPayload as sdkBuildCanonicalPayload,
} from "llmtxt/identity";
import { db, schema } from "../db/index.js";
import { agentPubkeys, agentSignatureNonces } from "../db/schema.js";
import { type AgentKey, agentKeys } from "../db/schema-pg.js";

// Noble ed25519 v3 requires setting the hash function in Node.js:
ed.hashes.sha512 = sha512;

// ── Constants ─────────────────────────────────────────────────────

/** Reject timestamps older than 5 minutes (ms). */
const MAX_AGE_MS = 5 * 60 * 1000;
/** Reject timestamps more than 1 minute in the future (ms). */
const MAX_FUTURE_MS = 60 * 1000;

// ── Fastify type augmentation ─────────────────────────────────────

declare module "fastify" {
	interface FastifyRequest {
		signatureVerified?: boolean;
		agentPubkeyId?: string;
		agentFingerprint?: string;
		/** The canonical payload bytes for this request (populated on verified requests). */
		_canonicalPayload?: string;
	}
}

// ── Helpers ───────────────────────────────────────────────────────

/** Compute SHA-256 fingerprint of a pubkey (first 16 hex chars of SHA-256(pubkey_hex_string)). */
function computeFingerprint(pubkeyHex: string): string {
	// Hash the hex string representation — deterministic fingerprint for display purposes.
	return hashContent(pubkeyHex).slice(0, 16);
}

/**
 * Compute SHA-256 of raw body bytes as lowercase hex.
 *
 * Converts Buffer to UTF-8 string before hashing (correct for JSON/text bodies).
 * Uses hashContent (WASM Rust SHA-256, SSoT per docs/SSOT.md) which matches
 * what the SDK's `bodyHashHex()` computes via WebCrypto on the client side.
 * For binary bodies this may differ; all our API bodies are JSON/UTF-8.
 */
function computeBodyHash(body: Buffer | null | undefined): string {
	const utfStr = body && body.length > 0 ? body.toString("utf8") : "";
	return hashContent(utfStr);
}

/**
 * Build the canonical payload string.
 *
 * Delegates to `buildCanonicalPayload` from `llmtxt/identity` (T651 — zero
 * duplicate identity logic between SDK and backend middleware).
 */
function buildCanonicalPayload(
	method: string,
	pathAndQuery: string,
	timestampMs: string,
	agentId: string,
	nonceHex: string,
	bodyHashHex: string,
): string {
	const bytes = sdkBuildCanonicalPayload({
		method,
		path: pathAndQuery,
		timestampMs: parseInt(timestampMs, 10),
		agentId,
		nonceHex,
		bodyHashHex,
	});
	return new TextDecoder().decode(bytes);
}

/**
 * Compute a stateless server receipt HMAC.
 *
 * receipt = HMAC-SHA256(SERVER_RECEIPT_SECRET, canonical_payload + '\n' + response_hash)
 * Uses signWebhookPayload (WASM Rust HMAC-SHA256, SSOT per docs/SSOT.md).
 * Returns the hex portion only (strips the 'sha256=' prefix for compact storage).
 */
export function computeReceipt(
	canonicalPayload: string,
	responseBodyHex: string,
): string {
	// D-01: Use configured secret; fall back to dev default only in non-production. [T108.6]
	const secret =
		process.env.SERVER_RECEIPT_SECRET ||
		(process.env.NODE_ENV !== "production" ? "default-receipt-secret" : "");
	const message = `${canonicalPayload}\n${responseBodyHex}`;
	const result = signWebhookPayload(secret, message);
	// signWebhookPayload returns 'sha256=<hex>' — strip prefix for compact form.
	return result.startsWith("sha256=") ? result.slice(7) : result;
}

/**
 * Build the signature receipt object included in every mutating write response.
 *
 * When `signatureVerified` is true, `agent_id` and `pubkey_fingerprint` are set.
 */
export function buildReceipt(opts: {
	agentId: string | null;
	pubkeyFingerprint: string | null;
	payloadHash: string;
	serverTimestamp: number;
	signatureVerified: boolean;
}) {
	return {
		agent_id: opts.agentId,
		pubkey_fingerprint: opts.pubkeyFingerprint,
		payload_hash: opts.payloadHash,
		server_timestamp: opts.serverTimestamp,
		signature_verified: opts.signatureVerified,
	};
}

// ── Background nonce cleanup ─────────────────────────────────────

let nonceCleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start a background interval that purges nonces older than 24 hours.
 * Safe to call multiple times — only one interval is registered.
 */
export function startNonceCleanup(): void {
	if (nonceCleanupInterval) return;
	nonceCleanupInterval = setInterval(
		async () => {
			try {
				// Cast cutoff to any to avoid SQLite vs PG type divergence on firstSeen.
				// The delete is non-fatal; in PG mode the column holds timestamps (ms number
				// from SQLite schema is accepted by the PG driver via implicit cast).
				const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				await db
					.delete(agentSignatureNonces)
					.where(lt(agentSignatureNonces.firstSeen, cutoffMs as any));
			} catch {
				// Non-fatal — next interval will retry.
			}
		},
		60 * 60 * 1000,
	); // Run every hour
	if (nonceCleanupInterval.unref) nonceCleanupInterval.unref();
}

// ── Middleware ────────────────────────────────────────────────────

/**
 * Fastify `preHandler` hook that verifies Ed25519 agent signatures.
 *
 * When no signature headers are present and the requesting user has no
 * registered pubkeys, the request passes through (unsigned writes are allowed
 * when `SIGNATURE_REQUIRED` is not set to `"true"`).
 */
export async function verifyAgentSignature(
	request: FastifyRequest,
	reply: FastifyReply,
): Promise<void> {
	const signatureRequired = process.env.SIGNATURE_REQUIRED === "true";

	const agentId = request.headers["x-agent-pubkey-id"];
	const signatureHex = request.headers["x-agent-signature"];
	const nonceHex = request.headers["x-agent-nonce"];
	const timestampStr = request.headers["x-agent-timestamp"];

	const hasAnyHeader = agentId || signatureHex || nonceHex || timestampStr;

	// No signature headers at all
	if (!hasAnyHeader) {
		if (!signatureRequired) {
			// Unsigned passthrough
			request.signatureVerified = false;
			return;
		}
		// Check if the user has any registered pubkeys — if yes, require sig
		// (This AC branch checks registered pubkeys, not just the flag)
		if (request.user?.id) {
			// Check if any active pubkey exists for this user's agents
			const [anyKey] = await db
				.select({ id: agentPubkeys.id })
				.from(agentPubkeys)
				.where(isNull(agentPubkeys.revokedAt))
				.limit(1);
			if (anyKey) {
				return reply.status(401).send({
					error: "SIGNATURE_REQUIRED",
					message: "This endpoint requires a valid agent signature",
				});
			}
		}
		request.signatureVerified = false;
		return;
	}

	// We have at least one header — validate all are present
	if (!agentId || !signatureHex || !nonceHex || !timestampStr) {
		return reply.status(401).send({
			error: "SIGNATURE_REQUIRED",
			message:
				"Incomplete signature headers: need X-Agent-Pubkey-Id, X-Agent-Signature, X-Agent-Nonce, X-Agent-Timestamp",
		});
	}

	const agentIdStr = Array.isArray(agentId) ? agentId[0] : agentId;
	const sigHex = Array.isArray(signatureHex) ? signatureHex[0] : signatureHex;
	const nonce = Array.isArray(nonceHex) ? nonceHex[0] : nonceHex;
	const tsStr = Array.isArray(timestampStr) ? timestampStr[0] : timestampStr;

	// Validate timestamp
	const tsMs = parseInt(tsStr, 10);
	if (isNaN(tsMs)) {
		return reply.status(401).send({
			error: "SIGNATURE_EXPIRED",
			message: "X-Agent-Timestamp must be a decimal millisecond timestamp",
		});
	}

	const now = Date.now();
	if (now - tsMs > MAX_AGE_MS) {
		return reply.status(401).send({
			error: "SIGNATURE_EXPIRED",
			message: "Timestamp is too old (max 5 minutes)",
		});
	}
	if (tsMs - now > MAX_FUTURE_MS) {
		return reply.status(401).send({
			error: "SIGNATURE_EXPIRED",
			message: "Timestamp is too far in the future (max 1 minute)",
		});
	}

	// Look up the pubkey — check both legacy agent_pubkeys and new versioned agent_keys table.
	// The versioned table supports active + retiring (grace-window) keys.
	// (now is already declared above for timestamp window checks)

	// 1. Try versioned agent_keys first: fetch active + retiring, filter grace in JS.
	const versionedKeys = await db
		.select({
			id: agentKeys.id,
			pubkey: agentKeys.pubkey,
			status: agentKeys.status,
			revokedAt: agentKeys.revokedAt,
			rotatedAt: agentKeys.rotatedAt,
			graceWindowSecs: agentKeys.graceWindowSecs,
		})
		.from(agentKeys)
		.where(
			sql`${agentKeys.agentId} = ${agentIdStr}
          AND ${agentKeys.status} IN ('active', 'retiring')`,
		)
		.limit(4)
		.then((rows: AgentKey[]) =>
			rows.filter((r: AgentKey) => {
				if (r.status === "active") return true;
				// Retiring: check grace window in JS
				if (r.status === "retiring" && r.rotatedAt) {
					const graceEndMs =
						new Date(r.rotatedAt).getTime() +
						(r.graceWindowSecs ?? 172800) * 1000;
					return now < graceEndMs;
				}
				return false;
			}),
		);

	// 2. Fall back to legacy agent_pubkeys if no versioned key found.
	const legacyKey =
		versionedKeys.length === 0
			? await db
					.select({
						id: agentPubkeys.id,
						pubkey: agentPubkeys.pubkey,
						revokedAt: agentPubkeys.revokedAt,
					})
					.from(agentPubkeys)
					.where(eq(agentPubkeys.agentId, agentIdStr))
					.limit(1)
					.then(
						(
							rows: Array<{
								id: string;
								pubkey: Buffer;
								revokedAt: Date | null;
							}>,
						) => rows[0] ?? null,
					)
			: null;

	if (versionedKeys.length === 0 && !legacyKey) {
		return reply.status(401).send({
			error: "SIGNATURE_MISMATCH",
			message: "Unknown agent_id — key not registered",
		});
	}

	// Check explicit revocation on legacy key.
	if (legacyKey && legacyKey.revokedAt !== null) {
		return reply.status(401).send({
			error: "SIGNATURE_MISMATCH",
			message: "Agent key has been revoked",
		});
	}

	// Build candidate pubkey list (active first, then retiring for grace window).
	const candidatePubkeys: Buffer[] = [];
	if (versionedKeys.length > 0) {
		// Sort: active before retiring
		const sorted = [...versionedKeys].sort((a, b) =>
			a.status === "active" ? -1 : b.status === "active" ? 1 : 0,
		);
		for (const k of sorted) {
			const buf = Buffer.isBuffer(k.pubkey) ? k.pubkey : Buffer.from(k.pubkey);
			if (buf.length === 32) candidatePubkeys.push(buf);
		}
	} else if (legacyKey) {
		const buf = Buffer.isBuffer(legacyKey.pubkey)
			? legacyKey.pubkey
			: Buffer.from(legacyKey.pubkey);
		if (buf.length === 32) candidatePubkeys.push(buf);
	}

	if (candidatePubkeys.length === 0) {
		return reply.status(401).send({
			error: "SIGNATURE_MISMATCH",
			message: "No valid public key found for agent",
		});
	}

	// Reconstruct canonical payload
	const rawBody: Buffer | undefined = (
		request as unknown as { rawBody?: Buffer }
	).rawBody;
	const bodyHash = computeBodyHash(rawBody);
	const pathAndQuery = request.url;
	const canonicalPayload = buildCanonicalPayload(
		request.method,
		pathAndQuery,
		tsStr,
		agentIdStr,
		nonce,
		bodyHash,
	);

	// Verify signature against all candidate pubkeys (active + retiring grace window).
	let sigValid = false;
	const sigBuf = Buffer.from(sigHex, "hex");
	const payloadBuf = Buffer.from(canonicalPayload, "utf8");

	if (sigBuf.length === 64) {
		for (const pubkeyBuf of candidatePubkeys) {
			try {
				const valid = await ed.verifyAsync(sigBuf, payloadBuf, pubkeyBuf);
				if (valid) {
					sigValid = true;
					break;
				}
			} catch {
				// Try next candidate
			}
		}
	}

	if (!sigValid) {
		return reply.status(401).send({
			error: "SIGNATURE_MISMATCH",
			message: "Signature verification failed",
		});
	}

	// Check nonce uniqueness — insert first, then check conflict.
	// Use raw SQL to avoid Drizzle ORM table-definition dialect mismatch: the
	// module imports agentSignatureNonces from schema.js (SQLite table type)
	// but db is a Postgres drizzle instance in production. Raw SQL bypasses
	// the dialect issue entirely and works for both SQLite and Postgres.
	try {
		// INSERT ... ON CONFLICT (nonce) DO UPDATE SET nonce=nonce returns the
		// xmax column to detect whether this was an insert or an update (conflict).
		// Simpler: just do a plain INSERT and catch the unique-constraint error.
		await db.execute(
			sql`INSERT INTO agent_signature_nonces (nonce, agent_id) VALUES (${nonce}, ${agentIdStr})`,
		);
	} catch (insertErr: unknown) {
		// Duplicate nonce — replay attack
		const msg =
			insertErr instanceof Error ? insertErr.message : String(insertErr);
		if (
			msg.includes("UNIQUE") ||
			msg.includes("unique") ||
			msg.includes("duplicate") ||
			msg.includes("conflict")
		) {
			return reply.status(401).send({
				error: "SIGNATURE_REPLAYED",
				message: "Nonce has already been used — replay attack detected",
			});
		}
		// Unexpected DB error — treat as mismatch to avoid leaking info
		return reply.status(401).send({
			error: "SIGNATURE_MISMATCH",
			message: "Nonce storage failed",
		});
	}

	// All checks passed — annotate request
	const verifiedPubkey = candidatePubkeys[0];
	const pubkeyHex = verifiedPubkey.toString("hex");
	const fingerprint = computeFingerprint(pubkeyHex);

	request.signatureVerified = true;
	request.agentPubkeyId = agentIdStr;
	request.agentFingerprint = fingerprint;
	request._canonicalPayload = canonicalPayload;
}
