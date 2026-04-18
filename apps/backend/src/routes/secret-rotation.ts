/**
 * Secret rotation routes — T090: Secret Rotation and KMS Integration.
 *
 * Endpoints:
 *   GET  /api/v1/admin/secrets
 *     — List current rotation metadata for all tracked secrets.
 *   POST /api/v1/admin/secrets/:name/rotate
 *     — Trigger a secret rotation (bumps version, starts grace window).
 *   GET  /api/v1/admin/secrets/:name/status
 *     — Check grace-window status for a specific secret.
 *
 * These endpoints are admin-only. The actual secret VALUES are never returned
 * or stored in the database. Only version metadata is managed here.
 *
 * Rotation runbook: see docs/ops/secret-rotation.md
 */

import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { secretsConfig } from "../db/schema-pg.js";
import { requireAuth } from "../middleware/auth.js";

// ── Validation schemas ────────────────────────────────────────────

const secretNameParamsSchema = z.object({
	name: z
		.string()
		.min(1)
		.max(128)
		.regex(/^[A-Z0-9_]+$/, "Secret name must be UPPER_SNAKE_CASE"),
});

const rotateSecretBodySchema = z.object({
	/** Grace window override (seconds). Default: current config or 3600. */
	grace_window_secs: z.number().int().min(60).max(86400).optional(),
});

// ── Route handlers ────────────────────────────────────────────────

export async function secretRotationRoutes(
	fastify: FastifyInstance,
): Promise<void> {
	// ── GET /admin/secrets — list all secret rotation configs ─────────

	fastify.get(
		"/admin/secrets",
		{ preHandler: requireAuth },
		async (_request: FastifyRequest, reply: FastifyReply) => {
			const rows = await db
				.select()
				.from(secretsConfig)
				.orderBy(secretsConfig.secretName);

			const now = Date.now();
			return reply.send({
				secrets: rows.map((r: (typeof rows)[number]) => {
					const rotatedAt = r.rotatedAt
						? new Date(r.rotatedAt).getTime()
						: null;
					const graceWindowMs = (r.graceWindowSecs ?? 3600) * 1000;
					const graceActive =
						rotatedAt !== null && r.previousVersion !== null
							? now < rotatedAt + graceWindowMs
							: false;
					const graceEndsAt =
						graceActive && rotatedAt !== null
							? new Date(rotatedAt + graceWindowMs).toISOString()
							: null;

					return {
						name: r.secretName,
						provider: r.provider,
						current_version: r.currentVersion,
						previous_version: r.previousVersion ?? null,
						grace_window_secs: r.graceWindowSecs,
						grace_window_active: graceActive,
						grace_ends_at: graceEndsAt,
						rotated_at: r.rotatedAt
							? new Date(r.rotatedAt).toISOString()
							: null,
						vault_path: r.vaultPath ?? null,
						kms_key_id: r.kmsKeyId ?? null,
					};
				}),
			});
		},
	);

	// ── GET /admin/secrets/:name/status ────────────────────────────────

	fastify.get<{ Params: { name: string } }>(
		"/admin/secrets/:name/status",
		{ preHandler: requireAuth },
		async (
			request: FastifyRequest<{ Params: { name: string } }>,
			reply: FastifyReply,
		) => {
			const parseResult = secretNameParamsSchema.safeParse(request.params);
			if (!parseResult.success) {
				return reply.status(400).send({
					error: "Invalid secret name",
					details: parseResult.error.issues,
				});
			}
			const { name } = parseResult.data;

			const [config] = await db
				.select()
				.from(secretsConfig)
				.where(eq(secretsConfig.secretName, name))
				.limit(1);

			if (!config) {
				return reply
					.status(404)
					.send({ error: "Secret not found in rotation config" });
			}

			const now = Date.now();
			const rotatedAt = config.rotatedAt
				? new Date(config.rotatedAt).getTime()
				: null;
			const graceWindowMs = (config.graceWindowSecs ?? 3600) * 1000;
			const graceActive =
				rotatedAt !== null && config.previousVersion !== null
					? now < rotatedAt + graceWindowMs
					: false;
			const graceRemainingMs =
				graceActive && rotatedAt !== null
					? Math.max(0, rotatedAt + graceWindowMs - now)
					: 0;

			return reply.send({
				name: config.secretName,
				provider: config.provider,
				current_version: config.currentVersion,
				previous_version: config.previousVersion ?? null,
				grace_window_secs: config.graceWindowSecs,
				grace_window_active: graceActive,
				grace_remaining_ms: graceRemainingMs,
				grace_ends_at:
					graceActive && rotatedAt !== null
						? new Date(rotatedAt + graceWindowMs).toISOString()
						: null,
				rotated_at: config.rotatedAt
					? new Date(config.rotatedAt).toISOString()
					: null,
			});
		},
	);

	// ── POST /admin/secrets/:name/rotate — bump version + start grace ─

	fastify.post<{
		Params: { name: string };
		Body: z.infer<typeof rotateSecretBodySchema>;
	}>(
		"/admin/secrets/:name/rotate",
		{ preHandler: requireAuth },
		async (
			request: FastifyRequest<{
				Params: { name: string };
				Body: z.infer<typeof rotateSecretBodySchema>;
			}>,
			reply: FastifyReply,
		) => {
			const nameParseResult = secretNameParamsSchema.safeParse(request.params);
			if (!nameParseResult.success) {
				return reply.status(400).send({ error: "Invalid secret name" });
			}
			const { name } = nameParseResult.data;

			const bodyParseResult = rotateSecretBodySchema.safeParse(
				request.body ?? {},
			);
			if (!bodyParseResult.success) {
				return reply.status(400).send({
					error: "Validation failed",
					details: bodyParseResult.error.issues,
				});
			}
			const { grace_window_secs } = bodyParseResult.data;

			const [existing] = await db
				.select()
				.from(secretsConfig)
				.where(eq(secretsConfig.secretName, name))
				.limit(1);

			const now = new Date();

			if (!existing) {
				// First time tracking this secret.
				const [inserted] = await db
					.insert(secretsConfig)
					.values({
						secretName: name,
						currentVersion: 1,
						previousVersion: null,
						graceWindowSecs: grace_window_secs ?? 3600,
						provider: process.env.SECRETS_PROVIDER ?? "env",
					})
					.returning();

				return reply.status(201).send({
					name,
					current_version: 1,
					previous_version: null,
					grace_window_secs: inserted?.graceWindowSecs ?? 3600,
					grace_ends_at: null,
					message: "Secret rotation config initialized at version 1.",
				});
			}

			// Bump version, record previous for grace window.
			const newVersion = existing.currentVersion + 1;
			const graceWindow = grace_window_secs ?? existing.graceWindowSecs ?? 3600;
			const graceEndsAt = new Date(
				now.getTime() + graceWindow * 1000,
			).toISOString();

			await db
				.update(secretsConfig)
				.set({
					currentVersion: newVersion,
					previousVersion: existing.currentVersion,
					rotatedAt: now,
					graceWindowSecs: graceWindow,
					updatedAt: now,
				})
				.where(eq(secretsConfig.secretName, name));

			return reply.send({
				name,
				current_version: newVersion,
				previous_version: existing.currentVersion,
				grace_window_secs: graceWindow,
				grace_ends_at: graceEndsAt,
				message:
					`Secret '${name}' rotated to v${newVersion}. ` +
					`Previous version (v${existing.currentVersion}) accepted for ${graceWindow}s until ${graceEndsAt}. ` +
					`IMPORTANT: Deploy the new secret value as ${name}_V${newVersion} before this rotation takes effect.`,
			});
		},
	);
}
