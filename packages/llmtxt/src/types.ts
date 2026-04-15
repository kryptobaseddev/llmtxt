/**
 * Shared types for llmtxt content workflows.
 *
 * These interfaces define the data shapes used across the llmtxt ecosystem.
 * They are intentionally decoupled from any ORM or database layer.
 */

// ── Document Types ──────────────────────────────────────────────

/** Supported content formats. */
export type ContentFormat = 'json' | 'text' | 'markdown';

/** Lifecycle state for collaborative documents. */
export type DocumentMode = 'draft' | 'review' | 'locked' | 'archived';

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
  /** Lifecycle state (collaborative documents). */
  mode?: DocumentMode;
  /** Total number of versions. */
  versionCount?: number;
  /** Current version number. */
  currentVersion?: number;
  /** Object storage key when content lives in S3 instead of inline. */
  storageKey?: string;
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

/** Attachment fetch mode supported by the bridge/API layer. */
export type AttachmentAccessMode = 'signed_url' | 'conversation' | 'owner' | 'public';

/** Share state persisted by the API layer for an attachment. */
export type AttachmentSharingMode = 'signed_url' | 'conversation' | 'public';

/** Options for re-sharing an existing attachment. */
export interface AttachmentReshareOptions {
  expiresIn?: number;
  mode?: AttachmentSharingMode;
}

/** Options for appending a version to an existing attachment slug. */
export interface AttachmentVersionOptions {
  baseVersion?: number;
  changelog?: string;
}

// ── RBAC Types ─────────────────────────────────────────────────

/**
 * Fine-grained permission on a document.
 * Canonical definition; mirrors crates/llmtxt-core::rbac::Permission.
 */
export type Permission = 'read' | 'write' | 'delete' | 'manage' | 'approve';

/**
 * Role a user holds on a specific document.
 * Canonical definition; mirrors crates/llmtxt-core::rbac::DocumentRole.
 */
export type DocumentRole = 'owner' | 'editor' | 'viewer';

/**
 * Role a user holds within an organisation.
 * Canonical definition; mirrors crates/llmtxt-core::rbac::OrgRole.
 */
export type OrgRole = 'admin' | 'member' | 'viewer';

/**
 * Permission matrix for document roles.
 * Mirrors the ROLE_PERMISSIONS constant from the Rust core — exported here
 * so TypeScript consumers do not need to call the WASM `rolePermissions`
 * helper for static look-ups.
 */
export const ROLE_PERMISSIONS: Readonly<Record<DocumentRole, readonly Permission[]>> = {
  owner: ['read', 'write', 'delete', 'manage', 'approve'],
  editor: ['read', 'write', 'approve'],
  viewer: ['read'],
} as const;

// ── Document Event Types ────────────────────────────────────────

/**
 * Discriminant for document lifecycle events emitted by the event bus.
 *
 * Consumers should use this type when subscribing to the bus or when
 * filtering events in webhook handlers.
 */
export type DocumentEventType =
  | 'version.created'
  | 'state.changed'
  | 'approval.submitted'
  | 'approval.rejected'
  | 'document.created'
  | 'document.locked'
  | 'document.archived'
  | 'contributor.updated';

/**
 * Payload for a document lifecycle event.
 *
 * Emitted by the in-process event bus after a successful database write.
 * Consumers include WebSocket/SSE streams and webhook delivery workers.
 */
export interface DocumentEvent {
  /** Discriminant — consumers can switch on this. */
  type: DocumentEventType;
  /** Short URL slug of the affected document. */
  slug: string;
  /** Opaque document primary key. */
  documentId: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** userId or agentId that triggered the event. 'system' for auto-actions. */
  actor: string;
  /** Event-specific supplemental data. */
  data: Record<string, unknown>;
}
