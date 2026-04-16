/**
 * Backend — portable interface for all LLMtxt persistence and coordination operations.
 *
 * Every method in this interface MUST be implemented by both LocalBackend and
 * RemoteBackend. LocalBackend provides offline-first SQLite + in-process EventEmitter
 * semantics. RemoteBackend delegates to a running api.llmtxt.my instance via HTTP/WS.
 *
 * Consumers MUST NOT import directly from LocalBackend or RemoteBackend unless they
 * intend to use backend-specific features. All portable code SHOULD depend on this
 * interface only.
 *
 * @see docs/specs/backend-interface.md for RFC 2119 specification
 * @module
 */

import type { DocumentState, StateTransition } from '../sdk/lifecycle.js';
import type { VersionEntry } from '../sdk/versions.js';
import type { Review, ApprovalPolicy, ApprovalResult } from '../sdk/consensus.js';

// ── Config ─────────────────────────────────────────────────────

/**
 * Configuration for a Backend instance.
 *
 * BackendConfig is passed to the backend constructor. LocalBackend uses
 * storagePath + identityPath; RemoteBackend uses baseUrl + apiKey.
 */
export interface BackendConfig {
  /**
   * Directory where the backend stores its data.
   * For LocalBackend: SQLite DB and large content blobs live here.
   * Defaults to '.llmtxt' relative to the working directory.
   */
  storagePath?: string;

  /**
   * Path to the agent identity keypair JSON file.
   * Defaults to <storagePath>/identity.json.
   */
  identityPath?: string;

  /**
   * Base URL of a remote LLMtxt API instance.
   * Required for RemoteBackend. MUST include scheme (https://).
   */
  baseUrl?: string;

  /**
   * API key for authenticating with the remote instance.
   * Used by RemoteBackend in the Authorization header.
   */
  apiKey?: string;

  /**
   * SQLite WAL mode. Defaults to true.
   * Only relevant for LocalBackend.
   */
  wal?: boolean;

  /**
   * Lease reaper interval in milliseconds. Defaults to 10_000.
   * Only relevant for LocalBackend.
   */
  leaseReaperIntervalMs?: number;

  /**
   * Presence TTL in milliseconds. Defaults to 30_000.
   * Only relevant for LocalBackend.
   */
  presenceTtlMs?: number;
}

// ── Document types ─────────────────────────────────────────────

/** A stored document record. */
export interface Document {
  /** Unique document identifier (nanoid). */
  id: string;
  /** URL-safe slug derived from the title. Unique per backend. */
  slug: string;
  /** Human-readable document title. */
  title: string;
  /** Current lifecycle state. */
  state: DocumentState;
  /** Agent that created the document. */
  createdBy: string;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
  /** Last modified timestamp (ms since epoch). */
  updatedAt: number;
  /** Current version count. */
  versionCount: number;
  /** Arbitrary metadata labels. */
  labels?: string[];
}

/** Parameters for creating a document. */
export interface CreateDocumentParams {
  title: string;
  createdBy: string;
  labels?: string[];
  /** If supplied, slug is used as-is instead of being derived from title. */
  slug?: string;
}

/** Parameters for listing documents. */
export interface ListDocumentsParams {
  /** Cursor for pagination (document id). */
  cursor?: string;
  /** Maximum number of results. Defaults to 20. */
  limit?: number;
  /** Filter by state. */
  state?: DocumentState;
  /** Filter by creator. */
  createdBy?: string;
}

/** Paginated list result. */
export interface ListResult<T> {
  items: T[];
  /** Cursor to pass for the next page, or null if no more results. */
  nextCursor: string | null;
}

// ── Version types ───────────────────────────────────────────────

/** Parameters for publishing a new version. */
export interface PublishVersionParams {
  documentId: string;
  /** Full content of this version (before patching). */
  content: string;
  /** Unified diff patch text from previous version. Empty string for v1. */
  patchText: string;
  /** Agent creating this version. */
  createdBy: string;
  /** One-line description of the change. */
  changelog: string;
}

/** Parameters for transitioning a document's lifecycle state. */
export interface TransitionParams {
  documentId: string;
  to: DocumentState;
  changedBy: string;
  reason?: string;
}

// ── Event log types ─────────────────────────────────────────────

/** A single document event entry. */
export interface DocumentEvent {
  id: string;
  documentId: string;
  type: string;
  agentId: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

/** Parameters for appending an event. */
export interface AppendEventParams {
  documentId: string;
  type: string;
  agentId: string;
  payload?: Record<string, unknown>;
}

/** Parameters for querying events. */
export interface QueryEventsParams {
  documentId: string;
  /** Filter by event type. */
  type?: string;
  /** Return events after this cursor (event id). */
  since?: string;
  /** Maximum results. Defaults to 50. */
  limit?: number;
}

// ── CRDT types ──────────────────────────────────────────────────

/** A CRDT update payload for a document section. */
export interface CrdtUpdate {
  documentId: string;
  sectionKey: string;
  /** Yjs binary update encoded as base64. */
  updateBase64: string;
  agentId: string;
  createdAt: number;
}

/** Current CRDT state for a section. */
export interface CrdtState {
  documentId: string;
  sectionKey: string;
  /** Serialized Yjs state vector as base64. */
  stateVectorBase64: string;
  /** Current merged document state as base64. */
  snapshotBase64: string;
  updatedAt: number;
}

// ── Lease types ─────────────────────────────────────────────────

/** A distributed lock / lease record. */
export interface Lease {
  id: string;
  /** Resource being locked (e.g. 'document:abc123'). */
  resource: string;
  /** Agent holding the lease. */
  holder: string;
  /** Expiry timestamp (ms since epoch). 0 = never expires. */
  expiresAt: number;
  acquiredAt: number;
}

/** Parameters for acquiring a lease. */
export interface AcquireLeaseParams {
  resource: string;
  holder: string;
  /** Lease TTL in milliseconds. */
  ttlMs: number;
}

// ── Presence types ──────────────────────────────────────────────

/** A presence record for an agent viewing a document. */
export interface PresenceEntry {
  agentId: string;
  documentId: string;
  /** Agent metadata (cursor position, color, etc.). */
  meta?: Record<string, unknown>;
  lastSeen: number;
  /** Expiry timestamp (ms since epoch). */
  expiresAt: number;
}

// ── Scratchpad types ────────────────────────────────────────────

/** A scratchpad message entry. */
export interface ScratchpadMessage {
  id: string;
  /** Recipient agent id. */
  toAgentId: string;
  /** Sender agent id. */
  fromAgentId: string;
  payload: Record<string, unknown>;
  createdAt: number;
  /** Expiry (ms since epoch). 0 = never expires. */
  exp: number;
}

/** Parameters for sending a scratchpad message. */
export interface SendScratchpadParams {
  toAgentId: string;
  fromAgentId: string;
  payload: Record<string, unknown>;
  /** TTL in ms. 0 = never expires. Defaults to 24h. */
  ttlMs?: number;
}

// ── A2A types ───────────────────────────────────────────────────

/** An A2A (Agent-to-Agent) inbox message. */
export interface A2AMessage {
  id: string;
  /** Recipient agent id. */
  toAgentId: string;
  /** Ed25519-signed envelope JSON string. */
  envelopeJson: string;
  createdAt: number;
  /** Expiry (ms since epoch). 0 = never expires. */
  exp: number;
}

// ── Search types ────────────────────────────────────────────────

/** A single semantic search result. */
export interface SearchResult {
  documentId: string;
  slug: string;
  title: string;
  /** Cosine similarity score in [0, 1]. */
  score: number;
  /** Matching snippet (optional). */
  snippet?: string;
}

/** Parameters for semantic search. */
export interface SearchParams {
  query: string;
  /** Maximum results. Defaults to 10. */
  topK?: number;
  /** Minimum similarity score (0–1). Defaults to 0.0. */
  minScore?: number;
}

// ── Identity types ──────────────────────────────────────────────

/** A registered agent public key record. */
export interface AgentPubkeyRecord {
  agentId: string;
  /** Hex-encoded Ed25519 public key. */
  pubkeyHex: string;
  label?: string;
  createdAt: number;
  /** If set, this key has been revoked. */
  revokedAt?: number;
}

// ── Sub-interfaces ──────────────────────────────────────────────

/** Document CRUD operations. */
export interface DocumentOps {
  /**
   * Create a new document.
   * MUST generate a unique slug from the title if not provided.
   */
  createDocument(params: CreateDocumentParams): Promise<Document>;

  /**
   * Retrieve a document by its id.
   * MUST return null (not throw) when the document does not exist.
   */
  getDocument(id: string): Promise<Document | null>;

  /**
   * Retrieve a document by its slug.
   * MUST return null (not throw) when the document does not exist.
   */
  getDocumentBySlug(slug: string): Promise<Document | null>;

  /**
   * List documents with optional filtering and cursor-based pagination.
   */
  listDocuments(params?: ListDocumentsParams): Promise<ListResult<Document>>;

  /**
   * Delete a document and all associated data.
   * MUST return false (not throw) if the document does not exist.
   */
  deleteDocument(id: string): Promise<boolean>;
}

/** Version stack operations. */
export interface VersionOps {
  /**
   * Publish a new version of a document.
   * MUST compute and store the content hash via llmtxt-core hash_content.
   * MUST increment the document's versionCount.
   */
  publishVersion(params: PublishVersionParams): Promise<VersionEntry>;

  /**
   * Retrieve a version entry by document id and version number.
   * MUST return null when the version does not exist.
   */
  getVersion(documentId: string, versionNumber: number): Promise<VersionEntry | null>;

  /**
   * List all version entries for a document in ascending order.
   */
  listVersions(documentId: string): Promise<VersionEntry[]>;

  /**
   * Transition a document's lifecycle state.
   * MUST validate the transition via sdk/lifecycle.ts validateTransition.
   * MUST return an error result (not throw) for invalid transitions.
   */
  transitionVersion(params: TransitionParams): Promise<{
    success: boolean;
    error?: string;
    document?: Document;
  }>;
}

/** BFT approval operations. */
export interface ApprovalOps {
  /**
   * Submit a signed approval (or rejection) for a document version.
   * MUST verify the Ed25519 signature before persisting.
   * MUST reject duplicate approvals from the same reviewer.
   */
  submitSignedApproval(params: {
    documentId: string;
    versionNumber: number;
    reviewerId: string;
    status: 'APPROVED' | 'REJECTED';
    reason?: string;
    /** Base64-encoded Ed25519 signature over canonical approval payload. */
    signatureBase64: string;
  }): Promise<{ success: boolean; error?: string; result?: ApprovalResult }>;

  /**
   * Get current approval progress for a document version.
   */
  getApprovalProgress(
    documentId: string,
    versionNumber: number
  ): Promise<ApprovalResult>;

  /**
   * Get or set the approval policy for a document.
   */
  getApprovalPolicy(documentId: string): Promise<ApprovalPolicy>;
  setApprovalPolicy(documentId: string, policy: ApprovalPolicy): Promise<void>;
}

/** Document event log operations. */
export interface EventOps {
  /**
   * Append an event to a document's event log.
   * MUST emit the event on the local bus for subscribeStream consumers.
   */
  appendEvent(params: AppendEventParams): Promise<DocumentEvent>;

  /**
   * Query the event log for a document with optional filtering.
   */
  queryEvents(params: QueryEventsParams): Promise<ListResult<DocumentEvent>>;

  /**
   * Subscribe to the event stream for a document.
   * MUST return an AsyncIterable that yields events as they are appended.
   * MUST clean up listeners when the consumer calls .return() or the iterator is GC'd.
   * LocalBackend uses in-process EventEmitter; RemoteBackend uses SSE.
   */
  subscribeStream(documentId: string): AsyncIterable<DocumentEvent>;
}

/** CRDT section operations. */
export interface CrdtOps {
  /**
   * Apply a Yjs binary update to a document section.
   * MUST merge via llmtxt-core WASM merge_updates.
   * MUST persist the raw update and update the section snapshot.
   */
  applyCrdtUpdate(params: {
    documentId: string;
    sectionKey: string;
    updateBase64: string;
    agentId: string;
  }): Promise<CrdtState>;

  /**
   * Get the current CRDT state for a section.
   * MUST return null when no state exists for the section.
   */
  getCrdtState(documentId: string, sectionKey: string): Promise<CrdtState | null>;

  /**
   * Subscribe to CRDT updates for a document section.
   * LocalBackend uses in-process EventEmitter; RemoteBackend uses WS.
   */
  subscribeSection(
    documentId: string,
    sectionKey: string
  ): AsyncIterable<CrdtUpdate>;
}

/** Distributed lease operations. */
export interface LeaseOps {
  /**
   * Acquire a lease on a resource.
   * MUST fail (return null) if a non-expired lease exists for a different holder.
   * MUST succeed (return existing) if the same holder re-acquires.
   */
  acquireLease(params: AcquireLeaseParams): Promise<Lease | null>;

  /**
   * Renew an existing lease, extending its TTL.
   * MUST return null if the lease does not exist or is held by a different agent.
   */
  renewLease(resource: string, holder: string, ttlMs: number): Promise<Lease | null>;

  /**
   * Release a lease immediately.
   * MUST return false if the lease does not exist or holder mismatch.
   */
  releaseLease(resource: string, holder: string): Promise<boolean>;

  /**
   * Get the current lease for a resource.
   * Returns null if no active lease exists.
   */
  getLease(resource: string): Promise<Lease | null>;
}

/** Presence (real-time who-is-viewing) operations. */
export interface PresenceOps {
  /**
   * Join or update presence for an agent on a document.
   * Presence is NOT persisted across restarts — in-memory only.
   */
  joinPresence(
    documentId: string,
    agentId: string,
    meta?: Record<string, unknown>
  ): Promise<PresenceEntry>;

  /**
   * Remove an agent from a document's presence.
   */
  leavePresence(documentId: string, agentId: string): Promise<void>;

  /**
   * List all non-expired presence entries for a document.
   */
  listPresence(documentId: string): Promise<PresenceEntry[]>;

  /**
   * Refresh the lastSeen timestamp for an agent's presence.
   */
  heartbeatPresence(documentId: string, agentId: string): Promise<void>;
}

/** Scratchpad ephemeral message operations. */
export interface ScratchpadOps {
  /**
   * Send a scratchpad message to an agent.
   * Default TTL is 24 hours. exp=0 means never expires.
   */
  sendScratchpad(params: SendScratchpadParams): Promise<ScratchpadMessage>;

  /**
   * Poll scratchpad messages for an agent.
   * MUST only return non-expired messages.
   * MUST treat exp=0 entries as never-expired.
   */
  pollScratchpad(agentId: string, limit?: number): Promise<ScratchpadMessage[]>;

  /**
   * Delete scratchpad messages for an agent (after consumption).
   */
  deleteScratchpadMessage(id: string, agentId: string): Promise<boolean>;
}

/** A2A (Agent-to-Agent) inbox operations. */
export interface A2AOps {
  /**
   * Deliver a signed A2A message to an agent's inbox.
   * MUST verify the sender's Ed25519 signature before persisting.
   * Default TTL is 48 hours.
   */
  sendA2AMessage(params: {
    toAgentId: string;
    envelopeJson: string;
    ttlMs?: number;
  }): Promise<{ success: boolean; error?: string; message?: A2AMessage }>;

  /**
   * Poll messages from an agent's inbox.
   * MUST only return non-expired messages.
   */
  pollA2AInbox(agentId: string, limit?: number): Promise<A2AMessage[]>;

  /**
   * Delete a message from an agent's inbox.
   */
  deleteA2AMessage(id: string, agentId: string): Promise<boolean>;
}

/** Semantic search operations. */
export interface SearchOps {
  /**
   * Index a document version for semantic search.
   * MUST compute an embedding vector and store it.
   * SHOULD degrade gracefully when onnxruntime-node is not installed.
   */
  indexDocument(documentId: string, content: string): Promise<void>;

  /**
   * Perform semantic search across indexed documents.
   * MUST return results sorted by cosine similarity descending.
   * SHOULD return empty array (not throw) when embedding model is unavailable.
   */
  search(params: SearchParams): Promise<SearchResult[]>;
}

/** Agent identity and pubkey registry operations. */
export interface IdentityOps {
  /**
   * Register an agent's public key.
   * MUST be idempotent — registering the same key twice MUST NOT error.
   */
  registerAgentPubkey(
    agentId: string,
    pubkeyHex: string,
    label?: string
  ): Promise<AgentPubkeyRecord>;

  /**
   * Look up an agent's registered public key.
   * MUST return null when the agent has no registered key.
   */
  lookupAgentPubkey(agentId: string): Promise<AgentPubkeyRecord | null>;

  /**
   * Revoke an agent's public key.
   * MUST set revokedAt on the key record.
   */
  revokeAgentPubkey(agentId: string, pubkeyHex: string): Promise<boolean>;

  /**
   * Record a signature nonce to prevent replay attacks.
   * MUST fail if the nonce has already been recorded.
   */
  recordSignatureNonce(agentId: string, nonce: string, ttlMs?: number): Promise<boolean>;

  /**
   * Check whether a nonce has already been used.
   */
  hasNonceBeenUsed(agentId: string, nonce: string): Promise<boolean>;
}

// ── Primary Interface ───────────────────────────────────────────

/**
 * Backend — the complete LLMtxt persistence and coordination interface.
 *
 * Implementations MUST satisfy all sub-interfaces. Consumers of this
 * interface SHOULD NOT depend on any implementation-specific methods.
 *
 * Both LocalBackend (packages/llmtxt/src/local/) and RemoteBackend
 * (packages/llmtxt/src/remote/) implement this interface.
 *
 * @example
 * ```ts
 * import { LocalBackend } from 'llmtxt/local';
 * const backend: Backend = new LocalBackend({ storagePath: './.llmtxt' });
 * await backend.open();
 * const doc = await backend.createDocument({ title: 'My Doc', createdBy: 'agent-1' });
 * await backend.close();
 * ```
 */
export interface Backend
  extends DocumentOps,
    VersionOps,
    ApprovalOps,
    EventOps,
    CrdtOps,
    LeaseOps,
    PresenceOps,
    ScratchpadOps,
    A2AOps,
    SearchOps,
    IdentityOps {

  /**
   * Open the backend connection / apply migrations.
   * MUST be called before any other method.
   * MUST be idempotent (calling open twice MUST NOT error).
   */
  open(): Promise<void>;

  /**
   * Close the backend, releasing resources (DB handles, timers, sockets).
   * MUST stop all background reapers and interval timers.
   * MUST be safe to call multiple times.
   */
  close(): Promise<void>;

  /** The BackendConfig this instance was constructed with. */
  readonly config: BackendConfig;
}
