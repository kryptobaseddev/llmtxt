/**
 * CRDT persistence helper — write-before-broadcast with advisory locking.
 *
 * Implements T203: Every incoming CRDT update is persisted to
 * section_crdt_updates AND section_crdt_states before the update is
 * broadcast. The seq number is assigned atomically via a Postgres advisory
 * lock (pg_advisory_xact_lock) inside a single transaction.
 *
 * Invariants:
 * - Broadcast NEVER happens before the DB write confirms.
 * - seq is monotonically increasing per (document_id, section_id).
 * - Applying the same update twice is idempotent (Loro guarantee).
 * - If the DB write fails, the caller must close the WS with code 4500.
 *
 * Only active in Postgres mode. SQLite falls back to a simpler path
 * (single INSERT without advisory lock — concurrency is not needed for
 * single-writer SQLite mode).
 */

import { db, dbDriver } from '../db/index.js';
import { pgSchema } from '../db/index.js';
import { sql, eq, and } from 'drizzle-orm';
import { crdt_apply_update } from './primitives.js';

// ── Lock helpers ─────────────────────────────────────────────────────────────

/**
 * Derive a stable 64-bit lock id from (documentId, sectionId).
 * Uses a FNV-1a-like fold into a BigInt so it fits in a signed int8.
 */
function lockId(documentId: string, sectionId: string): bigint {
  const key = `crdt:${documentId}:${sectionId}`;
  let h = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x00000100000001b3n;
  for (let i = 0; i < key.length; i++) {
    h ^= BigInt(key.charCodeAt(i));
    h = BigInt.asIntN(64, h * FNV_PRIME);
  }
  // pg_advisory_xact_lock takes a signed int8 — clamp to that range
  return BigInt.asIntN(64, h);
}

// ── Result types ─────────────────────────────────────────────────────────────

export interface PersistResult {
  seq: bigint;
  newState: Buffer;
}

// ── Core: persist a single CRDT update ──────────────────────────────────────

/**
 * Persist a CRDT update to section_crdt_updates and update section_crdt_states.
 *
 * Steps (all within one transaction):
 *  1. Acquire pg_advisory_xact_lock on the (docId, secId) pair.
 *  2. SELECT MAX(seq)+1 as next seq; default to 1 if no rows.
 *  3. Load current state from section_crdt_states (or empty for new section).
 *  4. Apply the update to derive new state.
 *  5. INSERT into section_crdt_updates (seq, updateBlob, clientId).
 *  6. UPSERT section_crdt_states with the new state.
 *
 * @param documentId - document slug (FK references documents.slug)
 * @param sectionId  - section identifier
 * @param updateBlob - raw Loro update bytes from the client
 * @param clientId   - agent/user ID that produced this update
 * @returns { seq, newState } on success; throws on failure
 */
export async function persistCrdtUpdate(
  documentId: string,
  sectionId: string,
  updateBlob: Buffer,
  clientId: string,
): Promise<PersistResult> {
  if (dbDriver === 'postgres') {
    return persistCrdtUpdatePg(documentId, sectionId, updateBlob, clientId);
  }
  return persistCrdtUpdateSqlite(documentId, sectionId, updateBlob, clientId);
}

// ── Postgres path ─────────────────────────────────────────────────────────────

async function persistCrdtUpdatePg(
  documentId: string,
  sectionId: string,
  updateBlob: Buffer,
  clientId: string,
): Promise<PersistResult> {
  const lid = lockId(documentId, sectionId);

  // We need raw postgres to run the transaction with advisory lock.
  // drizzle's db.transaction() wraps in BEGIN/COMMIT — advisory xact lock
  // is released automatically at COMMIT.
  const result = await db.transaction(async (tx: typeof db) => {
    // 1. Advisory transaction lock — serialises concurrent writers for this section
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lid})`);

    // 2. Compute next seq
    const seqResult = await tx.execute(sql`
      SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
      FROM section_crdt_updates
      WHERE document_id = ${documentId} AND section_id = ${sectionId}
    `);
    const nextSeq = BigInt((seqResult.rows[0] as { next_seq: string | number }).next_seq);

    // 3. Load current state
    const stateRows = await tx
      .select({ crdtState: pgSchema.sectionCrdtStates.crdtState, clock: pgSchema.sectionCrdtStates.clock })
      .from(pgSchema.sectionCrdtStates)
      .where(
        and(
          eq(pgSchema.sectionCrdtStates.documentId, documentId),
          eq(pgSchema.sectionCrdtStates.sectionId, sectionId),
        ),
      )
      .limit(1);

    const currentState: Buffer = stateRows.length > 0 ? stateRows[0].crdtState : Buffer.alloc(0);
    const currentClock: number = stateRows.length > 0 ? stateRows[0].clock : 0;

    // 4. Derive new state
    const newState = crdt_apply_update(currentState, updateBlob);

    // 5. INSERT into section_crdt_updates
    await tx.insert(pgSchema.sectionCrdtUpdates).values({
      documentId,
      sectionId,
      updateBlob,
      clientId,
      seq: nextSeq,
    });

    // 6. UPSERT section_crdt_states
    await tx
      .insert(pgSchema.sectionCrdtStates)
      .values({
        documentId,
        sectionId,
        clock: currentClock + 1,
        crdtState: newState,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [pgSchema.sectionCrdtStates.documentId, pgSchema.sectionCrdtStates.sectionId],
        set: {
          crdtState: newState,
          clock: currentClock + 1,
          updatedAt: new Date(),
        },
      });

    return { seq: nextSeq, newState };
  });

  return result as PersistResult;
}

// ── SQLite path (single-writer, no advisory locks needed) ────────────────────

async function persistCrdtUpdateSqlite(
  documentId: string,
  sectionId: string,
  updateBlob: Buffer,
  clientId: string,
): Promise<PersistResult> {
  // Load current state
  const stateRows = await db
    .select({ crdtState: pgSchema.sectionCrdtStates.crdtState, clock: pgSchema.sectionCrdtStates.clock })
    .from(pgSchema.sectionCrdtStates)
    .where(
      and(
        eq(pgSchema.sectionCrdtStates.documentId, documentId),
        eq(pgSchema.sectionCrdtStates.sectionId, sectionId),
      ),
    )
    .limit(1);

  const currentState: Buffer = stateRows.length > 0 ? stateRows[0].crdtState : Buffer.alloc(0);
  const currentClock: number = stateRows.length > 0 ? stateRows[0].clock : 0;

  // Compute seq
  const seqResult = await db.execute(sql`
    SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
    FROM section_crdt_updates
    WHERE document_id = ${documentId} AND section_id = ${sectionId}
  `);
  const rows = seqResult as unknown as Array<Record<string, number | string>>;
  const nextSeq = BigInt(rows[0]?.['next_seq'] ?? 1);

  const newState = crdt_apply_update(currentState, updateBlob);

  await db.insert(pgSchema.sectionCrdtUpdates).values({
    documentId,
    sectionId,
    updateBlob,
    clientId,
    seq: nextSeq,
  });

  await db
    .insert(pgSchema.sectionCrdtStates)
    .values({
      documentId,
      sectionId,
      clock: currentClock + 1,
      crdtState: newState,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [pgSchema.sectionCrdtStates.documentId, pgSchema.sectionCrdtStates.sectionId],
      set: {
        crdtState: newState,
        clock: currentClock + 1,
        updatedAt: new Date(),
      },
    });

  return { seq: nextSeq, newState };
}

// ── Load current state ────────────────────────────────────────────────────────

/**
 * Load the consolidated CRDT state for a (documentId, sectionId) pair.
 * Returns null if no state exists yet (section not yet initialized).
 */
export async function loadSectionState(
  documentId: string,
  sectionId: string,
): Promise<{ crdtState: Buffer; clock: number; updatedAt: Date | null } | null> {
  const rows = await db
    .select({
      crdtState: pgSchema.sectionCrdtStates.crdtState,
      clock: pgSchema.sectionCrdtStates.clock,
      updatedAt: pgSchema.sectionCrdtStates.updatedAt,
    })
    .from(pgSchema.sectionCrdtStates)
    .where(
      and(
        eq(pgSchema.sectionCrdtStates.documentId, documentId),
        eq(pgSchema.sectionCrdtStates.sectionId, sectionId),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  return { crdtState: rows[0].crdtState, clock: rows[0].clock, updatedAt: rows[0].updatedAt };
}

/**
 * Load all pending CRDT update blobs for a (documentId, sectionId) pair,
 * ordered by seq ascending.
 */
export async function loadPendingUpdates(
  documentId: string,
  sectionId: string,
): Promise<Buffer[]> {
  const rows = await db
    .select({ updateBlob: pgSchema.sectionCrdtUpdates.updateBlob })
    .from(pgSchema.sectionCrdtUpdates)
    .where(
      and(
        eq(pgSchema.sectionCrdtUpdates.documentId, documentId),
        eq(pgSchema.sectionCrdtUpdates.sectionId, sectionId),
      ),
    )
    .orderBy(pgSchema.sectionCrdtUpdates.seq);

  return (rows as Array<{ updateBlob: Buffer }>).map((r) => r.updateBlob);
}
