/**
 * Background job: purge expired anonymous sessions and auto-archive stale anon documents.
 *
 * Runs on a schedule set by the job runner. Default interval: every 30 minutes.
 *
 * Phase 1: Delete expired anonymous users (expiresAt < now, isAnonymous=true).
 *   - Cascades to sessions and api_keys (FK ON DELETE CASCADE)
 *   - Documents get ownerId set to NULL (FK ON DELETE SET NULL) and are NOT deleted —
 *     they remain visible (if public) but become unclaimed.
 *
 * Phase 2: Auto-archive anonymous-created documents older than 30 days unless claimed.
 *   - "Claimed" = ownerId is a non-anonymous registered user
 *   - Archiving means setting the document state to 'ARCHIVED'
 *   - Env: ANON_DOC_ARCHIVE_DAYS (default: 30)
 */

import { and, eq, lt, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { documents, users } from "../db/schema.js";
import { purgeExpiredAnonUsers } from "../middleware/anon-session.js";

/** Number of days before an anonymous-created document is auto-archived. */
const ANON_DOC_ARCHIVE_DAYS = parseInt(
	process.env.ANON_DOC_ARCHIVE_DAYS ?? "30",
	10,
);

const ARCHIVE_THRESHOLD_MS = ANON_DOC_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Auto-archive anonymous documents that are older than ARCHIVE_THRESHOLD_MS
 * and have not been claimed by a registered user.
 *
 * "Claimed" = ownerId points to a non-anonymous registered user.
 * "Unclaimed" = ownerId is NULL (user was purged) OR ownerId is an anon user.
 *
 * Returns the count of archived documents.
 */
async function archiveStaleAnonDocuments(): Promise<number> {
	const threshold = Date.now() - ARCHIVE_THRESHOLD_MS;

	// Find anon-flagged documents that are old enough and not already archived.
	// We batch to avoid long-running transactions.
	const candidates = await db
		.select({ id: documents.id, ownerId: documents.ownerId })
		.from(documents)
		.where(
			and(
				eq(documents.isAnonymous, true),
				lt(documents.createdAt, threshold),
				ne(documents.state, "ARCHIVED"),
			),
		)
		.limit(200);

	if (candidates.length === 0) return 0;

	// Filter out documents whose ownerId is a registered (non-anonymous) user.
	// Those have been claimed and must NOT be archived here.
	const unclaimedIds: string[] = [];
	for (const doc of candidates) {
		if (doc.ownerId === null) {
			// Owner was purged — unclaimed
			unclaimedIds.push(doc.id);
			continue;
		}
		// Check if the owner is still anonymous
		const [owner] = await db
			.select({ isAnonymous: users.isAnonymous })
			.from(users)
			.where(eq(users.id, doc.ownerId))
			.limit(1);

		if (!owner || owner.isAnonymous === true) {
			unclaimedIds.push(doc.id);
		}
		// else: registered owner → claimed → skip
	}

	if (unclaimedIds.length === 0) return 0;

	const now = Date.now();
	for (const id of unclaimedIds) {
		await db
			.update(documents)
			.set({ state: "ARCHIVED", updatedAt: now })
			.where(eq(documents.id, id));
	}

	return unclaimedIds.length;
}

/**
 * Run the full anonymous cleanup cycle.
 * Called by the job scheduler.
 */
export async function runAnonSessionCleanup(): Promise<{
	purgedUsers: number;
	archivedDocs: number;
}> {
	const [purgedUsers, archivedDocs] = await Promise.all([
		purgeExpiredAnonUsers(),
		archiveStaleAnonDocuments(),
	]);

	return { purgedUsers, archivedDocs };
}
