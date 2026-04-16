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
) => Promise<{ yrsState: Buffer; clock: number; updatedAt: Date | null } | null>;

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

  async getApprovalChain(_documentId: string): Promise<ApprovalChainResult> {
    this._assertOpen();
    throw new Error('PostgresBackend: getApprovalChain — Wave C implementation pending (T353.6)');
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
    const { documentEvents } = this._s;
    const { eq, gt, and, asc } = this._orm;

    const limit = rawLimit ?? 50;
    const sinceSeq = since ? BigInt(since) : BigInt(0);

    // Build filter conditions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conditions: any[] = [
      eq(documentEvents.documentId, documentId),
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

    const sv = this._crdtStateVector(row.yrsState);
    return {
      documentId,
      sectionKey,
      stateVectorBase64: sv.toString('base64'),
      snapshotBase64: row.yrsState.toString('base64'),
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
