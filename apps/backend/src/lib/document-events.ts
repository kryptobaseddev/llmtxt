/**
 * appendDocumentEvent — atomic helper for the per-document event log.
 *
 * Design:
 *  1. Atomically increments documents.event_seq_counter via
 *     UPDATE ... RETURNING, giving a monotonic per-document sequence number.
 *  2. Computes the SHA-256 hash chain from the previous row's hash.
 *  3. Inserts the new event row.
 *  4. On idempotency_key conflict, returns the existing row with
 *     { duplicated: true }.
 *
 * All three steps run inside the caller-supplied Drizzle transaction so
 * either all succeed or none do (persist-then-emit pattern).
 *
 * Usage:
 *   const result = await appendDocumentEvent(tx, {
 *     documentId: doc.slug,  // FK to documents.slug
 *     eventType: 'version.published',
 *     actorId: userId,
 *     payloadJson: { version: 3 },
 *     idempotencyKey: request.headers['idempotency-key'],
 *   });
 *
 * SSOT: crates/llmtxt-core owns the canonical hash algorithm; this TS
 * implementation mirrors it for the event log chain. The Rust core does
 * not yet export a WASM binding for this — if it does, replace the
 * node:crypto call with the WASM equivalent.
 */

import { createHash } from 'node:crypto';
import { eq, desc, and, sql } from 'drizzle-orm';
import { documentEvents, documents } from '../db/schema-pg.js';

// ── Event type enum ──────────────────────────────────────────────────────────

/**
 * Canonical event type strings for the document event log.
 *
 * Matches the design spec exactly. Consumers should import from here
 * rather than using raw strings to benefit from exhaustiveness checks.
 */
export const DOCUMENT_EVENT_TYPES = [
  'document.created',
  'version.published',
  'lifecycle.transitioned',
  'approval.submitted',
  'approval.rejected',
  'section.edited',
  'event.compacted',
] as const;

export type DocumentEventLogType = (typeof DOCUMENT_EVENT_TYPES)[number];

// ── Helper types ─────────────────────────────────────────────────────────────

export interface AppendDocumentEventInput {
  /** FK → documents.slug (the public-facing identifier). */
  documentId: string;
  eventType: DocumentEventLogType;
  /** Actor/user/agent that triggered this event. */
  actorId: string;
  /** Event-specific payload. Must be JSON-serialisable. */
  payloadJson: Record<string, unknown>;
  /** Optional idempotency key from the Idempotency-Key request header. */
  idempotencyKey?: string | null;
}

export interface AppendDocumentEventRow {
  id: string;
  documentId: string;
  seq: bigint;
  eventType: string;
  actorId: string;
  payloadJson: unknown;
  idempotencyKey: string | null;
  createdAt: Date;
  prevHash: Buffer | null;
}

export interface AppendDocumentEventResult {
  /** The inserted (or pre-existing) event row. */
  event: AppendDocumentEventRow;
  /** true when the idempotency key matched an existing row; no insert occurred. */
  duplicated: boolean;
}

// ── Hash chain computation ───────────────────────────────────────────────────

/**
 * Compute the prev_hash for a new event row.
 *
 * The chain input is a deterministic concatenation of the previous row's
 * tamper-evident fields:
 *   SHA-256( prevHash_hex | id | seq | eventType | actorId | JSON(payload) | createdAt.toISOString() )
 *
 * The first event in a document has no previous row — its prevHash = NULL
 * (genesis). Validators start from genesis and walk forward.
 */
function computeHashChain(prev: AppendDocumentEventRow): Buffer {
  const prevHashHex = prev.prevHash ? prev.prevHash.toString('hex') : 'genesis';
  const input = [
    prevHashHex,
    prev.id,
    prev.seq.toString(),
    prev.eventType,
    prev.actorId,
    JSON.stringify(prev.payloadJson),
    prev.createdAt.toISOString(),
  ].join('|');
  return createHash('sha256').update(input, 'utf-8').digest();
}

// ── Core helper ──────────────────────────────────────────────────────────────

/**
 * Append a document event inside an open Drizzle transaction.
 *
 * @param tx   Open Drizzle transaction (postgres-js provider).
 * @param input Event parameters.
 * @returns The appended event row + whether it was a duplicate.
 */
export async function appendDocumentEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  input: AppendDocumentEventInput,
): Promise<AppendDocumentEventResult> {
  const { documentId, eventType, actorId, payloadJson, idempotencyKey } = input;

  // ── Idempotency check (fast path) ────────────────────────────────────────
  // If an idempotency key was supplied, check whether this event was already
  // recorded. The partial unique index on (document_id, idempotency_key)
  // WHERE idempotency_key IS NOT NULL backs this query efficiently.
  if (idempotencyKey) {
    const existing = await tx
      .select()
      .from(documentEvents)
      .where(
        and(
          eq(documentEvents.documentId, documentId),
          eq(documentEvents.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return { event: existing[0] as AppendDocumentEventRow, duplicated: true };
    }
  }

  // ── Atomically increment the sequence counter ─────────────────────────────
  // UPDATE documents SET event_seq_counter = event_seq_counter + 1
  // WHERE slug = $1 RETURNING event_seq_counter
  // This is a single atomic round-trip; no race condition possible.
  const updated = await tx
    .update(documents)
    .set({ eventSeqCounter: sql`event_seq_counter + 1` })
    .where(eq(documents.slug, documentId))
    .returning({ newSeq: documents.eventSeqCounter });

  if (!updated.length) {
    throw new Error(`appendDocumentEvent: document '${documentId}' not found`);
  }

  const seq: bigint = updated[0].newSeq as bigint;

  // ── Fetch previous row for hash chain ─────────────────────────────────────
  const prevRows = await tx
    .select()
    .from(documentEvents)
    .where(eq(documentEvents.documentId, documentId))
    .orderBy(desc(documentEvents.seq))
    .limit(1);

  const prevHash: Buffer | null =
    prevRows.length > 0
      ? computeHashChain(prevRows[0] as AppendDocumentEventRow)
      : null;

  // ── Insert the event row ──────────────────────────────────────────────────
  const inserted = await tx
    .insert(documentEvents)
    .values({
      documentId,
      seq,
      eventType,
      actorId,
      payloadJson,
      idempotencyKey: idempotencyKey ?? null,
      prevHash,
    })
    .returning();

  return { event: inserted[0] as AppendDocumentEventRow, duplicated: false };
}

// ── Hash chain validator ─────────────────────────────────────────────────────

export interface ChainValidationResult {
  valid: boolean;
  checkedRows: number;
  firstBrokenSeq?: bigint;
  error?: string;
}

/**
 * Validate the hash chain for the last `limit` rows of a document's event log.
 *
 * Walks the rows in ascending seq order and recomputes each prev_hash,
 * comparing against the stored value. Returns the first broken seq if any.
 *
 * @param db    Drizzle client (outside any transaction).
 * @param slug  Document slug (= document_id FK).
 * @param limit Number of recent rows to validate (default 100).
 */
export async function validateHashChain(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  slug: string,
  limit = 100,
): Promise<ChainValidationResult> {
  // Get the last `limit` rows in ascending order
  const rows: AppendDocumentEventRow[] = await db
    .select()
    .from(documentEvents)
    .where(eq(documentEvents.documentId, slug))
    .orderBy(desc(documentEvents.seq))
    .limit(limit)
    .then((r: AppendDocumentEventRow[]) => r.reverse());

  if (rows.length === 0) {
    return { valid: true, checkedRows: 0 };
  }

  // Walk from oldest to newest, recomputing each row's prev_hash
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];
    const expected = computeHashChain(prev);
    const actual = curr.prevHash;

    if (!actual || !expected.equals(actual)) {
      return {
        valid: false,
        checkedRows: i + 1,
        firstBrokenSeq: curr.seq,
        error: `Hash mismatch at seq ${curr.seq}: expected ${expected.toString('hex')}, got ${actual?.toString('hex') ?? 'null'}`,
      };
    }
  }

  return { valid: true, checkedRows: rows.length };
}
