/**
 * Plain-text export formatter (T427.4 / T442).
 *
 * Produces a UTF-8, LF-only `.txt` file containing the document body only.
 * No frontmatter, no metadata. Used for quick diffing, clipboard pasting,
 * or piping into other tools.
 *
 * Invariants (§4.4 of ARCH-T427-document-export-ssot.md):
 * - Body content only — no frontmatter, no metadata.
 * - UTF-8, LF line endings.
 * - Exactly one trailing newline.
 * - Leading/trailing blank lines stripped from the body before output.
 *
 * @see docs/specs/ARCH-T427-document-export-ssot.md §4.4
 * @module
 */

import type { DocumentExportState } from './types.js';

export type { DocumentExportState };

// ── Formatter ─────────────────────────────────────────────────

/**
 * Serialize the body of a document snapshot to plain text.
 *
 * This formatter intentionally ignores all metadata. The `opts` parameter is
 * not accepted because plain-text format has no configurable behaviour.
 *
 * @param doc - Self-contained document snapshot.
 * @returns UTF-8 string with LF line endings and a single trailing newline.
 */
export function formatTxt(doc: DocumentExportState): string {
  // Normalise CRLF → LF.
  const lf = doc.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Strip trailing blank lines, append exactly one newline.
  return lf.trimEnd() + '\n';
}
