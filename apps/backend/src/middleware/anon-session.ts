/**
 * Anonymous session lifecycle middleware (T167).
 *
 * Enforces the anonymous session expiry contract:
 *   - Anonymous sessions expire 24h after last activity.
 *   - Expired anonymous session tokens return 401 SESSION_EXPIRED.
 *
 * This middleware runs as a preHandler on all authenticated routes.
 * It is a no-op for registered (non-anonymous) users.
 *
 * Session expiry is stored in the `users.expiresAt` column (unix ms).
 * On each valid request, `users.expiresAt` is refreshed to (now + 24h).
 *
 * The refresh is fire-and-forget to avoid adding latency to the request path.
 */

import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

/** Maximum anonymous session lifetime in milliseconds: 24 hours. */
export const ANON_SESSION_TTL_MS = parseInt(
	process.env.ANON_SESSION_TTL_MS ?? String(24 * 60 * 60 * 1000),
	10,
);

/**
 * Check whether an anonymous session has expired and refresh its deadline.
 *
 * - If `request.user` is not set or is not anonymous: no-op.
 * - If the anonymous user's `expiresAt` is in the past: returns 401 SESSION_EXPIRED.
 * - Otherwise: refreshes `expiresAt` to (now + ANON_SESSION_TTL_MS) asynchronously.
 *
 * Attach as a preHandler on any route that calls requireAuth.
 */
export async function enforceAnonSessionExpiry(
	request: FastifyRequest,
	reply: FastifyReply,
): Promise<void> {
	const user = request.user;
	if (!user?.id || user.isAnonymous !== true) {
		return; // Not an anonymous session — nothing to enforce.
	}

	const now = Date.now();

	// Fetch the user's expiry from the database.
	// We query directly rather than trusting the session token's embedded expiry
	// (which could be stale from a cached token).
	const [row] = await db
		.select({ expiresAt: users.expiresAt })
		.from(users)
		.where(eq(users.id, user.id))
		.limit(1);

	if (!row) {
		// User deleted mid-session
		reply.status(401).send({
			error: "Unauthorized",
			code: "SESSION_EXPIRED",
			message:
				"Anonymous session has expired or been deleted. Start a new anonymous session.",
		});
		return;
	}

	if (
		row.expiresAt !== null &&
		row.expiresAt !== undefined &&
		row.expiresAt <= now
	) {
		reply.status(401).send({
			error: "Unauthorized",
			code: "SESSION_EXPIRED",
			message:
				"Anonymous session has expired. Start a new anonymous session via POST /auth/sign-in/anonymous.",
		});
		return;
	}

	// Refresh the session expiry (sliding window) — fire and forget.
	const newExpiry = now + ANON_SESSION_TTL_MS;
	db.update(users)
		.set({ expiresAt: newExpiry, updatedAt: now })
		.where(eq(users.id, user.id))
		.catch(() => {
			// Non-fatal: refresh failure should not block the request.
		});
}

/**
 * Purge expired anonymous users from the database.
 *
 * Called by the background job scheduler (jobs/anon-session-cleanup.ts).
 * Returns the number of deleted rows.
 *
 * Deleting the user cascades to sessions, documents (if ON DELETE CASCADE),
 * and api_keys. Documents created by the anonymous user that are NOT claimed
 * have their ownerId set to NULL by the `ON DELETE SET NULL` FK on documents.ownerId.
 */
export async function purgeExpiredAnonUsers(): Promise<number> {
	const now = Date.now();

	// Fetch IDs of expired anonymous users first (for logging / auditing)
	const expired = await db
		.select({ id: users.id })
		.from(users)
		.where(
			and(
				eq(users.isAnonymous, true),
				isNotNull(users.expiresAt),
				lt(users.expiresAt, now),
			),
		)
		.limit(500); // Process in batches of 500

	if (expired.length === 0) return 0;

	// Delete in batch
	for (const { id } of expired) {
		await db.delete(users).where(eq(users.id, id));
	}

	return expired.length;
}
