/**
 * Lease TTL expiry background job — T284.
 *
 * Runs every 15 seconds. Selects all section_leases rows where
 * expiresAt < NOW(), deletes them, and emits a SECTION_LEASE_EXPIRED
 * document event for each.
 *
 * One failed deletion does not abort the rest (wrapped in try/catch per row).
 */

import { lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sectionLeases } from '../db/schema-pg.js';
import { appendDocumentEvent } from '../lib/document-events.js';

const EXPIRY_INTERVAL_MS = 15_000;

/**
 * Run one expiry pass: delete expired rows and emit events.
 */
export async function runLeaseExpiryPass(): Promise<void> {
  const now = new Date();

  // Select all expired leases
  let expired: Array<{ id: string; docId: string; sectionId: string; holderAgentId: string }> = [];
  try {
    expired = await db
      .select({
        id: sectionLeases.id,
        docId: sectionLeases.docId,
        sectionId: sectionLeases.sectionId,
        holderAgentId: sectionLeases.holderAgentId,
      })
      .from(sectionLeases)
      .where(lt(sectionLeases.expiresAt, now));
  } catch {
    // DB unreachable — skip this pass
    return;
  }

  for (const lease of expired) {
    try {
      // Delete the row
      await db
        .delete(sectionLeases)
        .where(
          // Re-check id to be safe (row may have been released concurrently)
          // Use eq import
          (await import('drizzle-orm')).eq(sectionLeases.id, lease.id)
        );

      // Emit SECTION_LEASE_EXPIRED event
      await db.transaction(async (tx: unknown) => {
        await appendDocumentEvent(tx, {
          documentId: lease.docId,
          eventType: 'section.edited',
          actorId: 'system',
          payloadJson: {
            event: 'SECTION_LEASE_EXPIRED',
            leaseId: lease.id,
            sectionId: lease.sectionId,
            holder: lease.holderAgentId,
          },
        });
      });
    } catch {
      // Non-fatal: log and continue to next lease
      console.error(`[lease-expiry] Failed to expire lease ${lease.id} — continuing`);
    }
  }
}

// ── Start / stop ──────────────────────────────────────────────────────────────

/**
 * Start the lease expiry job.
 * @returns NodeJS.Timeout reference for use with clearInterval in tests/shutdown.
 */
export function startLeaseExpiryJob(): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    void runLeaseExpiryPass();
  }, EXPIRY_INTERVAL_MS);
  return timer;
}

/**
 * Stop a previously started lease expiry job.
 */
export function stopLeaseExpiryJob(timer: ReturnType<typeof setInterval>): void {
  clearInterval(timer);
}
