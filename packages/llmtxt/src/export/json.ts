/**
 * JSON export formatter (T427.3 / T440).
 *
 * Produces a UTF-8, LF-only `.json` file containing the full structured
 * document state. Key order is fixed per §4.3 of the spec to guarantee
 * deterministic byte output.
 *
 * Output schema (§4.3 of ARCH-T427-document-export-ssot.md):
 * ```json
 * {
 *   "schema": "llmtxt-export/1",
 *   "title": "...",
 *   "slug": "...",
 *   "version": N,
 *   "state": "...",
 *   "contributors": [...],
 *   "content_hash": "...",
 *   "exported_at": "...",
 *   "content": "...",
 *   "labels": [...],
 *   "created_by": "...",
 *   "created_at": N,
 *   "updated_at": N,
 *   "version_count": N
 * }
 * ```
 *
 * Invariants:
 * - `schema` MUST be `"llmtxt-export/1"`.
 * - Keys serialized in exactly the order listed above (enforced via replacer array).
 * - `contributors` sorted lexicographically before serialization.
 * - Absent optional fields serialized as `null` (never `undefined`).
 * - `JSON.stringify` with 2-space indent.
 * - LF line endings, single trailing newline.
 *
 * @see docs/specs/ARCH-T427-document-export-ssot.md §4.3
 * @module
 */

import type { DocumentExportState, ExportOpts } from './types.js';

export type { DocumentExportState, ExportOpts };

// ── Key Order ──────────────────────────────────────────────────

/**
 * Fixed key order for the JSON export object (§4.3).
 *
 * Passed as the `replacer` argument to `JSON.stringify` to guarantee that
 * keys always appear in this exact order regardless of insertion order.
 */
const JSON_KEY_ORDER: readonly string[] = [
  'schema',
  'title',
  'slug',
  'version',
  'state',
  'contributors',
  'content_hash',
  'exported_at',
  'content',
  'labels',
  'created_by',
  'created_at',
  'updated_at',
  'version_count',
] as const;

// ── Formatter ─────────────────────────────────────────────────

/**
 * Serialize a document snapshot to the JSON export format.
 *
 * The `opts` parameter is accepted for API consistency but is not used by this
 * formatter — JSON export always includes all metadata fields.
 *
 * @param doc  - Self-contained document snapshot.
 * @param _opts - Unused; accepted for API consistency.
 * @returns UTF-8 JSON string with 2-space indent, LF line endings, single trailing newline.
 */
export function formatJson(doc: DocumentExportState, _opts: ExportOpts = {}): string {
  // Sort contributors lexicographically (spec invariant).
  const contributors = [...doc.contributors].sort();

  // Build the record in key order — only keys present in JSON_KEY_ORDER
  // will appear in the output (enforced by the replacer).
  const record: Record<string, unknown> = {
    schema: 'llmtxt-export/1',
    title: doc.title,
    slug: doc.slug,
    version: doc.version,
    state: doc.state,
    contributors,
    content_hash: doc.contentHash,
    exported_at: doc.exportedAt,
    content: doc.content,
    labels: doc.labels ?? null,
    created_by: doc.createdBy ?? null,
    created_at: doc.createdAt ?? null,
    updated_at: doc.updatedAt ?? null,
    version_count: doc.versionCount ?? null,
  };

  // Use the replacer array to enforce deterministic key order.
  // JSON.stringify with a replacer array only serializes the listed keys
  // in the order they appear in the array.
  let json = JSON.stringify(record, JSON_KEY_ORDER as string[], 2);

  // Normalise CRLF → LF (JSON.stringify is LF-only on Unix but be safe).
  json = json.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Ensure single trailing newline.
  return json.trimEnd() + '\n';
}
