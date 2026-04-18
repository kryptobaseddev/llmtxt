/**
 * Tier limit enforcement middleware for LLMtxt API.
 *
 * Apply `enforceTierLimit` as a preHandler on routes that consume
 * quota. When a user exceeds their tier limit the route receives
 * HTTP 402 Payment Required before the handler runs.
 *
 * Usage:
 *
 *   fastify.post('/compress', {
 *     preHandler: [requireAuth, enforceTierLimit('doc_write')],
 *   }, handler);
 *
 * The middleware also appends a usage event to the log. For write
 * events, pass the body size as `currentDocBytes` by calling
 * `enforceTierLimit('doc_write', () => request.body.length)` — the
 * factory accepts an optional bytes extractor.
 *
 * Important: recording usage is best-effort (never throws). The limit
 * check is authoritative — a Blocked decision always returns 402.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { checkTierLimit, recordUsageEvent, type EventType } from '../lib/usage.js';

/**
 * Build a preHandler that enforces tier limits for the given event type.
 *
 * `getBytes` (optional) — called with the request to extract the size of
 * the body being written. Only meaningful for 'doc_write' / 'blob_upload'.
 * Defaults to 0 (no size check beyond count/quota limits).
 *
 * `resourceIdGetter` (optional) — extract the resource ID from the request
 * (e.g. route param `slug`) for the usage event log.
 */
export function enforceTierLimit(
  eventType: EventType,
  getBytes?: (req: FastifyRequest) => number,
  getResourceId?: (req: FastifyRequest) => string | undefined
) {
  return async function tierLimitPreHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const userId = request.user?.id;
    if (!userId) {
      // No authenticated user — no quota to enforce.
      return;
    }

    const currentDocBytes = getBytes ? getBytes(request) : 0;

    const check = await checkTierLimit(userId, currentDocBytes);

    if (!check.allowed) {
      reply.status(402).send({
        error: 'Payment Required',
        message: `You have reached the ${formatLimitType(check.limitType!)} limit for your ${check.tier} plan.`,
        limit_type: check.limitType,
        current: check.current,
        limit: check.limit,
        tier: check.tier,
        upgrade_url: check.upgradeUrl,
      });
      return;
    }

    // Record the usage event asynchronously (fire-and-forget — best-effort).
    const resourceId = getResourceId ? getResourceId(request) : undefined;
    const agentId = (request.headers['x-agent-id'] as string | undefined) ?? request.user?.id;

    recordUsageEvent({
      userId,
      agentId,
      eventType,
      resourceId,
      bytes: currentDocBytes,
    }).catch(() => {/* ignore — already logged inside recordUsageEvent */});
  };
}

/**
 * Format a snake_case limit type into a human-readable label.
 */
function formatLimitType(limitType: string): string {
  const labels: Record<string, string> = {
    max_documents: 'document',
    max_doc_bytes: 'document size',
    max_api_calls_per_month: 'monthly API call',
    max_crdt_ops_per_month: 'monthly CRDT operation',
    max_agent_seats: 'agent seat',
    max_storage_bytes: 'storage',
  };
  return labels[limitType] ?? limitType.replace(/_/g, ' ');
}

/**
 * Convenience: record a usage event without enforcing a limit.
 *
 * Use this on read-only routes (e.g. GET /documents/:slug) where you
 * want to count the access but not block on quota.
 */
export function trackUsage(
  eventType: EventType,
  getResourceId?: (req: FastifyRequest) => string | undefined
) {
  return async function usageTrackingHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const userId = request.user?.id;
    if (!userId) return;

    const agentId = (request.headers['x-agent-id'] as string | undefined) ?? userId;
    const resourceId = getResourceId ? getResourceId(request) : undefined;

    recordUsageEvent({ userId, agentId, eventType, resourceId, bytes: 0 }).catch(() => {});
  };
}
