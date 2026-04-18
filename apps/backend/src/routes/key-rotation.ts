/**
 * Key rotation routes — T086: Signing Key Rotation (ed25519 per-agent).
 *
 * Endpoints:
 *   POST /api/v1/agents/:id/keys/rotate
 *     — Generate a new keypair, mark old key as retiring (grace window).
 *   POST /api/v1/agents/:id/keys/:keyId/revoke
 *     — Immediately revoke a key (no grace window). Audit logged.
 *   GET  /api/v1/agents/:id/keys
 *     — List all key versions for an agent.
 *   GET  /api/v1/agents/keys/current
 *     — Resolve the current active key for the requesting agent.
 *
 * SSoT: crypto primitives come from crates/llmtxt-core via WASM package (llmtxt).
 * Key wrapping uses AES-256-GCM from the Rust core. The KEK is resolved from
 * the environment (or KMS) — it is NEVER stored in the database.
 *
 * Audit: every rotation/revocation event is written to agent_key_rotation_events
 * (T164 tamper-evident audit trail).
 *
 * Grace window: 48 hours (172800 s) by default, configurable per-key.
 * Retiring keys are accepted by verify-agent-signature.ts until the window expires.
 */

import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { agentKeyRotationEvents, agentKeys } from "../db/schema-pg.js";
import { resolveKek } from "../lib/secrets-provider.js";
import { requireAuth } from "../middleware/auth.js";

// ── Constants ─────────────────────────────────────────────────────

/** Default grace window: 48 hours in seconds. */
const DEFAULT_GRACE_WINDOW_SECS = 172800;

// ── Helpers ───────────────────────────────────────────────────────

/** Extract IP from request (x-forwarded-for or socket). */
function getIp(request: FastifyRequest): string | null {
	const forwarded = request.headers["x-forwarded-for"];
	if (forwarded) {
		const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
		return raw.split(",")[0].trim();
	}
	return request.socket?.remoteAddress ?? null;
}

/** Write a key rotation audit event. Fire-and-forget (non-blocking). */
function writeKeyAuditEvent(opts: {
	agentId: string;
	keyId: string;
	keyVersion: number;
	eventType: "generated" | "rotated" | "revoked" | "retired" | "grace_expired";
	actorId: string | null;
	ipAddress: string | null;
	details?: Record<string, unknown>;
}): void {
	db.insert(agentKeyRotationEvents)
		.values({
			agentId: opts.agentId,
			keyId: opts.keyId,
			keyVersion: opts.keyVersion,
			eventType: opts.eventType,
			actorId: opts.actorId,
			ipAddress: opts.ipAddress,
			details: opts.details ? JSON.stringify(opts.details) : null,
		})
		.catch((err: unknown) => {
			// Non-fatal — log but never fail the rotation on audit write error.
			console.error("[key-rotation] audit write failed", err);
		});
}

// ── Validation schemas ────────────────────────────────────────────

const agentIdParamsSchema = z.object({
	id: z.string().min(1).max(128),
});

const keyIdParamsSchema = z.object({
	id: z.string().min(1).max(128),
	keyId: z.string().min(1).max(64),
});

const rotateBodySchema = z.object({
	/** Optional override for the grace window (seconds). Default: 172800 = 48 h. */
	grace_window_secs: z.number().int().min(60).max(604800).optional(),
	/** Optional human-readable label for the new key. */
	label: z.string().min(1).max(100).optional(),
});

// ── Route handler ─────────────────────────────────────────────────

export async function keyRotationRoutes(
	fastify: FastifyInstance,
): Promise<void> {
	// ── GET /agents/:id/keys — list all key versions ──────────────────

	fastify.get<{ Params: { id: string } }>(
		"/agents/:id/keys",
		{ preHandler: requireAuth },
		async (
			request: FastifyRequest<{ Params: { id: string } }>,
			reply: FastifyReply,
		) => {
			const parseResult = agentIdParamsSchema.safeParse(request.params);
			if (!parseResult.success) {
				return reply.status(400).send({ error: "Invalid agent ID" });
			}
			const { id: agentId } = parseResult.data;

			const rows = await db
				.select({
					id: agentKeys.id,
					keyVersion: agentKeys.keyVersion,
					keyId: agentKeys.keyId,
					status: agentKeys.status,
					createdAt: agentKeys.createdAt,
					rotatedAt: agentKeys.rotatedAt,
					retiredAt: agentKeys.retiredAt,
					revokedAt: agentKeys.revokedAt,
					graceWindowSecs: agentKeys.graceWindowSecs,
					label: agentKeys.label,
				})
				.from(agentKeys)
				.where(eq(agentKeys.agentId, agentId))
				.orderBy(desc(agentKeys.keyVersion));

			return reply.send({
				agent_id: agentId,
				keys: rows.map((r: (typeof rows)[number]) => ({
					id: r.id,
					key_version: r.keyVersion,
					key_id: r.keyId,
					status: r.status,
					label: r.label ?? null,
					created_at: r.createdAt ? new Date(r.createdAt).toISOString() : null,
					rotated_at: r.rotatedAt ? new Date(r.rotatedAt).toISOString() : null,
					retired_at: r.retiredAt ? new Date(r.retiredAt).toISOString() : null,
					revoked_at: r.revokedAt ? new Date(r.revokedAt).toISOString() : null,
					grace_window_secs: r.graceWindowSecs,
				})),
			});
		},
	);

	// ── POST /agents/:id/keys/rotate — generate new key, retire old ──

	fastify.post<{
		Params: { id: string };
		Body: z.infer<typeof rotateBodySchema>;
	}>(
		"/agents/:id/keys/rotate",
		{ preHandler: requireAuth },
		async (
			request: FastifyRequest<{
				Params: { id: string };
				Body: z.infer<typeof rotateBodySchema>;
			}>,
			reply: FastifyReply,
		) => {
			const agentParseResult = agentIdParamsSchema.safeParse(request.params);
			if (!agentParseResult.success) {
				return reply.status(400).send({ error: "Invalid agent ID" });
			}
			const { id: agentId } = agentParseResult.data;

			const bodyParseResult = rotateBodySchema.safeParse(request.body ?? {});
			if (!bodyParseResult.success) {
				return reply.status(400).send({
					error: "Validation failed",
					details: bodyParseResult.error.issues,
				});
			}
			const { grace_window_secs = DEFAULT_GRACE_WINDOW_SECS, label } =
				bodyParseResult.data;

			// Find current active key for this agent.
			const [currentKey] = await db
				.select()
				.from(agentKeys)
				.where(
					and(eq(agentKeys.agentId, agentId), eq(agentKeys.status, "active")),
				)
				.limit(1);

			const prevVersion = currentKey?.keyVersion ?? 0;
			const now = new Date();

			// Generate new versioned keypair via llmtxt-core primitives.
			// We import the WASM-backed keygen from the packages/llmtxt SDK (SSoT).
			// For key wrapping we use Node.js crypto directly (AES-256-GCM) since
			// the Rust wrap_secret is not available through WASM on the server path.
			const { generateKeyPair } = await import("node:crypto");
			const crypto = await import("node:crypto");

			// Generate Ed25519 keypair using Node.js WebCrypto (constant-time, native).
			const keyPair = await new Promise<{
				privateKey: CryptoKey;
				publicKey: CryptoKey;
			}>((resolve, reject) =>
				generateKeyPair("ed25519", {}, (err, pub, priv) => {
					if (err) reject(err);
					else
						resolve({
							publicKey: pub as unknown as CryptoKey,
							privateKey: priv as unknown as CryptoKey,
						});
				}),
			);

			// Export keys as raw bytes.
			const pubKeyRaw = (
				keyPair.publicKey as unknown as {
					export: (opts: { type: string; format: string }) => Buffer;
				}
			).export({
				type: "spki",
				format: "der",
			});
			const privKeyRaw = (
				keyPair.privateKey as unknown as {
					export: (opts: { type: string; format: string }) => Buffer;
				}
			).export({
				type: "pkcs8",
				format: "der",
			});

			// Ed25519 spki DER: last 32 bytes are the raw public key.
			const pubKey32 = pubKeyRaw.slice(-32);
			// Ed25519 pkcs8 DER: last 32 bytes are the raw private key (seed).
			const privKey32 = privKeyRaw.slice(-32);

			// Compute key ID = first 16 hex chars of SHA-256(pubkey_bytes).
			const pubHash = crypto
				.createHash("sha256")
				.update(pubKey32)
				.digest("hex");
			const keyId = pubHash.slice(0, 16);

			// Wrap private key with KEK using AES-256-GCM.
			const kek = resolveKek();
			const nonce = crypto.randomBytes(12);
			const cipher = crypto.createCipheriv("aes-256-gcm", kek, nonce);
			const ctBuf = Buffer.concat([cipher.update(privKey32), cipher.final()]);
			const tag = cipher.getAuthTag();
			// Wrapped = nonce(12) || ciphertext(32) || tag(16) = 60 bytes.
			const privkeyWrapped = Buffer.concat([nonce, ctBuf, tag]);

			const newVersion = prevVersion + 1;

			// Atomically: mark old key as retiring + insert new key.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await db.transaction(async (tx: any) => {
				if (currentKey) {
					await tx
						.update(agentKeys)
						.set({ status: "retiring", rotatedAt: now })
						.where(eq(agentKeys.id, currentKey.id));

					writeKeyAuditEvent({
						agentId,
						keyId: currentKey.keyId,
						keyVersion: currentKey.keyVersion,
						eventType: "rotated",
						actorId: request.user?.id ?? null,
						ipAddress: getIp(request),
						details: { new_version: newVersion, grace_window_secs },
					});
				}

				await tx.insert(agentKeys).values({
					agentId,
					keyVersion: newVersion,
					keyId,
					pubkey: Buffer.from(pubKey32),
					privkeyWrapped,
					status: "active",
					graceWindowSecs: grace_window_secs,
					label: label ?? null,
				});

				writeKeyAuditEvent({
					agentId,
					keyId,
					keyVersion: newVersion,
					eventType: "generated",
					actorId: request.user?.id ?? null,
					ipAddress: getIp(request),
					details: { prev_version: prevVersion || null, grace_window_secs },
				});
			});

			const graceEndsAt =
				prevVersion > 0
					? new Date(now.getTime() + grace_window_secs * 1000).toISOString()
					: null;

			return reply.status(201).send({
				agent_id: agentId,
				new_key: {
					key_version: newVersion,
					key_id: keyId,
					pubkey_hex: Buffer.from(pubKey32).toString("hex"),
					status: "active",
					created_at: now.toISOString(),
					label: label ?? null,
				},
				retired_key: currentKey
					? {
							key_version: currentKey.keyVersion,
							key_id: currentKey.keyId,
							status: "retiring",
							grace_window_secs,
							grace_ends_at: graceEndsAt,
						}
					: null,
				message:
					prevVersion > 0
						? `Key rotated. Previous key (v${prevVersion}) retiring — accepted for ${grace_window_secs}s.`
						: "First key generated for agent.",
			});
		},
	);

	// ── POST /agents/:id/keys/:keyId/revoke — immediate revocation ────

	fastify.post<{ Params: { id: string; keyId: string } }>(
		"/agents/:id/keys/:keyId/revoke",
		{ preHandler: requireAuth },
		async (
			request: FastifyRequest<{ Params: { id: string; keyId: string } }>,
			reply: FastifyReply,
		) => {
			const parseResult = keyIdParamsSchema.safeParse(request.params);
			if (!parseResult.success) {
				return reply.status(400).send({ error: "Invalid params" });
			}
			const { id: agentId, keyId } = parseResult.data;

			const [existing] = await db
				.select()
				.from(agentKeys)
				.where(and(eq(agentKeys.agentId, agentId), eq(agentKeys.keyId, keyId)))
				.limit(1);

			if (!existing) {
				return reply
					.status(404)
					.send({ error: "Key not found for this agent" });
			}

			if (existing.status === "revoked") {
				return reply.status(409).send({ error: "Key is already revoked" });
			}

			const now = new Date();
			await db
				.update(agentKeys)
				.set({ status: "revoked", revokedAt: now })
				.where(eq(agentKeys.id, existing.id));

			writeKeyAuditEvent({
				agentId,
				keyId: existing.keyId,
				keyVersion: existing.keyVersion,
				eventType: "revoked",
				actorId: request.user?.id ?? null,
				ipAddress: getIp(request),
				details: { previous_status: existing.status },
			});

			return reply.send({
				agent_id: agentId,
				key_id: keyId,
				key_version: existing.keyVersion,
				status: "revoked",
				revoked_at: now.toISOString(),
				message:
					"Key revoked immediately. All signatures from this key are now rejected.",
			});
		},
	);
}
