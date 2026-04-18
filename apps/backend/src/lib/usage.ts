/**
 * Usage tracking and tier enforcement service.
 *
 * Provides:
 *   - `recordUsageEvent` — append a single usage event row.
 *   - `getMonthlyUsage` — aggregate current-month usage for a user.
 *   - `getUserTier` — fetch (or create) the user's subscription row.
 *   - `checkTierLimit` — evaluate whether a user may perform an operation.
 *
 * The tier evaluation logic lives in crates/llmtxt-core (Rust / WASM).
 * This module is the only place in the TypeScript backend that calls it;
 * no other file should duplicate the limit constants.
 */

import { eq, and, gte, lt, sql, count, sum } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  usageEvents,
  usageRollups,
  subscriptions,
  documents,
  type Subscription,
} from '../db/schema-pg.js';
import { generateId } from '../utils/compression.js';

// ── Tier evaluation (WASM SSoT) ──────────────────────────────────────────────

// We import the WASM binding from the llmtxt npm package (which wraps
// crates/llmtxt-core). The evaluate_tier_limits_wasm function is
// deterministic and has no I/O.
import {
  evaluate_tier_limits_wasm,
  get_tier_limits_wasm,
} from 'llmtxt';

export type EventType = 'doc_read' | 'doc_write' | 'api_call' | 'crdt_op' | 'blob_upload';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the start of the current billing month (first day at 00:00 UTC).
 * We use calendar month, not 30-day rolling window, for simplicity.
 */
function billingPeriodStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Return the start of the next billing month.
 */
function billingPeriodEnd(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

// ── Usage recording ──────────────────────────────────────────────────────────

/**
 * Append a usage event row for the given user.
 * Best-effort: on DB error, logs the failure but does not throw (never
 * block a request due to usage accounting failure).
 */
export async function recordUsageEvent(opts: {
  userId: string;
  agentId?: string;
  eventType: EventType;
  resourceId?: string;
  bytes?: number;
}): Promise<void> {
  try {
    await db.insert(usageEvents).values({
      id: generateId(),
      userId: opts.userId,
      agentId: opts.agentId ?? null,
      eventType: opts.eventType,
      resourceId: opts.resourceId ?? null,
      bytes: opts.bytes ?? 0,
    });
  } catch (err) {
    // Log but never throw — billing recording must not block API responses.
    console.error('[usage] failed to record event', { opts, err });
  }
}

// ── Tier retrieval ───────────────────────────────────────────────────────────

/**
 * Fetch the subscription row for a user, creating a Free-tier row
 * if none exists yet (lazy initialisation).
 */
export async function getUserSubscription(userId: string): Promise<Subscription> {
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  if (existing) return existing;

  // Create Free-tier subscription lazily on first check.
  const [created] = await db
    .insert(subscriptions)
    .values({
      id: generateId(),
      userId,
      tier: 'free',
      status: 'active',
    })
    .returning();

  return created;
}

// ── Monthly usage aggregation ─────────────────────────────────────────────────

export interface MonthlyUsage {
  api_calls: number;
  crdt_ops: number;
  doc_reads: number;
  doc_writes: number;
  bytes_ingested: number;
}

/**
 * Return the aggregate usage for the current calendar month.
 *
 * We first look at the sum of daily rollups for this month (fast, indexed).
 * For the current incomplete day, we add the live event log totals.
 * This gives accurate real-time numbers without expensive full-table scans.
 */
export async function getMonthlyUsage(userId: string): Promise<MonthlyUsage> {
  const periodStart = billingPeriodStart();
  const periodEnd = billingPeriodEnd();

  // Sum all completed rollup days in this billing month.
  const rollupRows = await db
    .select({
      api_calls: sum(usageRollups.apiCalls).mapWith(Number),
      crdt_ops: sum(usageRollups.crdtOps).mapWith(Number),
      doc_reads: sum(usageRollups.docReads).mapWith(Number),
      doc_writes: sum(usageRollups.docWrites).mapWith(Number),
      bytes_ingested: sum(usageRollups.bytesIngested).mapWith(Number),
    })
    .from(usageRollups)
    .where(
      and(
        eq(usageRollups.userId, userId),
        gte(usageRollups.rollupDate, periodStart),
        lt(usageRollups.rollupDate, periodEnd)
      )
    );

  const rollup = rollupRows[0] ?? {
    api_calls: 0, crdt_ops: 0, doc_reads: 0, doc_writes: 0, bytes_ingested: 0,
  };

  // Add today's live events (not yet aggregated into a rollup).
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const liveRows = await db
    .select({
      event_type: usageEvents.eventType,
      total_bytes: sum(usageEvents.bytes).mapWith(Number),
      event_count: count(usageEvents.id).mapWith(Number),
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        gte(usageEvents.createdAt, todayStart)
      )
    )
    .groupBy(usageEvents.eventType);

  let liveApiCalls = 0;
  let liveCrdtOps = 0;
  let liveDocReads = 0;
  let liveDocWrites = 0;
  let liveBytesIngested = 0;

  for (const row of liveRows) {
    const n = row.event_count ?? 0;
    const b = row.total_bytes ?? 0;
    switch (row.event_type) {
      case 'api_call': liveApiCalls += n; break;
      case 'crdt_op': liveCrdtOps += n; break;
      case 'doc_read': liveDocReads += n; break;
      case 'doc_write': liveDocWrites += n; liveBytesIngested += b; break;
      case 'blob_upload': liveBytesIngested += b; break;
    }
  }

  return {
    api_calls: (rollup.api_calls ?? 0) + liveApiCalls,
    crdt_ops: (rollup.crdt_ops ?? 0) + liveCrdtOps,
    doc_reads: (rollup.doc_reads ?? 0) + liveDocReads,
    doc_writes: (rollup.doc_writes ?? 0) + liveDocWrites,
    bytes_ingested: (rollup.bytes_ingested ?? 0) + liveBytesIngested,
  };
}

// ── Document count ────────────────────────────────────────────────────────────

/**
 * Count the number of non-deleted documents owned by the user.
 */
export async function getUserDocumentCount(userId: string): Promise<number> {
  const rows = await db
    .select({ n: count(documents.id).mapWith(Number) })
    .from(documents)
    .where(
      and(
        eq(documents.ownerId, userId),
        sql`${documents.deletedAt} IS NULL`
      )
    );
  return rows[0]?.n ?? 0;
}

// ── Tier limit check ──────────────────────────────────────────────────────────

export interface TierCheckResult {
  allowed: boolean;
  tier: string;
  /** Populated only when allowed=false */
  limitType?: string;
  current?: number;
  limit?: number;
  upgradeUrl: string;
}

const UPGRADE_URL = 'https://www.llmtxt.my/pricing';

/**
 * Check whether the user is allowed to perform an operation.
 *
 * `currentDocBytes` should be set for doc_write events (the size of the
 * document being written). Pass 0 for other event types.
 *
 * The evaluation is delegated to crates/llmtxt-core via WASM binding.
 * No limit constants are defined in TypeScript — the Rust module is the SSoT.
 */
export async function checkTierLimit(
  userId: string,
  currentDocBytes = 0
): Promise<TierCheckResult> {
  const [sub, monthly, docCount] = await Promise.all([
    getUserSubscription(userId),
    getMonthlyUsage(userId),
    getUserDocumentCount(userId),
  ]);

  const tier = isEffectiveTier(sub);

  const usageSnapshot = {
    document_count: docCount,
    api_calls_this_month: monthly.api_calls,
    crdt_ops_this_month: monthly.crdt_ops,
    agent_seat_count: 0, // TODO: query agent pubkeys count when needed
    storage_bytes: monthly.bytes_ingested,
    current_doc_bytes: currentDocBytes,
  };

  const resultJson = evaluate_tier_limits_wasm(JSON.stringify(usageSnapshot), tier);
  const result = JSON.parse(resultJson) as
    | { status: 'allowed' }
    | { status: 'blocked'; limit_type: string; current: number; limit: number };

  if (result.status === 'allowed') {
    return { allowed: true, tier, upgradeUrl: UPGRADE_URL };
  }

  return {
    allowed: false,
    tier,
    limitType: result.limit_type,
    current: result.current,
    limit: result.limit,
    upgradeUrl: UPGRADE_URL,
  };
}

/**
 * Return the effective tier string for a subscription, accounting for
 * grace period expiry (downgrades to 'free' after grace_period_end).
 */
export function isEffectiveTier(sub: Subscription): string {
  if (sub.tier === 'free' || sub.tier === 'enterprise') return sub.tier;

  // Pro with past_due: check grace period
  if (sub.status === 'past_due' && sub.gracePeriodEnd) {
    const now = new Date();
    if (now > sub.gracePeriodEnd) {
      return 'free'; // grace period expired — enforce free limits
    }
  }

  if (sub.status === 'canceled') return 'free';

  return sub.tier;
}

/**
 * Return tier limits from the Rust SSoT as a plain object.
 * Used by the /api/me/usage endpoint to return limit values alongside usage.
 */
export function getTierLimits(tier: string): Record<string, number | null> {
  const json = get_tier_limits_wasm(tier);
  return JSON.parse(json);
}
