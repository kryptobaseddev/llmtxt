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
  uuid,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-orm/zod';
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
    /**
     * Data residency region for this user.
     * T185: Controls which regional backend/database stores this user's data.
     * Valid values: 'us' | 'eu' | 'apac'
     * Selection is permanent — changing requires a manual migration + customer consent.
     */
    region: text('region').notNull().default('us'),
  },
  (table) => ({
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
    expiresAtIdx: index('users_expires_at_idx').on(table.expiresAt),
    agentIdIdx: index('users_agent_id_idx').on(table.agentId),
    regionIdx: index('users_region_idx').on(table.region),
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

    // ── Event log counter (T226) ──
    /**
     * Monotonically increasing sequence counter for the document event log.
     * Incremented atomically on each appendDocumentEvent call via
     * `UPDATE documents SET event_seq_counter = event_seq_counter + 1 WHERE slug=$1 RETURNING event_seq_counter`.
     * Avoids a full-table scan on document_events for sequence assignment.
     */
    eventSeqCounter: bigint('event_seq_counter', { mode: 'bigint' }).notNull().default(BigInt(0)),

    // ── W3/T152 BFT config ──
    /**
     * Byzantine fault tolerance f: maximum number of Byzantine validators to tolerate.
     * Quorum = 2f+1. Default f=1 → quorum 3.
     * 0 means no Byzantine tolerance (any single approval suffices, backward-compat mode).
     */
    bftF: integer('bft_f').notNull().default(1),
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
 *
 * W3/T251 extensions:
 *   - sig_hex: Ed25519 signature over canonical_payload (128-char hex)
 *   - canonical_payload: the exact bytes that were signed (for audit/replay)
 *   - chain_hash: SHA-256 hash chaining this approval to the previous one
 *   - prev_chain_hash: hash of the previous approval in the chain
 *   - bft_f: per-document BFT fault tolerance f at time of approval
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
    // ── W3/T251 BFT fields ──
    /** Ed25519 signature over canonical_payload (128-char lowercase hex). Null for unsigned. */
    sigHex: text('sig_hex'),
    /** Canonical payload that was signed (UTF-8). Null for unsigned approvals. */
    canonicalPayload: text('canonical_payload'),
    /** SHA-256 chain hash: hex of SHA-256(prev_chain_hash_bytes || approval_json_bytes). */
    chainHash: text('chain_hash'),
    /** Hash of the previous approval's chain_hash. Null for the first in chain. */
    prevChainHash: text('prev_chain_hash'),
    /** BFT fault tolerance f value in effect when approval was processed. Default 1. */
    bftF: integer('bft_f').notNull().default(1),
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

    // ── T164: Tamper-evident hash chain ──
    /**
     * Structured event type for security taxonomy (mirrors action, e.g. 'auth.login').
     * Redundant with action; stored for fast security-event filtering.
     */
    eventType: text('event_type'),
    /**
     * Explicit actor identity (agentId from T147 signed identity, or userId).
     * Redundant with agentId/userId; stored for chain serialization.
     */
    actorId: text('actor_id'),
    /**
     * SHA-256 hex of canonical event serialization:
     * `{id}|{event_type}|{actor_id}|{resource_id}|{timestamp_ms}`
     * NULL for rows inserted before T164 was deployed.
     */
    payloadHash: text('payload_hash'),
    /**
     * SHA-256 hex of SHA-256(prev_chain_hash_bytes || payload_hash_bytes).
     * For the first row, prev_chain_hash is the 32-byte zero genesis sentinel.
     * NULL for rows inserted before T164 was deployed.
     */
    chainHash: text('chain_hash'),
  },
  (table) => ({
    userIdIdx: index('audit_logs_user_id_idx').on(table.userId),
    actionIdx: index('audit_logs_action_idx').on(table.action),
    resourceIdx: index('audit_logs_resource_idx').on(table.resourceType, table.resourceId),
    timestampIdx: index('audit_logs_timestamp_idx').on(table.timestamp),
    chainHashIdx: index('audit_logs_chain_hash_idx').on(table.chainHash),
    payloadHashIdx: index('audit_logs_payload_hash_idx').on(table.payloadHash),
  }),
);

// ────────────────────────────────────────────────────────────────
// Audit checkpoints (T164: tamper-evident daily Merkle anchors)
// ────────────────────────────────────────────────────────────────

/**
 * Audit checkpoints table — one row per day.
 *
 * The daily job computes a SHA-256 Merkle root over all audit_log leaf
 * hashes for that day and optionally commits it to an RFC 3161 timestamp
 * service (freetsa.org). The TSR token (DER hex) is stored here.
 *
 * A NULL tsr_token means the TSA was unavailable; the Merkle root still
 * provides local tamper-evidence.
 */
export const auditCheckpoints = pgTable(
  'audit_checkpoints',
  {
    id: text('id').primaryKey(),
    /** ISO 8601 date (YYYY-MM-DD) of the covered calendar day. */
    checkpointDate: text('checkpoint_date').notNull().unique(),
    /** Hex-encoded 32-byte SHA-256 Merkle root. */
    merkleRoot: text('merkle_root').notNull(),
    /**
     * Hex-encoded DER RFC 3161 TimeStampToken from freetsa.org.
     * NULL if the TSA was unavailable when the checkpoint was created.
     */
    tsrToken: text('tsr_token'),
    /** Number of audit_log events included in this checkpoint. */
    eventCount: integer('event_count').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  },
  (table) => ({
    dateIdx: uniqueIndex('audit_checkpoints_date_idx').on(table.checkpointDate),
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
    /**
     * Data residency region for this organization.
     * T185: All members of the org inherit this region for routing purposes.
     * Valid values: 'us' | 'eu' | 'apac'
     */
    region: text('region').notNull().default('us'),
  },
  (table) => ({
    slugIdx: uniqueIndex('organizations_slug_idx').on(table.slug),
    regionIdx: index('organizations_region_idx').on(table.region),
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
// W1 CRDT: Section CRDT states
// ────────────────────────────────────────────────────────────────

/**
 * Section CRDT states — consolidated Yjs state vector per (document, section).
 *
 * Stores the full Yjs document state after applying all updates. Updated
 * atomically when updates are compacted. FK references documents.slug
 * (the public-facing identifier used in CRDT operations).
 */
export const sectionCrdtStates = pgTable(
  'section_crdt_states',
  {
    documentId: text('document_id')
      .notNull()
      .references(() => documents.slug, { onDelete: 'cascade' }),
    sectionId: text('section_id').notNull(),
    /** Logical clock — incremented on each state compaction. */
    clock: integer('clock').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** Full consolidated Yjs state vector (binary). */
    crdtState: bytea('crdt_state').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.documentId, table.sectionId], name: 'section_crdt_states_pk' }),
  })
);

// ────────────────────────────────────────────────────────────────
// W1 CRDT: Section CRDT updates
// ────────────────────────────────────────────────────────────────

/**
 * Section CRDT updates — raw Yjs update messages pending compaction.
 *
 * Each row is one Yjs update message from a client. Updates are compacted
 * into section_crdt_states by a background job. FK on document_id alone
 * (cascade alignment mirrors states table via document_id).
 */
export const sectionCrdtUpdates = pgTable(
  'section_crdt_updates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: text('document_id').notNull(),
    sectionId: text('section_id').notNull(),
    /** Raw Yjs update message binary. */
    updateBlob: bytea('update_blob').notNull(),
    /** Agent ID that produced this update. */
    clientId: text('client_id').notNull(),
    /** Monotonically increasing per (document_id, section_id). */
    seq: bigint('seq', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    docSectionSeqIdx: index('section_crdt_updates_doc_section_seq_idx').on(
      table.documentId,
      table.sectionId,
      table.seq
    ),
    docSectionCreatedAtIdx: index('section_crdt_updates_doc_section_created_at_idx').on(
      table.documentId,
      table.sectionId,
      table.createdAt
    ),
  })
);

// ────────────────────────────────────────────────────────────────
// W1 Events: Document event log
// ────────────────────────────────────────────────────────────────

/**
 * Document events — append-only event log with hash chain for integrity.
 *
 * Every significant operation on a document emits an event here. The
 * prev_hash column links each event to its predecessor, forming a
 * tamper-evident chain. The first event per document has prev_hash = NULL.
 *
 * Partial unique index on (document_id, idempotency_key) WHERE
 * idempotency_key IS NOT NULL is added via raw-SQL follow-up migration.
 */
export const documentEvents = pgTable(
  'document_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.slug, { onDelete: 'cascade' }),
    /** Monotonically increasing per document. */
    seq: bigint('seq', { mode: 'bigint' }).notNull(),
    /** Structured event type, e.g. 'version.created', 'state.changed'. */
    eventType: text('event_type').notNull(),
    /** Agent or user that caused the event. */
    actorId: text('actor_id').notNull(),
    /** Event-specific JSON payload. */
    payloadJson: jsonb('payload_json').notNull(),
    /** Client-supplied idempotency key (nullable). */
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** SHA-256 of the previous event; NULL for the first event in a chain. */
    prevHash: bytea('prev_hash'),
  },
  (table) => ({
    uniqueDocSeq: uniqueIndex('document_events_doc_seq_unique').on(table.documentId, table.seq),
  })
);

// ────────────────────────────────────────────────────────────────
// W1 Identity: Agent public keys
// ────────────────────────────────────────────────────────────────

/**
 * Agent public keys — Ed25519 (or equivalent) pubkeys for agent signature
 * verification. Each agent_id maps to exactly one active pubkey at a time.
 * Revocation is soft: set revoked_at to the revocation timestamp.
 *
 * CHECK constraint (octet_length(pubkey) = 32) is added via raw-SQL
 * follow-up migration because Drizzle cannot express this in schema alone.
 */
export const agentPubkeys = pgTable(
  'agent_pubkeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Unique agent identifier. */
    agentId: text('agent_id').unique().notNull(),
    /** Raw 32-byte public key. */
    pubkey: bytea('pubkey').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** Null = active; set to revocation timestamp when key is revoked. */
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  }
);

// ────────────────────────────────────────────────────────────────
// W1 Identity: Agent signature nonces (replay prevention)
// ────────────────────────────────────────────────────────────────

/**
 * Agent signature nonces — append-only nonce store for replay attack prevention.
 *
 * Each nonce is recorded on first use. Verification middleware rejects any
 * request whose nonce already appears here. A background job purges entries
 * older than 24 hours (the TTL for nonce validity).
 */
// ────────────────────────────────────────────────────────────────
// W2 Leases: Section leases (advisory turn-taking)
// ────────────────────────────────────────────────────────────────

/**
 * Section leases — advisory locks for section turn-taking.
 *
 * Leases are cooperative signals only. The CRDT layer still accepts writes
 * from non-holders; a 409 from POST /lease is a social signal, not a hard
 * block. TTL is enforced server-side by the expiry background job.
 */
export const sectionLeases = pgTable(
  'section_leases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Document slug (FK → documents.slug). */
    docId: text('doc_id')
      .notNull()
      .references(() => documents.slug, { onDelete: 'cascade' }),
    /** Section identifier. */
    sectionId: text('section_id').notNull(),
    /** Agent ID of the lease holder. */
    holderAgentId: text('holder_agent_id').notNull(),
    /** When the lease was acquired. */
    acquiredAt: timestamp('acquired_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** When the lease expires. Must be checked server-side; row is soft-expired until TTL job removes it. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Optional human-readable reason for holding the lease. */
    reason: text('reason'),
  },
  (table) => ({
    /** Fast active-lease lookup by (docId, sectionId). */
    docSectionIdx: index('section_leases_doc_section_idx').on(table.docId, table.sectionId),
    /** Fast expiry job sweep: find expired leases. */
    expiresAtIdx: index('section_leases_expires_at_idx').on(table.expiresAt),
  })
);

export const agentSignatureNonces = pgTable(
  'agent_signature_nonces',
  {
    nonce: text('nonce').primaryKey(),
    agentId: text('agent_id').notNull(),
    firstSeen: timestamp('first_seen', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    agentFirstSeenIdx: index('agent_signature_nonces_agent_first_seen_idx').on(
      table.agentId,
      table.firstSeen
    ),
  })
);

// ────────────────────────────────────────────────────────────────
// W3 A2A: Agent inbox messages (T154 HTTP inbox transport)
// ────────────────────────────────────────────────────────────────

/**
 * Agent inbox messages — ephemeral A2A message store.
 *
 * Messages are stored for up to 48 hours. The recipient polls
 * GET /api/v1/agents/:id/inbox or subscribes to SSE.
 * Each message is a signed A2AMessage envelope (JSON).
 *
 * Background job purges rows where expires_at < now().
 */
export const agentInboxMessages = pgTable(
  'agent_inbox_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Recipient agent identifier. */
    toAgentId: text('to_agent_id').notNull(),
    /** Sender agent identifier. */
    fromAgentId: text('from_agent_id').notNull(),
    /** Full A2AMessage JSON envelope (includes signature). */
    envelopeJson: jsonb('envelope_json').notNull(),
    /** Nonce from the A2AMessage (for dedup). */
    nonce: text('nonce').notNull().unique(),
    /** When this message was received by the server (unix ms). */
    receivedAt: bigint('received_at', { mode: 'number' }).notNull(),
    /** When this message expires (unix ms). Default: receivedAt + 48h. */
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    /** Whether the recipient has read/acknowledged this message. */
    read: boolean('read').notNull().default(false),
  },
  (table) => ({
    /** Fast inbox poll: messages for a specific recipient. */
    toAgentIdx: index('agent_inbox_to_agent_idx').on(table.toAgentId, table.receivedAt),
    /** Purge job: find expired messages. */
    expiresAtIdx: index('agent_inbox_expires_at_idx').on(table.expiresAt),
    /** Dedup by nonce (unique constraint above handles this). */
    nonceIdx: uniqueIndex('agent_inbox_nonce_idx').on(table.nonce),
  })
);

// ────────────────────────────────────────────────────────────────
// Section Embeddings (T102/T103 — pgvector semantic search)
// ────────────────────────────────────────────────────────────────

/**
 * Cached per-section embeddings for nearest-neighbour search.
 *
 * Schema exception: the `embedding` column uses a raw SQL type `vector(384)`
 * because drizzle-orm does not (yet) ship a first-class pgvector column helper.
 * We store the vector as a text column in Drizzle but rely on the raw SQL
 * migration to create it as `vector(384)` so pgvector operators work.
 *
 * For INSERT/SELECT we convert between `number[]` <-> JSON string in the
 * embedding service layer (see src/jobs/embeddings.ts).
 */
export const sectionEmbeddings = pgTable(
  'section_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** FK to documents.id */
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** Normalised section slug (e.g. "introduction"). Empty = whole-doc embedding. */
    sectionSlug: text('section_slug').notNull().default(''),
    /** Raw section heading as it appears in the document. */
    sectionTitle: text('section_title').notNull().default(''),
    /** SHA-256 hex of the section content (for staleness detection). */
    contentHash: text('content_hash').notNull(),
    /** Embedding provider name, e.g. "local-onnx-minilm-l6" */
    provider: text('provider').notNull().default('local-onnx-minilm-l6'),
    /** Model name, e.g. "all-MiniLM-L6-v2" */
    model: text('model').notNull().default('all-MiniLM-L6-v2'),
    /**
     * Embedding stored as JSON text "[0.1,0.2,...]" for Drizzle compatibility.
     * The actual column type is vector(384) — created by the SQL migration.
     * The embedding service casts to/from number[] via JSON.parse/stringify.
     */
    embedding: text('embedding'),
    /** Unix millisecond timestamp of last computation. */
    computedAt: bigint('computed_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    /** Fast per-document lookup for invalidation. */
    documentIdIdx: index('section_embeddings_document_id_idx').on(table.documentId),
    /** Unique constraint: one embedding per (document, section, model). */
    docSectionModelIdx: uniqueIndex('section_embeddings_doc_section_model_idx').on(
      table.documentId,
      table.sectionSlug,
      table.model,
    ),
  })
);

// ────────────────────────────────────────────────────────────────
// Blob Attachments (T428 Binary Blobs)
// ────────────────────────────────────────────────────────────────

/**
 * Blob attachments table - stores metadata and storage info for binary attachments.
 *
 * Blobs are content-addressed by SHA-256 hash. Attachment names are scoped per
 * document and use Last-Write-Wins (LWW) for conflict resolution when multiple
 * agents upload to the same (doc_slug, blob_name).
 *
 * The deleted_at field enables soft-delete; null = active, non-null = soft-deleted.
 */
export const blobAttachments = pgTable(
  'blob_attachments',
  {
    id: text('id').primaryKey(),
    /** FK to documents.slug (logical FK, no constraint for perf). */
    docSlug: text('doc_slug').notNull(),
    /** User-visible attachment name (e.g. "diagram.png"), max 255 bytes. */
    blobName: text('blob_name').notNull(),
    /** SHA-256 hex digest (64 chars) — content address and storage key. */
    hash: text('hash').notNull(),
    /** Original byte count (uncompressed). */
    size: bigint('size', { mode: 'number' }).notNull(),
    /** MIME type (e.g. "image/png"). */
    contentType: text('content_type').notNull(),
    /** Agent ID that uploaded this blob. */
    uploadedBy: text('uploaded_by').notNull(),
    /** Unix timestamp (milliseconds) when this version was uploaded. */
    uploadedAt: bigint('uploaded_at', { mode: 'number' }).notNull(),
    /** PG large object OID (non-null when blobStorageMode = 'pg-lo', else null). */
    pgLoOid: bigint('pg_lo_oid', { mode: 'number' }),
    /** S3/R2 object key (non-null when blobStorageMode = 's3', else null). */
    s3Key: text('s3_key'),
    /** Soft-delete timestamp (ms). Null = active, non-null = deleted. */
    deletedAt: bigint('deleted_at', { mode: 'number' }),
  },
  (table) => ({
    /** Fast per-document lookup. */
    docSlugIdx: index('blob_attachments_doc_slug_idx').on(table.docSlug),
    /** Fast hash-based lookup (for dedup and verification). */
    hashIdx: index('blob_attachments_hash_idx').on(table.hash),
    /**
     * Unique constraint: only one active attachment per (doc_slug, blob_name).
     * The partial index (WHERE deleted_at IS NULL) is added via raw-SQL migration
     * to ensure only one active record per name.
     */
    activeNameIdx: uniqueIndex('blob_attachments_active_name_idx').on(table.docSlug, table.blobName),
  })
);

// ────────────────────────────────────────────────────────────────
// Monetization: subscriptions, usage_events, usage_rollups, stripe_events
// ────────────────────────────────────────────────────────────────

/**
 * subscriptions — maps each user to their billing tier and Stripe identifiers.
 *
 * Every user gets an implicit Free subscription (created on first API call).
 * Stripe keys are null for Free-tier users who have never upgraded.
 *
 * tier:   'free' | 'pro' | 'enterprise'
 * status: 'active' | 'past_due' | 'canceled' | 'trialing'
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    tier: text('tier').notNull().default('free'),
    status: text('status').notNull().default('active'),
    stripeCustomerId: text('stripe_customer_id').unique(),
    stripeSubscriptionId: text('stripe_subscription_id').unique(),
    currentPeriodStart: timestamp('current_period_start', { mode: 'date', withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { mode: 'date', withTimezone: true }),
    gracePeriodEnd: timestamp('grace_period_end', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stripeCustomerIdx: index('subscriptions_stripe_customer_id_idx').on(table.stripeCustomerId),
    stripeSubscriptionIdx: index('subscriptions_stripe_subscription_id_idx').on(table.stripeSubscriptionId),
    tierStatusIdx: index('subscriptions_tier_status_idx').on(table.tier, table.status),
  })
);

/**
 * usage_events — per-request event log used for billing enforcement.
 *
 * event_type: 'doc_read' | 'doc_write' | 'api_call' | 'crdt_op' | 'blob_upload'
 * bytes: payload size (0 for read events)
 * resource_id: document slug, blob id, etc.
 *
 * Rows older than 60 days are purged by the daily rollup job after aggregation.
 */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentId: text('agent_id'),
    eventType: text('event_type').notNull(),
    resourceId: text('resource_id'),
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdCreatedAtIdx: index('usage_events_user_id_created_at_idx').on(table.userId, table.createdAt),
    eventTypeIdx: index('usage_events_event_type_idx').on(table.eventType),
  })
);

/**
 * usage_rollups — daily aggregate per user.
 *
 * Populated at 01:00 UTC by the daily-rollup background job.
 * Used by GET /api/me/usage to return monthly usage totals.
 * One row per (user_id, rollup_date) — INSERT ON CONFLICT DO UPDATE.
 */
export const usageRollups = pgTable(
  'usage_rollups',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rollupDate: timestamp('rollup_date', { mode: 'date', withTimezone: false }).notNull(),
    apiCalls: bigint('api_calls', { mode: 'number' }).notNull().default(0),
    crdtOps: bigint('crdt_ops', { mode: 'number' }).notNull().default(0),
    docReads: bigint('doc_reads', { mode: 'number' }).notNull().default(0),
    docWrites: bigint('doc_writes', { mode: 'number' }).notNull().default(0),
    bytesIngested: bigint('bytes_ingested', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdRollupDateIdx: index('usage_rollups_user_id_rollup_date_idx').on(table.userId, table.rollupDate),
    uniqueUserDate: uniqueIndex('usage_rollups_user_id_rollup_date_uniq').on(table.userId, table.rollupDate),
  })
);

/**
 * stripe_events — idempotency table for Stripe webhook events.
 *
 * Before processing any Stripe webhook, insert the event ID here.
 * Duplicate events (replays) will hit the PRIMARY KEY constraint and
 * be silently discarded — no double processing.
 */
export const stripeEvents = pgTable('stripe_events', {
  stripeEventId: text('stripe_event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

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
export type SectionCrdtState = typeof sectionCrdtStates.$inferSelect;
export type NewSectionCrdtState = typeof sectionCrdtStates.$inferInsert;
export type SectionCrdtUpdate = typeof sectionCrdtUpdates.$inferSelect;
export type NewSectionCrdtUpdate = typeof sectionCrdtUpdates.$inferInsert;
export type DocumentEvent = typeof documentEvents.$inferSelect;
export type NewDocumentEvent = typeof documentEvents.$inferInsert;
export type AgentPubkey = typeof agentPubkeys.$inferSelect;
export type NewAgentPubkey = typeof agentPubkeys.$inferInsert;
export type AgentSignatureNonce = typeof agentSignatureNonces.$inferSelect;
export type NewAgentSignatureNonce = typeof agentSignatureNonces.$inferInsert;
export type SectionLease = typeof sectionLeases.$inferSelect;
export type NewSectionLease = typeof sectionLeases.$inferInsert;
export type AgentInboxMessage = typeof agentInboxMessages.$inferSelect;
export type NewAgentInboxMessage = typeof agentInboxMessages.$inferInsert;
export type SectionEmbedding = typeof sectionEmbeddings.$inferSelect;
export type NewSectionEmbedding = typeof sectionEmbeddings.$inferInsert;

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
export const insertAuditCheckpointSchema = createInsertSchema(auditCheckpoints);
export const selectAuditCheckpointSchema = createSelectSchema(auditCheckpoints);
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
export const insertSectionCrdtStateSchema = createInsertSchema(sectionCrdtStates);
export const selectSectionCrdtStateSchema = createSelectSchema(sectionCrdtStates);
export const insertSectionCrdtUpdateSchema = createInsertSchema(sectionCrdtUpdates);
export const selectSectionCrdtUpdateSchema = createSelectSchema(sectionCrdtUpdates);
export const insertDocumentEventSchema = createInsertSchema(documentEvents);
export const selectDocumentEventSchema = createSelectSchema(documentEvents);
export const insertAgentPubkeySchema = createInsertSchema(agentPubkeys);
export const selectAgentPubkeySchema = createSelectSchema(agentPubkeys);
export const insertAgentSignatureNonceSchema = createInsertSchema(agentSignatureNonces);
export const selectAgentSignatureNonceSchema = createSelectSchema(agentSignatureNonces);
export const insertAgentInboxMessageSchema = createInsertSchema(agentInboxMessages);
export const selectAgentInboxMessageSchema = createSelectSchema(agentInboxMessages);
export const insertBlobAttachmentSchema = createInsertSchema(blobAttachments);
export const selectBlobAttachmentSchema = createSelectSchema(blobAttachments);

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
export type InsertSectionCrdtState = z.infer<typeof insertSectionCrdtStateSchema>;
export type SelectSectionCrdtState = z.infer<typeof selectSectionCrdtStateSchema>;
export type InsertSectionCrdtUpdate = z.infer<typeof insertSectionCrdtUpdateSchema>;
export type SelectSectionCrdtUpdate = z.infer<typeof selectSectionCrdtUpdateSchema>;
export type InsertDocumentEvent = z.infer<typeof insertDocumentEventSchema>;
export type SelectDocumentEvent = z.infer<typeof selectDocumentEventSchema>;
export type InsertAgentPubkey = z.infer<typeof insertAgentPubkeySchema>;
export type SelectAgentPubkey = z.infer<typeof selectAgentPubkeySchema>;
export type InsertAgentSignatureNonce = z.infer<typeof insertAgentSignatureNonceSchema>;
export type SelectAgentSignatureNonce = z.infer<typeof selectAgentSignatureNonceSchema>;
export type InsertBlobAttachment = z.infer<typeof insertBlobAttachmentSchema>;
export type SelectBlobAttachment = z.infer<typeof selectBlobAttachmentSchema>;
export type AuditCheckpoint = typeof auditCheckpoints.$inferSelect;
export type NewAuditCheckpoint = typeof auditCheckpoints.$inferInsert;
export type InsertAuditCheckpoint = z.infer<typeof insertAuditCheckpointSchema>;
export type SelectAuditCheckpoint = z.infer<typeof selectAuditCheckpointSchema>;

// Monetization
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
export type UsageRollup = typeof usageRollups.$inferSelect;
export type NewUsageRollup = typeof usageRollups.$inferInsert;
export type StripeEvent = typeof stripeEvents.$inferSelect;
export type NewStripeEvent = typeof stripeEvents.$inferInsert;

export const insertSubscriptionSchema = createInsertSchema(subscriptions);
export const selectSubscriptionSchema = createSelectSchema(subscriptions);
export const insertUsageEventSchema = createInsertSchema(usageEvents);
export const selectUsageEventSchema = createSelectSchema(usageEvents);
export const insertUsageRollupSchema = createInsertSchema(usageRollups);
export const selectUsageRollupSchema = createSelectSchema(usageRollups);
export const insertStripeEventSchema = createInsertSchema(stripeEvents);
export const selectStripeEventSchema = createSelectSchema(stripeEvents);

export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type SelectSubscription = z.infer<typeof selectSubscriptionSchema>;
export type InsertUsageEvent = z.infer<typeof insertUsageEventSchema>;
export type SelectUsageEvent = z.infer<typeof selectUsageEventSchema>;
export type InsertUsageRollup = z.infer<typeof insertUsageRollupSchema>;
export type SelectUsageRollup = z.infer<typeof selectUsageRollupSchema>;
export type InsertStripeEvent = z.infer<typeof insertStripeEventSchema>;
export type SelectStripeEvent = z.infer<typeof selectStripeEventSchema>;
