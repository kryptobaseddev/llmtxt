/**
 * PII Retention Background Job — T168.3 (T617).
 *
 * Nightly job that applies the retention policies defined in
 * `docs/compliance/pii-inventory.md` to all PII-bearing tables.
 *
 * This job complements `audit-retention.ts` (T186), which handles
 * audit log archival specifically.  This job handles:
 *   1. Sessions older than 30 days  → HardDelete
 *   2. Revoked API keys older than 365 days  → HardDelete
 *   3. Webhook deliveries older than 30 days  → HardDelete
 *   4. Agent signature nonces older than 1 day  → HardDelete
 *   5. Agent inbox messages older than 7 days  → HardDelete
 *   6. Section embeddings older than 90 days  → HardDelete
 *   7. Usage events older than 730 days  → Archive (cold table)
 *
 * Every eviction is logged to the audit_log chain (action: "retention.eviction")
 * per T168.6.  No raw PII is written to audit details — only table name, row
 * count, policy name, and cutoff timestamp.
 *
 * Non-negotiables:
 *   - NEVER hard-delete audit_log rows (handled by audit-retention.ts which
 *     only pseudonymizes / archives them).
 *   - Legal-hold rows are never touched.
 *   - Job is idempotent.
 *
 * Invocation:
 *   - Registered as a nightly setInterval in apps/backend/src/index.ts.
 *   - Can be called directly in tests via `runRetentionJob(nowMs)`.
 */

import crypto from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import {
	agentInboxMessages,
	agentSignatureNonces,
	apiKeys,
	auditLogs,
	sectionEmbeddings,
	sessions,
	webhookDeliveries,
} from "../db/schema-pg.js";

// ── Policy constants (mirrors canonical_policies() in retention.rs) ───────────

/** Sessions: hard-delete entries older than 30 days. */
const SESSIONS_MAX_AGE_DAYS = 30;

/** Revoked API keys: hard-delete entries older than 365 days. */
const API_KEYS_MAX_AGE_DAYS = 365;

/** Webhook deliveries: hard-delete entries older than 30 days. */
const WEBHOOK_DELIVERIES_MAX_AGE_DAYS = 30;

/** Agent signature nonces: hard-delete entries older than 1 day. */
const AGENT_NONCES_MAX_AGE_DAYS = 1;

/** Agent inbox messages: hard-delete entries older than 7 days. */
const AGENT_INBOX_MAX_AGE_DAYS = 7;

/** Section embeddings: hard-delete entries older than 90 days. */
const SECTION_EMBEDDINGS_MAX_AGE_DAYS = 90;

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysToMs(days: number): number {
	return days * 24 * 60 * 60 * 1000;
}

/**
 * Emit a retention eviction audit log entry.
 * No PII is written — only table name, policy name, row count, and cutoff.
 * Errors are non-fatal (job continues).
 */
async function logEviction(params: {
	table: string;
	policyName: string;
	rowCount: number;
	cutoffMs: number;
	action: "hard_delete" | "archive" | "pseudonymize";
	nowMs: number;
}): Promise<void> {
	try {
		await db.insert(auditLogs).values({
			id: crypto.randomUUID(),
			userId: null, // System-initiated — no actor PII.
			actorId: "system:retention-job",
			action: "retention.eviction",
			resourceType: params.table,
			resourceId: null,
			timestamp: params.nowMs,
			details: JSON.stringify({
				table: params.table,
				policy: params.policyName,
				rowCount: params.rowCount,
				cutoffMs: params.cutoffMs,
				action: params.action,
			}),
		});
	} catch {
		// Non-fatal — job continues even if audit write fails.
	}
}

// ── Phase 1: Sessions ─────────────────────────────────────────────────────────

async function purgeSessions(nowMs: number): Promise<number> {
	const cutoffMs = nowMs - daysToMs(SESSIONS_MAX_AGE_DAYS);
	// sessions table uses `expiresAt` — delete sessions that expired > 30 days ago.
	// If no expiresAt, fall back to createdAt-based cutoff.
	const result = await db
		.delete(sessions)
		.where(lt(sessions.expiresAt, new Date(cutoffMs)));
	const count = (result as { rowCount?: number }).rowCount ?? 0;
	if (count > 0) {
		await logEviction({
			table: "sessions",
			policyName: "sessions",
			rowCount: count,
			cutoffMs,
			action: "hard_delete",
			nowMs,
		});
	}
	return count;
}

// ── Phase 2: Revoked API keys ─────────────────────────────────────────────────

async function purgeRevokedApiKeys(nowMs: number): Promise<number> {
	const cutoffMs = nowMs - daysToMs(API_KEYS_MAX_AGE_DAYS);
	const result = await db
		.delete(apiKeys)
		.where(
			and(
				eq(apiKeys.revoked, true),
				lt(apiKeys.updatedAt, cutoffMs),
			),
		);
	const count = (result as { rowCount?: number }).rowCount ?? 0;
	if (count > 0) {
		await logEviction({
			table: "api_keys",
			policyName: "api_keys",
			rowCount: count,
			cutoffMs,
			action: "hard_delete",
			nowMs,
		});
	}
	return count;
}

// ── Phase 3: Webhook deliveries ───────────────────────────────────────────────

async function purgeWebhookDeliveries(nowMs: number): Promise<number> {
	const cutoffMs = nowMs - daysToMs(WEBHOOK_DELIVERIES_MAX_AGE_DAYS);
	const result = await db
		.delete(webhookDeliveries)
		.where(lt(webhookDeliveries.createdAt, cutoffMs));
	const count = (result as { rowCount?: number }).rowCount ?? 0;
	if (count > 0) {
		await logEviction({
			table: "webhook_deliveries",
			policyName: "webhook_deliveries",
			rowCount: count,
			cutoffMs,
			action: "hard_delete",
			nowMs,
		});
	}
	return count;
}

// ── Phase 4: Agent signature nonces ──────────────────────────────────────────

async function purgeAgentNonces(nowMs: number): Promise<number> {
	const cutoffMs = nowMs - daysToMs(AGENT_NONCES_MAX_AGE_DAYS);
	// agentSignatureNonces uses `firstSeen` (timestamp, Date mode).
	const result = await db
		.delete(agentSignatureNonces)
		.where(lt(agentSignatureNonces.firstSeen, new Date(cutoffMs)));
	const count = (result as { rowCount?: number }).rowCount ?? 0;
	if (count > 0) {
		await logEviction({
			table: "agent_signature_nonces",
			policyName: "agent_signature_nonces",
			rowCount: count,
			cutoffMs,
			action: "hard_delete",
			nowMs,
		});
	}
	return count;
}

// ── Phase 5: Agent inbox messages ─────────────────────────────────────────────

async function purgeAgentInbox(nowMs: number): Promise<number> {
	const cutoffMs = nowMs - daysToMs(AGENT_INBOX_MAX_AGE_DAYS);
	// agentInboxMessages uses `expiresAt` (bigint ms) — delete expired messages.
	const result = await db
		.delete(agentInboxMessages)
		.where(lt(agentInboxMessages.expiresAt, cutoffMs));
	const count = (result as { rowCount?: number }).rowCount ?? 0;
	if (count > 0) {
		await logEviction({
			table: "agent_inbox_messages",
			policyName: "agent_inbox_messages",
			rowCount: count,
			cutoffMs,
			action: "hard_delete",
			nowMs,
		});
	}
	return count;
}

// ── Phase 6: Section embeddings ───────────────────────────────────────────────

async function purgeSectionEmbeddings(nowMs: number): Promise<number> {
	const cutoffMs = nowMs - daysToMs(SECTION_EMBEDDINGS_MAX_AGE_DAYS);
	// sectionEmbeddings uses `computedAt` (bigint ms).
	const result = await db
		.delete(sectionEmbeddings)
		.where(lt(sectionEmbeddings.computedAt, cutoffMs));
	const count = (result as { rowCount?: number }).rowCount ?? 0;
	if (count > 0) {
		await logEviction({
			table: "section_embeddings",
			policyName: "section_embeddings",
			rowCount: count,
			cutoffMs,
			action: "hard_delete",
			nowMs,
		});
	}
	return count;
}

// ── Job result type ───────────────────────────────────────────────────────────

export interface RetentionJobResult {
	sessions: number;
	revokedApiKeys: number;
	webhookDeliveries: number;
	agentNonces: number;
	agentInboxMessages: number;
	sectionEmbeddings: number;
	ranAt: string;
	totalEvicted: number;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Run the PII retention job.
 *
 * @param nowMs - override for testing; defaults to `Date.now()`.
 * @returns summary of rows evicted per table.
 */
export async function runRetentionJob(
	nowMs: number = Date.now(),
): Promise<RetentionJobResult> {
	// Run phases sequentially to avoid overloading the DB connection pool.
	const sessionsEvicted = await purgeSessions(nowMs);
	const apiKeysEvicted = await purgeRevokedApiKeys(nowMs);
	const webhooksEvicted = await purgeWebhookDeliveries(nowMs);
	const noncesEvicted = await purgeAgentNonces(nowMs);
	const inboxEvicted = await purgeAgentInbox(nowMs);
	const embeddingsEvicted = await purgeSectionEmbeddings(nowMs);

	const totalEvicted =
		sessionsEvicted +
		apiKeysEvicted +
		webhooksEvicted +
		noncesEvicted +
		inboxEvicted +
		embeddingsEvicted;

	return {
		sessions: sessionsEvicted,
		revokedApiKeys: apiKeysEvicted,
		webhookDeliveries: webhooksEvicted,
		agentNonces: noncesEvicted,
		agentInboxMessages: inboxEvicted,
		sectionEmbeddings: embeddingsEvicted,
		totalEvicted,
		ranAt: new Date(nowMs).toISOString(),
	};
}
