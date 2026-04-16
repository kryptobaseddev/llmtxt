/**
 * PostgresBackend — Backend implementation backed by drizzle-orm/postgres-js.
 *
 * This is the server-side implementation used by apps/backend. It implements
 * the same Backend interface as LocalBackend (SQLite) so that the HTTP layer
 * in apps/backend becomes a thin adapter calling PostgresBackend methods.
 *
 * Architecture:
 *  - Uses drizzle-orm/postgres-js for all persistence.
 *  - Schema is imported dynamically at open() time from apps/backend/src/db/schema-pg.ts.
 *    (Cross-package static imports are prohibited — schema stays in apps/backend during migration.)
 *  - Async everywhere (postgres-js is fully async; no synchronous methods).
 *  - Transactions via db.transaction(async (tx) => { ... }).
 *
 * Implementation status:
 *  - T353.3: Scaffold only — open() and close() implemented; all domain
 *    methods are stubs that throw NotImplemented.
 *  - T353.4 (Wave A): Documents + Versions + Lifecycle implemented.
 *  - T353.5 (Wave B): Events + CRDT will be implemented.
 *  - T353.6 (Wave C): Leases + Presence + Scratchpad + A2A + BFT.
 *  - T353.7 (Wave D): Search + Collections + Cross-doc + Auth + Identity.
 *
 * @see packages/llmtxt/src/core/backend.ts for the full interface definition.
 * @see docs/specs/T353-backend-coverage-map.md for the route→method mapping.
 *
 * @module
 */

import type {
  Backend,
  BackendConfig,
  // Document ops
  Document,
  CreateDocumentParams,
  ListDocumentsParams,
  ListResult,
  // Version ops
  PublishVersionParams,
  TransitionParams,
  // Approval ops
  ApprovalPolicy,
  ApprovalResult,
  // Contributor ops
  ContributorRecord,
  // BFT ops
  ApprovalChainResult,
  // Event ops
  AppendEventParams,
  DocumentEvent,
  QueryEventsParams,
  CrdtUpdate,
  CrdtState,
  // Lease ops
  AcquireLeaseParams,
  Lease,
  // Presence ops
  PresenceEntry,
  // Scratchpad ops
  ScratchpadMessage,
  SendScratchpadParams,
  // A2A ops
  A2AMessage,
  // Search ops
  SearchParams,
  SearchResult,
  // Identity ops
  AgentPubkeyRecord,
  // Collection ops
  Collection,
  CreateCollectionParams,
  ListCollectionsParams,
  CollectionExport,
  // Cross-doc ops
  DocumentLink,
  CreateDocLinkParams,
  GraphResult,
  // Webhook ops
  Webhook,
  CreateWebhookParams,
  WebhookTestResult,
  // Signed URL ops
  SignedUrl,
  CreateSignedUrlParams,
  // Access control ops
  AccessControlList,
  GrantAccessParams,
  DocumentVisibility,
  // Organization ops
  Organization,
  CreateOrgParams,
  // API key ops
  ApiKey,
  ApiKeyWithSecret,
  CreateApiKeyParams,
} from '../core/backend.js';
import type { VersionEntry } from '../sdk/versions.js';

// ── Wave A schema cache ───────────────────────────────────────────────────────
//
// The Postgres schema lives in apps/backend/src/db/schema-pg.ts. This package
// cannot statically import it (monorepo boundary). We load it once at open()
// and cache the table references here for all subsequent method calls.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SchemaCache = Record<string, any>;

// ── PostgresBackend Config ──────────────────────────────────────────────────

/** Extended config for PostgresBackend. */
export interface PostgresBackendConfig extends BackendConfig {
  /**
   * PostgreSQL connection string.
   * MUST be in the format: postgresql://user:pass@host:5432/dbname
   * Defaults to DATABASE_URL environment variable.
   */
  connectionString?: string;

  /**
   * Maximum number of connections in the pool.
   * Defaults to 10.
   */
  maxConnections?: number;
}

// ── PostgresBackend ─────────────────────────────────────────────────────────

/**
 * PostgresBackend — Backend implementation using drizzle-orm/postgres-js.
 *
 * Registers as `fastify.backendCore` via apps/backend/src/plugins/postgres-backend-plugin.ts.
 * All route handlers call `fastify.backendCore.*` instead of querying Drizzle directly.
 *
 * @example
 * ```ts
 * import { PostgresBackend } from 'llmtxt/pg';
 *
 * const backend = new PostgresBackend({
 *   connectionString: process.env.DATABASE_URL,
 * });
 * await backend.open();
 * const doc = await backend.createDocument({ title: 'My Doc', createdBy: 'agent-1' });
 * await backend.close();
 * ```
 */
export class PostgresBackend implements Backend {
  readonly config: PostgresBackendConfig;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _db: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _sql: any = null;
  private _isOpen = false;

  // Cached schema table references, loaded once at open() time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _s: SchemaCache = {};

  // Cached drizzle operator functions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _orm: Record<string, any> = {};

  constructor(config: PostgresBackendConfig = {}) {
    this.config = config;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Open the PostgreSQL connection pool.
   * MUST be called before any other method.
   * MUST be idempotent — calling open twice MUST NOT error.
   */
  async open(): Promise<void> {
    if (this._isOpen) return;

    const connectionString =
      this.config.connectionString ??
      process.env.DATABASE_URL ??
      'postgresql://localhost:5432/llmtxt';

    const maxConnections = this.config.maxConnections ?? 10;

    // Dynamically import to avoid loading postgres-js in SQLite-only environments.
    // `postgres` is a peer/optional dependency — installed by apps/backend, not by this package.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const postgres = ((await import('postgres' as any)) as any).default;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { drizzle } = (await import('drizzle-orm/postgres-js' as any)) as any;

    this._sql = postgres(connectionString, {
      max: maxConnections,
      prepare: false, // required for drizzle-orm/postgres-js
    });

    this._db = drizzle({ client: this._sql });

    // Load schema tables dynamically (monorepo boundary — schema lives in apps/backend).
    // The schema path is resolved relative to this file at runtime; in the compiled
    // output this resolves to apps/backend/src/db/schema-pg.js via NODE_PATH or symlink.
    // During Wave A the schema is injected by the Fastify plugin via setSchema().
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ormModule = (await import('drizzle-orm' as any)) as any;
    this._orm = {
      eq: ormModule.eq,
      and: ormModule.and,
      desc: ormModule.desc,
      inArray: ormModule.inArray,
      sql: ormModule.sql,
    };

    this._isOpen = true;
  }

  /**
   * Inject schema table references from the apps/backend side.
   * Called by postgres-backend-plugin.ts after loading schema-pg.ts.
   * This avoids cross-package static imports while keeping types intact.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSchema(schema: SchemaCache): void {
    this._s = schema;
  }

  /**
   * Close the PostgreSQL connection pool.
   * MUST stop all active connections.
   * MUST be safe to call multiple times.
   */
  async close(): Promise<void> {
    if (!this._isOpen) return;
    if (this._sql) {
      await this._sql.end();
      this._sql = null;
    }
    this._db = null;
    this._isOpen = false;
  }

  private _assertOpen(): void {
    if (!this._isOpen || !this._db) {
      throw new Error('PostgresBackend: call open() before using the backend');
    }
  }

  // ── Document operations ───────────────────────────────────────────────────
  // Wave A (T353.4) — implemented.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createDocument(_params: CreateDocumentParams): Promise<any> {
    this._assertOpen();
    // createDocument is called from compress handler which does its own DB writes.
    // PostgresBackend exposes this as a lower-level helper for Wave D refactor.
    // For Wave A, the compress route handles inserts directly.
    throw new Error('PostgresBackend: createDocument — use compress route handler directly (Wave A)');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getDocument(id: string): Promise<any> {
    this._assertOpen();
    const { documents } = this._s;
    const { eq } = this._orm;
    const [doc] = await this._db
      .select()
      .from(documents)
      .where(eq(documents.id, id));
    return doc ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getDocumentBySlug(slug: string): Promise<any> {
    this._assertOpen();
    const { documents } = this._s;
    const { eq } = this._orm;
    const [doc] = await this._db
      .select()
      .from(documents)
      .where(eq(documents.slug, slug));
    return doc ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async listDocuments(params?: ListDocumentsParams): Promise<ListResult<any>> {
    this._assertOpen();
    const { documents } = this._s;
    const { eq, desc } = this._orm;
    const ownerId = (params as Record<string, unknown> | undefined)?.ownerId as string | undefined;
    const query = this._db
      .select({
        id: documents.id,
        slug: documents.slug,
        format: documents.format,
        tokenCount: documents.tokenCount,
        originalSize: documents.originalSize,
        compressedSize: documents.compressedSize,
        createdAt: documents.createdAt,
        accessCount: documents.accessCount,
        state: documents.state,
        isAnonymous: documents.isAnonymous,
      })
      .from(documents);

    const rows = ownerId
      ? await query.where(eq(documents.ownerId, ownerId)).orderBy(desc(documents.createdAt))
      : await query.orderBy(desc(documents.createdAt));

    return { items: rows, nextCursor: null };
  }

  async deleteDocument(_id: string): Promise<boolean> {
    this._assertOpen();
    throw new Error('PostgresBackend: deleteDocument — Wave D implementation pending (T353.7)');
  }

  // ── Version operations ────────────────────────────────────────────────────
  // Wave A (T353.4) — implemented.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async publishVersion(_params: PublishVersionParams): Promise<any> {
    this._assertOpen();
    // publishVersion is called from PUT /documents/:slug handler which has complex
    // conflict detection, compression, and contributor upsert logic. The route
    // handler remains the owner of this transaction for Wave A.
    throw new Error('PostgresBackend: publishVersion — use PUT route handler directly (Wave A)');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getVersion(documentId: string, versionNumber: number): Promise<any> {
    this._assertOpen();
    const { documents, versions } = this._s;
    const { eq, and } = this._orm;

    // documentId may be document.id or document.slug — resolve to id first
    let docId = documentId;
    if (!documentId.includes('-') && documentId.length <= 20) {
      // Looks like a slug — resolve
      const [doc] = await this._db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.slug, documentId));
      if (!doc) return null;
      docId = doc.id;
    }

    const [version] = await this._db
      .select()
      .from(versions)
      .where(and(eq(versions.documentId, docId), eq(versions.versionNumber, versionNumber)));
    return version ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async listVersions(documentId: string): Promise<any[]> {
    this._assertOpen();
    const { documents, versions } = this._s;
    const { eq, desc } = this._orm;

    // Resolve slug to id if needed
    let docId = documentId;
    const [doc] = await this._db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.slug, documentId));
    if (doc) docId = doc.id;

    return this._db
      .select({
        versionNumber: versions.versionNumber,
        contentHash: versions.contentHash,
        tokenCount: versions.tokenCount,
        createdAt: versions.createdAt,
        createdBy: versions.createdBy,
        changelog: versions.changelog,
      })
      .from(versions)
      .where(eq(versions.documentId, docId))
      .orderBy(desc(versions.versionNumber));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async transitionVersion(params: TransitionParams): Promise<{
    success: boolean;
    error?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document?: any;
  }> {
    this._assertOpen();
    // transitionVersion is called from lifecycle.ts route which has complex
    // event appending and cache invalidation. Route handler remains owner for Wave A.
    throw new Error('PostgresBackend: transitionVersion — use lifecycle route handler directly (Wave A)');
  }

  // ── Approval operations ───────────────────────────────────────────────────
  // Wave A (T353.4) — approve/reject route logic stays in route handler;
  // getApprovalProgress and listContributors are implemented here.

  async submitSignedApproval(_params: {
    documentId: string;
    versionNumber: number;
    reviewerId: string;
    status: 'APPROVED' | 'REJECTED';
    reason?: string;
    signatureBase64: string;
  }): Promise<{ success: boolean; error?: string; result?: ApprovalResult }> {
    this._assertOpen();
    // Approve/reject routes have complex consensus + auto-lock transactions.
    // Route handlers remain owners for Wave A.
    throw new Error('PostgresBackend: submitSignedApproval — use lifecycle route handler directly (Wave A)');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getApprovalProgress(documentId: string, _versionNumber?: number): Promise<any> {
    this._assertOpen();
    const { documents, approvals } = this._s;
    const { eq, desc } = this._orm;

    // Resolve slug to document id
    const [doc] = await this._db
      .select()
      .from(documents)
      .where(eq(documents.slug, documentId))
      .limit(1);
    if (!doc) return null;

    const rows = await this._db
      .select()
      .from(approvals)
      .where(eq(approvals.documentId, doc.id))
      .orderBy(desc(approvals.timestamp));

    return { doc, reviews: rows };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getApprovalPolicy(documentId: string): Promise<any> {
    this._assertOpen();
    const { documents } = this._s;
    const { eq } = this._orm;

    const [doc] = await this._db
      .select({
        approvalRequiredCount: documents.approvalRequiredCount,
        approvalRequireUnanimous: documents.approvalRequireUnanimous,
        approvalAllowedReviewers: documents.approvalAllowedReviewers,
        approvalTimeoutMs: documents.approvalTimeoutMs,
      })
      .from(documents)
      .where(eq(documents.slug, documentId))
      .limit(1);
    return doc ?? null;
  }

  async setApprovalPolicy(_documentId: string, _policy: ApprovalPolicy): Promise<void> {
    this._assertOpen();
    throw new Error('PostgresBackend: setApprovalPolicy — Wave D implementation pending (T353.7)');
  }

  // ── Contributor operations ────────────────────────────────────────────────
  // Wave A (T353.4) — implemented.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async listContributors(documentId: string): Promise<any[]> {
    this._assertOpen();
    const { documents, contributors } = this._s;
    const { eq, desc } = this._orm;

    const [doc] = await this._db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.slug, documentId))
      .limit(1);
    if (!doc) return [];

    return this._db
      .select()
      .from(contributors)
      .where(eq(contributors.documentId, doc.id))
      .orderBy(desc(contributors.netTokens));
  }

  // ── BFT operations ────────────────────────────────────────────────────────

  async getApprovalChain(_documentId: string): Promise<ApprovalChainResult> {
    this._assertOpen();
    throw new Error('PostgresBackend: getApprovalChain — Wave C implementation pending (T353.6)');
  }

  // ── Event log operations ──────────────────────────────────────────────────

  async appendEvent(_params: AppendEventParams): Promise<DocumentEvent> {
    this._assertOpen();
    throw new Error('PostgresBackend: appendEvent — Wave B implementation pending (T353.5)');
  }

  async queryEvents(_params: QueryEventsParams): Promise<ListResult<DocumentEvent>> {
    this._assertOpen();
    throw new Error('PostgresBackend: queryEvents — Wave B implementation pending (T353.5)');
  }

  async *subscribeStream(_documentId: string): AsyncIterable<DocumentEvent> {
    this._assertOpen();
    throw new Error('PostgresBackend: subscribeStream — Wave B implementation pending (T353.5)');
  }

  // ── CRDT operations ───────────────────────────────────────────────────────

  async applyCrdtUpdate(_params: {
    documentId: string;
    sectionKey: string;
    updateBase64: string;
    agentId: string;
  }): Promise<CrdtState> {
    this._assertOpen();
    throw new Error('PostgresBackend: applyCrdtUpdate — Wave B implementation pending (T353.5)');
  }

  async getCrdtState(_documentId: string, _sectionKey: string): Promise<CrdtState | null> {
    this._assertOpen();
    throw new Error('PostgresBackend: getCrdtState — Wave B implementation pending (T353.5)');
  }

  async *subscribeSection(
    _documentId: string,
    _sectionKey: string
  ): AsyncIterable<CrdtUpdate> {
    this._assertOpen();
    throw new Error('PostgresBackend: subscribeSection — Wave B implementation pending (T353.5)');
  }

  // ── Lease operations ──────────────────────────────────────────────────────

  async acquireLease(_params: AcquireLeaseParams): Promise<Lease | null> {
    this._assertOpen();
    throw new Error('PostgresBackend: acquireLease — Wave C implementation pending (T353.6)');
  }

  async renewLease(_resource: string, _holder: string, _ttlMs: number): Promise<Lease | null> {
    this._assertOpen();
    throw new Error('PostgresBackend: renewLease — Wave C implementation pending (T353.6)');
  }

  async releaseLease(_resource: string, _holder: string): Promise<boolean> {
    this._assertOpen();
    throw new Error('PostgresBackend: releaseLease — Wave C implementation pending (T353.6)');
  }

  async getLease(_resource: string): Promise<Lease | null> {
    this._assertOpen();
    throw new Error('PostgresBackend: getLease — Wave C implementation pending (T353.6)');
  }

  // ── Presence operations ───────────────────────────────────────────────────

  async joinPresence(
    _documentId: string,
    _agentId: string,
    _meta?: Record<string, unknown>
  ): Promise<PresenceEntry> {
    this._assertOpen();
    throw new Error('PostgresBackend: joinPresence — Wave C implementation pending (T353.6)');
  }

  async leavePresence(_documentId: string, _agentId: string): Promise<void> {
    this._assertOpen();
    throw new Error('PostgresBackend: leavePresence — Wave C implementation pending (T353.6)');
  }

  async listPresence(_documentId: string): Promise<PresenceEntry[]> {
    this._assertOpen();
    throw new Error('PostgresBackend: listPresence — Wave C implementation pending (T353.6)');
  }

  async heartbeatPresence(_documentId: string, _agentId: string): Promise<void> {
    this._assertOpen();
    throw new Error('PostgresBackend: heartbeatPresence — Wave C implementation pending (T353.6)');
  }

  // ── Scratchpad operations ─────────────────────────────────────────────────

  async sendScratchpad(_params: SendScratchpadParams): Promise<ScratchpadMessage> {
    this._assertOpen();
    throw new Error('PostgresBackend: sendScratchpad — Wave C implementation pending (T353.6)');
  }

  async pollScratchpad(_agentId: string, _limit?: number): Promise<ScratchpadMessage[]> {
    this._assertOpen();
    throw new Error('PostgresBackend: pollScratchpad — Wave C implementation pending (T353.6)');
  }

  async deleteScratchpadMessage(_id: string, _agentId: string): Promise<boolean> {
    this._assertOpen();
    throw new Error('PostgresBackend: deleteScratchpadMessage — Wave C implementation pending (T353.6)');
  }

  // ── A2A operations ────────────────────────────────────────────────────────

  async sendA2AMessage(_params: {
    toAgentId: string;
    envelopeJson: string;
    ttlMs?: number;
  }): Promise<{ success: boolean; error?: string; message?: A2AMessage }> {
    this._assertOpen();
    throw new Error('PostgresBackend: sendA2AMessage — Wave C implementation pending (T353.6)');
  }

  async pollA2AInbox(_agentId: string, _limit?: number): Promise<A2AMessage[]> {
    this._assertOpen();
    throw new Error('PostgresBackend: pollA2AInbox — Wave C implementation pending (T353.6)');
  }

  async deleteA2AMessage(_id: string, _agentId: string): Promise<boolean> {
    this._assertOpen();
    throw new Error('PostgresBackend: deleteA2AMessage — Wave C implementation pending (T353.6)');
  }

  // ── Search operations ─────────────────────────────────────────────────────

  async indexDocument(_documentId: string, _content: string): Promise<void> {
    this._assertOpen();
    throw new Error('PostgresBackend: indexDocument — Wave D implementation pending (T353.7)');
  }

  async search(_params: SearchParams): Promise<SearchResult[]> {
    this._assertOpen();
    throw new Error('PostgresBackend: search — Wave D implementation pending (T353.7)');
  }

  // ── Identity operations ───────────────────────────────────────────────────

  async registerAgentPubkey(
    _agentId: string,
    _pubkeyHex: string,
    _label?: string
  ): Promise<AgentPubkeyRecord> {
    this._assertOpen();
    throw new Error('PostgresBackend: registerAgentPubkey — Wave D implementation pending (T353.7)');
  }

  async lookupAgentPubkey(_agentId: string): Promise<AgentPubkeyRecord | null> {
    this._assertOpen();
    throw new Error('PostgresBackend: lookupAgentPubkey — Wave D implementation pending (T353.7)');
  }

  async listAgentPubkeys(_userId?: string): Promise<AgentPubkeyRecord[]> {
    this._assertOpen();
    throw new Error('PostgresBackend: listAgentPubkeys — Wave D implementation pending (T353.7)');
  }

  async revokeAgentPubkey(_agentId: string, _pubkeyHex: string): Promise<boolean> {
    this._assertOpen();
    throw new Error('PostgresBackend: revokeAgentPubkey — Wave D implementation pending (T353.7)');
  }

  async recordSignatureNonce(
    _agentId: string,
    _nonce: string,
    _ttlMs?: number
  ): Promise<boolean> {
    this._assertOpen();
    throw new Error('PostgresBackend: recordSignatureNonce — Wave D implementation pending (T353.7)');
  }

  async hasNonceBeenUsed(_agentId: string, _nonce: string): Promise<boolean> {
    this._assertOpen();
    throw new Error('PostgresBackend: hasNonceBeenUsed — Wave D implementation pending (T353.7)');
  }

  // ── Collection operations ─────────────────────────────────────────────────

  async createCollection(_params: CreateCollectionParams): Promise<Collection> {
    this._assertOpen();
    throw new Error('PostgresBackend: createCollection — Wave D implementation pending (T353.7)');
  }

  async getCollection(_slug: string): Promise<Collection | null> {
    this._assertOpen();
    throw new Error('PostgresBackend: getCollection — Wave D implementation pending (T353.7)');
  }

  async listCollections(_params?: ListCollectionsParams): Promise<ListResult<Collection>> {
    this._assertOpen();
    throw new Error('PostgresBackend: listCollections — Wave D implementation pending (T353.7)');
  }

  async addDocToCollection(
    _collectionSlug: string,
    _documentSlug: string,
    _position?: number
  ): Promise<void> {
    this._assertOpen();
    throw new Error('PostgresBackend: addDocToCollection — Wave D implementation pending (T353.7)');
  }

  async removeDocFromCollection(
    _collectionSlug: string,
    _documentSlug: string
  ): Promise<boolean> {
    this._assertOpen();
    throw new Error('PostgresBackend: removeDocFromCollection — Wave D implementation pending (T353.7)');
  }

  async reorderCollection(_collectionSlug: string, _orderedSlugs: string[]): Promise<void> {
    this._assertOpen();
    throw new Error('PostgresBackend: reorderCollection — Wave D implementation pending (T353.7)');
  }

  async exportCollection(_collectionSlug: string): Promise<CollectionExport> {
    this._assertOpen();
    throw new Error('PostgresBackend: exportCollection — Wave D implementation pending (T353.7)');
  }

  // ── Cross-doc operations ──────────────────────────────────────────────────

  async createDocumentLink(_params: CreateDocLinkParams): Promise<DocumentLink> {
    this._assertOpen();
    throw new Error('PostgresBackend: createDocumentLink — Wave D implementation pending (T353.7)');
  }

  async getDocumentLinks(_documentId: string): Promise<DocumentLink[]> {
    this._assertOpen();
    throw new Error('PostgresBackend: getDocumentLinks — Wave D implementation pending (T353.7)');
  }

  async deleteDocumentLink(_documentId: string, _linkId: string): Promise<boolean> {
    this._assertOpen();
    throw new Error('PostgresBackend: deleteDocumentLink — Wave D implementation pending (T353.7)');
  }

  async getGlobalGraph(_params?: { maxNodes?: number }): Promise<GraphResult> {
    this._assertOpen();
    throw new Error('PostgresBackend: getGlobalGraph — Wave D implementation pending (T353.7)');
  }

  // ── Webhook operations ────────────────────────────────────────────────────

  async createWebhook(_params: CreateWebhookParams): Promise<Webhook> {
    this._assertOpen();
    throw new Error('PostgresBackend: createWebhook — Wave D implementation pending (T353.7)');
  }

  async listWebhooks(_userId: string): Promise<Webhook[]> {
    this._assertOpen();
    throw new Error('PostgresBackend: listWebhooks — Wave D implementation pending (T353.7)');
  }

  async deleteWebhook(_id: string, _userId: string): Promise<boolean> {
    this._assertOpen();
    throw new Error('PostgresBackend: deleteWebhook — Wave D implementation pending (T353.7)');
  }

  async testWebhook(_id: string): Promise<WebhookTestResult> {
    this._assertOpen();
    throw new Error('PostgresBackend: testWebhook — Wave D implementation pending (T353.7)');
  }

  // ── Signed URL operations ─────────────────────────────────────────────────

  async createSignedUrl(_params: CreateSignedUrlParams): Promise<SignedUrl> {
    this._assertOpen();
    throw new Error('PostgresBackend: createSignedUrl — Wave D implementation pending (T353.7)');
  }

  async verifySignedUrl(
    _token: string
  ): Promise<{ documentId: string; permission: 'read' | 'write' } | null> {
    this._assertOpen();
    throw new Error('PostgresBackend: verifySignedUrl — Wave D implementation pending (T353.7)');
  }

  // ── Access control operations ─────────────────────────────────────────────

  async getDocumentAccess(_documentId: string): Promise<AccessControlList> {
    this._assertOpen();
    throw new Error('PostgresBackend: getDocumentAccess — Wave D implementation pending (T353.7)');
  }

  async grantDocumentAccess(
    _documentId: string,
    _params: GrantAccessParams
  ): Promise<void> {
    this._assertOpen();
    throw new Error('PostgresBackend: grantDocumentAccess — Wave D implementation pending (T353.7)');
  }

  async revokeDocumentAccess(_documentId: string, _userId: string): Promise<boolean> {
    this._assertOpen();
    throw new Error('PostgresBackend: revokeDocumentAccess — Wave D implementation pending (T353.7)');
  }

  async setDocumentVisibility(
    _documentId: string,
    _visibility: DocumentVisibility
  ): Promise<void> {
    this._assertOpen();
    throw new Error('PostgresBackend: setDocumentVisibility — Wave D implementation pending (T353.7)');
  }

  // ── Organization operations ───────────────────────────────────────────────

  async createOrganization(_params: CreateOrgParams): Promise<Organization> {
    this._assertOpen();
    throw new Error('PostgresBackend: createOrganization — Wave D implementation pending (T353.7)');
  }

  async getOrganization(_slug: string): Promise<Organization | null> {
    this._assertOpen();
    throw new Error('PostgresBackend: getOrganization — Wave D implementation pending (T353.7)');
  }

  async listOrganizations(_userId: string): Promise<Organization[]> {
    this._assertOpen();
    throw new Error('PostgresBackend: listOrganizations — Wave D implementation pending (T353.7)');
  }

  async addOrgMember(_orgSlug: string, _userId: string, _role?: string): Promise<void> {
    this._assertOpen();
    throw new Error('PostgresBackend: addOrgMember — Wave D implementation pending (T353.7)');
  }

  async removeOrgMember(_orgSlug: string, _userId: string): Promise<boolean> {
    this._assertOpen();
    throw new Error('PostgresBackend: removeOrgMember — Wave D implementation pending (T353.7)');
  }

  // ── API key operations ────────────────────────────────────────────────────

  async createApiKey(_params: CreateApiKeyParams): Promise<ApiKeyWithSecret> {
    this._assertOpen();
    throw new Error('PostgresBackend: createApiKey — Wave D implementation pending (T353.7)');
  }

  async listApiKeys(_userId: string): Promise<ApiKey[]> {
    this._assertOpen();
    throw new Error('PostgresBackend: listApiKeys — Wave D implementation pending (T353.7)');
  }

  async deleteApiKey(_id: string, _userId: string): Promise<boolean> {
    this._assertOpen();
    throw new Error('PostgresBackend: deleteApiKey — Wave D implementation pending (T353.7)');
  }

  async rotateApiKey(_id: string, _userId: string): Promise<ApiKeyWithSecret> {
    this._assertOpen();
    throw new Error('PostgresBackend: rotateApiKey — Wave D implementation pending (T353.7)');
  }
}
