/**
 * Event log background jobs.
 *
 * Two jobs:
 *
 * 1. COMPACTION (every 24h):
 *    For documents with >10,000 events, collapse the oldest 5,000 rows into
 *    a single `event.compacted` summary row within a transaction. Deletes
 *    the originals atomically.
 *
 * 2. CHAIN VALIDATOR (every 6h):
 *    For the 100 most-active documents, recompute the last 100 rows' hash
 *    chain. Logs CRITICAL if a mismatch is found.
 *
 * Both jobs use setInterval and run in-process. They emit structured log
 * lines compatible with the OTel logger registered in instrumentation.ts.
 *
 * Usage:
 *   import { startEventLogJobs } from './jobs/event-log-compaction.js';
 *   startEventLogJobs(); // call once at server start
 */

import { createHash } from 'node:crypto';
import { eq, desc, asc, count, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documentEvents } from '../db/schema-pg.js';
import { validateHashChain } from '../lib/document-events.js';

const COMPACTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const VALIDATION_INTERVAL_MS = 6 * 60 * 60 * 1000;  // 6h
const COMPACTION_THRESHOLD = 10_000;
const COMPACTION_BATCH = 5_000;
const VALIDATION_TOP_N = 100;
const VALIDATION_LAST_N = 100;

// ── Compaction job ───────────────────────────────────────────────────────────

async function runCompactionJob(): Promise<void> {
  const tag = '[event-log-compaction]';
  console.log(`${tag} starting compaction sweep`);

  try {
    // Find documents with >COMPACTION_THRESHOLD events
    const busyDocs: Array<{ documentId: string; cnt: number }> = await db
      .select({
        documentId: documentEvents.documentId,
        cnt: sql<number>`count(*)`,
      })
      .from(documentEvents)
      .groupBy(documentEvents.documentId)
      .having(sql`count(*) > ${COMPACTION_THRESHOLD}`);

    if (busyDocs.length === 0) {
      console.log(`${tag} no documents exceed threshold — skipping`);
      return;
    }

    for (const { documentId, cnt } of busyDocs) {
      console.log(`${tag} compacting ${documentId} (${cnt} events)`);

      await db.transaction(async (tx: typeof db) => {
        // Grab oldest COMPACTION_BATCH rows
        const oldest: Array<{
          id: string;
          seq: bigint;
          eventType: string;
          actorId: string;
          payloadJson: unknown;
          createdAt: Date;
          prevHash: Buffer | null;
        }> = await tx
          .select()
          .from(documentEvents)
          .where(eq(documentEvents.documentId, documentId))
          .orderBy(asc(documentEvents.seq))
          .limit(COMPACTION_BATCH);

        if (oldest.length < COMPACTION_BATCH) {
          // Not enough rows to compact — skip this document this cycle.
          return;
        }

        const fromSeq = oldest[0].seq;
        const toSeq = oldest[oldest.length - 1].seq;
        const eventsCount = oldest.length;

        // Build a summary hash over all collapsed rows
        const summaryHash = createHash('sha256');
        for (const row of oldest) {
          summaryHash.update(
            [row.id, row.seq.toString(), row.eventType, JSON.stringify(row.payloadJson)].join('|'),
            'utf-8',
          );
        }
        const summaryHashHex = summaryHash.digest('hex');

        // Delete the originals
        for (const row of oldest) {
          await tx.delete(documentEvents).where(eq(documentEvents.id, row.id));
        }

        // Insert compacted summary row using the next available seq
        // (seq = toSeq stays — we will insert at toSeq + 1 conceptually;
        //  but we cannot re-use the auto-increment path here as we are in a job,
        //  not a route handler. We insert with seq = fromSeq to anchor the history gap.)
        // Design: use fromSeq as the summary's seq; the chain for seq < fromSeq is now
        // replaced by this summary. Validator skips seq ranges covered by compacted rows.
        await tx.insert(documentEvents).values({
          documentId,
          seq: fromSeq,
          eventType: 'event.compacted',
          actorId: 'system',
          payloadJson: { from_seq: fromSeq.toString(), to_seq: toSeq.toString(), events_count: eventsCount, summary_hash: summaryHashHex },
          idempotencyKey: null,
          prevHash: null, // Genesis of compacted chain segment
        });

        console.log(`${tag} compacted ${documentId}: seq ${fromSeq}-${toSeq} → 1 summary row`);
      });
    }
  } catch (err) {
    console.error(`${tag} compaction error:`, err);
  }
}

// ── Chain validation job ─────────────────────────────────────────────────────

async function runValidationJob(): Promise<void> {
  const tag = '[event-log-validator]';
  console.log(`${tag} starting chain validation sweep`);

  try {
    // Get top VALIDATION_TOP_N most-active documents by event count
    const topDocs: Array<{ documentId: string }> = await db
      .select({ documentId: documentEvents.documentId })
      .from(documentEvents)
      .groupBy(documentEvents.documentId)
      .orderBy(desc(sql`count(*)`))
      .limit(VALIDATION_TOP_N);

    for (const { documentId } of topDocs) {
      const result = await validateHashChain(db, documentId, VALIDATION_LAST_N);
      if (!result.valid) {
        console.error(
          `CRITICAL ${tag} hash chain broken for document '${documentId}': ${result.error}`,
        );
      }
    }

    console.log(`${tag} validated ${topDocs.length} documents`);
  } catch (err) {
    console.error(`${tag} validation error:`, err);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

let compactionTimer: ReturnType<typeof setInterval> | null = null;
let validationTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start both background jobs. Call once at server startup (after DB is ready).
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startEventLogJobs(): void {
  if (compactionTimer || validationTimer) return; // already running

  // Run immediately on start then repeat on schedule
  void runCompactionJob();
  compactionTimer = setInterval(() => void runCompactionJob(), COMPACTION_INTERVAL_MS);

  void runValidationJob();
  validationTimer = setInterval(() => void runValidationJob(), VALIDATION_INTERVAL_MS);

  console.log('[event-log-jobs] compaction and validation jobs started');
}

/**
 * Stop both background jobs. Useful in tests or graceful shutdown.
 */
export function stopEventLogJobs(): void {
  if (compactionTimer) {
    clearInterval(compactionTimer);
    compactionTimer = null;
  }
  if (validationTimer) {
    clearInterval(validationTimer);
    validationTimer = null;
  }
}
