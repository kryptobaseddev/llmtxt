/**
 * Shared types for the document export subsystem (T427).
 *
 * `DocumentExportState` is the self-contained snapshot a formatter receives.
 * It is intentionally decoupled from the database `Document` record so that
 * formatters are pure functions with no backend dependency.
 *
 * @see docs/specs/ARCH-T427-document-export-ssot.md §4–§5
 */

// ── DocumentExportState ────────────────────────────────────────

/**
 * Self-contained document snapshot passed to all format serializers.
 *
 * All fields required by the canonical frontmatter schema are present at the
 * top level; additional fields feed the JSON format.
 */
export interface DocumentExportState {
  /** Human-readable document title. */
  title: string;
  /** URL-safe slug. */
  slug: string;
  /** Version number of the exported state (integer, 1-based). */
  version: number;
  /** Lifecycle state string (DRAFT | REVIEW | LOCKED | ARCHIVED). */
  state: string;
  /**
   * Agent IDs that have contributed to this document.
   * Formatters MUST sort these lexicographically before serialization.
   */
  contributors: string[];
  /**
   * SHA-256 hex of the body content (64 lowercase hex chars).
   * Callers compute this; formatters embed it verbatim.
   */
  contentHash: string;
  /**
   * ISO 8601 UTC timestamp with millisecond precision.
   * Injected by the caller so that determinism is achievable across repeated calls.
   */
  exportedAt: string;
  /** Full body content of the exported version. */
  content: string;

  // ── JSON-format additional fields ─────────────────────────────

  /** Arbitrary metadata labels. Present if available; omitted or null otherwise. */
  labels?: string[] | null;
  /** Agent that created the document. */
  createdBy?: string | null;
  /** Creation timestamp (Unix milliseconds). */
  createdAt?: number | null;
  /** Last-modified timestamp (Unix milliseconds). */
  updatedAt?: number | null;
  /** Total number of versions for this document. */
  versionCount?: number | null;

  // ── LLMtxt-format additional field ────────────────────────────

  /**
   * BFT approval chain hash from `getApprovalChain`.
   * Null when no approvals exist or when CRDT state is unavailable (T451 stub).
   */
  chainRef?: string | null;
}

// ── ExportOpts ─────────────────────────────────────────────────

/**
 * Options controlling format serializer behaviour.
 *
 * All fields are optional. Formatters use sensible defaults when absent.
 */
export interface ExportOpts {
  /**
   * Whether to include metadata (frontmatter / structured fields).
   * Defaults to `true`.
   *
   * When `false`:
   * - `formatMarkdown` emits body only (no frontmatter fences).
   * - `formatLlmtxt` behaves identically to `formatMarkdown` with `includeMetadata: false`.
   * - `formatJson` ignores this flag (JSON format always includes metadata).
   * - `formatTxt` ignores this flag (plain-text format never includes metadata).
   */
  includeMetadata?: boolean;
}
