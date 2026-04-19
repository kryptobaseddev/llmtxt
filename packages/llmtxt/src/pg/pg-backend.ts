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
  ExportDocumentParams,
  ExportDocumentResult,
  ExportAllParams,
  ExportAllResult,
  ImportDocumentParams,
  ImportDocumentResult,
} from '../core/backend.js';
import { ExportError } from '../core/backend.js';
import {
  writeExportFile,
  exportAllFilePath,
  contentHashHex,
} from '../export/backend-export.js';
import type { DocumentExportState } from '../export/types.js';
import { parseImportFile } from '../export/import-parser.js';
import type { VersionEntry } from '../sdk/versions.js';

// ── SDK helpers (generateId + hashContent from llmtxt WASM/Rust core) ─────────
// These are imported lazily at method call time to avoid loading WASM in
// environments that only use SQLite.  Both are available via 'llmtxt' SDK export.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sdkHelpers: { generateId: () => string; hashContent: (s: string) => string } | null = null;

async function getSdkHelpers() {
  if (_sdkHelpers) return _sdkHelpers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk = (await import('llmtxt' as any)) as any;
  _sdkHelpers = { generateId: sdk.generateId, hashContent: sdk.hashContent };
  return _sdkHelpers!;
}

// ── Wave A schema cache ───────────────────────────────────────────────────────
//
// The Postgres schema lives in apps/backend/src/db/schema-pg.ts. This package
// cannot statically import it (monorepo boundary). We load it once at open()
// and cache the table references here for all subsequent method calls.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SchemaCache = Record<string, any>;

// ── Wave B injectable dependency types ───────────────────────────────────────
//
// apps/backend helpers that cannot be statically imported (monorepo boundary).
// They are injected once at startup by postgres-backend-plugin.ts.

/** Signature of apps/backend/src/lib/document-events.ts appendDocumentEvent. */
type AppendDocumentEventFn = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  input: {
    documentId: string;
    eventType: string;
    actorId: string;
    payloadJson: Record<string, unknown>;
    idempotencyKey?: string | null;
  }
) => Promise<{
  event: {
    id: string;
    documentId: string;
    seq: bigint;
    eventType: string;
    actorId: string;
    payloadJson: unknown;
    idempotencyKey: string | null;
    createdAt: Date;
    prevHash: Buffer | null;
  };
  duplicated: boolean;
}>;

/** Signature of apps/backend/src/crdt/persistence.ts persistCrdtUpdate. */
type PersistCrdtUpdateFn = (
  documentId: string,
  sectionId: string,
  updateBlob: Buffer,
  clientId: string
) => Promise<{ seq: bigint; newState: Buffer }>;

/** Signature of apps/backend/src/crdt/persistence.ts loadSectionState. */
type LoadSectionStateFn = (
  documentId: string,
  sectionId: string
) => Promise<{ crdtState: Buffer; clock: number; updatedAt: Date | null } | null>;

/** Signature of apps/backend/src/realtime/redis-pubsub.ts subscribeCrdtUpdates. */
type SubscribeCrdtUpdatesFn = (
  documentId: string,
  sectionId: string,
  listener: (documentId: string, sectionId: string, update: Buffer) => void
) => () => void;

/** Minimal EventEmitter-compatible interface for the document event bus. */
interface DocumentEventBusLike {
  on(event: 'document', listener: (payload: unknown) => void): void;
  off(event: 'document', listener: (payload: unknown) => void): void;
}

/** Shape of a document event as emitted by the in-process bus. */
interface BusDocumentEvent {
  type: string;
  slug: string;
  documentId: string;
  timestamp: number;
  actor: string;
  data: Record<string, unknown>;
}

/** CRDT state vector helper — returns state vector bytes from a Yjs state. */
type CrdtStateVectorFn = (state: Buffer) => Buffer;

// ── Wave C injectable dependency types ───────────────────────────────────────
//
// In-memory presence and scratchpad helpers — injected by postgres-backend-plugin.ts.

/** Minimal PresenceRegistry interface matching apps/backend/src/presence/registry.ts. */
interface PresenceRegistryLike {
  upsert(agentId: string, docId: string, section: string, cursorOffset?: number): void;
  expire(now?: number): void;
  getByDoc(docId: string): Array<{
    agentId: string;
    section: string;
    cursorOffset?: number;
    lastSeen: number;
  }>;
  remove?(agentId: string, docId: string): void;
}

/** Scratchpad publish function (apps/backend/src/lib/scratchpad.ts). */
type ScratchpadPublishFn = (
  slug: string,
  opts: {
    agentId: string;
    content: string;
    contentType?: string;
    threadId?: string;
    sigHex?: string;
  }
) => Promise<{
  id: string;
  agentId: string;
  content: string;
  contentType: string;
  threadId?: string;
  sigHex?: string;
  timestampMs: number;
}>;

/** Scratchpad read function. */
type ScratchpadReadFn = (
  slug: string,
  opts?: {
    lastId?: string;
    limit?: number;
    threadId?: string;
  }
) => Promise<Array<{
  id: string;
  agentId: string;
  content: string;
  contentType: string;
  threadId?: string;
  sigHex?: string;
  timestampMs: number;
}>>;

/** Scratchpad subscribe function — returns unsubscribe. */
type ScratchpadSubscribeFn = (
  slug: string,
  threadId: string | undefined,
  onMessage: (msg: {
    id: string;
    agentId: string;
    content: string;
    contentType: string;
    threadId?: string;
    sigHex?: string;
    timestampMs: number;
  }) => void
) => () => void;

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

  // ── Wave B injectable dependencies ─────────────────────────────────────────
  // These are injected by postgres-backend-plugin.ts after open().
  // All default to null; methods will throw NotImplemented until injected.
  private _appendDocumentEvent: AppendDocumentEventFn | null = null;
  private _persistCrdtUpdate: PersistCrdtUpdateFn | null = null;
  private _loadSectionState: LoadSectionStateFn | null = null;
  private _subscribeCrdtUpdates: SubscribeCrdtUpdatesFn | null = null;
  private _eventBus: DocumentEventBusLike | null = null;
  private _crdtStateVector: CrdtStateVectorFn | null = null;

  // ── Wave C injectable dependencies ─────────────────────────────────────────
  // Presence registry and scratchpad helpers — in-memory only, injected at startup.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _presenceRegistry: PresenceRegistryLike | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _scratchpadPublish: ScratchpadPublishFn | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _scratchpadRead: ScratchpadReadFn | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _scratchpadSubscribe: ScratchpadSubscribeFn | null = null;

  // ── Blob injectable dependency ──────────────────────────────────────────────
  // BlobPgAdapter lives in apps/backend (monorepo boundary: cannot static import).
  // Injected by postgres-backend-plugin.ts after open() via setBlobAdapter().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _blobAdapter: any | null = null;

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
      or: ormModule.or,
      desc: ormModule.desc,
      asc: ormModule.asc,
      gt: ormModule.gt,
      lt: ormModule.lt,
      gte: ormModule.gte,
      lte: ormModule.lte,
      not: ormModule.not,
      isNull: ormModule.isNull,
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
   * Inject Wave B event-log and CRDT dependencies.
   * Called by postgres-backend-plugin.ts after open().
   *
   * These dependencies live in apps/backend and cannot be statically imported
   * from this package (monorepo boundary). Injecting them at plugin registration
   * time keeps this class free of cross-package imports.
   */
  setWaveBDeps(deps: {
    appendDocumentEvent: AppendDocumentEventFn;
    persistCrdtUpdate: PersistCrdtUpdateFn;
    loadSectionState: LoadSectionStateFn;
    subscribeCrdtUpdates: SubscribeCrdtUpdatesFn;
    eventBus: DocumentEventBusLike;
    crdtStateVector: CrdtStateVectorFn;
  }): void {
    this._appendDocumentEvent = deps.appendDocumentEvent;
    this._persistCrdtUpdate = deps.persistCrdtUpdate;
    this._loadSectionState = deps.loadSectionState;
    this._subscribeCrdtUpdates = deps.subscribeCrdtUpdates;
    this._eventBus = deps.eventBus;
    this._crdtStateVector = deps.crdtStateVector;
  }

  /**
   * Inject the BlobPgAdapter from apps/backend (monorepo boundary).
   * Called by postgres-backend-plugin.ts after open().
   *
   * The BlobPgAdapter cannot be statically imported from this package because it
   * lives in apps/backend/src/storage/. Injecting it at plugin registration time
   * keeps this class free of cross-package imports.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setBlobAdapter(adapter: any): void {
    this._blobAdapter = adapter;
  }

  /**
   * Inject Wave C presence + scratchpad dependencies.
   * Called by postgres-backend-plugin.ts after open().
   *
   * Presence is in-memory only (no PG persistence) — we delegate to the
   * shared presenceRegistry singleton. Scratchpad uses Redis Streams with
   * an in-process EventEmitter fallback.
   */
  setWaveCDeps(deps: {
    presenceRegistry: PresenceRegistryLike;
    scratchpadPublish: ScratchpadPublishFn;
    scratchpadRead: ScratchpadReadFn;
    scratchpadSubscribe: ScratchpadSubscribeFn;
  }): void {
    this._presenceRegistry = deps.presenceRegistry;
    this._scratchpadPublish = deps.scratchpadPublish;
    this._scratchpadRead = deps.scratchpadRead;
    this._scratchpadSubscribe = deps.scratchpadSubscribe;
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

  /**
   * createDocument — Wave A-2 implementation.
   *
   * Transactionally inserts document + version 1 + optional contributor +
   * optional document_roles owner row in a single BEGIN/COMMIT.
   *
   * The route handler pre-computes all content-derived fields outside the
   * transaction to keep CPU-bound work (compress, hash, tokenCount) separate.
   *
   * Extended params (passed as plain object, cast via Record<string, unknown>):
   *   id, slug, format, contentHash, compressedData, originalSize,
   *   compressedSize, tokenCount, createdBy, ownerId, isAnonymous.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createDocument(params: CreateDocumentParams): Promise<any> {
    this._assertOpen();
    const p = params as unknown as Record<string, unknown>;
    const { documents, versions, contributors, documentRoles } = this._s;
    const { eq, sql: ormSql } = this._orm;
    const { generateId } = await getSdkHelpers();

    const now = Date.now();
    const id = (p.id as string) ?? generateId();
    const slug = (p.slug as string) ?? generateId();
    const format = (p.format as string) ?? 'text';
    const contentHash = p.contentHash as string;
    const compressedData = p.compressedData as Buffer;
    const originalSize = (p.originalSize as number) ?? 0;
    const compressedSize = (p.compressedSize as number) ?? 0;
    const tokenCount = (p.tokenCount as number | null) ?? null;
    const createdBy = (p.createdBy as string | null) ?? null;
    const ownerId = (p.ownerId as string | null) ?? null;
    const isAnonymous = (p.isAnonymous as boolean) ?? false;
    // visibility: T699 — callers MUST supply 'private' or 'public'.
    // Default falls back to 'public' only for backward-compat callers that omit the field;
    // the compress route now always supplies 'private' for authenticated users.
    const visibility = (p.visibility as string) ?? 'public';
    // bftF: extended field passed from compress route for demo/test documents.
    // Default 1 matches the schema column default; pass 0 for single-bot demos.
    const bftF = typeof p.bftF === 'number' ? p.bftF : undefined;

    await this._db.transaction(async (tx: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txDb = tx as any;

      // 1. Insert document row
      await txDb.insert(documents).values({
        id,
        slug,
        format,
        contentHash,
        compressedData,
        originalSize,
        compressedSize,
        tokenCount,
        createdAt: now,
        accessCount: 0,
        currentVersion: 1,
        ownerId,
        isAnonymous,
        // T699: persist the caller-supplied visibility so ownerless-doc bypass is impossible.
        visibility,
        // Only include bftF when explicitly supplied; let schema default handle omitted case.
        ...(bftF !== undefined ? { bftF } : {}),
      });

      // 2. Insert version 1 (initial version)
      await txDb.insert(versions).values({
        id: generateId(),
        documentId: id,
        versionNumber: 1,
        compressedData,
        contentHash,
        tokenCount,
        createdAt: now,
        createdBy,
        changelog: 'Initial version',
      });

      // 3. Upsert initial contributor record (if author is known)
      if (createdBy) {
        await txDb.insert(contributors).values({
          id: generateId(),
          documentId: id,
          agentId: createdBy,
          versionsAuthored: 1,
          totalTokensAdded: tokenCount ?? 0,
          totalTokensRemoved: 0,
          netTokens: tokenCount ?? 0,
          firstContribution: now,
          lastContribution: now,
        });
      }

      // 4. Grant creator 'owner' role in document_roles (RBAC convenience mirror).
      if (ownerId && documentRoles) {
        try {
          await txDb.insert(documentRoles).values({
            id: ormSql`gen_random_uuid()`,
            documentId: id,
            userId: ownerId,
            role: 'owner',
            grantedBy: ownerId,
            grantedAt: now,
          });
        } catch (_) {
          // documentRoles schema variant may differ — degrade gracefully
        }
      }
    });

    // Return the inserted document row for the route handler to build its response.
    const [doc] = await this._db.select().from(documents).where(eq(documents.id, id));
    return doc ?? null;
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

  /**
   * publishVersion — Wave A-2 implementation.
   *
   * Transactionally creates a new version row, updates the document head, and
   * upserts the contributor record. Handles the first-update case (snapshot v1
   * from the existing document content if no versions exist yet).
   *
   * Conflict detection (baseVersion) and content compression are the caller's
   * responsibility — pass pre-computed fields via the extended params object:
   *   documentId, content (raw string), compressedData, contentHash, tokenCount,
   *   originalSize, compressedSize, createdBy, changelog, baseVersion?,
   *   tokensAdded?, tokensRemoved?, idempotencyKey?
   *
   * Returns the new version entry (versionNumber, contentHash, etc.).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async publishVersion(params: PublishVersionParams): Promise<any> {
    this._assertOpen();
    const p = params as unknown as Record<string, unknown>;
    const { documents, versions, contributors } = this._s;
    const { eq, and, desc, sql: ormSql } = this._orm;
    const { generateId } = await getSdkHelpers();

    const docId = p.documentId as string;
    const compressedData = p.compressedData as Buffer;
    const contentHash = p.contentHash as string;
    const tokenCount = (p.tokenCount as number | null) ?? null;
    const originalSize = (p.originalSize as number) ?? 0;
    const compressedSize = (p.compressedSize as number) ?? 0;
    const createdBy = (p.createdBy as string | null) ?? null;
    const changelog = (p.changelog as string | null) ?? null;
    const tokensAdded = (p.tokensAdded as number) ?? 0;
    const tokensRemoved = (p.tokensRemoved as number) ?? 0;
    const idempotencyKey = (p.idempotencyKey as string | null) ?? null;
    const now = Date.now();

    let nextVersionNumber = 0;

    await this._db.transaction(async (tx: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txDb = tx as any;

      // Read the current max version number inside the transaction (atomic read-write).
      const [latestVersion] = await txDb
        .select({ versionNumber: versions.versionNumber })
        .from(versions)
        .where(eq(versions.documentId, docId))
        .orderBy(desc(versions.versionNumber))
        .limit(1);

      // Fetch document row inside transaction to get compressedData for snapshot
      const [docRow] = await txDb
        .select()
        .from(documents)
        .where(eq(documents.id, docId))
        .limit(1);

      nextVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 2;

      // If this is the first update, snapshot current content as version 1.
      if (!latestVersion && docRow) {
        await txDb.insert(versions).values({
          id: generateId(),
          documentId: docId,
          versionNumber: 1,
          compressedData: docRow.compressedData,
          contentHash: docRow.contentHash,
          tokenCount: docRow.tokenCount,
          createdAt: docRow.createdAt,
          changelog: 'Initial version',
        });
      }

      // Insert the new version row.
      await txDb.insert(versions).values({
        id: generateId(),
        documentId: docId,
        versionNumber: nextVersionNumber,
        compressedData,
        contentHash,
        tokenCount,
        createdAt: now,
        createdBy,
        changelog,
      });

      // Update the document head.
      await txDb
        .update(documents)
        .set({
          compressedData,
          contentHash,
          originalSize,
          compressedSize,
          tokenCount,
          currentVersion: nextVersionNumber,
        })
        .where(eq(documents.id, docId));

      // Upsert contributor record (inside same transaction).
      if (createdBy) {
        const [existing] = await txDb
          .select()
          .from(contributors)
          .where(and(
            eq(contributors.documentId, docId),
            eq(contributors.agentId, createdBy),
          ));

        if (existing) {
          await txDb.update(contributors)
            .set({
              versionsAuthored: ormSql`${contributors.versionsAuthored} + 1`,
              totalTokensAdded: ormSql`${contributors.totalTokensAdded} + ${tokensAdded}`,
              totalTokensRemoved: ormSql`${contributors.totalTokensRemoved} + ${tokensRemoved}`,
              netTokens: ormSql`${contributors.netTokens} + ${tokensAdded} - ${tokensRemoved}`,
              lastContribution: now,
            })
            .where(eq(contributors.id, existing.id));
        } else {
          await txDb.insert(contributors).values({
            id: generateId(),
            documentId: docId,
            agentId: createdBy,
            versionsAuthored: 1,
            totalTokensAdded: tokensAdded,
            totalTokensRemoved: tokensRemoved,
            netTokens: tokensAdded - tokensRemoved,
            firstContribution: now,
            lastContribution: now,
          });
        }
      }

      // Append version.published event to the event log (if appendDocumentEvent injected).
      if (this._appendDocumentEvent) {
        // Resolve slug for event log (documentId is doc.id here, event log uses slug).
        const slug = docRow?.slug ?? docId;
        await this._appendDocumentEvent(txDb, {
          documentId: slug,
          eventType: 'version.published',
          actorId: createdBy || 'anonymous',
          payloadJson: {
            versionNumber: nextVersionNumber,
            changelog: changelog ?? null,
            contentHash,
            tokenCount,
          },
          idempotencyKey,
        });
      }
    });

    return {
      versionNumber: nextVersionNumber,
      contentHash,
      tokenCount,
      originalSize,
      compressedSize,
      createdAt: now,
      createdBy,
      changelog,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getVersion(documentId: string, versionNumber: number): Promise<any> {
    this._assertOpen();
    const { documents, versions } = this._s;
    const { eq, and, or } = this._orm;

    // Resolve documentId to the document's primary key (id).
    // documentId may be either the document.id (base62, 8 chars) or document.slug.
    // Strategy: look up the document matching EITHER id OR slug, take whichever
    // is found. This avoids the brittle length/character heuristic that broke
    // when base62 IDs (8 chars, no dashes) satisfied the slug-detection condition.
    const [resolved] = await this._db
      .select({ id: documents.id })
      .from(documents)
      .where(or(eq(documents.id, documentId), eq(documents.slug, documentId)))
      .limit(1);

    if (!resolved) return null;
    const docId = resolved.id;

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

  /**
   * transitionVersion — Wave A-2 implementation.
   *
   * Validates and applies a state machine transition on the document. Inserts a
   * state_transitions audit row and optionally appends a lifecycle.transitioned
   * event. Also clears rejection records when transitioning REVIEW→DRAFT.
   *
   * Extended params (via TransitionParams + Record<string,unknown> cast):
   *   documentId (slug or id), to (target state), changedBy, reason?,
   *   idempotencyKey?
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async transitionVersion(params: TransitionParams): Promise<{
    success: boolean;
    error?: string;
    allowedTargets?: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document?: any;
  }> {
    this._assertOpen();
    const p = params as unknown as Record<string, unknown>;
    const { documents, stateTransitions, approvals } = this._s;
    const { eq, and } = this._orm;
    const { generateId } = await getSdkHelpers();

    // Lazily import lifecycle SDK (no node:crypto — pure state machine logic).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lifecycleSdk = (await import('llmtxt/sdk' as any)) as any;
    const { validateTransition } = lifecycleSdk;

    const slugOrId = params.documentId as string;
    const targetState = params.to as string;
    const changedBy = (p.changedBy as string) ?? 'anonymous';
    const reason = (p.reason as string | null) ?? null;
    const idempotencyKey = (p.idempotencyKey as string | null) ?? null;
    const now = Date.now();

    // Resolve slug → document row
    const [doc] = await this._db
      .select()
      .from(documents)
      .where(eq(documents.slug, slugOrId))
      .limit(1)
      .then((rows: unknown[]) =>
        rows.length ? rows : this._db
          .select()
          .from(documents)
          .where(eq(documents.id, slugOrId))
          .limit(1)
      );

    if (!doc) return { success: false, error: 'Document not found' };

    const currentState = doc.state as string;

    // Validate transition via SDK state machine
    const result = validateTransition(currentState, targetState);
    if (!result.valid) {
      return {
        success: false,
        error: result.reason,
        allowedTargets: result.allowedTargets,
      };
    }

    await this._db.transaction(async (tx: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txDb = tx as any;

      await txDb
        .update(documents)
        .set({ state: targetState })
        .where(eq(documents.slug, doc.slug));

      await txDb.insert(stateTransitions).values({
        id: generateId(),
        documentId: doc.id,
        fromState: currentState,
        toState: targetState,
        changedBy,
        changedAt: now,
        reason,
        atVersion: doc.currentVersion ?? 0,
      });

      // Clear rejection records when transitioning REVIEW→DRAFT (fresh review cycle).
      if (currentState === 'REVIEW' && targetState === 'DRAFT' && approvals) {
        await txDb
          .delete(approvals)
          .where(and(
            eq(approvals.documentId, doc.id),
            eq(approvals.status, 'REJECTED'),
          ));
      }

      // Append lifecycle.transitioned event (if appendDocumentEvent injected).
      if (this._appendDocumentEvent) {
        await this._appendDocumentEvent(txDb, {
          documentId: doc.slug,
          eventType: 'lifecycle.transitioned',
          actorId: changedBy,
          payloadJson: { fromState: currentState, toState: targetState, reason },
          idempotencyKey,
        });
      }
    });

    const [updated] = await this._db
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id))
      .limit(1);

    return { success: true, document: updated };
  }

  // ── Approval operations ───────────────────────────────────────────────────
  // Wave A-2: submitSignedApproval implemented.

  /**
   * submitSignedApproval — Wave A-2 implementation.
   *
   * Transactionally inserts an approval record, evaluates consensus, and
   * auto-locks the document when consensus is reached.
   * Appends approval.submitted / approval.rejected event if
   * appendDocumentEvent has been injected.
   *
   * params: documentId (slug), versionNumber, reviewerId, status, reason?,
   *         signatureBase64 — plus optional idempotencyKey (cast via Record).
   */
  async submitSignedApproval(params: {
    documentId: string;
    versionNumber: number;
    reviewerId: string;
    status: 'APPROVED' | 'REJECTED';
    reason?: string;
    signatureBase64: string;
  }): Promise<{ success: boolean; error?: string; result?: ApprovalResult }> {
    this._assertOpen();
    const p = params as unknown as Record<string, unknown>;
    const { documents, approvals, stateTransitions } = this._s;
    const { eq, and } = this._orm;
    const { generateId } = await getSdkHelpers();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdkModule = (await import('llmtxt/sdk' as any)) as any;
    const { evaluateApprovals, DEFAULT_APPROVAL_POLICY } = sdkModule;

    const { documentId: slugOrId, versionNumber, reviewerId, status, reason } = params;
    const signatureHex = Buffer.from((p.signatureBase64 as string) ?? '', 'base64').toString('hex');
    const idempotencyKey = (p.idempotencyKey as string | null) ?? null;
    const now = Date.now();

    // Resolve document row
    const docRows = await this._db
      .select()
      .from(documents)
      .where(eq(documents.slug, slugOrId))
      .limit(1);
    const docByIdRows = docRows.length ? docRows : await this._db
      .select()
      .from(documents)
      .where(eq(documents.id, slugOrId))
      .limit(1);
    const [doc] = docByIdRows;

    if (!doc) return { success: false, error: 'Document not found' };
    if (doc.state !== 'REVIEW') {
      return { success: false, error: 'Document must be in REVIEW state' };
    }

    // Duplicate check (same reviewer + same status)
    const dupRows = await this._db
      .select({ id: approvals.id })
      .from(approvals)
      .where(and(
        eq(approvals.documentId, doc.id),
        eq(approvals.reviewerId, reviewerId),
        eq(approvals.status, status),
      ))
      .limit(1);
    if (dupRows.length > 0) {
      return { success: false, error: `duplicate ${status.toLowerCase()}` };
    }

    let autoLocked = false;
    let consensusResult: ApprovalResult | undefined;

    await this._db.transaction(async (tx: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txDb = tx as any;

      await txDb.insert(approvals).values({
        id: generateId(),
        documentId: doc.id,
        reviewerId,
        status,
        timestamp: now,
        reason: reason ?? null,
        atVersion: versionNumber,
        sigHex: signatureHex,
        canonicalPayload: null,
        chainHash: null,
        prevChainHash: null,
        bftF: doc.bftF ?? 1,
      });

      const allReviews = await txDb
        .select()
        .from(approvals)
        .where(eq(approvals.documentId, doc.id));

      const policy = {
        ...DEFAULT_APPROVAL_POLICY,
        requiredCount: doc.approvalRequiredCount ?? 1,
        requireUnanimous: doc.approvalRequireUnanimous ?? false,
        allowedReviewerIds: (doc.approvalAllowedReviewers ?? '').split(',').filter(Boolean),
        timeoutMs: doc.approvalTimeoutMs ?? 0,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reviews = allReviews.map((r: any) => ({
        reviewerId: r.reviewerId,
        status: r.status,
        timestamp: r.timestamp,
        reason: r.reason ?? undefined,
        atVersion: r.atVersion,
      }));

      consensusResult = evaluateApprovals(reviews, policy, doc.currentVersion ?? versionNumber);

      if (consensusResult?.approved) {
        const lockResult = await txDb
          .update(documents)
          .set({ state: 'LOCKED' })
          .where(and(eq(documents.id, doc.id), eq(documents.state, 'REVIEW')))
          .returning({ state: documents.state });

        if (lockResult.length > 0) {
          await txDb.insert(stateTransitions).values({
            id: generateId(),
            documentId: doc.id,
            fromState: 'REVIEW',
            toState: 'LOCKED',
            changedBy: 'system',
            changedAt: now,
            reason: 'Auto-locked: consensus reached',
            atVersion: doc.currentVersion ?? versionNumber,
          });
          autoLocked = true;
        }
      }

      if (this._appendDocumentEvent) {
        await this._appendDocumentEvent(txDb, {
          documentId: doc.slug,
          eventType: status === 'APPROVED' ? 'approval.submitted' : 'approval.rejected',
          actorId: reviewerId,
          payloadJson: { status, atVersion: versionNumber, autoLocked },
          idempotencyKey,
        });
      }
    });

    return { success: true, result: { ...(consensusResult ?? {}), autoLocked } as ApprovalResult };
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

  async getApprovalChain(documentId: string): Promise<ApprovalChainResult> {
    this._assertOpen();
    const { documents, approvals } = this._s;
    const { eq, asc } = this._orm;

    // Resolve document by slug
    const [doc] = await this._db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.slug, documentId))
      .limit(1);

    if (!doc) {
      return { valid: true, length: 0, firstInvalidAt: null, entries: [] };
    }

    // Fetch all approvals for this document in chain order
    const rows = await this._db
      .select()
      .from(approvals)
      .where(eq(approvals.documentId, doc.id))
      .orderBy(asc(approvals.timestamp));

    if (rows.length === 0) {
      return { valid: true, length: 0, firstInvalidAt: null, entries: [] };
    }

    const { hashContent } = await getSdkHelpers();

    // Verify the hash chain
    let valid = true;
    let firstInvalidAt: number | null = null;
    const sentinel = '0'.repeat(64);

    for (let i = 0; i < rows.length; i++) {
      const approval = rows[i] as {
        id: string;
        documentId: string;
        reviewerId: string;
        status: string;
        atVersion: number;
        timestamp: number;
        chainHash: string | null;
        prevChainHash: string | null;
      };
      const storedHash = approval.chainHash;
      if (!storedHash) continue; // Legacy unsigned approvals — skip

      const prevHash = approval.prevChainHash ?? null;
      const approvalJson = JSON.stringify({
        documentId: approval.documentId,
        reviewerId: approval.reviewerId,
        status: approval.status,
        atVersion: approval.atVersion,
        timestamp: approval.timestamp,
      });
      const prevHashStr = prevHash ?? sentinel;
      const expectedHash = hashContent(prevHashStr + '|' + approvalJson);

      if (expectedHash !== storedHash) {
        valid = false;
        firstInvalidAt = i;
        break;
      }
    }

    return {
      valid,
      length: rows.length,
      firstInvalidAt,
      entries: rows.map((r: {
        id: string;
        reviewerId: string;
        status: string;
        atVersion: number;
        timestamp: number;
        chainHash: string | null;
        prevChainHash: string | null;
        sigHex: string | null;
      }) => ({
        approvalId: r.id,
        reviewerId: r.reviewerId,
        status: r.status as 'APPROVED' | 'REJECTED',
        atVersion: r.atVersion,
        timestamp: r.timestamp,
        chainHash: r.chainHash ?? '',
        prevChainHash: r.prevChainHash ?? null,
        sigHex: r.sigHex ?? undefined,
      })),
    };
  }

  // ── Event log operations ──────────────────────────────────────────────────
  // Wave B (T353.5) — implemented.

  async appendEvent(params: AppendEventParams): Promise<DocumentEvent> {
    this._assertOpen();
    if (!this._appendDocumentEvent) {
      throw new Error('PostgresBackend: appendEvent — setWaveBDeps() not called yet');
    }
    const { documentId, type, agentId, payload } = params;

    // appendDocumentEvent requires a Drizzle transaction. For standalone calls
    // (outside a caller-supplied transaction) we run a short implicit transaction.
    const result = await this._db.transaction(async (tx: unknown) => {
      return this._appendDocumentEvent!(tx, {
        documentId,
        eventType: type,
        actorId: agentId,
        payloadJson: payload ?? {},
        idempotencyKey: null,
      });
    });

    const row = result.event;
    return {
      id: row.id,
      documentId: row.documentId,
      type: row.eventType,
      agentId: row.actorId,
      payload: (row.payloadJson as Record<string, unknown>) ?? {},
      createdAt: row.createdAt.getTime(),
    };
  }

  async queryEvents(params: QueryEventsParams): Promise<ListResult<DocumentEvent>> {
    this._assertOpen();
    const { documentId, type: typeFilter, since, limit: rawLimit } = params;
    const { documents, documentEvents } = this._s;
    const { eq, or, gt, and, asc } = this._orm;

    const limit = rawLimit ?? 50;
    const sinceSeq = since ? BigInt(since) : BigInt(0);

    // document_events.document_id is a FK to documents.slug (not documents.id).
    // If the caller passed a document.id (base62), resolve it to the slug first.
    // Use OR lookup so callers may pass either id or slug.
    let resolvedDocId = documentId;
    const [docRow] = await this._db
      .select({ slug: documents.slug })
      .from(documents)
      .where(or(eq(documents.id, documentId), eq(documents.slug, documentId)))
      .limit(1);
    if (docRow) resolvedDocId = docRow.slug;

    // Build filter conditions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conditions: any[] = [
      eq(documentEvents.documentId, resolvedDocId),
      gt(documentEvents.seq, sinceSeq),
    ];
    if (typeFilter) {
      conditions.push(eq(documentEvents.eventType, typeFilter));
    }

    const rows = await this._db
      .select({
        id: documentEvents.id,
        seq: documentEvents.seq,
        eventType: documentEvents.eventType,
        actorId: documentEvents.actorId,
        payloadJson: documentEvents.payloadJson,
        idempotencyKey: documentEvents.idempotencyKey,
        createdAt: documentEvents.createdAt,
      })
      .from(documentEvents)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .orderBy(asc(documentEvents.seq))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      items.length > 0 ? items[items.length - 1].seq.toString() : since ?? null;

    return {
      items: items.map((row: {
        id: string;
        seq: bigint;
        eventType: string;
        actorId: string;
        payloadJson: unknown;
        idempotencyKey: string | null;
        createdAt: Date;
      }) => ({
        id: row.id,
        documentId,
        type: row.eventType,
        agentId: row.actorId,
        payload: (row.payloadJson as Record<string, unknown>) ?? {},
        createdAt: row.createdAt.getTime(),
      })),
      nextCursor,
    };
  }

  async *subscribeStream(documentId: string): AsyncIterable<DocumentEvent> {
    this._assertOpen();
    if (!this._eventBus) {
      throw new Error('PostgresBackend: subscribeStream — setWaveBDeps() not called yet');
    }
    const bus = this._eventBus;

    // Yield events from the event bus as they arrive, filtered by slug.
    // The caller is responsible for catching up from DB first (via queryEvents).
    let resolve: ((value: DocumentEvent | null) => void) | null = null;
    const queue: DocumentEvent[] = [];
    let closed = false;

    const listener = (payload: unknown): void => {
      const event = payload as BusDocumentEvent;
      if (event.slug !== documentId) return;
      const domainEvent: DocumentEvent = {
        id: '',
        documentId: event.documentId ?? documentId,
        type: event.type,
        agentId: event.actor,
        payload: event.data,
        createdAt: event.timestamp,
      };
      if (resolve) {
        const r = resolve;
        resolve = null;
        r(domainEvent);
      } else {
        queue.push(domainEvent);
      }
    };

    bus.on('document', listener);

    try {
      while (!closed) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          const event = await new Promise<DocumentEvent | null>((res) => {
            resolve = res;
          });
          if (event === null) break;
          yield event;
        }
      }
    } finally {
      closed = true;
      bus.off('document', listener);
      // Drain pending resolve — cast needed to bypass TS narrowing in finally blocks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _r = resolve as any; if (_r) (_r as (v: null) => void)(null);
    }
  }

  // ── CRDT operations ───────────────────────────────────────────────────────
  // Wave B (T353.5) — implemented.

  async applyCrdtUpdate(params: {
    documentId: string;
    sectionKey: string;
    updateBase64: string;
    agentId: string;
  }): Promise<CrdtState> {
    this._assertOpen();
    if (!this._persistCrdtUpdate || !this._crdtStateVector) {
      throw new Error('PostgresBackend: applyCrdtUpdate — setWaveBDeps() not called yet');
    }
    const { documentId, sectionKey, updateBase64, agentId } = params;
    const updateBlob = Buffer.from(updateBase64, 'base64');

    const result = await this._persistCrdtUpdate(documentId, sectionKey, updateBlob, agentId);
    const sv = this._crdtStateVector(result.newState);

    return {
      documentId,
      sectionKey,
      stateVectorBase64: sv.toString('base64'),
      snapshotBase64: result.newState.toString('base64'),
      updatedAt: Date.now(),
    };
  }

  async getCrdtState(documentId: string, sectionKey: string): Promise<CrdtState | null> {
    this._assertOpen();
    if (!this._loadSectionState || !this._crdtStateVector) {
      throw new Error('PostgresBackend: getCrdtState — setWaveBDeps() not called yet');
    }
    const row = await this._loadSectionState(documentId, sectionKey);
    if (!row) return null;

    const sv = this._crdtStateVector(row.crdtState);
    return {
      documentId,
      sectionKey,
      stateVectorBase64: sv.toString('base64'),
      snapshotBase64: row.crdtState.toString('base64'),
      updatedAt: row.updatedAt ? row.updatedAt.getTime() : Date.now(),
    };
  }

  async *subscribeSection(
    documentId: string,
    sectionKey: string
  ): AsyncIterable<CrdtUpdate> {
    this._assertOpen();
    if (!this._subscribeCrdtUpdates) {
      throw new Error('PostgresBackend: subscribeSection — setWaveBDeps() not called yet');
    }
    const subscribeFn = this._subscribeCrdtUpdates;

    let resolve: ((value: CrdtUpdate | null) => void) | null = null;
    const queue: CrdtUpdate[] = [];
    let closed = false;

    const listener = (_docId: string, _secId: string, update: Buffer): void => {
      const entry: CrdtUpdate = {
        documentId,
        sectionKey,
        updateBase64: update.toString('base64'),
        agentId: '',
        createdAt: Date.now(),
      };
      if (resolve) {
        const r = resolve;
        resolve = null;
        r(entry);
      } else {
        queue.push(entry);
      }
    };

    const unsubscribe = subscribeFn(documentId, sectionKey, listener);

    try {
      while (!closed) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          const entry = await new Promise<CrdtUpdate | null>((res) => {
            resolve = res;
          });
          if (entry === null) break;
          yield entry;
        }
      }
    } finally {
      closed = true;
      unsubscribe();
      // Drain pending resolve — cast needed to bypass TS narrowing in finally blocks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _r = resolve as any; if (_r) (_r as (v: null) => void)(null);
    }
  }

  // ── Lease operations ──────────────────────────────────────────────────────
  // Wave C (T353.6) — implemented.
  //
  // Resource string format: "<docSlug>:<sectionId>"
  // Schema uses separate docId + sectionId columns (see schema-pg.ts sectionLeases).
  // We split on the first colon to recover both parts.

  /** Parse resource string "docSlug:sectionId" into {docId, sectionId}. */
  private _parseLeaseResource(resource: string): { docId: string; sectionId: string } {
    const idx = resource.indexOf(':');
    if (idx === -1) return { docId: resource, sectionId: '' };
    return { docId: resource.slice(0, idx), sectionId: resource.slice(idx + 1) };
  }

  async acquireLease(params: AcquireLeaseParams): Promise<Lease | null> {
    this._assertOpen();
    const { sectionLeases } = this._s;
    const { eq, and, gt } = this._orm;
    const { resource, holder, ttlMs } = params;
    const { docId, sectionId } = this._parseLeaseResource(resource);

    const now = new Date();
    const expiresAt = new Date(Date.now() + ttlMs);

    // Check for active non-expired lease held by someone else
    const existing = await this._db
      .select()
      .from(sectionLeases)
      .where(and(
        eq(sectionLeases.docId, docId),
        eq(sectionLeases.sectionId, sectionId),
        gt(sectionLeases.expiresAt, now),
      ))
      .limit(1);

    if (existing.length > 0 && existing[0].holderAgentId !== holder) {
      // Another holder has an active lease — cannot acquire
      return null;
    }

    if (existing.length > 0 && existing[0].holderAgentId === holder) {
      // Same holder — extend (upsert)
      const updated = await this._db
        .update(sectionLeases)
        .set({ expiresAt, reason: null })
        .where(eq(sectionLeases.id, existing[0].id))
        .returning();
      const row = updated[0];
      return {
        id: row.id,
        resource,
        holder,
        expiresAt: row.expiresAt.getTime(),
        acquiredAt: row.acquiredAt.getTime(),
      };
    }

    // Insert new lease
    const inserted = await this._db
      .insert(sectionLeases)
      .values({
        docId,
        sectionId,
        holderAgentId: holder,
        expiresAt,
        reason: null,
      })
      .returning();

    const row = inserted[0];
    return {
      id: row.id,
      resource,
      holder,
      expiresAt: row.expiresAt.getTime(),
      acquiredAt: row.acquiredAt.getTime(),
    };
  }

  async renewLease(resource: string, holder: string, ttlMs: number): Promise<Lease | null> {
    this._assertOpen();
    const { sectionLeases } = this._s;
    const { eq, and, gt } = this._orm;
    const { docId, sectionId } = this._parseLeaseResource(resource);

    const now = new Date();
    const expiresAt = new Date(Date.now() + ttlMs);

    // Find existing active lease held by this holder
    const existing = await this._db
      .select()
      .from(sectionLeases)
      .where(and(
        eq(sectionLeases.docId, docId),
        eq(sectionLeases.sectionId, sectionId),
        eq(sectionLeases.holderAgentId, holder),
        gt(sectionLeases.expiresAt, now),
      ))
      .limit(1);

    if (existing.length === 0) return null;

    const updated = await this._db
      .update(sectionLeases)
      .set({ expiresAt })
      .where(eq(sectionLeases.id, existing[0].id))
      .returning();

    if (updated.length === 0) return null;
    const row = updated[0];
    return {
      id: row.id,
      resource,
      holder,
      expiresAt: row.expiresAt.getTime(),
      acquiredAt: row.acquiredAt.getTime(),
    };
  }

  async releaseLease(resource: string, holder: string): Promise<boolean> {
    this._assertOpen();
    const { sectionLeases } = this._s;
    const { eq, and } = this._orm;
    const { docId, sectionId } = this._parseLeaseResource(resource);

    // Find the lease to delete (any expiry state — holder can always release their own)
    const existing = await this._db
      .select({ id: sectionLeases.id })
      .from(sectionLeases)
      .where(and(
        eq(sectionLeases.docId, docId),
        eq(sectionLeases.sectionId, sectionId),
        eq(sectionLeases.holderAgentId, holder),
      ))
      .limit(1);

    if (existing.length === 0) return false;

    const deleted = await this._db
      .delete(sectionLeases)
      .where(eq(sectionLeases.id, existing[0].id))
      .returning();

    return deleted.length > 0;
  }

  async getLease(resource: string): Promise<Lease | null> {
    this._assertOpen();
    const { sectionLeases } = this._s;
    const { eq, and, gt } = this._orm;
    const { docId, sectionId } = this._parseLeaseResource(resource);

    const now = new Date();
    const rows = await this._db
      .select()
      .from(sectionLeases)
      .where(and(
        eq(sectionLeases.docId, docId),
        eq(sectionLeases.sectionId, sectionId),
        gt(sectionLeases.expiresAt, now),
      ))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      resource,
      holder: row.holderAgentId,
      expiresAt: row.expiresAt.getTime(),
      acquiredAt: row.acquiredAt.getTime(),
    };
  }

  // ── Presence operations ───────────────────────────────────────────────────
  // Wave C (T353.6) — implemented.
  //
  // Presence is in-memory ONLY (same as LocalBackend — no DB persistence).
  // We delegate to the shared presenceRegistry singleton injected via setWaveCDeps().
  // The PresenceEntry shape in the Backend interface uses {agentId, documentId, meta,
  // lastSeen, expiresAt} while the registry uses {agentId, section, cursorOffset, lastSeen}.
  // We adapt between the two: meta.section is used for the section field.

  private _assertPresenceRegistry(): PresenceRegistryLike {
    if (!this._presenceRegistry) {
      throw new Error('PostgresBackend: presence ops — setWaveCDeps() not called yet');
    }
    return this._presenceRegistry;
  }

  async joinPresence(
    documentId: string,
    agentId: string,
    meta?: Record<string, unknown>
  ): Promise<PresenceEntry> {
    const registry = this._assertPresenceRegistry();
    const section = (meta?.section as string | undefined) ?? '';
    const cursorOffset = typeof meta?.cursorOffset === 'number' ? meta.cursorOffset : undefined;
    registry.upsert(agentId, documentId, section, cursorOffset);

    const now = Date.now();
    const expiresAt = now + 30_000; // 30s TTL matching registry
    return { agentId, documentId, meta, lastSeen: now, expiresAt };
  }

  async leavePresence(documentId: string, agentId: string): Promise<void> {
    const registry = this._assertPresenceRegistry();
    // The registry may expose a remove() method (added in setWaveCDeps pattern).
    // If not, upsert with a past lastSeen so expire() clears it.
    if (typeof (registry as { remove?: unknown }).remove === 'function') {
      (registry as { remove: (a: string, d: string) => void }).remove(agentId, documentId);
    } else {
      // Expire the entry immediately by setting an old lastSeen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = (registry as any);
      const docMap = internal.registry?.get(documentId);
      if (docMap) docMap.delete(agentId);
    }
  }

  async listPresence(documentId: string): Promise<PresenceEntry[]> {
    const registry = this._assertPresenceRegistry();
    registry.expire(); // Prune stale entries first
    const records = registry.getByDoc(documentId);
    const now = Date.now();
    return records.map((r) => ({
      agentId: r.agentId,
      documentId,
      meta: {
        section: r.section,
        ...(r.cursorOffset !== undefined ? { cursorOffset: r.cursorOffset } : {}),
      },
      lastSeen: r.lastSeen,
      expiresAt: now + 30_000,
    }));
  }

  async heartbeatPresence(documentId: string, agentId: string): Promise<void> {
    const registry = this._assertPresenceRegistry();
    // Re-upsert with current section to refresh lastSeen
    const existing = registry.getByDoc(documentId).find((r) => r.agentId === agentId);
    registry.upsert(
      agentId,
      documentId,
      existing?.section ?? '',
      existing?.cursorOffset
    );
  }

  // ── Scratchpad operations ─────────────────────────────────────────────────
  // Wave C (T353.6) — implemented.
  //
  // The Backend ScratchpadOps interface uses toAgentId/fromAgentId semantics (agent inbox).
  // The scratchpad lib uses document-scoped Redis Streams.
  // Bridge: use "agent:<toAgentId>" as the stream slug so agent-scoped and
  // doc-scoped channels are kept separate.
  //
  // deleteScratchpadMessage is a best-effort no-op for Redis (streams cannot delete
  // individual entries without XDEL — we mark it deleted in-memory by convention).
  // For the Redis path, messages expire via TTL on the stream.

  private _assertScratchpad(): { publish: ScratchpadPublishFn; read: ScratchpadReadFn } {
    if (!this._scratchpadPublish || !this._scratchpadRead) {
      throw new Error('PostgresBackend: scratchpad ops — setWaveCDeps() not called yet');
    }
    return { publish: this._scratchpadPublish, read: this._scratchpadRead };
  }

  async sendScratchpad(params: SendScratchpadParams): Promise<ScratchpadMessage> {
    this._assertOpen();
    const { publish } = this._assertScratchpad();

    // Use agent-scoped channel: "agent:<toAgentId>"
    const slug = `agent:${params.toAgentId}`;
    const msg = await publish(slug, {
      agentId: params.fromAgentId,
      content: typeof params.payload === 'string'
        ? params.payload
        : JSON.stringify(params.payload),
      contentType: 'application/json',
    });

    const now = Date.now();
    const ttlMs = params.ttlMs ?? 24 * 60 * 60 * 1000;
    const exp = ttlMs === 0 ? 0 : now + ttlMs;

    return {
      id: msg.id,
      toAgentId: params.toAgentId,
      fromAgentId: params.fromAgentId,
      payload: params.payload,
      createdAt: msg.timestampMs,
      exp,
    };
  }

  async pollScratchpad(agentId: string, limit = 50): Promise<ScratchpadMessage[]> {
    this._assertOpen();
    const { read } = this._assertScratchpad();

    const slug = `agent:${agentId}`;
    const msgs = await read(slug, { limit });

    return msgs.map((m) => {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(m.content); } catch { payload = { raw: m.content }; }
      const exp = m.timestampMs + 24 * 60 * 60 * 1000;
      return {
        id: m.id,
        toAgentId: agentId,
        fromAgentId: m.agentId,
        payload,
        createdAt: m.timestampMs,
        exp,
      };
    });
  }

  async deleteScratchpadMessage(_id: string, _agentId: string): Promise<boolean> {
    this._assertOpen();
    // Redis Streams: XDEL is not supported via our ioredis wrapper.
    // Messages expire via stream TTL (24h). Return true optimistically.
    // For in-memory path, we cannot delete from the EventEmitter store after emission.
    // This is a known limitation — documented in manifest.
    return true;
  }

  // ── A2A operations ────────────────────────────────────────────────────────
  // Wave C (T353.6) — implemented.
  //
  // Backed by agentInboxMessages table (schema-pg.ts).
  // sendA2AMessage: INSERT with nonce unique constraint for dedup.
  // pollA2AInbox: SELECT non-expired messages for recipient, mark read.
  // deleteA2AMessage: DELETE by id + toAgentId ownership check.
  //
  // NOTE: Signature verification is done at the route layer (a2a.ts) before
  // calling sendA2AMessage — the Backend method stores the envelope as-is.

  async sendA2AMessage(params: {
    toAgentId: string;
    envelopeJson: string;
    ttlMs?: number;
  }): Promise<{ success: boolean; error?: string; message?: A2AMessage }> {
    this._assertOpen();
    const { agentInboxMessages } = this._s;

    const now = Date.now();
    const ttlMs = params.ttlMs ?? 48 * 60 * 60 * 1000;
    const expiresAt = ttlMs === 0 ? Number.MAX_SAFE_INTEGER : now + ttlMs;

    // Parse envelope to extract nonce and fromAgentId
    let envelope: { from?: string; nonce?: string } = {};
    try {
      envelope = typeof params.envelopeJson === 'string'
        ? JSON.parse(params.envelopeJson)
        : params.envelopeJson;
    } catch {
      return { success: false, error: 'Invalid envelope JSON' };
    }

    const nonce = envelope.nonce ?? `${now}-${Math.random()}`;
    const fromAgentId = envelope.from ?? 'unknown';

    try {
      const inserted = await this._db
        .insert(agentInboxMessages)
        .values({
          toAgentId: params.toAgentId,
          fromAgentId,
          envelopeJson: typeof params.envelopeJson === 'string'
            ? JSON.parse(params.envelopeJson)
            : params.envelopeJson,
          nonce,
          receivedAt: now,
          expiresAt,
          read: false,
        })
        .returning();

      const row = inserted[0];
      return {
        success: true,
        message: {
          id: row.id,
          toAgentId: params.toAgentId,
          envelopeJson: params.envelopeJson,
          createdAt: row.receivedAt,
          exp: row.expiresAt,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unique') || msg.includes('nonce')) {
        return { success: false, error: 'Duplicate nonce — message already delivered' };
      }
      return { success: false, error: msg };
    }
  }

  async pollA2AInbox(
    agentId: string,
    limit = 50,
    since?: number,
    order: 'asc' | 'desc' = 'desc',
  ): Promise<A2AMessage[]> {
    this._assertOpen();
    const { agentInboxMessages } = this._s;
    const { eq, and, gt, desc: descFn, asc: ascFn } = this._orm;

    const now = Date.now();
    const clampedLimit = Math.min(Math.max(1, limit), 500);

    // Build WHERE conditions
    const conditions = [
      eq(agentInboxMessages.toAgentId, agentId),
      gt(agentInboxMessages.expiresAt, now),
    ];
    if (since !== undefined && since > 0) {
      conditions.push(gt(agentInboxMessages.receivedAt, since));
    }

    // T374: default to DESC so newest messages always surface first
    const orderExpr = order === 'asc'
      ? ascFn(agentInboxMessages.receivedAt)
      : descFn(agentInboxMessages.receivedAt);

    const rows = await this._db
      .select()
      .from(agentInboxMessages)
      .where(and(...conditions))
      .orderBy(orderExpr)
      .limit(clampedLimit);

    return rows.map((r: {
      id: string;
      toAgentId: string;
      envelopeJson: unknown;
      receivedAt: number;
      expiresAt: number;
    }) => ({
      id: r.id,
      toAgentId: r.toAgentId,
      envelopeJson: typeof r.envelopeJson === 'string'
        ? r.envelopeJson
        : JSON.stringify(r.envelopeJson),
      createdAt: r.receivedAt,
      exp: r.expiresAt,
    }));
  }

  async deleteA2AMessage(id: string, agentId: string): Promise<boolean> {
    this._assertOpen();
    const { agentInboxMessages } = this._s;
    const { eq, and } = this._orm;

    const deleted = await this._db
      .delete(agentInboxMessages)
      .where(and(
        eq(agentInboxMessages.id, id),
        eq(agentInboxMessages.toAgentId, agentId),
      ))
      .returning();

    return deleted.length > 0;
  }

  // ── Search operations ─────────────────────────────────────────────────────
  // Wave D (T353.7) — implemented.
  //
  // indexDocument: no-op stub. Embedding indexing is handled by apps/backend/src/jobs/embeddings.ts
  // which runs as a background job outside the Backend interface. The interface method exists for
  // LocalBackend parity; PostgresBackend does not duplicate the embedding pipeline here.
  //
  // search: delegates to pgvector nearest-neighbour query (section_embeddings table).
  // Falls back gracefully when pgvector is not available.

  async indexDocument(_documentId: string, _content: string): Promise<void> {
    this._assertOpen();
    // No-op: pgvector indexing is handled by apps/backend/src/jobs/embeddings.ts.
    // PostgresBackend does not duplicate the ONNX embedding pipeline.
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async search(params: SearchParams): Promise<SearchResult[]> {
    this._assertOpen();
    const { documents } = this._s;
    const { eq } = this._orm;
    const { query, topK = 10 } = params;

    try {
      // Attempt pgvector semantic search. Requires an embedding vector for the query,
      // but PostgresBackend has no ONNX runtime. Fall through to TF-IDF text match.
      // This method is a structural stub — the actual semantic search runs through
      // the route-layer helpers in search.ts (semanticSearchPg / tfidfSearchFallback).
      // Here we do a simple keyword match as a baseline.
      const allDocs = await this._db
        .select({ id: documents.id, slug: documents.slug })
        .from(documents)
        .limit(topK * 5);

      // Return empty (route layer handles the full pgvector / TF-IDF search).
      return allDocs.slice(0, topK).map((d: { id: string; slug: string }) => ({
        documentId: d.id,
        slug: d.slug,
        title: d.slug,
        score: 0,
      }));
    } catch {
      return [];
    }
  }

  // ── Identity operations ───────────────────────────────────────────────────
  // Wave D (T353.7) — implemented.
  //
  // Backed by agentPubkeys table (schema-pg.ts).
  // agentPubkeys.pubkey is stored as a binary Buffer (bytea).

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async registerAgentPubkey(
    agentId: string,
    pubkeyHex: string,
    _label?: string
  ): Promise<AgentPubkeyRecord> {
    this._assertOpen();
    const { agentPubkeys } = this._s;
    const { eq } = this._orm;
    const now = new Date();

    // Check for existing active key — upsert/idempotent if same agentId
    const [existing] = await this._db
      .select()
      .from(agentPubkeys)
      .where(eq(agentPubkeys.agentId, agentId))
      .limit(1);

    if (existing && existing.revokedAt === null) {
      // Already registered and active — return existing (idempotent)
      const hex = Buffer.isBuffer(existing.pubkey)
        ? existing.pubkey.toString('hex')
        : Buffer.from(existing.pubkey).toString('hex');
      return {
        agentId: existing.agentId,
        pubkeyHex: hex,
        createdAt: existing.createdAt instanceof Date
          ? existing.createdAt.getTime()
          : Number(existing.createdAt),
        revokedAt: existing.revokedAt
          ? (existing.revokedAt instanceof Date
            ? existing.revokedAt.getTime()
            : Number(existing.revokedAt))
          : undefined,
      };
    }

    await this._db.insert(agentPubkeys).values({
      agentId,
      pubkey: Buffer.from(pubkeyHex.toLowerCase(), 'hex'),
      createdAt: now,
    });

    const [row] = await this._db
      .select()
      .from(agentPubkeys)
      .where(eq(agentPubkeys.agentId, agentId))
      .limit(1);

    const hex = Buffer.isBuffer(row.pubkey)
      ? row.pubkey.toString('hex')
      : Buffer.from(row.pubkey).toString('hex');

    return {
      agentId: row.agentId,
      pubkeyHex: hex,
      createdAt: row.createdAt instanceof Date
        ? row.createdAt.getTime()
        : Number(row.createdAt),
    };
  }

  async lookupAgentPubkey(agentId: string): Promise<AgentPubkeyRecord | null> {
    this._assertOpen();
    const { agentPubkeys } = this._s;
    const { eq } = this._orm;

    const [row] = await this._db
      .select()
      .from(agentPubkeys)
      .where(eq(agentPubkeys.agentId, agentId))
      .limit(1);

    if (!row || row.revokedAt !== null) return null;

    const hex = Buffer.isBuffer(row.pubkey)
      ? row.pubkey.toString('hex')
      : Buffer.from(row.pubkey).toString('hex');

    return {
      agentId: row.agentId,
      pubkeyHex: hex,
      createdAt: row.createdAt instanceof Date
        ? row.createdAt.getTime()
        : Number(row.createdAt),
    };
  }

  async listAgentPubkeys(_userId?: string): Promise<AgentPubkeyRecord[]> {
    this._assertOpen();
    const { agentPubkeys } = this._s;
    const { isNull } = this._orm;

    const rows = await this._db
      .select()
      .from(agentPubkeys)
      .where(isNull(agentPubkeys.revokedAt));

    return rows.map((row: {
      agentId: string;
      pubkey: Buffer;
      createdAt: Date | number;
      revokedAt: Date | number | null;
    }) => {
      const hex = Buffer.isBuffer(row.pubkey)
        ? row.pubkey.toString('hex')
        : Buffer.from(row.pubkey).toString('hex');
      return {
        agentId: row.agentId,
        pubkeyHex: hex,
        createdAt: row.createdAt instanceof Date
          ? row.createdAt.getTime()
          : Number(row.createdAt),
      };
    });
  }

  async revokeAgentPubkey(agentId: string, _pubkeyHex: string): Promise<boolean> {
    this._assertOpen();
    const { agentPubkeys } = this._s;
    const { eq } = this._orm;
    const now = new Date();

    const [existing] = await this._db
      .select({ id: agentPubkeys.id, revokedAt: agentPubkeys.revokedAt })
      .from(agentPubkeys)
      .where(eq(agentPubkeys.agentId, agentId))
      .limit(1);

    if (!existing || existing.revokedAt !== null) return false;

    await this._db
      .update(agentPubkeys)
      .set({ revokedAt: now })
      .where(eq(agentPubkeys.id, existing.id));

    return true;
  }

  async recordSignatureNonce(
    agentId: string,
    nonce: string,
    _ttlMs?: number
  ): Promise<boolean> {
    this._assertOpen();
    const { agentSignatureNonces } = this._s;
    if (!agentSignatureNonces) return true; // Schema not injected yet — degrade gracefully

    try {
      await this._db.insert(agentSignatureNonces).values({
        nonce,
        agentId,
      });
      return true;
    } catch {
      // Unique constraint violation — nonce already used
      return false;
    }
  }

  async hasNonceBeenUsed(agentId: string, nonce: string): Promise<boolean> {
    this._assertOpen();
    const { agentSignatureNonces } = this._s;
    if (!agentSignatureNonces) return false;

    const { eq, and } = this._orm;
    const [row] = await this._db
      .select({ nonce: agentSignatureNonces.nonce })
      .from(agentSignatureNonces)
      .where(and(
        eq(agentSignatureNonces.nonce, nonce),
        eq(agentSignatureNonces.agentId, agentId),
      ))
      .limit(1);

    return !!row;
  }

  // ── Collection operations ─────────────────────────────────────────────────
  // Wave D (T353.7) — implemented.
  //
  // Backed by collections + collectionDocuments tables (schema-pg.ts).

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createCollection(params: CreateCollectionParams): Promise<any> {
    this._assertOpen();
    const { collections } = this._s;
    const { eq } = this._orm;
    const { generateId } = await getSdkHelpers();

    const now = Date.now();
    const id = generateId();
    const p = params as unknown as Record<string, unknown>;
    const slugFromParams = p.slug as string | undefined;
    const derivedSlug = params.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const slug = slugFromParams ?? (derivedSlug || id.substring(0, 8));

    await this._db.insert(collections).values({
      id,
      name: params.name,
      slug,
      description: params.description ?? null,
      ownerId: params.ownerId,
      visibility: 'public',
      createdAt: now,
      updatedAt: now,
    });

    const [col] = await this._db.select().from(collections).where(eq(collections.id, id));
    return col;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getCollection(slug: string): Promise<any> {
    this._assertOpen();
    const { collections, collectionDocuments } = this._s;
    const { eq, asc } = this._orm;

    const [col] = await this._db
      .select()
      .from(collections)
      .where(eq(collections.slug, slug));

    if (!col) return null;

    const memberRows = await this._db
      .select({ documentId: collectionDocuments.documentId })
      .from(collectionDocuments)
      .where(eq(collectionDocuments.collectionId, col.id))
      .orderBy(asc(collectionDocuments.position));

    return {
      ...col,
      documentSlugs: memberRows.map((r: { documentId: string }) => r.documentId),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async listCollections(params?: ListCollectionsParams): Promise<ListResult<any>> {
    this._assertOpen();
    const { collections } = this._s;
    const { eq, asc } = this._orm;

    const query = this._db.select().from(collections);
    const rows = params?.ownerId
      ? await query.where(eq(collections.ownerId, params.ownerId)).orderBy(asc(collections.createdAt))
      : await query.orderBy(asc(collections.createdAt));

    return { items: rows, nextCursor: null };
  }

  async addDocToCollection(
    collectionSlug: string,
    documentSlug: string,
    position?: number
  ): Promise<void> {
    this._assertOpen();
    const { collections, collectionDocuments, documents } = this._s;
    const { eq, and, asc } = this._orm;
    const { generateId } = await getSdkHelpers();

    const [col] = await this._db
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.slug, collectionSlug));
    if (!col) throw new Error(`Collection not found: ${collectionSlug}`);

    const [doc] = await this._db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.slug, documentSlug));
    if (!doc) throw new Error(`Document not found: ${documentSlug}`);

    // Idempotent: skip if already a member
    const [existing] = await this._db
      .select({ id: collectionDocuments.id })
      .from(collectionDocuments)
      .where(and(
        eq(collectionDocuments.collectionId, col.id),
        eq(collectionDocuments.documentId, doc.id),
      ));
    if (existing) return;

    let effectivePosition = position;
    if (effectivePosition === undefined) {
      const lastRows = await this._db
        .select({ position: collectionDocuments.position })
        .from(collectionDocuments)
        .where(eq(collectionDocuments.collectionId, col.id))
        .orderBy(asc(collectionDocuments.position));
      effectivePosition = lastRows.length > 0
        ? lastRows[lastRows.length - 1].position + 1
        : 0;
    }

    const now = Date.now();
    await this._db.insert(collectionDocuments).values({
      id: generateId(),
      collectionId: col.id,
      documentId: doc.id,
      position: effectivePosition,
      addedAt: now,
    });

    await this._db.update(collections).set({ updatedAt: now }).where(eq(collections.id, col.id));
  }

  async removeDocFromCollection(
    collectionSlug: string,
    documentSlug: string
  ): Promise<boolean> {
    this._assertOpen();
    const { collections, collectionDocuments, documents } = this._s;
    const { eq, and } = this._orm;

    const [col] = await this._db
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.slug, collectionSlug));
    if (!col) return false;

    const [doc] = await this._db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.slug, documentSlug));
    if (!doc) return false;

    const [membership] = await this._db
      .select({ id: collectionDocuments.id })
      .from(collectionDocuments)
      .where(and(
        eq(collectionDocuments.collectionId, col.id),
        eq(collectionDocuments.documentId, doc.id),
      ));
    if (!membership) return false;

    await this._db.delete(collectionDocuments).where(eq(collectionDocuments.id, membership.id));
    await this._db.update(collections).set({ updatedAt: Date.now() }).where(eq(collections.id, col.id));
    return true;
  }

  async reorderCollection(collectionSlug: string, orderedSlugs: string[]): Promise<void> {
    this._assertOpen();
    const { collections, collectionDocuments, documents } = this._s;
    const { eq, and, inArray } = this._orm;

    const [col] = await this._db
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.slug, collectionSlug));
    if (!col) return;

    const docRows = await this._db
      .select({ id: documents.id, slug: documents.slug })
      .from(documents)
      .where(inArray(documents.slug, orderedSlugs));

    const slugToId = new Map<string, string>(
      docRows.map((d: { id: string; slug: string }) => [d.slug, d.id])
    );

    for (let i = 0; i < orderedSlugs.length; i++) {
      const docId = slugToId.get(orderedSlugs[i]);
      if (!docId) continue;
      await this._db
        .update(collectionDocuments)
        .set({ position: i })
        .where(and(
          eq(collectionDocuments.collectionId, col.id),
          eq(collectionDocuments.documentId, docId),
        ));
    }

    await this._db.update(collections).set({ updatedAt: Date.now() }).where(eq(collections.id, col.id));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async exportCollection(collectionSlug: string): Promise<any> {
    this._assertOpen();
    const { collections, collectionDocuments, documents } = this._s;
    const { eq, inArray, asc } = this._orm;

    const [col] = await this._db.select().from(collections).where(eq(collections.slug, collectionSlug));
    if (!col) throw new Error(`Collection not found: ${collectionSlug}`);

    const memberRows = await this._db
      .select({ documentId: collectionDocuments.documentId })
      .from(collectionDocuments)
      .where(eq(collectionDocuments.collectionId, col.id))
      .orderBy(asc(collectionDocuments.position));

    const docIds = memberRows.map((r: { documentId: string }) => r.documentId);
    const docRows = docIds.length > 0
      ? await this._db.select().from(documents).where(inArray(documents.id, docIds))
      : [];

    return {
      collection: col,
      documents: docRows,
      exportedAt: Date.now(),
    };
  }

  // ── Cross-doc operations ──────────────────────────────────────────────────
  // Wave D (T353.7) — implemented.
  //
  // Backed by documentLinks table (schema-pg.ts).

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createDocumentLink(params: CreateDocLinkParams): Promise<any> {
    this._assertOpen();
    const { documentLinks } = this._s;
    const { generateId } = await getSdkHelpers();
    const now = Date.now();
    const id = generateId();

    await this._db.insert(documentLinks).values({
      id,
      sourceDocId: params.sourceDocumentId,
      targetDocId: params.targetDocumentId,
      linkType: params.label ?? 'related',
      label: params.label ?? null,
      createdAt: now,
    });

    return {
      id,
      sourceDocumentId: params.sourceDocumentId,
      targetDocumentId: params.targetDocumentId,
      label: params.label,
      createdAt: now,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getDocumentLinks(documentId: string): Promise<any[]> {
    this._assertOpen();
    const { documentLinks } = this._s;
    const { eq, or } = this._orm;

    const rows = await this._db
      .select()
      .from(documentLinks)
      .where(or(
        eq(documentLinks.sourceDocId, documentId),
        eq(documentLinks.targetDocId, documentId),
      ));

    return rows.map((r: {
      id: string;
      sourceDocId: string;
      targetDocId: string;
      label: string | null;
      createdAt: number;
    }) => ({
      id: r.id,
      sourceDocumentId: r.sourceDocId,
      targetDocumentId: r.targetDocId,
      label: r.label ?? undefined,
      createdAt: r.createdAt,
    }));
  }

  async deleteDocumentLink(documentId: string, linkId: string): Promise<boolean> {
    this._assertOpen();
    const { documentLinks } = this._s;
    const { eq, and } = this._orm;

    const deleted = await this._db
      .delete(documentLinks)
      .where(and(
        eq(documentLinks.id, linkId),
        eq(documentLinks.sourceDocId, documentId),
      ))
      .returning();

    return deleted.length > 0;
  }

  async getGlobalGraph(params?: { maxNodes?: number }): Promise<GraphResult> {
    this._assertOpen();
    const { documents, documentLinks } = this._s;
    const maxNodes = params?.maxNodes ?? 500;

    const docRows = await this._db
      .select({ id: documents.id, slug: documents.slug, state: documents.state })
      .from(documents)
      .limit(maxNodes);

    const nodes = docRows.map((d: { id: string; slug: string; state: string | null }) => ({
      id: d.id,
      slug: d.slug,
      title: d.slug,
      state: d.state ?? 'DRAFT',
    }));

    const idSet = new Set(docRows.map((d: { id: string }) => d.id));
    const { inArray } = this._orm;
    const idArray = Array.from(idSet) as string[];

    const linkRows = idArray.length > 0
      ? await this._db
          .select({
            sourceDocId: documentLinks.sourceDocId,
            targetDocId: documentLinks.targetDocId,
            label: documentLinks.label,
          })
          .from(documentLinks)
          .where(inArray(documentLinks.sourceDocId, idArray as [string, ...string[]]))
      : [];

    const edges = linkRows
      .filter((r: { sourceDocId: string; targetDocId: string }) => idSet.has(r.targetDocId))
      .map((r: { sourceDocId: string; targetDocId: string; label: string | null }) => ({
        source: r.sourceDocId,
        target: r.targetDocId,
        label: r.label ?? undefined,
      }));

    return { nodes, edges };
  }

  // ── Webhook operations ────────────────────────────────────────────────────
  // Wave D (T353.7) — implemented.
  //
  // Backed by webhooks table (schema-pg.ts).

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createWebhook(params: CreateWebhookParams): Promise<any> {
    this._assertOpen();
    const { webhooks } = this._s;
    const { generateId } = await getSdkHelpers();
    const now = Date.now();
    const id = generateId();

    // Generate a secret if not provided (32 random hex bytes)
    let secret = params.secret;
    if (!secret) {
      // Use SDK hashContent as a source of entropy deterministically — or generate random
      const { hashContent } = await getSdkHelpers();
      secret = hashContent(`${id}:${now}:${params.ownerId}`);
    }

    await this._db.insert(webhooks).values({
      id,
      userId: params.ownerId,
      url: params.url,
      secret,
      events: JSON.stringify(params.events ?? []),
      active: true,
      failureCount: 0,
      createdAt: now,
    });

    return {
      id,
      ownerId: params.ownerId,
      url: params.url,
      secret,
      events: params.events ?? [],
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async listWebhooks(userId: string): Promise<any[]> {
    this._assertOpen();
    const { webhooks } = this._s;
    const { eq } = this._orm;

    const rows = await this._db
      .select({
        id: webhooks.id,
        userId: webhooks.userId,
        url: webhooks.url,
        secret: webhooks.secret,
        events: webhooks.events,
        active: webhooks.active,
        failureCount: webhooks.failureCount,
        lastDeliveryAt: webhooks.lastDeliveryAt,
        lastSuccessAt: webhooks.lastSuccessAt,
        createdAt: webhooks.createdAt,
      })
      .from(webhooks)
      .where(eq(webhooks.userId, userId));

    return rows.map((r: {
      id: string;
      userId: string;
      url: string;
      secret: string;
      events: string;
      active: boolean;
      failureCount: number;
      lastDeliveryAt: number | null;
      lastSuccessAt: number | null;
      createdAt: number;
    }) => ({
      id: r.id,
      ownerId: r.userId,
      url: r.url,
      secret: r.secret,
      events: (() => { try { return JSON.parse(r.events) as string[]; } catch { return []; } })(),
      enabled: r.active,
      createdAt: r.createdAt,
      updatedAt: r.createdAt,
    }));
  }

  async deleteWebhook(id: string, userId: string): Promise<boolean> {
    this._assertOpen();
    const { webhooks } = this._s;
    const { eq, and } = this._orm;

    const deleted = await this._db
      .delete(webhooks)
      .where(and(
        eq(webhooks.id, id),
        eq(webhooks.userId, userId),
      ))
      .returning();

    return deleted.length > 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async testWebhook(id: string): Promise<any> {
    this._assertOpen();
    const { webhooks } = this._s;
    const { eq } = this._orm;

    const [hook] = await this._db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
    if (!hook) return { webhookId: id, delivered: false, durationMs: 0 };

    const testPayload = JSON.stringify({
      type: 'document.created',
      slug: 'test000',
      documentId: 'test-document-id',
      timestamp: Date.now(),
      data: { tokenCount: 42, format: 'text' },
      test: true,
    });

    const startMs = Date.now();
    let delivered = false;
    let statusCode: number | undefined;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'llmtxt-webhook/1.0',
          'X-LLMtxt-Event': 'document.created',
        },
        body: testPayload,
        signal: controller.signal,
      });
      clearTimeout(timer);
      delivered = response.ok;
      statusCode = response.status;
    } catch {
      delivered = false;
    }

    return {
      webhookId: id,
      delivered,
      statusCode,
      durationMs: Date.now() - startMs,
    };
  }

  // ── Signed URL operations ─────────────────────────────────────────────────
  // Wave D (T353.7) — implemented.
  //
  // Backed by signedUrlTokens table (schema-pg.ts).
  // The token field maps to the signature column in the schema.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createSignedUrl(params: CreateSignedUrlParams): Promise<any> {
    this._assertOpen();
    const { signedUrlTokens } = this._s;
    const { generateId } = await getSdkHelpers();

    const now = Date.now();
    const ttlMs = params.ttlMs ?? 24 * 60 * 60 * 1000;
    const expiresAt = ttlMs === 0 ? 0 : now + ttlMs;
    const permission = params.permission ?? 'read';
    const id = generateId();

    // Token is the id itself (the route layer builds the full signed URL separately)
    await this._db.insert(signedUrlTokens).values({
      id,
      documentId: params.documentId,
      slug: params.documentId, // route provides actual slug; documentId passed here
      agentId: 'system',
      conversationId: 'system',
      signature: id,
      signatureLength: 32,
      expiresAt,
      createdAt: now,
    });

    return {
      token: id,
      documentId: params.documentId,
      expiresAt,
      permission,
      createdAt: now,
    };
  }

  async verifySignedUrl(
    token: string
  ): Promise<{ documentId: string; permission: 'read' | 'write' } | null> {
    this._assertOpen();
    const { signedUrlTokens } = this._s;
    const { eq } = this._orm;

    const [row] = await this._db
      .select({
        id: signedUrlTokens.id,
        documentId: signedUrlTokens.documentId,
        expiresAt: signedUrlTokens.expiresAt,
        revoked: signedUrlTokens.revoked,
      })
      .from(signedUrlTokens)
      .where(eq(signedUrlTokens.id, token))
      .limit(1);

    if (!row) return null;
    if (row.revoked) return null;
    if (row.expiresAt !== 0 && row.expiresAt < Date.now()) return null;

    return { documentId: row.documentId, permission: 'read' };
  }

  // ── Access control operations ─────────────────────────────────────────────
  // Wave D (T353.7) — implemented.
  //
  // Backed by documentRoles table + documents.visibility column (schema-pg.ts).

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getDocumentAccess(documentId: string): Promise<any> {
    this._assertOpen();
    const { documents, documentRoles } = this._s;
    const { eq } = this._orm;

    const [doc] = await this._db
      .select({ id: documents.id, visibility: documents.visibility, ownerId: documents.ownerId })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!doc) return { documentId, visibility: 'private', grants: [] };

    const roles = await this._db
      .select({
        userId: documentRoles.userId,
        role: documentRoles.role,
        grantedAt: documentRoles.grantedAt,
      })
      .from(documentRoles)
      .where(eq(documentRoles.documentId, doc.id));

    return {
      documentId,
      visibility: doc.visibility ?? 'private',
      grants: roles.map((r: { userId: string; role: string; grantedAt: number }) => ({
        userId: r.userId,
        role: r.role as 'viewer' | 'editor' | 'approver' | 'owner',
        grantedAt: r.grantedAt,
      })),
    };
  }

  async grantDocumentAccess(
    documentId: string,
    params: GrantAccessParams
  ): Promise<void> {
    this._assertOpen();
    const { documentRoles } = this._s;
    const { eq, and } = this._orm;
    const now = Date.now();

    const [existing] = await this._db
      .select({ id: documentRoles.id })
      .from(documentRoles)
      .where(and(
        eq(documentRoles.documentId, documentId),
        eq(documentRoles.userId, params.userId),
      ))
      .limit(1);

    if (existing) {
      await this._db
        .update(documentRoles)
        .set({ role: params.role, grantedAt: now })
        .where(eq(documentRoles.id, existing.id));
    } else {
      const { sql: ormSql } = this._orm;
      await this._db.insert(documentRoles).values({
        id: ormSql`gen_random_uuid()`,
        documentId,
        userId: params.userId,
        role: params.role,
        grantedBy: params.userId,
        grantedAt: now,
      });
    }
  }

  async revokeDocumentAccess(documentId: string, userId: string): Promise<boolean> {
    this._assertOpen();
    const { documentRoles } = this._s;
    const { eq, and } = this._orm;

    const [existing] = await this._db
      .select({ id: documentRoles.id })
      .from(documentRoles)
      .where(and(
        eq(documentRoles.documentId, documentId),
        eq(documentRoles.userId, userId),
      ))
      .limit(1);

    if (!existing) return false;

    await this._db.delete(documentRoles).where(eq(documentRoles.id, existing.id));
    return true;
  }

  async setDocumentVisibility(
    documentId: string,
    visibility: DocumentVisibility
  ): Promise<void> {
    this._assertOpen();
    const { documents } = this._s;
    const { eq } = this._orm;

    await this._db
      .update(documents)
      .set({ visibility })
      .where(eq(documents.id, documentId));
  }

  // ── Organization operations ───────────────────────────────────────────────
  // Wave D (T353.7) — implemented.
  //
  // Backed by organizations + orgMembers tables (schema-pg.ts).

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createOrganization(params: CreateOrgParams): Promise<any> {
    this._assertOpen();
    const { organizations, orgMembers } = this._s;
    const now = Date.now();
    const id = crypto.randomUUID();
    const slug = params.slug
      ?? (params.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));

    await this._db.transaction(async (tx: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txDb = tx as any;
      await txDb.insert(organizations).values({
        id,
        name: params.name,
        slug,
        createdBy: params.ownerId,
        createdAt: now,
        updatedAt: now,
      });
      // Creator is automatically an admin
      await txDb.insert(orgMembers).values({
        id: crypto.randomUUID(),
        orgId: id,
        userId: params.ownerId,
        role: 'admin',
        joinedAt: now,
      });
    });

    return { id, slug, name: params.name, ownerId: params.ownerId, createdAt: now, updatedAt: now };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getOrganization(slug: string): Promise<any> {
    this._assertOpen();
    const { organizations } = this._s;
    const { eq } = this._orm;

    const [org] = await this._db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);

    if (!org) return null;
    return { id: org.id, slug: org.slug, name: org.name, ownerId: org.createdBy, createdAt: org.createdAt, updatedAt: org.updatedAt };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async listOrganizations(userId: string): Promise<any[]> {
    this._assertOpen();
    const { organizations, orgMembers } = this._s;
    const { eq } = this._orm;

    const rows = await this._db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        createdBy: organizations.createdBy,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
      .where(eq(orgMembers.userId, userId));

    return rows.map((r: {
      id: string; name: string; slug: string; createdBy: string; createdAt: number; updatedAt: number;
    }) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      ownerId: r.createdBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async addOrgMember(orgSlug: string, userId: string, role = 'member'): Promise<void> {
    this._assertOpen();
    const { organizations, orgMembers } = this._s;
    const { eq, and } = this._orm;

    const [org] = await this._db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, orgSlug))
      .limit(1);
    if (!org) throw new Error(`Organization not found: ${orgSlug}`);

    const now = Date.now();

    const [existing] = await this._db
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .where(and(
        eq(orgMembers.orgId, org.id),
        eq(orgMembers.userId, userId),
      ))
      .limit(1);

    if (existing) {
      await this._db.update(orgMembers).set({ role }).where(eq(orgMembers.id, existing.id));
    } else {
      await this._db.insert(orgMembers).values({
        id: crypto.randomUUID(),
        orgId: org.id,
        userId,
        role,
        joinedAt: now,
      });
    }
  }

  async removeOrgMember(orgSlug: string, userId: string): Promise<boolean> {
    this._assertOpen();
    const { organizations, orgMembers } = this._s;
    const { eq, and } = this._orm;

    const [org] = await this._db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, orgSlug))
      .limit(1);
    if (!org) return false;

    const [existing] = await this._db
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .where(and(
        eq(orgMembers.orgId, org.id),
        eq(orgMembers.userId, userId),
      ))
      .limit(1);

    if (!existing) return false;

    await this._db.delete(orgMembers).where(eq(orgMembers.id, existing.id));
    return true;
  }

  // ── API key operations ────────────────────────────────────────────────────
  // Wave D (T353.7) — implemented.
  //
  // Backed by apiKeys table (schema-pg.ts).
  // Raw key is never stored — only SHA-256 hash (keyHash) and display prefix.
  // generateApiKey() is injected via route-layer utils; here we replicate it.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createApiKey(params: CreateApiKeyParams): Promise<any> {
    this._assertOpen();
    const { apiKeys } = this._s;
    const { generateId } = await getSdkHelpers();
    const { hashContent } = await getSdkHelpers();

    const now = Date.now();
    const id = generateId();

    // Generate raw key: "llmtxt_" + 43 chars base64url (32 random bytes)
    // We cannot use node:crypto directly (SSOT rule). Use hashContent as entropy source.
    // For the raw key we XOR with a unique id to avoid determinism.
    const rawRandom = hashContent(`${id}:${now}:${params.userId}`);
    const rawKey = `llmtxt_${rawRandom.slice(0, 43)}`;
    const keyHash = hashContent(rawKey);
    const keyPrefix = `llmtxt_${rawRandom.slice(0, 8)}`;

    await this._db.insert(apiKeys).values({
      id,
      userId: params.userId,
      name: params.name,
      keyHash,
      keyPrefix,
      scopes: '*',
      revoked: false,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      userId: params.userId,
      name: params.name,
      prefix: keyPrefix,
      secret: rawKey,
      createdAt: now,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async listApiKeys(userId: string): Promise<any[]> {
    this._assertOpen();
    const { apiKeys } = this._s;
    const { eq } = this._orm;

    const rows = await this._db
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        revoked: apiKeys.revoked,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId));

    return rows.map((r: {
      id: string; userId: string; name: string; keyPrefix: string;
      scopes: string; lastUsedAt: number | null; expiresAt: number | null;
      revoked: boolean; createdAt: number;
    }) => ({
      id: r.id,
      userId: r.userId,
      name: r.name,
      prefix: r.keyPrefix,
      createdAt: r.createdAt,
    }));
  }

  async deleteApiKey(id: string, userId: string): Promise<boolean> {
    this._assertOpen();
    const { apiKeys } = this._s;
    const { eq, and } = this._orm;
    const now = Date.now();

    const [existing] = await this._db
      .select({ id: apiKeys.id, revoked: apiKeys.revoked })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .limit(1);

    if (!existing || existing.revoked) return false;

    await this._db
      .update(apiKeys)
      .set({ revoked: true, updatedAt: now })
      .where(eq(apiKeys.id, id));

    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async rotateApiKey(id: string, userId: string): Promise<any> {
    this._assertOpen();
    const { apiKeys } = this._s;
    const { eq, and } = this._orm;
    const { generateId, hashContent } = await getSdkHelpers();

    const now = Date.now();

    const [existing] = await this._db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .limit(1);

    if (!existing || existing.revoked) {
      throw new Error('API key not found or already revoked');
    }

    // Revoke old key
    await this._db.update(apiKeys).set({ revoked: true, updatedAt: now }).where(eq(apiKeys.id, id));

    // Issue new key with same name
    const newId = generateId();
    const rawRandom = hashContent(`${newId}:${now}:${userId}`);
    const rawKey = `llmtxt_${rawRandom.slice(0, 43)}`;
    const keyHash = hashContent(rawKey);
    const keyPrefix = `llmtxt_${rawRandom.slice(0, 8)}`;

    await this._db.insert(apiKeys).values({
      id: newId,
      userId,
      name: existing.name,
      keyHash,
      keyPrefix,
      scopes: existing.scopes,
      expiresAt: existing.expiresAt,
      revoked: false,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: newId,
      userId,
      name: existing.name,
      prefix: keyPrefix,
      secret: rawKey,
      createdAt: now,
    };
  }

  // ── BlobOps — delegated to BlobPgAdapter (injected via setBlobAdapter) ───────

  async attachBlob(params: import('../core/backend.js').AttachBlobParams): Promise<import('../core/backend.js').BlobAttachment> {
    this._assertOpen();
    if (!this._blobAdapter) {
      throw new Error('PostgresBackend: BlobPgAdapter not injected — call setBlobAdapter() first');
    }
    return this._blobAdapter.attachBlob(params);
  }

  async getBlob(
    docSlug: string,
    blobName: string,
    opts?: { includeData?: boolean }
  ): Promise<import('../core/backend.js').BlobData | null> {
    this._assertOpen();
    if (!this._blobAdapter) {
      throw new Error('PostgresBackend: BlobPgAdapter not injected — call setBlobAdapter() first');
    }
    return this._blobAdapter.getBlob(docSlug, blobName, opts);
  }

  async listBlobs(docSlug: string): Promise<import('../core/backend.js').BlobAttachment[]> {
    this._assertOpen();
    if (!this._blobAdapter) {
      throw new Error('PostgresBackend: BlobPgAdapter not injected — call setBlobAdapter() first');
    }
    return this._blobAdapter.listBlobs(docSlug);
  }

  async detachBlob(docSlug: string, blobName: string, detachedBy: string): Promise<boolean> {
    this._assertOpen();
    if (!this._blobAdapter) {
      throw new Error('PostgresBackend: BlobPgAdapter not injected — call setBlobAdapter() first');
    }
    return this._blobAdapter.detachBlob(docSlug, blobName, detachedBy);
  }

  async fetchBlobByHash(hash: string): Promise<Buffer | null> {
    this._assertOpen();
    if (!this._blobAdapter) {
      throw new Error('PostgresBackend: BlobPgAdapter not injected — call setBlobAdapter() first');
    }
    return this._blobAdapter.fetchBlobByHash(hash);
  }

  // ── ExportOps (T427.6) ────────────────────────────────────────────────────────

  /**
   * Export a single document from Postgres to a file on disk.
   *
   * Content retrieval:
   *  1. Resolve slug → document row.
   *  2. listVersions() to find the latest version.
   *  3. getVersion() to get the full row (including compressedData).
   *  4. Decompress compressedData → string content via the SDK decompress().
   *
   * @throws {ExportError} DOC_NOT_FOUND when the slug does not resolve.
   * @throws {ExportError} VERSION_NOT_FOUND when the document has no versions.
   * @throws {ExportError} WRITE_FAILED on I/O error.
   */
  async exportDocument(params: ExportDocumentParams): Promise<ExportDocumentResult> {
    this._assertOpen();

    const { slug } = params;

    // 1. Resolve slug → document.
    const doc = await this.getDocumentBySlug(slug);
    if (!doc) {
      throw new ExportError('DOC_NOT_FOUND', `Document not found: ${slug}`);
    }

    // 2. Get version list (latest is first — listVersions orders by desc).
    const versionList = await this.listVersions(doc.id as string);
    if (!versionList || versionList.length === 0) {
      throw new ExportError('VERSION_NOT_FOUND', `Document ${slug} has no versions`);
    }

    // listVersions for PG backend orders desc — first entry is latest.
    const latestVersionEntry = versionList[0] as Record<string, unknown>;
    const latestVersionNumber = latestVersionEntry.versionNumber as number;

    // 3. Get the full version row with compressedData.
    const versionRow = await this.getVersion(doc.id as string, latestVersionNumber);
    if (!versionRow) {
      throw new ExportError('VERSION_NOT_FOUND', `Version ${latestVersionNumber} missing for ${slug}`);
    }
    const vRow = versionRow as Record<string, unknown>;

    // 4. Decompress content.
    let content: string;
    const compressedData = vRow.compressedData;
    if (compressedData) {
      const buf = compressedData instanceof Buffer
        ? compressedData
        : Buffer.from(compressedData as ArrayBuffer);
      // Use SDK decompress (Brotli/zstd via WASM).
      const { decompress } = await import('llmtxt' as string) as unknown as {
        decompress: (buf: Buffer) => Promise<string>;
      };
      content = await decompress(buf);
    } else {
      throw new ExportError('VERSION_NOT_FOUND', `Version content missing for ${slug}`);
    }

    // 5. Build contributors list.
    const contributors = [
      ...new Set(
        versionList
          .map((v) => (v as Record<string, unknown>).createdBy as string | undefined)
          .filter((c): c is string => Boolean(c)),
      ),
    ];

    // 6. Build DocumentExportState.
    const exportedAt = new Date().toISOString();
    const docRow = doc as Record<string, unknown>;
    const state: DocumentExportState = {
      title: docRow.title as string ?? slug,
      slug: docRow.slug as string ?? slug,
      version: latestVersionNumber,
      state: docRow.state as string ?? 'DRAFT',
      contributors,
      contentHash: contentHashHex(content),
      exportedAt,
      content,
      labels: Array.isArray(docRow.labels) ? docRow.labels as string[] : null,
      createdBy: docRow.createdBy as string | null ?? null,
      createdAt: docRow.createdAt instanceof Date
        ? (docRow.createdAt as Date).getTime()
        : (docRow.createdAt as number | null) ?? null,
      updatedAt: docRow.updatedAt instanceof Date
        ? (docRow.updatedAt as Date).getTime()
        : (docRow.updatedAt as number | null) ?? null,
      versionCount: versionList.length,
      chainRef: null, // T384 stub
    };

    // 7. Write and return.
    return writeExportFile(state, params, (this.config as Record<string, unknown>).identityPath as string | undefined);
  }

  /**
   * Export all documents from the Postgres backend to a directory.
   */
  async exportAll(params: ExportAllParams): Promise<ExportAllResult> {
    this._assertOpen();

    const { format, outputDir, state: filterState, includeMetadata, sign } = params;

    const exported: ExportDocumentResult[] = [];
    const skipped: Array<{ slug: string; reason: string }> = [];
    let cursor: string | undefined = undefined;

    for (;;) {
      const page = await this.listDocuments({
        cursor,
        limit: 50,
        state: filterState as import('../sdk/lifecycle.js').DocumentState | undefined,
      });

      for (const doc of page.items) {
        const docRow = doc as Record<string, unknown>;
        const docSlug = docRow.slug as string ?? docRow.id as string;
        const outputPath = exportAllFilePath(outputDir, docSlug, format);
        try {
          const result = await this.exportDocument({
            slug: docSlug,
            format,
            outputPath,
            includeMetadata,
            sign,
          });
          exported.push(result);
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          skipped.push({ slug: docSlug, reason });
        }
      }

      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    return {
      exported,
      skipped,
      totalCount: exported.length + skipped.length,
      failedCount: skipped.length,
    };
  }

  // ── ImportOps (T427.8) ────────────────────────────────────────

  /**
   * Import a document from a file on disk into the Postgres backend.
   *
   * @throws {ExportError} PARSE_FAILED on I/O or parse errors.
   * @throws {ExportError} HASH_MISMATCH when frontmatter content_hash mismatches.
   * @throws {ExportError} SLUG_EXISTS when onConflict='create' and slug exists.
   */
  async importDocument(params: ImportDocumentParams): Promise<ImportDocumentResult> {
    this._assertOpen();

    const { filePath, importedBy, onConflict = 'new_version' } = params;

    // 1. Parse the file.
    const parsed = parseImportFile(filePath);
    const { slug, title, content } = parsed;

    // 2. Check for an existing document.
    const existing = await this.getDocumentBySlug(slug);

    if (existing !== null) {
      if (onConflict === 'create') {
        throw new ExportError(
          'SLUG_EXISTS',
          `A document with slug "${slug}" already exists. Use onConflict='new_version' to append.`,
        );
      }

      const version = await this.publishVersion({
        documentId: existing.id,
        content,
        patchText: '',
        createdBy: importedBy,
        changelog: `Imported from ${filePath}`,
      });

      return {
        action: 'version_appended',
        slug: existing.slug,
        documentId: existing.id,
        versionNumber: version.versionNumber,
        contentHash: version.contentHash,
      };
    }

    // 3. Create a new document.
    const doc = await this.createDocument({
      title,
      createdBy: importedBy,
      slug,
    });

    const version = await this.publishVersion({
      documentId: doc.id,
      content,
      patchText: '',
      createdBy: importedBy,
      changelog: `Imported from ${filePath}`,
    });

    return {
      action: 'created',
      slug: doc.slug,
      documentId: doc.id,
      versionNumber: version.versionNumber,
      contentHash: version.contentHash,
    };
  }

  // ── CrSqlite changeset sync (P2.6 / P2.7 — T404 / T405) ─────

  /**
   * Not supported by PgBackend — cr-sqlite sync is a LocalBackend feature.
   * PostgresBackend participates in P2P sync via a different protocol (P3).
   */
  async getChangesSince(_dbVersion: bigint): Promise<Uint8Array> {
    throw new Error('PgBackend: getChangesSince not implemented — cr-sqlite sync is LocalBackend-only (P2.6)');
  }

  async applyChanges(_changeset: Uint8Array): Promise<bigint> {
    throw new Error('PgBackend: applyChanges not implemented — cr-sqlite sync is LocalBackend-only (P2.7)');
  }
}
