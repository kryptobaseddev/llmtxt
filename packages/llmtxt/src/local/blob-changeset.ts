/**
 * Blob changeset integration — T428.6 (T462)
 *
 * Extends the cr-sqlite changeset payload with optional blob references.
 * Provides:
 *   - BlobChangeset: the extended changeset type carrying BlobRef[]
 *   - buildBlobChangeset: collects BlobRef entries for all blob ops since
 *     a given timestamp window (used by the sync layer)
 *   - applyBlobChangeset: applies incoming BlobRef entries with LWW semantics
 *     and schedules lazy fetchBlobByHash when a hash is not present locally
 *
 * LWW rule per (docSlug, blobName):
 *   winner = argmax(uploadedAt)
 *   tie-break = argmax(uploadedBy) lexicographically descending
 *
 * Lazy-pull protocol:
 *   - On receive: manifest record is written immediately with the winner ref's
 *     metadata; bytes are NOT pulled eagerly.
 *   - If the winner hash is NOT on disk, a lazy-fetch is queued via the
 *     provided fetchBlobByHash callback.
 *   - A Set<string> of pending hashes prevents duplicate in-flight pulls.
 *
 * @see docs/specs/ARCH-T428-binary-blob-attachments.md §7
 * @module
 */

import { nanoid } from 'nanoid';
import { eq, and, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type { BlobRef } from '../core/backend.js';
import { blobAttachments } from './schema-local.js';
import type { BlobFsAdapter } from './blob-fs-adapter.js';

// ── Types ──────────────────────────────────────────────────────────

/**
 * Extended changeset type carrying optional blob references.
 *
 * This wraps the existing cr-sqlite binary changeset (Uint8Array) with a
 * separate `blobs` array that carries manifest metadata — never raw bytes.
 * The blob bytes are pulled lazily on first `getBlob(includeData=true)` call.
 */
export interface BlobChangeset {
  /** The cr-sqlite binary changeset (may be empty Uint8Array). */
  crsqlChangeset: Uint8Array;
  /** Blob references for all blob operations in the transaction window. */
  blobs: BlobRef[];
}

/**
 * Result of applying a BlobChangeset.
 */
export interface ApplyBlobChangesetResult {
  /** Number of blob refs successfully applied (winners inserted). */
  applied: number;
  /** Number of blob refs that lost LWW and were discarded. */
  discarded: number;
  /** Hashes scheduled for lazy background pull. */
  pendingFetches: string[];
}

// ── buildBlobChangeset ─────────────────────────────────────────────

/**
 * Collect BlobRef entries for all active blobs modified since `sinceMs`.
 *
 * The sync layer calls this after `getChangesSince` to augment the binary
 * changeset with blob manifest metadata. The caller passes the combined
 * BlobChangeset to the receiving peer.
 *
 * `sinceMs = 0` returns refs for all active blobs on the document.
 *
 * @param db         - The SQLite Drizzle instance
 * @param docSlug    - The document slug to scope blob refs to (optional)
 * @param sinceMs    - Only include blobs with uploadedAt > sinceMs (0 = all)
 * @param crsqlBytes - The binary cr-sqlite changeset to embed
 */
export function buildBlobChangeset(
  db: BetterSQLite3Database<Record<string, never>>,
  crsqlBytes: Uint8Array,
  docSlug?: string,
  sinceMs = 0
): BlobChangeset {
  // Query active (non-deleted) blob attachment records
  // Filter by uploadedAt > sinceMs to capture the transaction window.
  const rows = db
    .select()
    .from(blobAttachments)
    .where(
      docSlug
        ? and(
            eq(blobAttachments.docSlug, docSlug),
            isNull(blobAttachments.deletedAt)
          )
        : isNull(blobAttachments.deletedAt)
    )
    .all();

  const refs: BlobRef[] = rows
    .filter((r) => sinceMs === 0 || r.uploadedAt > sinceMs)
    .map((r) => ({
      blobName: r.blobName,
      hash: r.hash,
      size: r.size,
      contentType: r.contentType,
      uploadedBy: r.uploadedBy,
      uploadedAt: r.uploadedAt,
      docSlug: r.docSlug,
    }));

  return {
    crsqlChangeset: crsqlBytes,
    blobs: refs,
  };
}

// ── LWW comparison ─────────────────────────────────────────────────

/**
 * Returns true if `incoming` wins over `existing` under the LWW rule.
 *
 * LWW rule per ARCH-T428 §3.4:
 *   - newer uploadedAt wins
 *   - tie-break: higher uploadedBy lexicographically (deterministic)
 *   - same (uploadedAt, uploadedBy) = same record, no-op
 */
function incomingWinsLWW(
  incoming: BlobRef,
  existing: { uploadedAt: number; uploadedBy: string }
): boolean {
  if (incoming.uploadedAt > existing.uploadedAt) return true;
  if (incoming.uploadedAt < existing.uploadedAt) return false;
  // Tie-break: higher lex uploadedBy wins
  return incoming.uploadedBy > existing.uploadedBy;
}

// ── applyBlobChangeset ─────────────────────────────────────────────

/**
 * Apply incoming BlobRef entries from a received changeset.
 *
 * For each ref:
 *   1. Query the local manifest for (docSlug, blobName).
 *   2. Apply LWW: incoming wins if uploadedAt is newer or tie-breaks higher.
 *   3. If incoming wins: soft-delete local record (if any), insert new record.
 *   4. If the winner's hash is NOT on disk, schedule a lazy fetch.
 *
 * @param db           - Drizzle SQLite instance
 * @param blobFs       - The BlobFsAdapter for hash-presence check + fetch
 * @param refs         - BlobRef array from the incoming changeset
 * @param pendingFetches - Mutable Set used to track in-flight pulls (dedup)
 * @param scheduleFetch - Optional callback invoked for each hash that needs
 *                        a background pull; receives (docSlug, hash)
 */
export function applyBlobChangeset(
  db: BetterSQLite3Database<Record<string, never>>,
  blobFs: BlobFsAdapter,
  refs: BlobRef[],
  pendingFetches: Set<string>,
  scheduleFetch?: (docSlug: string, hash: string) => void
): ApplyBlobChangesetResult {
  let applied = 0;
  let discarded = 0;
  const newPendingFetches: string[] = [];

  for (const ref of refs) {
    // Refs extended with docSlug come from buildBlobChangeset; plain BlobRef
    // (per the spec interface) may also arrive without docSlug. Skip if absent.
    const docSlug = (ref as BlobRef & { docSlug?: string }).docSlug;
    if (!docSlug) {
      discarded++;
      continue;
    }

    // Query the currently active manifest record for this (docSlug, blobName)
    const existing = db
      .select({
        id: blobAttachments.id,
        uploadedAt: blobAttachments.uploadedAt,
        uploadedBy: blobAttachments.uploadedBy,
        hash: blobAttachments.hash,
      })
      .from(blobAttachments)
      .where(
        and(
          eq(blobAttachments.docSlug, docSlug),
          eq(blobAttachments.blobName, ref.blobName),
          isNull(blobAttachments.deletedAt)
        )
      )
      .get();

    // Check LWW
    if (existing && !incomingWinsLWW(ref, existing)) {
      discarded++;
      continue;
    }

    // Incoming wins — apply in a transaction
    const now = Date.now();
    const newId = nanoid(21);

    db.transaction(() => {
      if (existing) {
        // Soft-delete the displaced record
        db.update(blobAttachments)
          .set({ deletedAt: now })
          .where(eq(blobAttachments.id, existing.id))
          .run();
      }

      // Insert new active record with the incoming ref's metadata
      db.insert(blobAttachments).values({
        id: newId,
        docSlug,
        blobName: ref.blobName,
        hash: ref.hash,
        size: ref.size,
        contentType: ref.contentType,
        uploadedBy: ref.uploadedBy,
        uploadedAt: ref.uploadedAt,
        deletedAt: null,
      }).run();
    });

    applied++;

    // Check if the winner's hash is already in local blob storage
    const localBytes = blobFs.fetchBlobByHash(ref.hash);
    if (localBytes === null && !pendingFetches.has(ref.hash)) {
      pendingFetches.add(ref.hash);
      newPendingFetches.push(ref.hash);
      scheduleFetch?.(docSlug, ref.hash);
    }
  }

  return { applied, discarded, pendingFetches: newPendingFetches };
}

// ── Unit-testable LWW helpers (exported for tests) ─────────────────

export { incomingWinsLWW };

// ── BlobRef type augmentation for internal use ─────────────────────

/**
 * Extended BlobRef used internally in the sync layer.
 * docSlug is required for manifest writes but is omitted from the public
 * BlobRef spec interface (which is scoped to a document context by the caller).
 */
export interface BlobRefWithDocSlug extends BlobRef {
  docSlug: string;
}
