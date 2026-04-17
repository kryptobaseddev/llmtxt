/**
 * Canonical frontmatter serializer — TypeScript SSoT bridge (T427.1 / T435).
 *
 * This module is the TypeScript implementation of the canonical frontmatter
 * algorithm defined in `crates/llmtxt-core/src/canonical.rs`. The output is
 * byte-identical to the Rust `canonical_frontmatter()` function for all valid
 * inputs.
 *
 * When the WASM binary is rebuilt to include the `canonicalFrontmatter` binding
 * (post wasm-pack rebuild), this module automatically delegates to WASM. Until
 * then the pure-TS path is used and produces identical output.
 *
 * Key invariants (RFC 2119):
 * - Fixed key order: title, slug, version, state, contributors, content_hash, exported_at
 * - Contributors MUST be sorted lexicographically inside this function.
 * - LF (`\n`) line endings only — no CRLF.
 * - Closing `---` fence followed by exactly one `\n`.
 * - All string values double-quoted.
 * - UTF-8 output.
 *
 * @see docs/specs/ARCH-T427-document-export-ssot.md §4.1
 * @see crates/llmtxt-core/src/canonical.rs
 * @module
 */

import * as wasmModule from '../../wasm/llmtxt_core.js';

// ── Types ──────────────────────────────────────────────────────

/**
 * Structured input for {@link canonicalFrontmatter}.
 *
 * Mirrors `FrontmatterMeta` in `crates/llmtxt-core/src/canonical.rs`.
 * Contributors are sorted inside this function — callers MUST NOT pre-sort.
 */
export interface FrontmatterMeta {
  /** Document title (UTF-8, double-quoted in output). */
  title: string;
  /** URL-safe slug. */
  slug: string;
  /** Integer version number of the exported state. */
  version: number;
  /** Lifecycle state string (e.g. "DRAFT", "APPROVED"). */
  state: string;
  /** Agent IDs — sorted lexicographically by this function. */
  contributors: string[];
  /** SHA-256 hex of the body content (64 lowercase chars). */
  content_hash: string;
  /** ISO 8601 UTC timestamp with millisecond precision. */
  exported_at: string;
}

// ── Private helpers ────────────────────────────────────────────

/**
 * Escape a string value for safe embedding in double-quoted YAML scalars.
 *
 * Mirrors `escape_yaml_string()` in `crates/llmtxt-core/src/canonical.rs`.
 * Escapes `\` → `\\` and `"` → `\"`. Control characters are not expected in
 * well-formed document metadata.
 */
function escapeYamlString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── Serializer ─────────────────────────────────────────────────

/**
 * Produce the canonical YAML frontmatter block for a document export.
 *
 * Delegates to the WASM `canonicalFrontmatter` binding when available
 * (post wasm-pack rebuild). Falls back to the pure-TS implementation that
 * is byte-identical to the Rust function.
 *
 * Output:
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
 * ---
 * ```
 */
export function canonicalFrontmatter(meta: FrontmatterMeta): string {
  // Delegate to WASM when the binding is available (post wasm-pack rebuild).
  const mod = wasmModule as Record<string, unknown>;
  if (typeof mod['canonicalFrontmatter'] === 'function') {
    return (mod['canonicalFrontmatter'] as (json: string) => string)(
      JSON.stringify(meta),
    );
  }

  // Pure-TS fallback — byte-identical to the Rust canonical_frontmatter().
  const sorted = [...meta.contributors].sort();

  let out = '';
  out += '---\n';
  out += `title: "${escapeYamlString(meta.title)}"\n`;
  out += `slug: "${escapeYamlString(meta.slug)}"\n`;
  out += `version: ${meta.version}\n`;
  out += `state: "${escapeYamlString(meta.state)}"\n`;
  out += 'contributors:\n';
  for (const contributor of sorted) {
    out += `  - "${escapeYamlString(contributor)}"\n`;
  }
  out += `content_hash: "${escapeYamlString(meta.content_hash)}"\n`;
  out += `exported_at: "${escapeYamlString(meta.exported_at)}"\n`;
  out += '---\n';
  return out;
}
