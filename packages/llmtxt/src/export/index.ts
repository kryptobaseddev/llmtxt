/**
 * Document export formatters (T427).
 *
 * Re-exports all four format serializers and the shared types used across
 * the export subsystem.
 *
 * @see docs/specs/ARCH-T427-document-export-ssot.md
 * @module
 */

// ── Format serializers ─────────────────────────────────────────

export { formatMarkdown } from './markdown.js';
export { formatJson } from './json.js';
export { formatTxt } from './txt.js';
export { formatLlmtxt } from './llmtxt.js';

// ── Shared types ───────────────────────────────────────────────

export type { DocumentExportState, ExportOpts } from './types.js';
