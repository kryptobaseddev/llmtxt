/**
 * Usage tracking and tier enforcement service.
 *
 * Provides:
 *   - `recordUsageEvent` — append a single usage event row.
 *   - `getMonthlyUsage` — aggregate current-month usage for a user.
 *   - `getUserSubscription` — fetch (or create) the user's subscription row.
 *   - `checkTierLimit` — evaluate whether a user may perform an operation.
 *
 * The tier evaluation logic is defined in crates/llmtxt-core (Rust / WASM).
 * The TypeScript implementation here is a faithful mirror of the Rust logic
 * (same constants, same evaluation order). Once wasm-pack rebuilds the
 * package with the billing module, this file can delegate to the WASM binding
 * by importing evaluate_tier_limits_wasm / get_tier_limits_wasm from 'llmtxt'.
 *
 * Design invariant: `evaluateTierLimits` is a pure function — same inputs
 * always yield the same output (no I/O, no global state).
 */

import { and, count, eq, gte, lt, sql, sum } from "drizzle-orm";
import { db } from "../db/index.js";
import {
	documents,
	type Subscription,
	subscriptions,
	usageEvents,
	usageRollups,
} from "../db/schema-pg.js";
import { generateId } from "../utils/compression.js";

// ── Tier limits (mirrors crates/llmtxt-core/src/billing.rs) ─────────────────

export type TierKind = "free" | "pro" | "enterprise";

interface TierLimits {
	max_documents: number | null;
	max_doc_bytes: number | null;
	max_api_calls_per_month: number | null;
	max_crdt_ops_per_month: number | null;
	max_agent_seats: number | null;
	max_storage_bytes: number | null;
}

const TIER_LIMITS: Record<TierKind, TierLimits> = {
	free: {
		max_documents: 50,
		max_doc_bytes: 500 * 1024, // 500 KB
		max_api_calls_per_month: 1_000,
		max_crdt_ops_per_month: 500,
		max_agent_seats: 3,
		max_storage_bytes: 25 * 1024 * 1024, // 25 MB
	},
	pro: {
		max_documents: 500,
		max_doc_bytes: 10 * 1024 * 1024, // 10 MB
		max_api_calls_per_month: 50_000,
		max_crdt_ops_per_month: 25_000,
		max_agent_seats: 25,
		max_storage_bytes: 5 * 1024 * 1024 * 1024, // 5 GB
	},
	enterprise: {
		max_documents: null, // unlimited
		max_doc_bytes: 100 * 1024 * 1024, // 100 MB per doc
		max_api_calls_per_month: null,
		max_crdt_ops_per_month: null,
		max_agent_seats: null,
		max_storage_bytes: null,
	},
};

/**
 * Return tier limits for a given tier string.
 * Unknown tier defaults to Free.
 */
export function getTierLimits(tier: string): TierLimits {
	const t = tier as TierKind;
	return TIER_LIMITS[t] ?? TIER_LIMITS.free;
}

// ── Tier evaluation ──────────────────────────────────────────────────────────

interface UsageSnapshot {
	document_count: number;
	api_calls_this_month: number;
	crdt_ops_this_month: number;
	agent_seat_count: number;
	storage_bytes: number;
	current_doc_bytes: number;
}

interface TierDecisionAllowed {
	status: "allowed";
}
interface TierDecisionBlocked {
	status: "blocked";
	limit_type: string;
	current: number;
	limit: number;
}
type TierDecision = TierDecisionAllowed | TierDecisionBlocked;

/**
 * Pure function — mirrors evaluate_tier_limits in billing.rs exactly.
 * Same evaluation order: documents → doc_bytes → api_calls → crdt_ops →
 * agent_seats → storage.
 */
export function evaluateTierLimits(
	usage: UsageSnapshot,
	tier: TierKind,
): TierDecision {
	const limits = getTierLimits(tier);

	if (
		limits.max_documents !== null &&
		usage.document_count >= limits.max_documents
	) {
		return {
			status: "blocked",
			limit_type: "max_documents",
			current: usage.document_count,
			limit: limits.max_documents,
		};
	}

	if (
		usage.current_doc_bytes > 0 &&
		limits.max_doc_bytes !== null &&
		usage.current_doc_bytes > limits.max_doc_bytes
	) {
		return {
			status: "blocked",
			limit_type: "max_doc_bytes",
			current: usage.current_doc_bytes,
			limit: limits.max_doc_bytes,
		};
	}

	if (
		limits.max_api_calls_per_month !== null &&
		usage.api_calls_this_month >= limits.max_api_calls_per_month
	) {
		return {
			status: "blocked",
			limit_type: "max_api_calls_per_month",
			current: usage.api_calls_this_month,
			limit: limits.max_api_calls_per_month,
		};
	}

	if (
		limits.max_crdt_ops_per_month !== null &&
		usage.crdt_ops_this_month >= limits.max_crdt_ops_per_month
	) {
		return {
			status: "blocked",
			limit_type: "max_crdt_ops_per_month",
			current: usage.crdt_ops_this_month,
			limit: limits.max_crdt_ops_per_month,
		};
	}

	if (
		limits.max_agent_seats !== null &&
		usage.agent_seat_count >= limits.max_agent_seats
	) {
		return {
			status: "blocked",
			limit_type: "max_agent_seats",
			current: usage.agent_seat_count,
			limit: limits.max_agent_seats,
		};
	}

	if (
		limits.max_storage_bytes !== null &&
		usage.storage_bytes >= limits.max_storage_bytes
	) {
		return {
			status: "blocked",
			limit_type: "max_storage_bytes",
			current: usage.storage_bytes,
			limit: limits.max_storage_bytes,
		};
	}

	return { status: "allowed" };
}

// ── Usage event types ────────────────────────────────────────────────────────

export type EventType =
	| "doc_read"
	| "doc_write"
	| "api_call"
	| "crdt_op"
	| "blob_upload";

// ── Helpers ──────────────────────────────────────────────────────────────────

function billingPeriodStart(): Date {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function billingPeriodEnd(): Date {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

// ── Usage recording ──────────────────────────────────────────────────────────

/**
 * Append a usage event row for the given user.
 * Best-effort: on DB error, logs the failure but does not throw.
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
		console.error("[usage] failed to record event", { opts, err });
	}
}

// ── Tier retrieval ───────────────────────────────────────────────────────────

/**
 * Fetch (or lazily create) the subscription row for a user.
 */
export async function getUserSubscription(
	userId: string,
): Promise<Subscription> {
	const [existing] = await db
		.select()
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
		.limit(1);

	if (existing) return existing;

	const [created] = await db
		.insert(subscriptions)
		.values({
			id: generateId(),
			userId,
			tier: "free",
			status: "active",
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
 * Return aggregate usage for the current calendar month.
 * Sums completed daily rollups + today's live event log.
 */
export async function getMonthlyUsage(userId: string): Promise<MonthlyUsage> {
	const periodStart = billingPeriodStart();
	const periodEnd = billingPeriodEnd();

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
				lt(usageRollups.rollupDate, periodEnd),
			),
		);

	const rollup = rollupRows[0] ?? {
		api_calls: 0,
		crdt_ops: 0,
		doc_reads: 0,
		doc_writes: 0,
		bytes_ingested: 0,
	};

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
				gte(usageEvents.createdAt, todayStart),
			),
		)
		.groupBy(usageEvents.eventType);

	let liveApiCalls = 0,
		liveCrdtOps = 0,
		liveDocReads = 0,
		liveDocWrites = 0,
		liveBytesIngested = 0;

	for (const row of liveRows) {
		const n = row.event_count ?? 0;
		const b = row.total_bytes ?? 0;
		switch (row.event_type) {
			case "api_call":
				liveApiCalls += n;
				break;
			case "crdt_op":
				liveCrdtOps += n;
				break;
			case "doc_read":
				liveDocReads += n;
				break;
			case "doc_write":
				liveDocWrites += n;
				liveBytesIngested += b;
				break;
			case "blob_upload":
				liveBytesIngested += b;
				break;
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
 * Count active documents owned by the user.
 *
 * "Active" = not in ARCHIVED state and not yet expired.
 * The documents table does not have a deleted_at column; archival
 * is tracked via the `state` column ('DRAFT' | 'REVIEW' | 'LOCKED' | 'ARCHIVED').
 * Expired documents are purged by the GC job so we only count non-expired ones
 * (expiresAt IS NULL OR expiresAt > now()).
 */
export async function getUserDocumentCount(userId: string): Promise<number> {
	const now = Date.now();
	const rows = await db
		.select({ n: count(documents.id).mapWith(Number) })
		.from(documents)
		.where(
			and(
				eq(documents.ownerId, userId),
				sql`${documents.state} != 'ARCHIVED'`,
				sql`(${documents.expiresAt} IS NULL OR ${documents.expiresAt} > ${now})`,
			),
		);
	return rows[0]?.n ?? 0;
}

// ── Tier limit check ──────────────────────────────────────────────────────────

export interface TierCheckResult {
	allowed: boolean;
	tier: string;
	limitType?: string;
	current?: number;
	limit?: number;
	upgradeUrl: string;
}

const UPGRADE_URL = "https://www.llmtxt.my/pricing";

/**
 * Check whether the user may perform an operation.
 *
 * Collects current usage from the database, then delegates to the pure
 * `evaluateTierLimits` function (mirroring Rust SSoT in crates/llmtxt-core).
 */
export async function checkTierLimit(
	userId: string,
	currentDocBytes = 0,
): Promise<TierCheckResult> {
	const [sub, monthly, docCount] = await Promise.all([
		getUserSubscription(userId),
		getMonthlyUsage(userId),
		getUserDocumentCount(userId),
	]);

	const tier = isEffectiveTier(sub) as TierKind;

	const usage: UsageSnapshot = {
		document_count: docCount,
		api_calls_this_month: monthly.api_calls,
		crdt_ops_this_month: monthly.crdt_ops,
		agent_seat_count: 0,
		storage_bytes: monthly.bytes_ingested,
		current_doc_bytes: currentDocBytes,
	};

	const result = evaluateTierLimits(usage, tier);

	if (result.status === "allowed") {
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
 * Return the effective tier accounting for grace period expiry.
 */
export function isEffectiveTier(sub: Subscription): string {
	if (sub.tier === "free" || sub.tier === "enterprise") return sub.tier;

	if (sub.status === "past_due" && sub.gracePeriodEnd) {
		const now = new Date();
		if (now > sub.gracePeriodEnd) return "free";
	}

	if (sub.status === "canceled") return "free";
	return sub.tier;
}
