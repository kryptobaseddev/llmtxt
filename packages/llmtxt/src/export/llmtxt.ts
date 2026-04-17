/**
 * Native LLMtxt export formatter (T427.5 / T444).
 *
 * Produces a UTF-8, LF-only `.llmtxt` file — a superset of Markdown that is
 * explicitly round-trippable. It extends the canonical YAML frontmatter with
 * two additional fields:
 *
 * - `chain_ref`: BFT approval chain hash, or `null` when unavailable.
 * - `format`: always `"llmtxt/1"` (must be the last frontmatter key).
 *
 * Output structure (§4.5 of ARCH-T427-document-export-ssot.md):
 * ```
 * ---
 * title: "..."
 * slug: "..."
 * version: N
 * state: "..."
 * contributors:
 *   - "..."
 * content_hash: "..."
 * exported_at: "..."
 * chain_ref: "bft:abc123" | null
 * format: "llmtxt/1"
 * ---
 *
 * <document body>
 * ```
 *
 * Invariants:
 * - All standard frontmatter keys from §4.1 MUST appear before `chain_ref`.
 * - `chain_ref` is the second-to-last key; `format` is the last key.
 * - `chain_ref: null` is serialized as the bare YAML scalar `null` (no quotes).
 * - `format: "llmtxt/1"` is double-quoted.
 * - Exactly one blank line between the closing `---` fence and the body.
 * - File ends with exactly one trailing `\n`.
 * - LF line endings only — no CRLF.
 * - When `opts.includeMetadata === false`, body only (no frontmatter fences).
 *
 * Round-trip note: `importLlmtxt` (T451) MUST parse this format and recover
 * all metadata. The import path is not implemented here.
 *
 * @see docs/specs/ARCH-T427-document-export-ssot.md §4.5
 * @module
 */

import { canonicalFrontmatter } from './canonical.js';
import type { DocumentExportState, ExportOpts } from './types.js';

export type { DocumentExportState, ExportOpts };

// ── Helpers ────────────────────────────────────────────────────

/**
 * Normalise line endings to LF and ensure exactly one trailing newline.
 */
function normaliseBody(text: string): string {
  const lf = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return lf.trimEnd() + '\n';
}

/**
 * Extend a canonical frontmatter block (which ends with `---\n`) by inserting
 * `chain_ref` and `format` keys before the closing `---` fence.
 *
 * The canonical block produced by `canonicalFrontmatter()` has this structure:
 * ```
 * ---
 * ...fields...
 * ---\n
 * ```
 *
 * We replace the closing `---\n` with the two extra lines + `---\n`.
 */
function injectLlmtxtFields(base: string, chainRef: string | null): string {
  // The canonical block always ends with exactly "---\n".
  const closingFence = '---\n';
  if (!base.endsWith(closingFence)) {
    throw new Error('canonicalFrontmatter output does not end with "---\\n"');
  }
  const withoutFence = base.slice(0, -closingFence.length);

  // chain_ref: null serializes as bare `null` (YAML null scalar, no quotes).
  const chainRefLine =
    chainRef === null ? 'chain_ref: null\n' : `chain_ref: "${chainRef}"\n`;
  const formatLine = 'format: "llmtxt/1"\n';

  return withoutFence + chainRefLine + formatLine + closingFence;
}

// ── Formatter ─────────────────────────────────────────────────

/**
 * Serialize a document snapshot to the native `.llmtxt` format.
 *
 * @param doc  - Self-contained document snapshot.
 *               `doc.chainRef` may be `null` when no BFT approval chain exists.
 * @param opts - Optional formatting flags (default: include metadata).
 * @returns UTF-8 string with LF line endings and a single trailing newline.
 */
export function formatLlmtxt(doc: DocumentExportState, opts: ExportOpts = {}): string {
  const includeMetadata = opts.includeMetadata !== false;

  const body = normaliseBody(doc.content);

  if (!includeMetadata) {
    return body;
  }

  // Build canonical frontmatter (title through exported_at).
  const baseFrontmatter = canonicalFrontmatter({
    title: doc.title,
    slug: doc.slug,
    version: doc.version,
    state: doc.state,
    contributors: doc.contributors,
    content_hash: doc.contentHash,
    exported_at: doc.exportedAt,
  });

  // Inject chain_ref + format fields before the closing fence.
  const chainRef = doc.chainRef ?? null;
  const frontmatter = injectLlmtxtFields(baseFrontmatter, chainRef);

  // frontmatter ends with "---\n"; add one blank line before body per §4.5.
  return frontmatter + '\n' + body;
}
