/**
 * Shared types for llmtxt content workflows.
 *
 * These interfaces define the data shapes used across the llmtxt ecosystem.
 * They are intentionally decoupled from any ORM or database layer.
 */

// ── Document Types ──────────────────────────────────────────────

/** Supported content formats. */
export type ContentFormat = 'json' | 'text' | 'markdown';

/** Metadata for a stored document. */
export interface DocumentMeta {
  id: string;
  slug: string;
  format: ContentFormat;
  contentHash: string;
  originalSize: number;
  compressedSize: number;
  tokenCount: number;
  createdAt: number;
  expiresAt: number | null;
  accessCount: number;
  lastAccessedAt: number | null;
}

// ── Version Types ───────────────────────────────────────────────

/** Metadata for a single document version. */
export interface VersionMeta {
  id: string;
  documentId: string;
  versionNumber: number;
  contentHash: string;
  tokenCount: number;
  createdAt: number;
  createdBy?: string;
  changelog?: string;
}

/** Summary of a version for listing (no content). */
export interface VersionSummary {
  versionNumber: number;
  tokenCount: number;
  createdAt: number;
  createdBy?: string;
  changelog?: string;
}

/** Result of comparing two versions. */
export interface VersionDiff {
  documentId: string;
  fromVersion: number;
  toVersion: number;
  addedTokens: number;
  removedTokens: number;
  addedLines: number;
  removedLines: number;
}

// ── Attachment Types (Phase 4 Bridge) ───────────────────────────

/** Reference to an llmtxt document shared in a message. */
export interface LlmtxtRef {
  slug: string;
  url: string;
  format: ContentFormat;
  tokenCount: number;
  preview: string;
}

/** Options for creating an attachment via the bridge. */
export interface AttachmentOptions {
  content: string;
  format?: ContentFormat;
  conversationId: string;
  fromAgentId: string;
  expiresInMs?: number;
}
