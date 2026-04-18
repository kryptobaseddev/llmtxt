/**
 * Daily usage rollup background job.
 *
 * Runs at 01:00 UTC daily. For each user who has usage events in the
 * previous calendar day:
 *   1. Aggregate all usage_event rows into a daily total.
 *   2. Upsert a row into usage_rollups.
 *   3. (Optional future step) Purge usage_events older than 60 days.
 *
 * The job uses a simple setInterval loop — no external scheduler needed.
 * Crash-safe: the upsert is idempotent (UNIQUE on user_id + rollup_date).
 */

import { and, gte, lt, sql, sum, count, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { usageEvents, usageRollups } from '../db/schema-pg.js';
import { generateId } from '../utils/compression.js';

const ROLLUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Core aggregation ─────────────────────────────────────────────────────────

/**
 * Aggregate usage events for a given UTC day and upsert into usage_rollups.
 *
 * @param targetDate — the date to aggregate (defaults to yesterday UTC).
 */
export async function runUsageRollup(targetDate?: Date): Promise<void> {
  const now = new Date();

  // Default: yesterday UTC
  const rollupDay = targetDate ?? (() => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  })();

  const dayStart = new Date(Date.UTC(
    rollupDay.getUTCFullYear(),
    rollupDay.getUTCMonth(),
    rollupDay.getUTCDate()
  ));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  console.info(`[usage-rollup] Aggregating ${dayStart.toISOString().split('T')[0]}`);

  // Aggregate by (user_id, event_type) for the target day.
  const rows = await db
    .select({
      userId: usageEvents.userId,
      eventType: usageEvents.eventType,
      eventCount: count(usageEvents.id).mapWith(Number),
      totalBytes: sum(usageEvents.bytes).mapWith(Number),
    })
    .from(usageEvents)
    .where(
      and(
        gte(usageEvents.createdAt, dayStart),
        lt(usageEvents.createdAt, dayEnd)
      )
    )
    .groupBy(usageEvents.userId, usageEvents.eventType);

  // Pivot into per-user totals.
  const byUser = new Map<string, {
    api_calls: number;
    crdt_ops: number;
    doc_reads: number;
    doc_writes: number;
    bytes_ingested: number;
  }>();

  for (const row of rows) {
    if (!byUser.has(row.userId)) {
      byUser.set(row.userId, {
        api_calls: 0, crdt_ops: 0, doc_reads: 0, doc_writes: 0, bytes_ingested: 0,
      });
    }
    const u = byUser.get(row.userId)!;
    const n = row.eventCount ?? 0;
    const b = row.totalBytes ?? 0;

    switch (row.eventType) {
      case 'api_call': u.api_calls += n; break;
      case 'crdt_op': u.crdt_ops += n; break;
      case 'doc_read': u.doc_reads += n; break;
      case 'doc_write': u.doc_writes += n; u.bytes_ingested += b; break;
      case 'blob_upload': u.bytes_ingested += b; break;
    }
  }

  if (byUser.size === 0) {
    console.info('[usage-rollup] No events to aggregate');
    return;
  }

  // Upsert rollup rows.
  const rollupDate = new Date(dayStart);
  let upserted = 0;

  for (const [userId, totals] of byUser.entries()) {
    try {
      await db
        .insert(usageRollups)
        .values({
          id: generateId(),
          userId,
          rollupDate,
          apiCalls: totals.api_calls,
          crdtOps: totals.crdt_ops,
          docReads: totals.doc_reads,
          docWrites: totals.doc_writes,
          bytesIngested: totals.bytes_ingested,
        })
        .onConflictDoUpdate({
          target: [usageRollups.userId, usageRollups.rollupDate],
          set: {
            apiCalls: totals.api_calls,
            crdtOps: totals.crdt_ops,
            docReads: totals.doc_reads,
            docWrites: totals.doc_writes,
            bytesIngested: totals.bytes_ingested,
          },
        });
      upserted++;
    } catch (err) {
      console.error('[usage-rollup] Failed to upsert rollup for user', userId, err);
    }
  }

  console.info(`[usage-rollup] Done — ${upserted} users aggregated`);

  // Purge raw events older than 60 days (keep rollups forever).
  const purgeOlderThan = new Date();
  purgeOlderThan.setUTCDate(purgeOlderThan.getUTCDate() - 60);

  try {
    const result = await db
      .delete(usageEvents)
      .where(lt(usageEvents.createdAt, purgeOlderThan));
    console.info('[usage-rollup] Purged old usage events');
  } catch (err) {
    console.error('[usage-rollup] Failed to purge old events', err);
  }
}

// ── Job scheduler ────────────────────────────────────────────────────────────

/**
 * Start the daily usage rollup job.
 *
 * Runs once at startup for yesterday (catches any missed day), then
 * schedules the rollup to run every 24 hours aligned to 01:00 UTC.
 */
export function startUsageRollupJob(): void {
  console.info('[usage-rollup] Scheduling daily usage rollup job');

  // Run immediately for yesterday to catch any missed rollup.
  runUsageRollup().catch((err) =>
    console.error('[usage-rollup] Startup rollup failed', err)
  );

  // Calculate delay until next 01:00 UTC.
  const now = new Date();
  const nextRun = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    1, 0, 0 // 01:00 UTC
  ));
  const msUntilNext = nextRun.getTime() - now.getTime();

  setTimeout(() => {
    // Run at 01:00 UTC, then every 24 hours.
    runUsageRollup().catch((err) =>
      console.error('[usage-rollup] Scheduled rollup failed', err)
    );
    setInterval(() => {
      runUsageRollup().catch((err) =>
        console.error('[usage-rollup] Interval rollup failed', err)
      );
    }, ROLLUP_INTERVAL_MS);
  }, msUntilNext);

  console.info(
    `[usage-rollup] First run in ${Math.round(msUntilNext / 60_000)} minutes (at 01:00 UTC)`
  );
}
