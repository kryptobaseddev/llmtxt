/**
 * LocalBackend SQLite schema — Drizzle ORM schema for embedded LLMtxt storage.
 *
 * This is a SQLite-compatible port of apps/backend/src/db/schema-pg.ts.
 *
 * Key differences from the Postgres schema:
 * - `timestamp` columns → `integer` (unix ms, bigint mode)
 * - `bytea` → `blob` (Buffer / Uint8Array)
 * - `uuid` primary keys → `text` (nanoid / base62 strings)
 * - `jsonb` → `text` (JSON.stringify / JSON.parse at application layer)
 * - `pgvector` (for embeddings) → `blob` (Float32Array serialized as Buffer)
 * - No pgvector extension — cosine similarity done in-memory via llmtxt-core WASM
 *
 * NEVER edit migration files by hand. Always run:
 *   drizzle-kit generate --config packages/llmtxt/drizzle-local.config.ts
 */

import {
  sqliteTable,
  text,
  integer,
  blob,
  index,
  uniqueIndex,
  primaryKey,
  real,
} from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-orm/zod';
import type { z } from 'zod';

// ────────────────────────────────────────────────────────────────
// Documents — core document records
// ────────────────────────────────────────────────────────────────

/**
 * Documents table. The primary entity for the LocalBackend.
 * Each document has a unique slug used in URLs and CRDT operations.
 */
export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(), // nanoid or base62
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    /** DRAFT | REVIEW | LOCKED | ARCHIVED */
    state: text('state').notNull().default('DRAFT'),
    /** Agent identifier of the document creator. */
    createdBy: text('created_by').notNull(),
    /** public | private | org */
    visibility: text('visibility').notNull().default('public'),
    /** unix ms */
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    /** unix ms */
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
    /** Incremented on each publishVersion call. */
    versionCount: integer('version_count').notNull().default(0),
    /** JSON array of label strings. */
    labelsJson: text('labels_json').notNull().default('[]'),
    /** unix ms; null = no expiry */
    expiresAt: integer('expires_at', { mode: 'number' }),
    /** Monotonically increasing event log counter. */
    eventSeqCounter: integer('event_seq_counter').notNull().default(0),
    /** BFT fault tolerance f. Quorum = 2f+1. */
    bftF: integer('bft_f').notNull().default(1),
    /** Required approvals before LOCKED transition. */
    requiredApprovals: integer('required_approvals').notNull().default(1),
    /** unix ms timeout for approvals (0 = no timeout). */
    approvalTimeoutMs: integer('approval_timeout_ms').notNull().default(0),
  },
  (table) => ({
    slugIdx: uniqueIndex('documents_slug_idx').on(table.slug),
    createdAtIdx: index('documents_created_at_idx').on(table.createdAt),
    stateIdx: index('documents_state_idx').on(table.state),
    createdByIdx: index('documents_created_by_idx').on(table.createdBy),
  })
);

// ────────────────────────────────────────────────────────────────
// Versions — document version stack with patch storage
// ────────────────────────────────────────────────────────────────

/**
 * Versions table. Each row represents one version of a document.
 * Incremental patches are stored alongside full content snapshots.
 * Large content (> 10 KB) is written to the filesystem; content_ref
 * stores the relative path.
 */
export const versions = sqliteTable(
  'versions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    /** Compressed inline content for small payloads (< 10 KB). Null when filesystem. */
    compressedData: blob('compressed_data'),
    /** SHA-256 hex hash of uncompressed content. */
    contentHash: text('content_hash').notNull(),
    tokenCount: integer('token_count'),
    /** unix ms */
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    createdBy: text('created_by'),
    changelog: text('changelog'),
    /** Unified diff patch text from baseVersion. Empty string for v1. */
    patchText: text('patch_text'),
    /** Base version number this patch applies against. Null for v1. */
    baseVersion: integer('base_version'),
    /**
     * Storage type: 'inline' (blob in DB) or 'filesystem' (relative path).
     * RemoteBackend uses 'object-store' but LocalBackend never does.
     */
    storageType: text('storage_type').notNull().default('inline'),
    /** Filesystem path relative to storagePath when storageType = 'filesystem'. */
    storageKey: text('storage_key'),
  },
  (table) => ({
    documentIdIdx: index('versions_document_id_idx').on(table.documentId),
    uniqueVersionIdx: uniqueIndex('versions_unique_version_idx').on(
      table.documentId,
      table.versionNumber
    ),
  })
);

// ────────────────────────────────────────────────────────────────
// State transitions — audit trail for lifecycle changes
// ────────────────────────────────────────────────────────────────

export const stateTransitions = sqliteTable(
  'state_transitions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull(),
    fromState: text('from_state').notNull(),
    toState: text('to_state').notNull(),
    changedBy: text('changed_by').notNull(),
    /** unix ms */
    changedAt: integer('changed_at', { mode: 'number' }).notNull(),
    reason: text('reason'),
    atVersion: integer('at_version').notNull(),
  },
  (table) => ({
    documentIdIdx: index('state_transitions_document_id_idx').on(table.documentId),
    changedAtIdx: index('state_transitions_changed_at_idx').on(table.changedAt),
  })
);

// ────────────────────────────────────────────────────────────────
// Approvals — BFT signed approvals
// ────────────────────────────────────────────────────────────────

export const approvals = sqliteTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull(),
    reviewerId: text('reviewer_id').notNull(),
    /** PENDING | APPROVED | REJECTED | STALE */
    status: text('status').notNull(),
    /** unix ms */
    timestamp: integer('timestamp', { mode: 'number' }).notNull(),
    reason: text('reason'),
    atVersion: integer('at_version').notNull(),
    /** Hex-encoded Ed25519 signature (128 chars). Null for unsigned. */
    sigHex: text('sig_hex'),
    /** Canonical payload that was signed. */
    canonicalPayload: text('canonical_payload'),
    /** SHA-256 hash chain: hex(SHA-256(prevChainHash || approvalJson)). */
    chainHash: text('chain_hash'),
    prevChainHash: text('prev_chain_hash'),
    bftF: integer('bft_f').notNull().default(1),
  },
  (table) => ({
    documentIdIdx: index('approvals_document_id_idx').on(table.documentId),
    reviewerIdx: index('approvals_reviewer_idx').on(table.documentId, table.reviewerId),
    statusIdx: index('approvals_status_idx').on(table.documentId, table.status),
  })
);

// ────────────────────────────────────────────────────────────────
// Section CRDT states — consolidated Yjs state per (document, section)
// ────────────────────────────────────────────────────────────────

export const sectionCrdtStates = sqliteTable(
  'section_crdt_states',
  {
    documentId: text('document_id').notNull(),
    sectionId: text('section_id').notNull(),
    clock: integer('clock').notNull().default(0),
    /** unix ms */
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
    /** Serialized Yjs state (binary). */
    yrsState: blob('yrs_state').notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.documentId, table.sectionId],
      name: 'section_crdt_states_pk',
    }),
  })
);

// ────────────────────────────────────────────────────────────────
// Section CRDT updates — raw Yjs update messages pending compaction
// ────────────────────────────────────────────────────────────────

export const sectionCrdtUpdates = sqliteTable(
  'section_crdt_updates',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull(),
    sectionId: text('section_id').notNull(),
    /** Raw Yjs update message binary. */
    updateBlob: blob('update_blob').notNull(),
    clientId: text('client_id').notNull(),
    seq: integer('seq').notNull(),
    /** unix ms */
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    docSectionSeqIdx: index('section_crdt_updates_doc_section_seq_idx').on(
      table.documentId,
      table.sectionId,
      table.seq
    ),
  })
);

// ────────────────────────────────────────────────────────────────
// Document events — append-only event log
// ────────────────────────────────────────────────────────────────

export const documentEvents = sqliteTable(
  'document_events',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull(),
    seq: integer('seq').notNull(),
    eventType: text('event_type').notNull(),
    actorId: text('actor_id').notNull(),
    /** JSON.stringify of the event payload object. */
    payloadJson: text('payload_json').notNull().default('{}'),
    idempotencyKey: text('idempotency_key'),
    /** unix ms */
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    /** Hex-encoded SHA-256 of previous event blob (null for first event). */
    prevHash: text('prev_hash'),
  },
  (table) => ({
    uniqueDocSeq: uniqueIndex('document_events_doc_seq_unique').on(
      table.documentId,
      table.seq
    ),
    docCreatedAtIdx: index('document_events_doc_created_at_idx').on(
      table.documentId,
      table.createdAt
    ),
  })
);

// ────────────────────────────────────────────────────────────────
// Agent public keys — Ed25519 pubkeys for signature verification
// ────────────────────────────────────────────────────────────────

export const agentPubkeys = sqliteTable(
  'agent_pubkeys',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    /** Hex-encoded 32-byte Ed25519 public key. */
    pubkeyHex: text('pubkey_hex').notNull(),
    label: text('label'),
    /** unix ms */
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    /** unix ms; null = active / not revoked */
    revokedAt: integer('revoked_at', { mode: 'number' }),
  },
  (table) => ({
    agentIdIdx: uniqueIndex('agent_pubkeys_agent_id_idx').on(table.agentId),
  })
);

// ────────────────────────────────────────────────────────────────
// Agent signature nonces — replay attack prevention
// ────────────────────────────────────────────────────────────────

export const agentSignatureNonces = sqliteTable(
  'agent_signature_nonces',
  {
    nonce: text('nonce').primaryKey(),
    agentId: text('agent_id').notNull(),
    /** unix ms */
    firstSeen: integer('first_seen', { mode: 'number' }).notNull(),
    /** unix ms; when to purge this nonce record */
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    agentIdIdx: index('agent_signature_nonces_agent_id_idx').on(table.agentId),
    expiresAtIdx: index('agent_signature_nonces_expires_at_idx').on(table.expiresAt),
  })
);

// ────────────────────────────────────────────────────────────────
// Section leases — distributed locks on document sections
// ────────────────────────────────────────────────────────────────

export const sectionLeases = sqliteTable(
  'section_leases',
  {
    id: text('id').primaryKey(),
    /** Resource identifier (e.g. 'document:abc123' or 'section:abc123:intro'). */
    resource: text('resource').notNull(),
    holder: text('holder').notNull(),
    /** unix ms */
    acquiredAt: integer('acquired_at', { mode: 'number' }).notNull(),
    /**
     * unix ms expiry. 0 = never expires (use with caution).
     * GUARD: always check `expiresAt === 0 || expiresAt > Date.now()`.
     */
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    resourceIdx: uniqueIndex('section_leases_resource_idx').on(table.resource),
    expiresAtIdx: index('section_leases_expires_at_idx').on(table.expiresAt),
  })
);

// ────────────────────────────────────────────────────────────────
// Agent inbox messages — A2A signed message delivery
// ────────────────────────────────────────────────────────────────

export const agentInboxMessages = sqliteTable(
  'agent_inbox_messages',
  {
    id: text('id').primaryKey(),
    toAgentId: text('to_agent_id').notNull(),
    /** Full JSON envelope string (signed A2AMessage). */
    envelopeJson: text('envelope_json').notNull(),
    /** unix ms */
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    /**
     * unix ms expiry. 0 = never expires.
     * GUARD: always check `exp === 0 || exp > Date.now()`.
     */
    exp: integer('exp', { mode: 'number' }).notNull(),
  },
  (table) => ({
    toAgentIdIdx: index('agent_inbox_messages_to_agent_id_idx').on(table.toAgentId),
    expIdx: index('agent_inbox_messages_exp_idx').on(table.exp),
  })
);

// ────────────────────────────────────────────────────────────────
// Scratchpad entries — ephemeral agent-to-agent messages
// ────────────────────────────────────────────────────────────────

export const scratchpadEntries = sqliteTable(
  'scratchpad_entries',
  {
    id: text('id').primaryKey(),
    toAgentId: text('to_agent_id').notNull(),
    fromAgentId: text('from_agent_id').notNull(),
    /** JSON.stringify of the payload object. */
    payloadJson: text('payload_json').notNull().default('{}'),
    /** unix ms */
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    /**
     * unix ms expiry. 0 = never expires.
     * GUARD: always check `exp === 0 || exp > Date.now()`.
     */
    exp: integer('exp', { mode: 'number' }).notNull(),
  },
  (table) => ({
    toAgentIdIdx: index('scratchpad_entries_to_agent_id_idx').on(table.toAgentId),
    expIdx: index('scratchpad_entries_exp_idx').on(table.exp),
  })
);

// ────────────────────────────────────────────────────────────────
// Section embeddings — semantic search vectors stored as BLOBs
// ────────────────────────────────────────────────────────────────

/**
 * Semantic embedding vectors for documents.
 *
 * Unlike Postgres (which uses pgvector), LocalBackend stores vectors as
 * raw Float32Array serialized to Buffers. Cosine similarity is computed
 * in-memory via llmtxt-core WASM (similarity.rs). Acceptable for
 * corpora up to ~10 000 documents.
 */
export const sectionEmbeddings = sqliteTable(
  'section_embeddings',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull(),
    /** Version number this embedding was computed for. */
    versionNumber: integer('version_number').notNull(),
    /** Section key within the document (or '__full__' for whole-doc embedding). */
    sectionKey: text('section_key').notNull().default('__full__'),
    /**
     * Float32Array serialized as Buffer (4 bytes per dimension).
     * Dimensions must match the embedding model (e.g. 384 for all-MiniLM-L6-v2).
     */
    embeddingBlob: blob('embedding_blob').notNull(),
    /** Number of float32 dimensions in the vector. */
    dimensions: integer('dimensions').notNull(),
    /** Model identifier used to produce this embedding. */
    modelId: text('model_id').notNull(),
    /** unix ms */
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    documentIdIdx: index('section_embeddings_document_id_idx').on(table.documentId),
    uniqueDocSectionIdx: uniqueIndex('section_embeddings_unique_doc_section_idx').on(
      table.documentId,
      table.sectionKey
    ),
  })
);

// ────────────────────────────────────────────────────────────────
// TypeScript type exports (Drizzle inferred)
// ────────────────────────────────────────────────────────────────

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Version = typeof versions.$inferSelect;
export type NewVersion = typeof versions.$inferInsert;
export type StateTransition = typeof stateTransitions.$inferSelect;
export type NewStateTransition = typeof stateTransitions.$inferInsert;
export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
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
export type ScratchpadEntry = typeof scratchpadEntries.$inferSelect;
export type NewScratchpadEntry = typeof scratchpadEntries.$inferInsert;
export type SectionEmbedding = typeof sectionEmbeddings.$inferSelect;
export type NewSectionEmbedding = typeof sectionEmbeddings.$inferInsert;

// ────────────────────────────────────────────────────────────────
// Zod schemas (for runtime validation)
// ────────────────────────────────────────────────────────────────

export const insertDocumentSchema = createInsertSchema(documents);
export const selectDocumentSchema = createSelectSchema(documents);
export const insertVersionSchema = createInsertSchema(versions);
export const selectVersionSchema = createSelectSchema(versions);
export const insertApprovalSchema = createInsertSchema(approvals);
export const selectApprovalSchema = createSelectSchema(approvals);
export const insertDocumentEventSchema = createInsertSchema(documentEvents);
export const selectDocumentEventSchema = createSelectSchema(documentEvents);
export const insertAgentPubkeySchema = createInsertSchema(agentPubkeys);
export const selectAgentPubkeySchema = createSelectSchema(agentPubkeys);
export const insertSectionLeaseSchema = createInsertSchema(sectionLeases);
export const selectSectionLeaseSchema = createSelectSchema(sectionLeases);
export const insertAgentInboxMessageSchema = createInsertSchema(agentInboxMessages);
export const selectAgentInboxMessageSchema = createSelectSchema(agentInboxMessages);
export const insertScratchpadEntrySchema = createInsertSchema(scratchpadEntries);
export const selectScratchpadEntrySchema = createSelectSchema(scratchpadEntries);

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type SelectDocument = z.infer<typeof selectDocumentSchema>;
