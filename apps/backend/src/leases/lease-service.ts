/**
 * Lease service — T278.
 *
 * Advisory section leases. Leases are NOT hard locks — the CRDT layer
 * still accepts writes from non-holders. A lease is a cooperative signal.
 *
 * All functions accept a Drizzle client as first argument to support
 * test injection (pass a test transaction for isolation).
 */

import { eq, and, gt, sql } from 'drizzle-orm';
import { sectionLeases, documents } from '../db/schema-pg.js';
import { appendDocumentEvent } from '../lib/document-events.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Lease {
  id: string;
  docId: string;
  sectionId: string;
  holderAgentId: string;
  acquiredAt: Date;
  expiresAt: Date;
  reason: string | null;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Convert a TTL in milliseconds to a future Date.
 */
function expiresAtFromTtl(ttlMs: number): Date {
  return new Date(Date.now() + ttlMs);
}

// ── Service functions ────────────────────────────────────────────────────────

/**
 * Acquire an advisory lease on a section.
 *
 * Returns the inserted Lease row, or null if the section is already leased by
 * another agent (conflict). The caller may pass ttlMs to override the default.
 *
 * @param db        Drizzle client or transaction.
 * @param docId     Document slug.
 * @param sectionId Section identifier.
 * @param agentId   Requesting agent.
 * @param ttlMs     Lease duration in milliseconds.
 * @param reason    Optional human-readable reason.
 */
export async function acquireLease(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  docId: string,
  sectionId: string,
  agentId: string,
  ttlMs: number,
  reason?: string | null,
): Promise<Lease | null> {
  // Check if an active lease already exists for this (docId, sectionId)
  const now = new Date();
  const existing = await db
    .select()
    .from(sectionLeases)
    .where(
      and(
        eq(sectionLeases.docId, docId),
        eq(sectionLeases.sectionId, sectionId),
        gt(sectionLeases.expiresAt, now),
      ),
    )
    .limit(1);

  if (existing.length > 0 && existing[0].holderAgentId !== agentId) {
    // Another agent holds the lease
    return null;
  }

  // If same agent already holds, upsert (extend)
  if (existing.length > 0 && existing[0].holderAgentId === agentId) {
    const expiresAt = expiresAtFromTtl(ttlMs);
    const updated = await db
      .update(sectionLeases)
      .set({ expiresAt, reason: reason ?? null })
      .where(eq(sectionLeases.id, existing[0].id))
      .returning();

    const lease = updated[0] as Lease;

    // Emit event
    await db.transaction(async (tx: unknown) => {
      await appendDocumentEvent(tx, {
        documentId: docId,
        eventType: 'section.edited',
        actorId: agentId,
        payloadJson: {
          event: 'SECTION_LEASED',
          leaseId: lease.id,
          sectionId,
          holder: agentId,
          expiresAt: lease.expiresAt.toISOString(),
        },
      });
    }).catch(() => {
      // Non-fatal: event log failure should not fail the lease operation
    });

    return lease;
  }

  // Insert new lease
  const expiresAt = expiresAtFromTtl(ttlMs);
  const inserted = await db
    .insert(sectionLeases)
    .values({
      docId,
      sectionId,
      holderAgentId: agentId,
      expiresAt,
      reason: reason ?? null,
    })
    .returning();

  const lease = inserted[0] as Lease;

  // Emit SECTION_LEASED event (best-effort, non-fatal)
  try {
    await db.transaction(async (tx: unknown) => {
      await appendDocumentEvent(tx, {
        documentId: docId,
        eventType: 'section.edited',
        actorId: agentId,
        payloadJson: {
          event: 'SECTION_LEASED',
          leaseId: lease.id,
          sectionId,
          holder: agentId,
          expiresAt: lease.expiresAt.toISOString(),
        },
      });
    });
  } catch {
    // Non-fatal
  }

  return lease;
}

/**
 * Renew a lease by extending its expiresAt.
 *
 * Returns the updated Lease, or null if the lease was not found or the
 * requesting agent is not the holder.
 */
export async function renewLease(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  leaseId: string,
  agentId: string,
  ttlMs: number,
): Promise<Lease | null> {
  const now = new Date();
  const expiresAt = expiresAtFromTtl(ttlMs);

  const updated = await db
    .update(sectionLeases)
    .set({ expiresAt })
    .where(
      and(
        eq(sectionLeases.id, leaseId),
        eq(sectionLeases.holderAgentId, agentId),
        gt(sectionLeases.expiresAt, now),
      ),
    )
    .returning();

  if (updated.length === 0) return null;
  return updated[0] as Lease;
}

/**
 * Release a lease. No-op if the lease is already expired or does not exist.
 * Returns true if a row was deleted.
 */
export async function releaseLease(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  leaseId: string,
  agentId: string,
): Promise<boolean> {
  // Fetch lease first to get docId/sectionId for event emission
  const rows = await db
    .select()
    .from(sectionLeases)
    .where(
      and(
        eq(sectionLeases.id, leaseId),
        eq(sectionLeases.holderAgentId, agentId),
      ),
    )
    .limit(1);

  if (rows.length === 0) return false;

  const lease = rows[0] as Lease;

  const deleted = await db
    .delete(sectionLeases)
    .where(
      and(
        eq(sectionLeases.id, leaseId),
        eq(sectionLeases.holderAgentId, agentId),
      ),
    )
    .returning();

  if (deleted.length === 0) return false;

  // Emit SECTION_LEASE_RELEASED event (best-effort)
  try {
    await db.transaction(async (tx: unknown) => {
      await appendDocumentEvent(tx, {
        documentId: lease.docId,
        eventType: 'section.edited',
        actorId: agentId,
        payloadJson: {
          event: 'SECTION_LEASE_RELEASED',
          leaseId,
          sectionId: lease.sectionId,
          releasedBy: agentId,
        },
      });
    });
  } catch {
    // Non-fatal
  }

  return true;
}

/**
 * Get the active (non-expired) lease for a (docId, sectionId) pair.
 * Returns null if no active lease exists.
 */
export async function getActiveLease(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  docId: string,
  sectionId: string,
): Promise<Lease | null> {
  const now = new Date();
  const rows = await db
    .select()
    .from(sectionLeases)
    .where(
      and(
        eq(sectionLeases.docId, docId),
        eq(sectionLeases.sectionId, sectionId),
        gt(sectionLeases.expiresAt, now),
      ),
    )
    .limit(1);

  return rows.length > 0 ? (rows[0] as Lease) : null;
}
