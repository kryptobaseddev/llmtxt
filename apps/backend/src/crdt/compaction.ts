/**
 * CRDT section compaction — T204.
 *
 * Merges all pending section_crdt_updates into section_crdt_states,
 * deletes compacted rows, and resets clock to 0 — all in a single DB
 * transaction. Compaction does NOT run while any WS session is active
 * for the same (document_id, section_id).
 *
 * Triggers:
 *  - On WS close, if clock >= CRDT_COMPACT_THRESHOLD (wired in ws-crdt.ts)
 *  - Periodic GC job (crdt-compaction.ts) handles the "idle" threshold
 *
 * Environment overrides:
 *  - CRDT_COMPACT_THRESHOLD (default 100)
 *  - CRDT_COMPACT_IDLE_MS   (default 30000) — used by the periodic job
 */

import { db, dbDriver } from '../db/index.js';
import { pgSchema } from '../db/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { crdt_apply_update, crdt_merge_updates } from './primitives.js';

/** FNV-1a derived advisory lock id — mirrors the one in persistence.ts */
function lockId(documentId: string, sectionId: string): bigint {
  const key = `crdt:${documentId}:${sectionId}`;
  let h = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x00000100000001b3n;
  for (let i = 0; i < key.length; i++) {
    h ^= BigInt(key.charCodeAt(i));
    h = BigInt.asIntN(64, h * FNV_PRIME);
  }
  return BigInt.asIntN(64, h);
}

export const CRDT_COMPACT_THRESHOLD = parseInt(process.env.CRDT_COMPACT_THRESHOLD ?? '100', 10);
export const CRDT_COMPACT_IDLE_MS = parseInt(process.env.CRDT_COMPACT_IDLE_MS ?? '30000', 10);

/**
 * Compact a single (documentId, sectionId) pair.
 *
 * Steps:
 *  1. BEGIN TRANSACTION
 *  2. SELECT all pending updates ordered by seq
 *  3. Merge updates into consolidated state via crdt_merge_updates
 *  4. UPSERT section_crdt_states with merged state, clock = 0
 *  5. DELETE all compacted rows from section_crdt_updates
 *  6. COMMIT
 *
 * If the transaction fails, no update rows are deleted (rollback guarantee).
 *
 * @returns number of update rows deleted
 */
export async function compactSection(documentId: string, sectionId: string): Promise<number> {
  if (dbDriver !== 'postgres') {
    // SQLite compaction is simpler — no advisory lock needed
    return compactSectionSqlite(documentId, sectionId);
  }

  return db.transaction(async (tx: typeof db) => {
    // Lock the section for compaction (same advisory lock as persistence.ts)
    const lid = lockId(documentId, sectionId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lid})`);

    // Load current state
    const stateRows = await tx
      .select({
        yrsState: pgSchema.sectionCrdtStates.yrsState,
      })
      .from(pgSchema.sectionCrdtStates)
      .where(
        and(
          eq(pgSchema.sectionCrdtStates.documentId, documentId),
          eq(pgSchema.sectionCrdtStates.sectionId, sectionId),
        ),
      )
      .limit(1);

    if (stateRows.length === 0) {
      // Nothing to compact
      return 0;
    }

    let baseState = stateRows[0].yrsState;

    // Load pending updates
    const updateRows = await tx
      .select({
        id: pgSchema.sectionCrdtUpdates.id,
        updateBlob: pgSchema.sectionCrdtUpdates.updateBlob,
      })
      .from(pgSchema.sectionCrdtUpdates)
      .where(
        and(
          eq(pgSchema.sectionCrdtUpdates.documentId, documentId),
          eq(pgSchema.sectionCrdtUpdates.sectionId, sectionId),
        ),
      )
      .orderBy(pgSchema.sectionCrdtUpdates.seq);

    if (updateRows.length === 0) {
      // Only reset clock
      await tx
        .update(pgSchema.sectionCrdtStates)
        .set({ clock: 0, updatedAt: new Date() })
        .where(
          and(
            eq(pgSchema.sectionCrdtStates.documentId, documentId),
            eq(pgSchema.sectionCrdtStates.sectionId, sectionId),
          ),
        );
      return 0;
    }

    // Apply all pending updates to base state
    const updateBlobs = (updateRows as Array<{ id: string; updateBlob: Buffer }>).map((r) => r.updateBlob);
    const merged = crdt_merge_updates(updateBlobs);
    const finalState = crdt_apply_update(baseState, merged);

    // Upsert final state with clock = 0
    await tx
      .insert(pgSchema.sectionCrdtStates)
      .values({
        documentId,
        sectionId,
        clock: 0,
        yrsState: finalState,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [pgSchema.sectionCrdtStates.documentId, pgSchema.sectionCrdtStates.sectionId],
        set: { yrsState: finalState, clock: 0, updatedAt: new Date() },
      });

    // Delete compacted rows
    const ids = (updateRows as Array<{ id: string; updateBlob: Buffer }>).map((r) => r.id);
    await tx.execute(
      sql`DELETE FROM section_crdt_updates WHERE id = ANY(${ids}::uuid[])`,
    );

    console.log(
      `[crdt-compact] doc=${documentId} sec=${sectionId} compacted=${ids.length} updates`,
    );
    return ids.length;
  });
}

async function compactSectionSqlite(documentId: string, sectionId: string): Promise<number> {
  const stateRows = await db
    .select({ yrsState: pgSchema.sectionCrdtStates.yrsState })
    .from(pgSchema.sectionCrdtStates)
    .where(
      and(
        eq(pgSchema.sectionCrdtStates.documentId, documentId),
        eq(pgSchema.sectionCrdtStates.sectionId, sectionId),
      ),
    )
    .limit(1);

  if (stateRows.length === 0) return 0;

  const updateRows = await db
    .select({ id: pgSchema.sectionCrdtUpdates.id, updateBlob: pgSchema.sectionCrdtUpdates.updateBlob })
    .from(pgSchema.sectionCrdtUpdates)
    .where(
      and(
        eq(pgSchema.sectionCrdtUpdates.documentId, documentId),
        eq(pgSchema.sectionCrdtUpdates.sectionId, sectionId),
      ),
    )
    .orderBy(pgSchema.sectionCrdtUpdates.seq);

  if (updateRows.length === 0) return 0;

  const merged = crdt_merge_updates((updateRows as Array<{ id: string; updateBlob: Buffer }>).map((r) => r.updateBlob));
  const finalState = crdt_apply_update(stateRows[0].yrsState, merged);

  await db
    .insert(pgSchema.sectionCrdtStates)
    .values({ documentId, sectionId, clock: 0, yrsState: finalState, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [pgSchema.sectionCrdtStates.documentId, pgSchema.sectionCrdtStates.sectionId],
      set: { yrsState: finalState, clock: 0, updatedAt: new Date() },
    });

  for (const row of updateRows) {
    await db
      .delete(pgSchema.sectionCrdtUpdates)
      .where(eq(pgSchema.sectionCrdtUpdates.id, row.id));
  }

  return updateRows.length;
}
