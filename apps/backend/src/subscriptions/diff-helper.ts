/**
 * Diff helper for differential subscriptions — T294.
 *
 * getEventsSince: query the event log for events newer than a given seq.
 * computeSectionDelta: compute which sections were added/modified/deleted
 *   by examining events between fromSeq and the current max seq.
 */

import { eq, gt, asc, and, max } from 'drizzle-orm';
import { documentEvents } from '../db/schema-pg.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DocumentEventRow {
  id: string;
  documentId: string;
  seq: bigint;
  eventType: string;
  actorId: string;
  payloadJson: unknown;
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface SectionDelta {
  added: string[];
  modified: Array<{ name: string; content: string }>;
  deleted: string[];
  fromSeq: number;
  toSeq: number;
}

// ── getEventsSince ────────────────────────────────────────────────────────────

/**
 * Fetch document events with seq > fromSeq, ordered ascending.
 */
export async function getEventsSince(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  docId: string,
  fromSeq: number,
): Promise<DocumentEventRow[]> {
  const rows = await db
    .select()
    .from(documentEvents)
    .where(
      and(
        eq(documentEvents.documentId, docId),
        gt(documentEvents.seq, BigInt(fromSeq)),
      ),
    )
    .orderBy(asc(documentEvents.seq));

  return rows as DocumentEventRow[];
}

// ── computeSectionDelta ───────────────────────────────────────────────────────

/**
 * Compute a SectionDelta for a specific section between fromSeq and now.
 *
 * Returns null when fromSeq === currentSeq (no changes).
 *
 * The delta is derived by examining SECTION_UPDATED / SECTION_CREATED /
 * SECTION_DELETED events in the payload. Events of type 'section.edited'
 * are used as the primary signal (payload.sectionId and payload.event).
 *
 * For backward compatibility, also checks event payloads for sectionName
 * and content fields.
 */
export async function computeSectionDelta(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  docId: string,
  sectionName: string,
  fromSeq: number,
): Promise<SectionDelta | null> {
  // Get current max seq
  const maxResult = await db
    .select({ maxSeq: max(documentEvents.seq) })
    .from(documentEvents)
    .where(eq(documentEvents.documentId, docId));

  const maxSeq = maxResult[0]?.maxSeq ?? BigInt(0);
  const currentSeq = Number(maxSeq);

  if (fromSeq >= currentSeq) {
    return null; // No changes
  }

  // Get all events since fromSeq
  const events = await getEventsSince(db, docId, fromSeq);

  // Categorise events by section
  const added = new Set<string>();
  const modified = new Map<string, string>(); // sectionName → content
  const deleted = new Set<string>();

  for (const event of events) {
    const payload = event.payloadJson as Record<string, unknown>;

    // Determine the section this event references
    const eventSectionId =
      (payload?.sectionId as string | undefined) ??
      (payload?.section as string | undefined) ??
      (payload?.name as string | undefined);

    if (!eventSectionId || eventSectionId !== sectionName) continue;

    const eventKind =
      (payload?.event as string | undefined) ?? event.eventType;

    if (eventKind === 'SECTION_CREATED' || eventKind === 'section.created') {
      added.add(sectionName);
      deleted.delete(sectionName);
    } else if (
      eventKind === 'SECTION_UPDATED' ||
      eventKind === 'section.edited' ||
      eventKind === 'section.updated'
    ) {
      if (!added.has(sectionName)) {
        modified.set(sectionName, (payload?.content as string | undefined) ?? '');
      }
    } else if (eventKind === 'SECTION_DELETED' || eventKind === 'section.deleted') {
      deleted.add(sectionName);
      added.delete(sectionName);
      modified.delete(sectionName);
    }
  }

  return {
    added: Array.from(added),
    modified: Array.from(modified.entries()).map(([name, content]) => ({ name, content })),
    deleted: Array.from(deleted),
    fromSeq,
    toSeq: currentSeq,
  };
}
