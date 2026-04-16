/**
 * CRDT compaction job — periodic GC of raw update rows.
 *
 * Runs every 6 hours. For each (document_id, section_id) that has accumulated
 * more than 100 rows in section_crdt_updates, or has rows older than 7 days,
 * deletes the older updates keeping only the most recent `KEEP_WINDOW` rows.
 *
 * The consolidated state is always in `section_crdt_states.yrs_state`, so
 * deleting update rows never loses data — updates are ephemeral WAL entries
 * used for debugging and incremental diff. The consolidated state survives.
 *
 * Metrics:
 *   - Logs the number of rows deleted per run
 *   - Does not emit structured metrics (can be added via prom-client later)
 *
 * Activation:
 *   Call `startCrdtCompactionJob()` once in `index.ts` after DB is ready.
 *   The timer is a `setInterval` — automatically stops when process exits.
 */

import { db, dbDriver } from '../db/index.js';
import { pgSchema } from '../db/index.js';
import { eq, and, lt, sql } from 'drizzle-orm';

// ── Constants ─────────────────────────────────────────────────────────────────

const COMPACTION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_UPDATES_PER_SECTION = 100;
const KEEP_WINDOW = 50; // keep the N most recent update rows
const MAX_AGE_DAYS = 7;

// ── Job ───────────────────────────────────────────────────────────────────────

async function runCompaction(): Promise<void> {
  if (dbDriver !== 'postgres') {
    // Advisory locks and the compaction logic assume Postgres
    return;
  }

  const startedAt = Date.now();
  let totalDeleted = 0;

  try {
    // Find (document_id, section_id) pairs needing compaction.
    // Criteria: count > MAX_UPDATES_PER_SECTION OR min(created_at) < 7 days ago
    const cutoffDate = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

    const candidateQuery = await db.execute(sql`
      SELECT
        document_id,
        section_id,
        COUNT(*)::int AS cnt,
        MIN(seq) AS min_seq,
        MAX(seq) AS max_seq
      FROM section_crdt_updates
      GROUP BY document_id, section_id
      HAVING COUNT(*) > ${MAX_UPDATES_PER_SECTION}
         OR MIN(created_at) < ${cutoffDate}
    `);

    const candidates = candidateQuery.rows as Array<{
      document_id: string;
      section_id: string;
      cnt: number;
      min_seq: bigint;
      max_seq: bigint;
    }>;

    if (candidates.length === 0) {
      console.log('[crdt-compaction] no sections need compaction');
      return;
    }

    console.log(`[crdt-compaction] compacting ${candidates.length} section(s)`);

    for (const candidate of candidates) {
      const { document_id: documentId, section_id: sectionId, max_seq: maxSeq } = candidate;

      // Delete updates older than (max_seq - KEEP_WINDOW)
      const keepFromSeq = BigInt(maxSeq) - BigInt(KEEP_WINDOW);
      if (keepFromSeq <= 0n) continue;

      try {
        const deleted = await db
          .delete(pgSchema.sectionCrdtUpdates)
          .where(
            and(
              eq(pgSchema.sectionCrdtUpdates.documentId, documentId),
              eq(pgSchema.sectionCrdtUpdates.sectionId, sectionId),
              lt(pgSchema.sectionCrdtUpdates.seq, keepFromSeq),
            ),
          );

        // drizzle returns rowCount on postgres delete
        const rowsDeleted = (deleted as unknown as { rowCount?: number }).rowCount ?? 0;
        totalDeleted += rowsDeleted;

        if (rowsDeleted > 0) {
          console.log(
            `[crdt-compaction] doc=${documentId} sec=${sectionId} deleted=${rowsDeleted} updates`,
          );
        }
      } catch (err) {
        console.error(
          `[crdt-compaction] error compacting doc=${documentId} sec=${sectionId}:`,
          err,
        );
      }
    }

    const elapsed = Date.now() - startedAt;
    console.log(
      `[crdt-compaction] run complete: ${totalDeleted} rows deleted in ${elapsed}ms`,
    );
  } catch (err) {
    console.error('[crdt-compaction] compaction run failed:', err);
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the CRDT compaction background job.
 *
 * Runs immediately on startup (to handle backlog) then every 6 hours.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startCrdtCompactionJob(): void {
  if (_timer) return;

  // Run once at startup after a short delay to let the server warm up
  setTimeout(() => {
    void runCompaction();
  }, 30_000);

  _timer = setInterval(() => {
    void runCompaction();
  }, COMPACTION_INTERVAL_MS);

  // Allow process to exit even if this timer is pending
  _timer.unref();

  console.log('[crdt-compaction] job scheduled (interval: 6h)');
}
