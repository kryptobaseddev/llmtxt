/**
 * T164/T107: Audit log verification and Merkle root endpoints.
 *
 * T164 (existing):
 *   GET /api/v1/audit/verify — re-derive all chain_hashes and report integrity.
 *
 * T107 (new):
 *   GET /api/v1/audit-logs/merkle-root/:date — return signed Merkle root for a date.
 *   POST /api/v1/audit-logs/verify — range-verify against a claimed root.
 *
 * Authentication: admin required on all endpoints.
 */

import crypto from "node:crypto";
import { and, asc, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { auditCheckpoints, auditLogs } from "../db/schema-pg.js";
import { computeMerkleRoot } from "../jobs/audit-checkpoint.js";
import { requireAuth } from "../middleware/auth.js";

// ── Hash verification helpers ────────────────────────────────────────────────

const GENESIS_HASH = "0".repeat(64);

function sha256hex(data: string): string {
	return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function canonicalEventStr(
	id: string,
	eventType: string | null,
	actorId: string | null,
	resourceId: string | null,
	timestampMs: number,
): string {
	return [
		id,
		eventType ?? "",
		actorId ?? "",
		resourceId ?? "",
		String(timestampMs),
	].join("|");
}

function computeChainHash(
	prevChainHashHex: string,
	payloadHashHex: string,
): string {
	const prev = Buffer.from(prevChainHashHex, "hex");
	const payload = Buffer.from(payloadHashHex, "hex");
	return crypto.createHash("sha256").update(prev).update(payload).digest("hex");
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function auditVerifyRoutes(app: FastifyInstance): Promise<void> {
	// ── T164: GET /audit/verify — full chain integrity check ─────────────────

	app.get(
		"/audit/verify",
		{ preHandler: [requireAuth] },
		async (_request, reply) => {
			// 1. Fetch all chained rows ordered by timestamp.
			const rows = await db
				.select({
					id: auditLogs.id,
					eventType: auditLogs.eventType,
					actorId: auditLogs.actorId,
					resourceId: auditLogs.resourceId,
					timestamp: auditLogs.timestamp,
					payloadHash: auditLogs.payloadHash,
					chainHash: auditLogs.chainHash,
				})
				.from(auditLogs)
				.where(isNotNull(auditLogs.chainHash))
				.orderBy(asc(auditLogs.timestamp));

			// 2. Verify each row.
			let prevChainHash = GENESIS_HASH;
			let firstInvalidAt: string | null = null;
			let chainLength = 0;

			for (const row of rows) {
				chainLength++;

				// Re-derive payload_hash from canonical serialization.
				const expectedPayloadHash = sha256hex(
					canonicalEventStr(
						row.id,
						row.eventType,
						row.actorId,
						row.resourceId,
						row.timestamp,
					),
				);

				// Re-derive chain_hash from prev + payload.
				const expectedChainHash = computeChainHash(
					prevChainHash,
					expectedPayloadHash,
				);

				if (
					row.payloadHash !== expectedPayloadHash ||
					row.chainHash !== expectedChainHash
				) {
					firstInvalidAt = row.id;
					break;
				}

				prevChainHash = row.chainHash as string;
			}

			// 3. Fetch last checkpoint.
			const lastCheckpointRows = await db
				.select({
					createdAt: auditCheckpoints.createdAt,
					tsrToken: auditCheckpoints.tsrToken,
				})
				.from(auditCheckpoints)
				.orderBy(desc(auditCheckpoints.createdAt))
				.limit(1);

			const lastCheckpoint = lastCheckpointRows[0] ?? null;
			const lastCheckpointAt = lastCheckpoint?.createdAt?.toISOString() ?? null;
			const tsrAnchored = lastCheckpoint?.tsrToken != null;

			// 4. Return result.
			if (firstInvalidAt !== null) {
				return reply.send({
					valid: false,
					firstInvalidAt,
					chainLength,
					lastCheckpointAt,
				});
			}

			return reply.send({
				valid: true,
				chainLength,
				lastCheckpointAt,
				tsrAnchored,
			});
		},
	);

	// ── T107: GET /audit-logs/merkle-root/:date ───────────────────────────────

	app.get<{ Params: { date: string } }>(
		"/audit-logs/merkle-root/:date",
		{ preHandler: [requireAuth] },
		async (request, reply) => {
			const { date } = request.params;

			// Validate YYYY-MM-DD format.
			if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
				return reply.status(400).send({
					error: "INVALID_DATE",
					message: "date must be in YYYY-MM-DD format",
				});
			}

			const rows = await db
				.select({
					checkpointDate: auditCheckpoints.checkpointDate,
					merkleRoot: auditCheckpoints.merkleRoot,
					tsrToken: auditCheckpoints.tsrToken,
					eventCount: auditCheckpoints.eventCount,
					signedRootSig: auditCheckpoints.signedRootSig,
					signingKeyId: auditCheckpoints.signingKeyId,
					createdAt: auditCheckpoints.createdAt,
				})
				.from(auditCheckpoints)
				.where(eq(auditCheckpoints.checkpointDate, date))
				.limit(1);

			if (rows.length === 0) {
				return reply.status(404).send({
					error: "NO_CHECKPOINT",
					message: `No checkpoint for ${date}`,
				});
			}

			const cp = rows[0];
			return reply.send({
				checkpoint_date: cp.checkpointDate,
				root: cp.merkleRoot,
				signature: cp.signedRootSig ?? null,
				signing_key_id: cp.signingKeyId ?? null,
				timestamp_token: cp.tsrToken ?? null,
				event_count: cp.eventCount,
				created_at: cp.createdAt?.toISOString() ?? null,
			});
		},
	);

	// ── T107: POST /audit-logs/verify ────────────────────────────────────────

	app.post<{
		Body: {
			from_id?: string;
			to_id?: string;
			claimed_root?: string;
		};
	}>(
		"/audit-logs/verify",
		{ preHandler: [requireAuth] },
		async (request, reply) => {
			const { from_id, to_id, claimed_root } = request.body ?? {};

			if (!from_id || !to_id || !claimed_root) {
				return reply.status(400).send({
					error: "INVALID_REQUEST",
					message: "from_id, to_id, and claimed_root are required",
				});
			}

			// Validate claimed_root is 64 hex chars.
			if (!/^[0-9a-f]{64}$/i.test(claimed_root)) {
				return reply.status(400).send({
					error: "INVALID_REQUEST",
					message: "claimed_root must be a 64-char lowercase hex string",
				});
			}

			// Fetch the range of audit_log rows between from_id and to_id (inclusive).
			// We identify the rows by fetching from_id and to_id to get their timestamps,
			// then select all chained rows in that timestamp window.
			const [fromRow] = await db
				.select({ timestamp: auditLogs.timestamp })
				.from(auditLogs)
				.where(eq(auditLogs.id, from_id))
				.limit(1);

			const [toRow] = await db
				.select({ timestamp: auditLogs.timestamp })
				.from(auditLogs)
				.where(eq(auditLogs.id, to_id))
				.limit(1);

			if (!fromRow || !toRow) {
				return reply.status(404).send({
					error: "NOT_FOUND",
					message: `One or both row IDs not found (from_id=${from_id}, to_id=${to_id})`,
				});
			}

			if (fromRow.timestamp > toRow.timestamp) {
				return reply.status(400).send({
					error: "INVALID_RANGE",
					message: "from_id must come before to_id in timestamp order",
				});
			}

			// Fetch all chained rows in the range, ordered by timestamp.
			const rows = await db
				.select({
					id: auditLogs.id,
					eventType: auditLogs.eventType,
					actorId: auditLogs.actorId,
					resourceId: auditLogs.resourceId,
					timestamp: auditLogs.timestamp,
					payloadHash: auditLogs.payloadHash,
					chainHash: auditLogs.chainHash,
				})
				.from(auditLogs)
				.where(
					and(
						isNotNull(auditLogs.payloadHash),
						gte(auditLogs.timestamp, fromRow.timestamp),
						lte(auditLogs.timestamp, toRow.timestamp),
					),
				)
				.orderBy(asc(auditLogs.timestamp));

			// Compute the Merkle root over the payload_hashes of the range.
			const leaves = rows.map(
				(r: { payloadHash: string | null }) => r.payloadHash as string,
			);
			const matchedRoot = computeMerkleRoot(leaves);

			const valid = matchedRoot.toLowerCase() === claimed_root.toLowerCase();

			// Additionally verify the hash chain within the range.
			// We can't verify the very first row's prev_hash without loading the full
			// prior chain — so we only verify internal consistency within the range.
			let firstInvalidAt: string | null = null;
			if (rows.length >= 2) {
				for (let i = 1; i < rows.length; i++) {
					const prev = rows[i - 1];
					const curr = rows[i];
					if (!prev.chainHash || !curr.chainHash || !curr.payloadHash) continue;

					const expectedChainHash = computeChainHash(
						prev.chainHash,
						curr.payloadHash,
					);
					if (curr.chainHash !== expectedChainHash) {
						firstInvalidAt = curr.id;
						break;
					}
				}
			}

			return reply.send({
				valid: valid && firstInvalidAt === null,
				matched_root: matchedRoot,
				claimed_root: claimed_root.toLowerCase(),
				event_count: rows.length,
				first_invalid_at: firstInvalidAt,
			});
		},
	);
}
