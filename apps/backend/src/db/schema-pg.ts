// Drizzle ORM PostgreSQL schema for LLMtxt — mirrors schema.ts for pg provider.
import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import type { z } from 'zod';

// PostgreSQL bytea custom type — maps to Node.js Buffer
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// ────────────────────────────────────────────────────────────────
// Users
// ────────────────────────────────────────────────────────────────

/**
 * Users table - supports both anonymous (24hr TTL) and registered accounts.
 *
 * Anonymous users get a generated ID and no credentials. They are
 * auto-purged after `expiresAt`. Registered users provide email/password
 * and persist indefinitely until explicitly deleted.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    // better-auth required fields
    name: text('name').notNull().default(''),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
    // anonymous plugin field
    isAnonymous: boolean('is_anonymous').default(false),
    // llmtxt custom fields
    /** Agent identifier for programmatic users (SDK client agentId) */
    agentId: text('agent_id'),
    /** Auto-purge deadline for anonymous users (unix ms). Null = no expiry. */
    expiresAt: bigint('expires_at', { mode: 'number' }),
  },
  (table) => ({
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
    expiresAtIdx: index('users_expires_at_idx').on(table.expiresAt),
    agentIdIdx: index('users_agent_id_idx').on(table.agentId),
  })
);

// ────────────────────────────────────────────────────────────────
// Sessions (auth)
// ────────────────────────────────────────────────────────────────

/**
 * Sessions table - server-side session tokens for both user types.
 *
 * Anonymous users get a session on first document creation.
 * Registered users get a session on login. Sessions are
 * invalidated on logout or expiration.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // better-auth required fields
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => ({
    userIdIdx: index('sessions_user_id_idx').on(table.userId),
    tokenIdx: uniqueIndex('sessions_token_idx').on(table.token),
    expiresAtIdx: index('sessions_expires_at_idx').on(table.expiresAt),
  })
);

// ────────────────────────────────────────────────────────────────
// Accounts (better-auth)
// ────────────────────────────────────────────────────────────────

/** Accounts table — better-auth manages OAuth and credential providers. */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { mode: 'date' }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { mode: 'date' }),
    scope: text('scope'),
    idToken: text('id_token'),
    password: text('password'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  }
);

// ────────────────────────────────────────────────────────────────
// Verifications (better-auth)
// ────────────────────────────────────────────────────────────────

/** Verifications table — better-auth email verification and password reset tokens. */
export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }),
    updatedAt: timestamp('updated_at', { mode: 'date' }),
  }
);

// ────────────────────────────────────────────────────────────────
// Documents (extended)
// ────────────────────────────────────────────────────────────────

/**
 * Documents table - stores compressed text documents.
 *
 * Extended with lifecycle state, ownership, anonymous flag, storage
 * mode, version tracking, and approval policy to support the full
 * SDK feature set (lifecycle, consensus, versioning, signed URLs).
 */
export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(), // base62 encoded UUID
    slug: text('slug').notNull().unique(), // 8-char short URL
    format: text('format').notNull(), // 'json' | 'text' | 'markdown'
    contentHash: text('content_hash').notNull(), // SHA-256 of uncompressed content
    compressedData: bytea('compressed_data'), // deflate compressed content (null when object-store)
    originalSize: integer('original_size').notNull(), // size before compression
    compressedSize: integer('compressed_size').notNull(), // size after compression
    tokenCount: integer('token_count'), // estimated tokens (ceil(len/4))
    createdAt: bigint('created_at', { mode: 'number' }).notNull(), // unix timestamp ms
    expiresAt: bigint('expires_at', { mode: 'number' }), // unix timestamp ms, nullable
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: bigint('last_accessed_at', { mode: 'number' }), // unix timestamp ms, nullable

    // ── Lifecycle (SDK lifecycle.ts) ──
    /** Document state machine: DRAFT → REVIEW → LOCKED → ARCHIVED */
    state: text('state').notNull().default('DRAFT'),

    // ── Ownership ──
    /** FK to users.id. Null for legacy/system documents. */
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    /** True when created by an anonymous user (24hr TTL auto-purge). */
    isAnonymous: boolean('is_anonymous').notNull().default(false),

    // ── Storage (SDK storage.ts) ──
    /** 'inline' | 'object-store' — where compressed blob lives. */
    storageType: text('storage_type').notNull().default('inline'),
    /** S3-compatible key when storageType = 'object-store'. */
    storageKey: text('storage_key'),

    // ── Versioning metadata (SDK versions.ts) ──
    /** Current version number (updated on each version append). */
    currentVersion: integer('current_version').notNull().default(0),
    /** Total version count (denormalized for fast reads). */
    versionCount: integer('version_count').notNull().default(0),

    // ── Sharing (SDK signed-url.ts) ──
    /** How this document can be accessed: 'signed_url' | 'conversation' | 'public'. */
    sharingMode: text('sharing_mode').notNull().default('signed_url'),

    // ── Approval policy (SDK consensus.ts) ──
    /** Minimum approvals required. Default 1. */
    approvalRequiredCount: integer('approval_required_count').notNull().default(1),
    /** If true, all allowed reviewers must approve (overrides requiredCount). */
    approvalRequireUnanimous: boolean('approval_require_unanimous').notNull().default(false),
    /** Comma-separated list of reviewer agent IDs. Empty = anyone can review. */
    approvalAllowedReviewers: text('approval_allowed_reviewers').notNull().default(''),
    /** Auto-expire reviews older than this (ms). 0 = no timeout. */
    approvalTimeoutMs: bigint('approval_timeout_ms', { mode: 'number' }).notNull().default(0),

    // ── Visibility (RBAC) ──
    /**
     * Who can read this document without an explicit role grant.
     * 'public'  — anyone can read (default; backwards compatible).
     * 'private' — only users with an explicit documentRoles row (or the owner) can read.
     * 'org'     — members of any associated organization can read.
     */
    visibility: text('visibility').notNull().default('public'),
  },
  (table) => ({
    slugIdx: index('documents_slug_idx').on(table.slug),
    createdAtIdx: index('documents_created_at_idx').on(table.createdAt),
    expiresAtIdx: index('documents_expires_at_idx').on(table.expiresAt),
    stateIdx: index('documents_state_idx').on(table.state),
    ownerIdIdx: index('documents_owner_id_idx').on(table.ownerId),
    isAnonymousIdx: index('documents_is_anonymous_idx').on(table.isAnonymous),
    /** Composite for auto-purge query: anonymous + expired + not archived */
    purgeIdx: index('documents_purge_idx').on(table.isAnonymous, table.expiresAt),
    storageKeyIdx: index('documents_storage_key_idx').on(table.storageKey),
    sharingModeIdx: index('documents_sharing_mode_idx').on(table.sharingMode),
    visibilityIdx: index('documents_visibility_idx').on(table.visibility),
  })
);

// ────────────────────────────────────────────────────────────────
// Versions (extended)
// ────────────────────────────────────────────────────────────────

/**
 * Versions table - tracks document version history with patch support.
 *
 * Extended with patchText for incremental storage (SDK VersionEntry),
 * storage mode, and base version reference for patch chains.
 */
export const versions = pgTable(
  'versions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    /** Full compressed content for this version (used for inline storage). */
    compressedData: bytea('compressed_data'),
    contentHash: text('content_hash').notNull(), // SHA-256 of uncompressed content
    tokenCount: integer('token_count'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(), // unix timestamp ms
    /** Agent/user identifier that created this version. */
    createdBy: text('created_by'),
    changelog: text('changelog'), // nullable

    // ── Patch support (SDK versions.ts VersionEntry) ──
    /** Unified diff patch text. Null for version 0 (base content). */
    patchText: text('patch_text'),
    /** Base version this patch applies against. Null for base version. */
    baseVersion: integer('base_version'),

    // ── Storage ──
    /** 'inline' | 'object-store' — where this version's blob lives. */
    storageType: text('storage_type').notNull().default('inline'),
    /** S3 key when storageType = 'object-store'. */
    storageKey: text('storage_key'),
  },
  (table) => ({
    documentIdIdx: index('versions_document_id_idx').on(table.documentId),
    versionNumberIdx: index('versions_version_number_idx').on(table.documentId, table.versionNumber),
    createdAtIdx: index('versions_created_at_idx').on(table.createdAt),
    /** Unique constraint: one version number per document. */
    uniqueVersionIdx: uniqueIndex('versions_unique_version_idx').on(table.documentId, table.versionNumber),
  })
);

// ────────────────────────────────────────────────────────────────
// State transitions (audit log)
// ────────────────────────────────────────────────────────────────

/**
 * State transitions table - audit trail for document lifecycle changes.
 *
 * Maps directly to the SDK StateTransition interface. Every call to
 * `LlmtxtDocument.transition()` inserts a row here.
 */
export const stateTransitions = pgTable(
  'state_transitions',
  {
    id: text('id').primaryKey(), // base62
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** State before transition: DRAFT | REVIEW | LOCKED | ARCHIVED */
    fromState: text('from_state').notNull(),
    /** State after transition: DRAFT | REVIEW | LOCKED | ARCHIVED */
    toState: text('to_state').notNull(),
    /** Agent/user that initiated the transition. */
    changedBy: text('changed_by').notNull(),
    /** Timestamp of the transition (ms since epoch). */
    changedAt: bigint('changed_at', { mode: 'number' }).notNull(),
    /** Human-readable reason for the transition. */
    reason: text('reason'),
    /** Document version number at the time of transition. */
    atVersion: integer('at_version').notNull(),
  },
  (table) => ({
    documentIdIdx: index('state_transitions_document_id_idx').on(table.documentId),
    changedAtIdx: index('state_transitions_changed_at_idx').on(table.changedAt),
    /** Composite for filtering: document + chronological order. */
    docTimeIdx: index('state_transitions_doc_time_idx').on(table.documentId, table.changedAt),
  })
);

// ────────────────────────────────────────────────────────────────
// Approvals (consensus)
// ────────────────────────────────────────────────────────────────

/**
 * Approvals table - stores individual review/approval records.
 *
 * Maps directly to the SDK Review interface from consensus.ts.
 * Each row is one review action; the latest per reviewer wins.
 */
export const approvals = pgTable(
  'approvals',
  {
    id: text('id').primaryKey(), // base62
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** Agent/user that submitted this review. */
    reviewerId: text('reviewer_id').notNull(),
    /** PENDING | APPROVED | REJECTED | STALE */
    status: text('status').notNull(),
    /** Timestamp of the review action (ms since epoch). */
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    /** Reason or comment provided with the review. */
    reason: text('reason'),
    /** Version number the review applies to. Stale if document changed since. */
    atVersion: integer('at_version').notNull(),
  },
  (table) => ({
    documentIdIdx: index('approvals_document_id_idx').on(table.documentId),
    reviewerIdx: index('approvals_reviewer_idx').on(table.documentId, table.reviewerId),
    statusIdx: index('approvals_status_idx').on(table.documentId, table.status),
    timestampIdx: index('approvals_timestamp_idx').on(table.timestamp),
    /** For "latest review per reviewer" queries. */
    latestReviewIdx: index('approvals_latest_review_idx').on(
      table.documentId,
      table.reviewerId,
      table.timestamp
    ),
  })
);

// ────────────────────────────────────────────────────────────────
// Contributors (materialized)
// ────────────────────────────────────────────────────────────────

/**
 * Contributors table - materialized aggregation of per-agent attribution.
 *
 * Maps directly to the SDK ContributorSummary interface. Denormalized
 * from version + attribution data for fast reads. Refreshed on each
 * version creation via application logic.
 */
export const contributors = pgTable(
  'contributors',
  {
    id: text('id').primaryKey(), // base62
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** Agent/user identifier. */
    agentId: text('agent_id').notNull(),
    /** Number of versions this agent authored. */
    versionsAuthored: integer('versions_authored').notNull().default(0),
    /** Total tokens added across all versions. */
    totalTokensAdded: integer('total_tokens_added').notNull().default(0),
    /** Total tokens removed across all versions. */
    totalTokensRemoved: integer('total_tokens_removed').notNull().default(0),
    /** Net token impact (added - removed). */
    netTokens: integer('net_tokens').notNull().default(0),
    /** Timestamp of first contribution (ms since epoch). */
    firstContribution: bigint('first_contribution', { mode: 'number' }).notNull(),
    /** Timestamp of most recent contribution (ms since epoch). */
    lastContribution: bigint('last_contribution', { mode: 'number' }).notNull(),
    /** JSON array of unique section titles modified by this agent. */
    sectionsModified: text('sections_modified').notNull().default('[]'),
    /** Denormalized display name for fast rendering. */
    displayName: text('display_name'),
  },
  (table) => ({
    documentIdIdx: index('contributors_document_id_idx').on(table.documentId),
    agentIdIdx: index('contributors_agent_id_idx').on(table.documentId, table.agentId),
    /** Unique constraint: one summary per agent per document. */
    uniqueContributorIdx: uniqueIndex('contributors_unique_idx').on(table.documentId, table.agentId),
    /** For leaderboard queries: sort by net tokens descending. */
    netTokensIdx: index('contributors_net_tokens_idx').on(table.documentId, table.netTokens),
  })
);

// ────────────────────────────────────────────────────────────────
// Signed URL tokens
// ────────────────────────────────────────────────────────────────

/**
 * Signed URL tokens table - persists generated signed URL grants.
 *
 * Maps to the SDK SignedUrlParams interface. Each row represents an
 * active access grant. Expired tokens are cleaned up by the purge job.
 * Supports both conversation-scoped and org-scoped signatures.
 */
export const signedUrlTokens = pgTable(
  'signed_url_tokens',
  {
    id: text('id').primaryKey(), // base62
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(), // document slug (denormalized for URL building)
    /** Agent that the signed URL was issued for. */
    agentId: text('agent_id').notNull(),
    /** Conversation context for the access grant. */
    conversationId: text('conversation_id').notNull(),
    /** Organization ID for org-scoped URLs (Phase 5). Null for standard URLs. */
    orgId: text('org_id'),
    /** HMAC-SHA256 signature (hex). */
    signature: text('signature').notNull(),
    /** Signature length in hex chars (16 for short-lived, 32 for long-lived). */
    signatureLength: integer('signature_length').notNull().default(16),
    /** Expiration timestamp (ms since epoch). */
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    /** Whether this token has been explicitly revoked. */
    revoked: boolean('revoked').notNull().default(false),
    /** Access count for this specific token. */
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: bigint('last_accessed_at', { mode: 'number' }),
  },
  (table) => ({
    documentIdIdx: index('signed_url_tokens_document_id_idx').on(table.documentId),
    slugIdx: index('signed_url_tokens_slug_idx').on(table.slug),
    agentIdIdx: index('signed_url_tokens_agent_id_idx').on(table.agentId),
    conversationIdIdx: index('signed_url_tokens_conversation_id_idx').on(table.conversationId),
    expiresAtIdx: index('signed_url_tokens_expires_at_idx').on(table.expiresAt),
    /** Composite for signature verification: slug + agent + conv + expires. */
    verifyIdx: index('signed_url_tokens_verify_idx').on(
      table.slug,
      table.agentId,
      table.conversationId,
      table.expiresAt
    ),
    /** For org-scoped lookups. */
    orgIdx: index('signed_url_tokens_org_idx').on(table.orgId),
    /** For cleanup: find expired or revoked tokens. */
    purgeIdx: index('signed_url_tokens_purge_idx').on(table.revoked, table.expiresAt),
  })
);

// ────────────────────────────────────────────────────────────────
// Version attributions (per-version diff metadata)
// ────────────────────────────────────────────────────────────────

/**
 * Version attributions table - per-version diff metadata for attribution.
 *
 * Maps directly to the SDK VersionAttribution interface. Stores the
 * computed diff stats (lines/tokens added/removed, sections modified)
 * for each version, enabling fast attribution queries without
 * recomputing diffs.
 */
export const versionAttributions = pgTable(
  'version_attributions',
  {
    id: text('id').primaryKey(), // base62
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    /** Agent that authored the change. */
    authorId: text('author_id').notNull(),
    addedLines: integer('added_lines').notNull().default(0),
    removedLines: integer('removed_lines').notNull().default(0),
    addedTokens: integer('added_tokens').notNull().default(0),
    removedTokens: integer('removed_tokens').notNull().default(0),
    /** JSON array of section titles modified in this version. */
    sectionsModified: text('sections_modified').notNull().default('[]'),
    /** One-line change description (mirrors version changelog). */
    changelog: text('changelog').notNull().default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    documentIdIdx: index('version_attributions_document_id_idx').on(table.documentId),
    authorIdIdx: index('version_attributions_author_id_idx').on(table.authorId),
    /** Unique: one attribution per version per document. */
    uniqueAttrIdx: uniqueIndex('version_attributions_unique_idx').on(
      table.documentId,
      table.versionNumber
    ),
  })
);

// ────────────────────────────────────────────────────────────────
// API Keys
// ────────────────────────────────────────────────────────────────

/**
 * API keys table - programmatic access tokens for registered users.
 *
 * Keys are generated once and the raw value is never stored. Only the
 * SHA-256 hash is persisted. The `keyPrefix` stores "llmtxt_" + first
 * 8 chars of the random part for display purposes.
 *
 * Revocation is soft (revoked=true); rows are never hard-deleted so
 * audit trails are preserved.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(), // base62 generated
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Human-readable key name like "CI Bot". */
    name: text('name').notNull(),
    /** SHA-256 of the full raw key (hex). */
    keyHash: text('key_hash').notNull(),
    /** Display prefix: "llmtxt_" + first 8 chars of the random part. */
    keyPrefix: text('key_prefix').notNull(),
    /** JSON array of allowed scopes, or '*' for all. */
    scopes: text('scopes').notNull().default('*'),
    /** Last time this key was used (unix ms). */
    lastUsedAt: bigint('last_used_at', { mode: 'number' }),
    /** Expiration timestamp (unix ms). Null means no expiry. */
    expiresAt: bigint('expires_at', { mode: 'number' }),
    /** Soft-delete flag. Revoked keys are rejected on auth. */
    revoked: boolean('revoked').notNull().default(false),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    userIdIdx: index('api_keys_user_id_idx').on(table.userId),
    keyHashIdx: uniqueIndex('api_keys_key_hash_idx').on(table.keyHash),
    keyPrefixIdx: index('api_keys_key_prefix_idx').on(table.keyPrefix),
  })
);

// ────────────────────────────────────────────────────────────────
// Audit Logs
// ────────────────────────────────────────────────────────────────

/**
 * Audit logs table - records all state-changing operations for compliance and
 * forensic investigation. Every successful mutating request (POST/PUT/DELETE)
 * should produce an audit log row.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(), // crypto.randomUUID()
    // ── Who ──
    /** Authenticated user ID. Null for unauthenticated / anonymous requests. */
    userId: text('user_id'),
    /** SDK agent identifier supplied in the request body (agentId / createdBy). */
    agentId: text('agent_id'),
    /** Client IP address extracted from x-forwarded-for or socket. */
    ipAddress: text('ip_address'),
    /** User-Agent header value. */
    userAgent: text('user_agent'),
    // ── What ──
    /**
     * Structured action name, dot-separated: `<resource>.<verb>`.
     * Examples: 'document.create', 'document.update', 'version.create',
     * 'lifecycle.transition', 'approval.submit', 'approval.reject',
     * 'auth.login', 'auth.logout', 'signed_url.create'.
     */
    action: text('action').notNull(),
    /** Resource type affected: 'document' | 'version' | 'approval' | 'auth' | 'signed_url' | ... */
    resourceType: text('resource_type').notNull(),
    /** Slug or ID of the affected resource. Null for resource-independent actions. */
    resourceId: text('resource_id'),
    // ── Details ──
    /** JSON blob with action-specific context (e.g., from/to state for transitions). */
    details: text('details'), // JSON string
    // ── When ──
    /** Unix timestamp in milliseconds when the request was received. */
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    // ── Context ──
    /** Fastify request ID for log correlation. */
    requestId: text('request_id'),
    /** HTTP method of the originating request. */
    method: text('method'),
    /** Full request path (url). */
    path: text('path'),
    /** HTTP status code of the response. Populated via onResponse hook. */
    statusCode: integer('status_code'),
  },
  (table) => ({
    userIdIdx: index('audit_logs_user_id_idx').on(table.userId),
    actionIdx: index('audit_logs_action_idx').on(table.action),
    resourceIdx: index('audit_logs_resource_idx').on(table.resourceType, table.resourceId),
    timestampIdx: index('audit_logs_timestamp_idx').on(table.timestamp),
  }),
);

// ────────────────────────────────────────────────────────────────
// Document roles (RBAC)
// ────────────────────────────────────────────────────────────────

/**
 * Document-level role assignments.
 *
 * One row per (document, user) pair. The ownerId on the documents table
 * is the source of truth for the 'owner' role; explicit role rows are
 * for 'editor' and 'viewer' grants (and can optionally mirror owner).
 *
 * Roles: 'owner' | 'editor' | 'viewer'
 */
export const documentRoles = pgTable(
  'document_roles',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'owner' | 'editor' | 'viewer' */
    role: text('role').notNull(),
    /** userId who granted this role */
    grantedBy: text('granted_by').notNull(),
    /** unix ms */
    grantedAt: bigint('granted_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    docUserIdx: uniqueIndex('document_roles_doc_user_idx').on(table.documentId, table.userId),
    userIdx: index('document_roles_user_idx').on(table.userId),
    roleIdx: index('document_roles_role_idx').on(table.documentId, table.role),
  })
);

// ────────────────────────────────────────────────────────────────
// Organizations
// ────────────────────────────────────────────────────────────────

/**
 * Organizations table — optional grouping of users for shared document access.
 *
 * Documents can be associated with one or more organizations via documentOrgs.
 * Members of the organization inherit access based on their org role.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex('organizations_slug_idx').on(table.slug),
  })
);

// ────────────────────────────────────────────────────────────────
// Organization membership
// ────────────────────────────────────────────────────────────────

/**
 * Org members table — maps users to organizations with a role.
 *
 * Roles: 'admin' | 'member' | 'viewer'
 * Admin: can manage org membership and associate documents.
 * Member: can read/write org-associated documents (per doc visibility).
 * Viewer: read-only access to org documents.
 */
export const orgMembers = pgTable(
  'org_members',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'admin' | 'member' | 'viewer' */
    role: text('role').notNull(),
    joinedAt: bigint('joined_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    orgUserIdx: uniqueIndex('org_members_org_user_idx').on(table.orgId, table.userId),
    userIdx: index('org_members_user_idx').on(table.userId),
  })
);

// ────────────────────────────────────────────────────────────────
// Document-to-org associations
// ────────────────────────────────────────────────────────────────

/**
 * Document-org association table — links a document to an organization.
 *
 * When a document has visibility='org', all members of associated organizations
 * gain access according to their org role.
 */
export const documentOrgs = pgTable(
  'document_orgs',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    addedAt: bigint('added_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    docOrgIdx: uniqueIndex('document_orgs_doc_org_idx').on(table.documentId, table.orgId),
  })
);

// ────────────────────────────────────────────────────────────────
// Pending access invites
// ────────────────────────────────────────────────────────────────

/**
 * Pending invites table — holds invite-by-email records for users who do
 * not yet have an account. On sign-up the invite is resolved and converted
 * to a documentRoles row.
 */
export const pendingInvites = pgTable(
  'pending_invites',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    /** 'editor' | 'viewer' */
    role: text('role').notNull(),
    /** userId of inviter */
    invitedBy: text('invited_by').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    /** nullable — invites may be permanent */
    expiresAt: bigint('expires_at', { mode: 'number' }),
  },
  (table) => ({
    docEmailIdx: uniqueIndex('pending_invites_doc_email_idx').on(table.documentId, table.email),
    emailIdx: index('pending_invites_email_idx').on(table.email),
  })
);

// ────────────────────────────────────────────────────────────────
// Webhooks
// ────────────────────────────────────────────────────────────────

/**
 * Webhooks table - stores external HTTP callback registrations.
 * When a matching document event fires, the delivery worker POSTs
 * the event payload to `url` with an HMAC-SHA256 signature in the
 * X-LLMtxt-Signature header. Webhooks are automatically disabled
 * after 10 consecutive delivery failures.
 */
export const webhooks = pgTable(
  'webhooks',
  {
    id: text('id').primaryKey(), // base62
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Callback URL — must be HTTPS in production. */
    url: text('url').notNull(),
    /** HMAC-SHA256 signing secret (caller-provided or auto-generated). */
    secret: text('secret').notNull(),
    /**
     * JSON array of DocumentEventType strings to subscribe to.
     * Empty array or omitted = subscribe to all events.
     * Example: '["version.created","state.changed"]'
     */
    events: text('events').notNull().default('[]'),
    /**
     * Target document slug. Null = receive events from ALL documents
     * owned by userId. Set to a specific slug to scope to one document.
     */
    documentSlug: text('document_slug'),
    /** Whether this webhook is active. Set to false after 10 failures. */
    active: boolean('active').notNull().default(true),
    /** Consecutive delivery failure count. Reset to 0 on success. */
    failureCount: integer('failure_count').notNull().default(0),
    /** Timestamp of last successful or failed delivery attempt (ms). */
    lastDeliveryAt: bigint('last_delivery_at', { mode: 'number' }),
    /** Timestamp of last successful delivery (ms). */
    lastSuccessAt: bigint('last_success_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    userIdx: index('webhooks_user_id_idx').on(table.userId),
    slugIdx: index('webhooks_document_slug_idx').on(table.documentSlug),
    activeIdx: index('webhooks_active_idx').on(table.active, table.userId),
  })
);

// ────────────────────────────────────────────────────────────────
// Document Links (cross-document references)
// ────────────────────────────────────────────────────────────────

/**
 * Document links table - directional relationships between documents.
 * Supports typed relationships: references, depends_on, derived_from,
 * supersedes, related. Links are used to build cross-document
 * knowledge graphs and dependency chains.
 */
export const documentLinks = pgTable(
  'document_links',
  {
    id: text('id').primaryKey(),
    sourceDocId: text('source_doc_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    targetDocId: text('target_doc_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** 'references' | 'depends_on' | 'derived_from' | 'supersedes' | 'related' */
    linkType: text('link_type').notNull(),
    /** Optional human-readable label for the link. */
    label: text('label'),
    /** userId of whoever created the link. */
    createdBy: text('created_by'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    sourceIdx: index('document_links_source_idx').on(table.sourceDocId),
    targetIdx: index('document_links_target_idx').on(table.targetDocId),
    uniqueLinkIdx: uniqueIndex('document_links_unique_idx').on(
      table.sourceDocId,
      table.targetDocId,
      table.linkType
    ),
  })
);

// ────────────────────────────────────────────────────────────────
// Collections (document grouping)
// ────────────────────────────────────────────────────────────────

/**
 * Collections table - named, ordered groupings of documents.
 * Allows users to curate sets of related documents (e.g., a spec +
 * design + implementation + test plan) and export them as a single
 * concatenated context for agent consumption.
 */
export const collections = pgTable(
  'collections',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** URL-safe slug: lowercase, hyphens, no spaces. */
    slug: text('slug').notNull().unique(),
    description: text('description'),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    /** 'public' | 'private' */
    visibility: text('visibility').notNull().default('public'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex('collections_slug_idx').on(table.slug),
    ownerIdx: index('collections_owner_idx').on(table.ownerId),
  })
);

// ────────────────────────────────────────────────────────────────
// Collection documents (membership)
// ────────────────────────────────────────────────────────────────

/**
 * Collection documents table - ordered membership list.
 * Each row maps a document into a collection with a position for
 * ordering. The position is used for export order and display order.
 */
export const collectionDocuments = pgTable(
  'collection_documents',
  {
    id: text('id').primaryKey(),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** Ordering position within the collection (0-indexed). */
    position: integer('position').notNull().default(0),
    /** userId of whoever added the document. */
    addedBy: text('added_by'),
    addedAt: bigint('added_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    collectionIdx: index('collection_docs_collection_idx').on(table.collectionId),
    documentIdx: index('collection_docs_document_idx').on(table.documentId),
    uniqueDocIdx: uniqueIndex('collection_docs_unique_idx').on(table.collectionId, table.documentId),
  })
);

// ────────────────────────────────────────────────────────────────
// Export TypeScript types
// ────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Version = typeof versions.$inferSelect;
export type NewVersion = typeof versions.$inferInsert;
export type StateTransition = typeof stateTransitions.$inferSelect;
export type NewStateTransition = typeof stateTransitions.$inferInsert;
export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
export type Contributor = typeof contributors.$inferSelect;
export type NewContributor = typeof contributors.$inferInsert;
export type SignedUrlToken = typeof signedUrlTokens.$inferSelect;
export type NewSignedUrlToken = typeof signedUrlTokens.$inferInsert;
export type VersionAttribution = typeof versionAttributions.$inferSelect;
export type NewVersionAttribution = typeof versionAttributions.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type DocumentRole = typeof documentRoles.$inferSelect;
export type NewDocumentRole = typeof documentRoles.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrgMember = typeof orgMembers.$inferSelect;
export type NewOrgMember = typeof orgMembers.$inferInsert;
export type DocumentOrg = typeof documentOrgs.$inferSelect;
export type NewDocumentOrg = typeof documentOrgs.$inferInsert;
export type PendingInvite = typeof pendingInvites.$inferSelect;
export type NewPendingInvite = typeof pendingInvites.$inferInsert;
export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
export type DocumentLink = typeof documentLinks.$inferSelect;
export type NewDocumentLink = typeof documentLinks.$inferInsert;
export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type CollectionDocument = typeof collectionDocuments.$inferSelect;
export type NewCollectionDocument = typeof collectionDocuments.$inferInsert;

// ────────────────────────────────────────────────────────────────
// Export Zod schemas for validation
// ────────────────────────────────────────────────────────────────

export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export const insertSessionSchema = createInsertSchema(sessions);
export const selectSessionSchema = createSelectSchema(sessions);
export const insertDocumentSchema = createInsertSchema(documents);
export const selectDocumentSchema = createSelectSchema(documents);
export const insertVersionSchema = createInsertSchema(versions);
export const selectVersionSchema = createSelectSchema(versions);
export const insertStateTransitionSchema = createInsertSchema(stateTransitions);
export const selectStateTransitionSchema = createSelectSchema(stateTransitions);
export const insertApprovalSchema = createInsertSchema(approvals);
export const selectApprovalSchema = createSelectSchema(approvals);
export const insertContributorSchema = createInsertSchema(contributors);
export const selectContributorSchema = createSelectSchema(contributors);
export const insertSignedUrlTokenSchema = createInsertSchema(signedUrlTokens);
export const selectSignedUrlTokenSchema = createSelectSchema(signedUrlTokens);
export const insertVersionAttributionSchema = createInsertSchema(versionAttributions);
export const selectVersionAttributionSchema = createSelectSchema(versionAttributions);
export const insertApiKeySchema = createInsertSchema(apiKeys);
export const selectApiKeySchema = createSelectSchema(apiKeys);
export const insertAuditLogSchema = createInsertSchema(auditLogs);
export const selectAuditLogSchema = createSelectSchema(auditLogs);
export const insertDocumentRoleSchema = createInsertSchema(documentRoles);
export const selectDocumentRoleSchema = createSelectSchema(documentRoles);
export const insertOrganizationSchema = createInsertSchema(organizations);
export const selectOrganizationSchema = createSelectSchema(organizations);
export const insertOrgMemberSchema = createInsertSchema(orgMembers);
export const selectOrgMemberSchema = createSelectSchema(orgMembers);
export const insertDocumentOrgSchema = createInsertSchema(documentOrgs);
export const selectDocumentOrgSchema = createSelectSchema(documentOrgs);
export const insertPendingInviteSchema = createInsertSchema(pendingInvites);
export const selectPendingInviteSchema = createSelectSchema(pendingInvites);
export const insertWebhookSchema = createInsertSchema(webhooks);
export const selectWebhookSchema = createSelectSchema(webhooks);
export const insertDocumentLinkSchema = createInsertSchema(documentLinks);
export const selectDocumentLinkSchema = createSelectSchema(documentLinks);
export const insertCollectionSchema = createInsertSchema(collections);
export const selectCollectionSchema = createSelectSchema(collections);
export const insertCollectionDocumentSchema = createInsertSchema(collectionDocuments);
export const selectCollectionDocumentSchema = createSelectSchema(collectionDocuments);

export type InsertUser = z.infer<typeof insertUserSchema>;
export type SelectUser = z.infer<typeof selectUserSchema>;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type SelectSession = z.infer<typeof selectSessionSchema>;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type SelectDocument = z.infer<typeof selectDocumentSchema>;
export type InsertVersion = z.infer<typeof insertVersionSchema>;
export type SelectVersion = z.infer<typeof selectVersionSchema>;
export type InsertStateTransition = z.infer<typeof insertStateTransitionSchema>;
export type SelectStateTransition = z.infer<typeof selectStateTransitionSchema>;
export type InsertApproval = z.infer<typeof insertApprovalSchema>;
export type SelectApproval = z.infer<typeof selectApprovalSchema>;
export type InsertContributor = z.infer<typeof insertContributorSchema>;
export type SelectContributor = z.infer<typeof selectContributorSchema>;
export type InsertSignedUrlToken = z.infer<typeof insertSignedUrlTokenSchema>;
export type SelectSignedUrlToken = z.infer<typeof selectSignedUrlTokenSchema>;
export type InsertVersionAttribution = z.infer<typeof insertVersionAttributionSchema>;
export type SelectVersionAttribution = z.infer<typeof selectVersionAttributionSchema>;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type SelectApiKey = z.infer<typeof selectApiKeySchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type SelectAuditLog = z.infer<typeof selectAuditLogSchema>;
export type InsertDocumentRole = z.infer<typeof insertDocumentRoleSchema>;
export type SelectDocumentRole = z.infer<typeof selectDocumentRoleSchema>;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type SelectOrganization = z.infer<typeof selectOrganizationSchema>;
export type InsertOrgMember = z.infer<typeof insertOrgMemberSchema>;
export type SelectOrgMember = z.infer<typeof selectOrgMemberSchema>;
export type InsertDocumentOrg = z.infer<typeof insertDocumentOrgSchema>;
export type SelectDocumentOrg = z.infer<typeof selectDocumentOrgSchema>;
export type InsertPendingInvite = z.infer<typeof insertPendingInviteSchema>;
export type SelectPendingInvite = z.infer<typeof selectPendingInviteSchema>;
export type InsertWebhook = z.infer<typeof insertWebhookSchema>;
export type SelectWebhook = z.infer<typeof selectWebhookSchema>;
export type InsertDocumentLink = z.infer<typeof insertDocumentLinkSchema>;
export type SelectDocumentLink = z.infer<typeof selectDocumentLinkSchema>;
export type InsertCollection = z.infer<typeof insertCollectionSchema>;
export type SelectCollection = z.infer<typeof selectCollectionSchema>;
export type InsertCollectionDocument = z.infer<typeof insertCollectionDocumentSchema>;
export type SelectCollectionDocument = z.infer<typeof selectCollectionDocumentSchema>;
