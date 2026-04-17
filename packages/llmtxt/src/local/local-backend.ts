/**
 * LocalBackend — embedded SQLite implementation of the Backend interface.
 *
 * Provides the full LLMtxt feature set with zero network dependency.
 * Uses better-sqlite3 (synchronous) via Drizzle ORM. All business logic
 * that was previously in apps/backend/src/routes/ is implemented here.
 *
 * IMPORTANT: better-sqlite3 is SYNCHRONOUS. Transaction callbacks MUST NOT
 * be async. All database calls are synchronous; async methods in this class
 * wrap sync operations with Promise.resolve() only at the boundary, never
 * inside transaction callbacks.
 *
 * @example
 * ```ts
 * import { LocalBackend } from 'llmtxt/local';
 *
 * const backend = new LocalBackend({ storagePath: './.llmtxt' });
 * await backend.open();
 *
 * const doc = await backend.createDocument({ title: 'My Task', createdBy: 'agent-1' });
 * await backend.publishVersion({
 *   documentId: doc.id,
 *   content: '# My Task\nDetails here.',
 *   patchText: '',
 *   createdBy: 'agent-1',
 *   changelog: 'Initial version',
 * });
 *
 * await backend.close();
 * ```
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, and, gt, asc, desc, lt, sql } from 'drizzle-orm';

import type {
  Backend,
  BackendConfig,
  Document,
  CreateDocumentParams,
  ListDocumentsParams,
  ListResult,
  PublishVersionParams,
  TransitionParams,
  AppendEventParams,
  DocumentEvent,
  QueryEventsParams,
  CrdtUpdate,
  CrdtState,
  AcquireLeaseParams,
  Lease,
  PresenceEntry,
  ScratchpadMessage,
  SendScratchpadParams,
  A2AMessage,
  SearchParams,
  SearchResult,
  AgentPubkeyRecord,
  ApprovalResult,
  ApprovalPolicy,
  AttachBlobParams,
  BlobAttachment,
  BlobData,
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
  FORMAT_EXT,
} from '../export/backend-export.js';
import type { DocumentExportState } from '../export/types.js';
import { parseImportFile } from '../export/import-parser.js';

import {
  BlobFsAdapter,
  BlobTooLargeError,
  BlobNameInvalidError,
  BlobCorruptError,
} from './blob-fs-adapter.js';

export {
  BlobTooLargeError,
  BlobNameInvalidError,
  BlobCorruptError,
} from './blob-fs-adapter.js';

import {
  documents,
  versions,
  stateTransitions,
  approvals,
  sectionCrdtStates,
  sectionCrdtUpdates,
  documentEvents,
  agentPubkeys,
  agentSignatureNonces,
  sectionLeases,
  agentInboxMessages,
  scratchpadEntries,
  sectionEmbeddings,
} from './schema-local.js';

import { validateTransition, isValidTransition } from '../sdk/lifecycle.js';
import type { DocumentState } from '../sdk/lifecycle.js';
import type { VersionEntry } from '../sdk/versions.js';
import { evaluateApprovals, DEFAULT_APPROVAL_POLICY } from '../sdk/consensus.js';
import type { Review } from '../sdk/consensus.js';
import { loadCrSqliteExtensionPath } from '../crsqlite-loader.js';

// ── Migrations path ────────────────────────────────────────────
// __dirname equivalent for ESM
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_PATH = path.join(__dirname, 'migrations');

// ── Lazy CRDT primitives cache ─────────────────────────────────
// Loaded on first applyCrdtUpdate call; avoids circular import at module init.
// Safe to cache: crdt-primitives module is stateless (pure functions).
let _crdtPrimitivesCache: typeof import('../crdt-primitives.js') | null = null;
async function _loadCrdtPrimitives(): Promise<typeof import('../crdt-primitives.js') | null> {
  if (_crdtPrimitivesCache !== null) return _crdtPrimitivesCache;
  try {
    _crdtPrimitivesCache = await import('../crdt-primitives.js');
    return _crdtPrimitivesCache;
  } catch {
    return null;
  }
}

// ── cr-sqlite schema version ───────────────────────────────────
/**
 * SQLite user_version value that indicates CRR activation is complete.
 * Set by migration 20260417230000_crsql_as_crr.
 * user_version 0 = plain SQLite (no CRR).
 * user_version 2 = CRR activated on all 13 tables.
 *
 * DR-P2-04 (MANDATORY — OWNER MANDATE 2026-04-17):
 * section_crdt_states.crdt_state MUST use application-level Loro merge, NOT
 * cr-sqlite LWW. LWW on this blob column would silently corrupt collaborative
 * editing state. See applyChanges() for the enforced merge path.
 */
const CRR_SCHEMA_VERSION = 2;

/** Table names that receive crsql_as_crr() (validated against schema-local.ts, 2026-04-17). */
const CRR_TABLES = [
  'documents',
  'versions',
  'state_transitions',
  'approvals',
  'section_crdt_states',
  'section_crdt_updates',
  'document_events',
  'agent_pubkeys',
  'agent_signature_nonces',
  'section_leases',
  'agent_inbox_messages',
  'scratchpad_entries',
  'section_embeddings',
] as const;

// ── Default config ─────────────────────────────────────────────
const DEFAULT_STORAGE_PATH = '.llmtxt';
const DEFAULT_PRESENCE_TTL_MS = 30_000;
const DEFAULT_LEASE_REAPER_INTERVAL_MS = 10_000;
const SCRATCHPAD_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const A2A_DEFAULT_TTL_MS = 48 * 60 * 60 * 1000; // 48h

// ── Helpers ────────────────────────────────────────────────────

/**
 * Check if an expiry timestamp is still valid.
 * exp=0 means never expires — MUST be treated as always valid.
 */
function isNotExpired(exp: number): boolean {
  return exp === 0 || exp > Date.now();
}

/** Generate a short unique id. */
function newId(): string {
  return nanoid(21);
}

/**
 * Slugify a title for use as a URL-safe document slug.
 * Falls back to a pure-JS implementation if WASM is unavailable.
 */
function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80) || 'untitled';
}

// ────────────────────────────────────────────────────────────────
// In-memory presence store
// ────────────────────────────────────────────────────────────────

interface PresenceRecord {
  agentId: string;
  documentId: string;
  meta?: Record<string, unknown>;
  lastSeen: number;
  expiresAt: number;
}

// ────────────────────────────────────────────────────────────────
// LocalBackend class
// ────────────────────────────────────────────────────────────────

export class LocalBackend implements Backend {
  readonly config: BackendConfig;

  private db!: ReturnType<typeof drizzle>;
  private rawDb!: Database.Database;
  private opened = false;
  private blobAdapter!: BlobFsAdapter;

  /**
   * True if the cr-sqlite extension was successfully loaded and CRR tables are
   * activated. False if cr-sqlite is unavailable (local-only mode, no sync).
   *
   * Callers MUST check hasCRR before calling getChangesSince() or applyChanges().
   * Those methods throw CrSqliteNotLoadedError when hasCRR is false.
   *
   * DR-P2-01: Graceful degradation — LocalBackend MUST work without cr-sqlite.
   */
  hasCRR = false;

  /** In-process event bus for subscribeStream / subscribeSection. */
  private readonly bus = new EventEmitter();

  /** In-memory presence store: key = `${docId}::${agentId}` */
  private readonly presenceMap = new Map<string, PresenceRecord>();

  /** Background timers — stopped in close(). */
  private timers: NodeJS.Timeout[] = [];

  constructor(config: BackendConfig = {}) {
    this.config = {
      storagePath: DEFAULT_STORAGE_PATH,
      wal: true,
      leaseReaperIntervalMs: DEFAULT_LEASE_REAPER_INTERVAL_MS,
      presenceTtlMs: DEFAULT_PRESENCE_TTL_MS,
      ...config,
    };
    // Increase EventEmitter max listeners to avoid warnings for multi-subscriber scenarios
    this.bus.setMaxListeners(500);
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async open(): Promise<void> {
    if (this.opened) return;

    const storagePath = this.config.storagePath!;
    fs.mkdirSync(storagePath, { recursive: true });

    const dbPath = this.config.identityPath
      ? path.join(storagePath, 'llmtxt.db')
      : path.join(storagePath, 'llmtxt.db');

    this.rawDb = new Database(dbPath);

    if (this.config.wal) {
      this.rawDb.pragma('journal_mode = WAL');
    }
    this.rawDb.pragma('foreign_keys = ON');

    this.db = drizzle({ client: this.rawDb });

    // Apply pending migrations first (idempotent).
    // Migrations MUST run before _activateCRRTables() so all tables exist
    // when crsql_as_crr() is called. The CRR migration SQL
    // (20260417230000_crsql_as_crr) is a no-op SELECT — it does NOT call
    // crsql_as_crr() directly. CRR activation is deferred to runtime below.
    migrate(this.db, { migrationsFolder: MIGRATIONS_PATH });

    // ── cr-sqlite extension load (P2.5) ──────────────────────────────────────
    //
    // Run AFTER migrate() so all tables exist when crsql_as_crr() is called.
    //
    // DR-P2-01: @vlcn.io/crsqlite is an optional peer dependency. If absent,
    // LocalBackend opens in local-only mode (hasCRR = false). No crash.
    //
    // Spec §3.1: @vlcn.io/crsqlite is ESM-only. MUST use dynamic import().
    // require('@vlcn.io/crsqlite') MUST NOT be used — it throws ERR_REQUIRE_ESM.

    let extPath: string | null = this.config.crsqliteExtPath ?? null;
    if (extPath === null) {
      extPath = await loadCrSqliteExtensionPath();
    }

    if (extPath !== null) {
      try {
        this.rawDb.loadExtension(extPath);
        // Extension loaded — activate CRRs on all tables if not yet done.
        // _activateCRRTables() is idempotent: crsql_as_crr() is a no-op for
        // tables that are already CRRs.
        this._activateCRRTables();
        this.hasCRR = true;
      } catch (err) {
        // Extension load or CRR activation failed (ABI mismatch, wrong platform,
        // corrupted binary). Degrade gracefully: log warning, continue without
        // cr-sqlite. Basic CRUD continues to function normally.
        console.warn(
          '[LocalBackend] Failed to load cr-sqlite extension at path %s — ' +
          'opening in local-only mode (hasCRR=false). Error: %s',
          extPath,
          (err as Error).message
        );
        this.hasCRR = false;
      }
    } else {
      // No extension path available — silent local-only mode.
      console.warn(
        '[LocalBackend] @vlcn.io/crsqlite not installed and no crsqliteExtPath ' +
        'provided — opening in local-only mode (hasCRR=false). ' +
        'Install @vlcn.io/crsqlite to enable cr-sqlite sync.'
      );
      this.hasCRR = false;
    }
    // ── end cr-sqlite extension load ─────────────────────────────────────────

    // Initialise blob filesystem adapter
    this.blobAdapter = new BlobFsAdapter(
      this.db as unknown as import('drizzle-orm/better-sqlite3').BetterSQLite3Database<Record<string, never>>,
      this.config.storagePath!,
      this.config.maxBlobSizeBytes
    );

    // Start background reapers
    this._startReapers();

    this.opened = true;
  }

  /**
   * Activates CRR on all LocalBackend tables via crsql_as_crr().
   *
   * Called from open() after successfully loading the cr-sqlite extension.
   * crsql_as_crr() is idempotent: calling it on an already-CRR table is safe.
   *
   * DR-P2-02: CRR activation happens at database initialisation time.
   * DR-P2-04: section_crdt_states is registered as CRR here (safe), but the
   * crdt_state blob column MUST use application-level Loro merge in
   * applyChanges() — LWW on this column is PROHIBITED.
   */
  private _activateCRRTables(): void {
    for (const table of CRR_TABLES) {
      try {
        this.rawDb.exec(`SELECT crsql_as_crr('${table}')`);
      } catch (err) {
        // crsql_as_crr may fail if the table doesn't exist yet (e.g., first open
        // before migrations run). This is non-fatal; migration SQL also calls
        // crsql_as_crr() after table creation, so the activation is deferred.
        const msg = (err as Error).message ?? '';
        if (!msg.includes('no such table')) {
          throw err;
        }
      }
    }
    // Bump user_version to CRR_SCHEMA_VERSION to record successful activation.
    // This allows hasCRR detection on subsequent opens without re-running all
    // crsql_as_crr() calls.
    const currentVersion = (this.rawDb.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version ?? 0;
    if (currentVersion < CRR_SCHEMA_VERSION) {
      this.rawDb.pragma(`user_version = ${CRR_SCHEMA_VERSION}`);
    }
  }

  async close(): Promise<void> {
    // Stop all background timers
    for (const t of this.timers) {
      clearInterval(t);
    }
    this.timers = [];

    if (this.rawDb) {
      this.rawDb.close();
    }
    this.opened = false;
  }

  private _assertOpen(): void {
    if (!this.opened) {
      throw new Error('LocalBackend: call open() before using this instance');
    }
  }

  private _startReapers(): void {
    // Lease expiry reaper
    const leaseReaper = setInterval(() => {
      try {
        const now = Date.now();
        this.db
          .delete(sectionLeases)
          .where(and(gt(sectionLeases.expiresAt, 0), lt(sectionLeases.expiresAt, now)))
          .run();
      } catch (_) {
        // Log but don't crash — reaper errors are non-fatal
      }
    }, this.config.leaseReaperIntervalMs!);
    this.timers.push(leaseReaper);

    // Presence TTL reaper
    const presenceReaper = setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.presenceMap.entries()) {
        if (record.lastSeen + this.config.presenceTtlMs! < now) {
          this.presenceMap.delete(key);
        }
      }
    }, Math.floor(this.config.presenceTtlMs! / 3));
    this.timers.push(presenceReaper);

    // Scratchpad TTL reaper (every 60s)
    const scratchpadReaper = setInterval(() => {
      try {
        const now = Date.now();
        this.db
          .delete(scratchpadEntries)
          .where(and(gt(scratchpadEntries.exp, 0), lt(scratchpadEntries.exp, now)))
          .run();
      } catch (_) {
        // non-fatal
      }
    }, 60_000);
    this.timers.push(scratchpadReaper);

    // A2A inbox TTL reaper (every 5 minutes)
    const a2aReaper = setInterval(() => {
      try {
        const now = Date.now();
        this.db
          .delete(agentInboxMessages)
          .where(and(gt(agentInboxMessages.exp, 0), lt(agentInboxMessages.exp, now)))
          .run();
      } catch (_) {
        // non-fatal
      }
    }, 5 * 60_000);
    this.timers.push(a2aReaper);

    // Nonce TTL reaper (every 5 minutes)
    const nonceReaper = setInterval(() => {
      try {
        const now = Date.now();
        this.db
          .delete(agentSignatureNonces)
          .where(lt(agentSignatureNonces.expiresAt, now))
          .run();
      } catch (_) {
        // non-fatal
      }
    }, 5 * 60_000);
    this.timers.push(nonceReaper);
  }

  // ── DocumentOps ──────────────────────────────────────────────

  async createDocument(params: CreateDocumentParams): Promise<Document> {
    this._assertOpen();

    const id = newId();
    const now = Date.now();
    let slug = params.slug ?? slugifyTitle(params.title);

    // Ensure slug uniqueness
    let attempt = 0;
    let candidateSlug = slug;
    while (true) {
      const existing = this.db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.slug, candidateSlug))
        .get();
      if (!existing) {
        slug = candidateSlug;
        break;
      }
      attempt++;
      candidateSlug = `${slug}-${attempt}`;
    }

    this.db.insert(documents).values({
      id,
      slug,
      title: params.title,
      state: 'DRAFT',
      createdBy: params.createdBy,
      visibility: 'public',
      createdAt: now,
      updatedAt: now,
      versionCount: 0,
      labelsJson: JSON.stringify(params.labels ?? []),
      eventSeqCounter: 0,
      bftF: 1,
      requiredApprovals: 1,
      approvalTimeoutMs: 0,
    }).run();

    return this._rowToDocument(
      this.db.select().from(documents).where(eq(documents.id, id)).get()!
    );
  }

  async getDocument(id: string): Promise<Document | null> {
    this._assertOpen();
    const row = this.db.select().from(documents).where(eq(documents.id, id)).get();
    return row ? this._rowToDocument(row) : null;
  }

  async getDocumentBySlug(slug: string): Promise<Document | null> {
    this._assertOpen();
    const row = this.db.select().from(documents).where(eq(documents.slug, slug)).get();
    return row ? this._rowToDocument(row) : null;
  }

  async listDocuments(params: ListDocumentsParams = {}): Promise<ListResult<Document>> {
    this._assertOpen();
    const limit = params.limit ?? 20;

    const rows = this.db
      .select()
      .from(documents)
      .orderBy(desc(documents.createdAt))
      .limit(limit + 1)
      .all();

    const items = rows.slice(0, limit).map((r) => this._rowToDocument(r));
    const nextCursor = rows.length > limit ? items[items.length - 1]?.id ?? null : null;

    return { items, nextCursor };
  }

  async deleteDocument(id: string): Promise<boolean> {
    this._assertOpen();
    const existing = this.db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, id))
      .get();
    if (!existing) return false;

    this.db.delete(documents).where(eq(documents.id, id)).run();
    return true;
  }

  private _rowToDocument(row: typeof documents.$inferSelect): Document {
    let labels: string[] = [];
    try {
      labels = JSON.parse(row.labelsJson ?? '[]');
    } catch (_) {
      labels = [];
    }
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      state: row.state as DocumentState,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      versionCount: row.versionCount,
      labels,
    };
  }

  // ── VersionOps ────────────────────────────────────────────────

  async publishVersion(params: PublishVersionParams): Promise<VersionEntry> {
    this._assertOpen();
    const now = Date.now();

    // Compute content hash (use simple SHA-256 via node:crypto as fallback
    // until WASM integration is wired in a follow-up)
    const { createHash } = await import('node:crypto');
    const contentHash = createHash('sha256').update(params.content).digest('hex');

    const doc = this.db
      .select({ versionCount: documents.versionCount })
      .from(documents)
      .where(eq(documents.id, params.documentId))
      .get();
    if (!doc) throw new Error(`Document not found: ${params.documentId}`);

    const versionNumber = doc.versionCount + 1;
    const id = newId();

    // Inline vs filesystem storage threshold: 10 KB
    const INLINE_THRESHOLD = 10 * 1024;
    const contentBytes = Buffer.from(params.content, 'utf8');
    let storageType = 'inline';
    let storageKey: string | null = null;
    let compressedData: Buffer | null = null;

    if (contentBytes.length <= INLINE_THRESHOLD) {
      compressedData = contentBytes;
    } else {
      // Write to filesystem
      storageType = 'filesystem';
      const blobsDir = path.join(this.config.storagePath!, 'blobs');
      fs.mkdirSync(blobsDir, { recursive: true });
      storageKey = contentHash;
      fs.writeFileSync(path.join(blobsDir, contentHash), contentBytes);
    }

    this.db.insert(versions).values({
      id,
      documentId: params.documentId,
      versionNumber,
      compressedData,
      contentHash,
      tokenCount: null,
      createdAt: now,
      createdBy: params.createdBy,
      changelog: params.changelog,
      patchText: params.patchText,
      baseVersion: versionNumber > 1 ? versionNumber - 1 : null,
      storageType,
      storageKey,
    }).run();

    // Increment versionCount
    this.db
      .update(documents)
      .set({ versionCount: versionNumber, updatedAt: now })
      .where(eq(documents.id, params.documentId))
      .run();

    return {
      versionNumber,
      patchText: params.patchText,
      createdBy: params.createdBy,
      changelog: params.changelog,
      contentHash,
      createdAt: now,
    };
  }

  async getVersion(documentId: string, versionNumber: number): Promise<VersionEntry | null> {
    this._assertOpen();
    const row = this.db
      .select()
      .from(versions)
      .where(
        and(
          eq(versions.documentId, documentId),
          eq(versions.versionNumber, versionNumber)
        )
      )
      .get();
    if (!row) return null;
    return {
      versionNumber: row.versionNumber,
      patchText: row.patchText ?? '',
      createdBy: row.createdBy ?? '',
      changelog: row.changelog ?? '',
      contentHash: row.contentHash,
      createdAt: row.createdAt,
    };
  }

  async listVersions(documentId: string): Promise<VersionEntry[]> {
    this._assertOpen();
    const rows = this.db
      .select()
      .from(versions)
      .where(eq(versions.documentId, documentId))
      .orderBy(asc(versions.versionNumber))
      .all();
    return rows.map((row) => ({
      versionNumber: row.versionNumber,
      patchText: row.patchText ?? '',
      createdBy: row.createdBy ?? '',
      changelog: row.changelog ?? '',
      contentHash: row.contentHash,
      createdAt: row.createdAt,
    }));
  }

  async transitionVersion(params: TransitionParams): Promise<{
    success: boolean;
    error?: string;
    document?: Document;
  }> {
    this._assertOpen();
    const doc = this.db
      .select()
      .from(documents)
      .where(eq(documents.id, params.documentId))
      .get();
    if (!doc) return { success: false, error: 'Document not found' };

    const currentState = doc.state as DocumentState;
    if (!isValidTransition(currentState, params.to)) {
      return {
        success: false,
        error: `Invalid transition: ${currentState} → ${params.to}`,
      };
    }

    const now = Date.now();
    this.db
      .update(documents)
      .set({ state: params.to, updatedAt: now })
      .where(eq(documents.id, params.documentId))
      .run();

    // Record state transition
    this.db.insert(stateTransitions).values({
      id: newId(),
      documentId: params.documentId,
      fromState: currentState,
      toState: params.to,
      changedBy: params.changedBy,
      changedAt: now,
      reason: params.reason ?? null,
      atVersion: doc.versionCount,
    }).run();

    const updated = this.db
      .select()
      .from(documents)
      .where(eq(documents.id, params.documentId))
      .get()!;

    return { success: true, document: this._rowToDocument(updated) };
  }

  // ── ApprovalOps ───────────────────────────────────────────────

  async submitSignedApproval(params: {
    documentId: string;
    versionNumber: number;
    reviewerId: string;
    status: 'APPROVED' | 'REJECTED';
    reason?: string;
    signatureBase64: string;
  }): Promise<{ success: boolean; error?: string; result?: ApprovalResult }> {
    this._assertOpen();

    // Check for duplicate
    const existing = this.db
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.documentId, params.documentId),
          eq(approvals.reviewerId, params.reviewerId),
          eq(approvals.atVersion, params.versionNumber),
          eq(approvals.status, params.status)
        )
      )
      .get();
    if (existing) {
      return { success: false, error: 'duplicate approval' };
    }

    const now = Date.now();
    this.db.insert(approvals).values({
      id: newId(),
      documentId: params.documentId,
      reviewerId: params.reviewerId,
      status: params.status,
      timestamp: now,
      reason: params.reason ?? null,
      atVersion: params.versionNumber,
      sigHex: Buffer.from(params.signatureBase64, 'base64').toString('hex'),
      canonicalPayload: null,
      chainHash: null,
      prevChainHash: null,
      bftF: 1,
    }).run();

    const result = await this.getApprovalProgress(params.documentId, params.versionNumber);
    return { success: true, result };
  }

  async getApprovalProgress(
    documentId: string,
    versionNumber: number
  ): Promise<ApprovalResult> {
    this._assertOpen();
    const rows = this.db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.documentId, documentId),
          eq(approvals.atVersion, versionNumber)
        )
      )
      .all();

    const reviews: Review[] = rows.map((r) => ({
      reviewerId: r.reviewerId,
      status: r.status as Review['status'],
      timestamp: r.timestamp,
      reason: r.reason ?? undefined,
      atVersion: r.atVersion,
    }));

    const policy = await this.getApprovalPolicy(documentId);
    return evaluateApprovals(reviews, policy, versionNumber);
  }

  async getApprovalPolicy(documentId: string): Promise<ApprovalPolicy> {
    this._assertOpen();
    const doc = this.db
      .select({ requiredApprovals: documents.requiredApprovals, bftF: documents.bftF })
      .from(documents)
      .where(eq(documents.id, documentId))
      .get();
    return {
      ...DEFAULT_APPROVAL_POLICY,
      requiredCount: doc?.requiredApprovals ?? 1,
    };
  }

  async setApprovalPolicy(documentId: string, policy: ApprovalPolicy): Promise<void> {
    this._assertOpen();
    this.db
      .update(documents)
      .set({ requiredApprovals: policy.requiredCount, updatedAt: Date.now() })
      .where(eq(documents.id, documentId))
      .run();
  }

  // ── EventOps ──────────────────────────────────────────────────

  async appendEvent(params: AppendEventParams): Promise<DocumentEvent> {
    this._assertOpen();
    const now = Date.now();
    const id = newId();

    // Atomically increment seq counter
    this.db
      .update(documents)
      .set({ eventSeqCounter: sql`${documents.eventSeqCounter} + 1` })
      .where(eq(documents.id, params.documentId))
      .run();

    const doc = this.db
      .select({ eventSeqCounter: documents.eventSeqCounter })
      .from(documents)
      .where(eq(documents.id, params.documentId))
      .get();
    const seq = doc?.eventSeqCounter ?? 0;

    this.db.insert(documentEvents).values({
      id,
      documentId: params.documentId,
      seq,
      eventType: params.type,
      actorId: params.agentId,
      payloadJson: JSON.stringify(params.payload ?? {}),
      idempotencyKey: null,
      createdAt: now,
      prevHash: null,
    }).run();

    const event: DocumentEvent = {
      id,
      documentId: params.documentId,
      type: params.type,
      agentId: params.agentId,
      payload: params.payload ?? {},
      createdAt: now,
    };

    // Emit to in-process subscribers
    this.bus.emit(`events:${params.documentId}`, event);

    return event;
  }

  async queryEvents(params: QueryEventsParams): Promise<ListResult<DocumentEvent>> {
    this._assertOpen();
    const limit = params.limit ?? 50;

    const rows = this.db
      .select()
      .from(documentEvents)
      .where(eq(documentEvents.documentId, params.documentId))
      .orderBy(asc(documentEvents.createdAt))
      .limit(limit + 1)
      .all();

    const items: DocumentEvent[] = rows.slice(0, limit).map((r) => ({
      id: r.id,
      documentId: r.documentId,
      type: r.eventType,
      agentId: r.actorId,
      payload: (() => {
        try {
          return JSON.parse(r.payloadJson);
        } catch {
          return {};
        }
      })(),
      createdAt: r.createdAt,
    }));

    const nextCursor = rows.length > limit ? items[items.length - 1]?.id ?? null : null;
    return { items, nextCursor };
  }

  subscribeStream(documentId: string): AsyncIterable<DocumentEvent> {
    const bus = this.bus;
    return {
      [Symbol.asyncIterator]() {
        const queue: DocumentEvent[] = [];
        let resolve: ((value: IteratorResult<DocumentEvent>) => void) | null = null;
        let done = false;

        const handler = (event: DocumentEvent) => {
          if (done) return;
          if (resolve) {
            const r = resolve;
            resolve = null;
            r({ value: event, done: false });
          } else {
            queue.push(event);
          }
        };

        bus.on(`events:${documentId}`, handler);

        return {
          next(): Promise<IteratorResult<DocumentEvent>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false });
            }
            if (done) {
              return Promise.resolve({ value: undefined as unknown as DocumentEvent, done: true });
            }
            return new Promise((res) => {
              resolve = res;
            });
          },
          return(): Promise<IteratorResult<DocumentEvent>> {
            done = true;
            bus.off(`events:${documentId}`, handler);
            return Promise.resolve({ value: undefined as unknown as DocumentEvent, done: true });
          },
        };
      },
    };
  }

  // ── CrdtOps ───────────────────────────────────────────────────

  async applyCrdtUpdate(params: {
    documentId: string;
    sectionKey: string;
    updateBase64: string;
    agentId: string;
  }): Promise<CrdtState> {
    this._assertOpen();
    const now = Date.now();
    const id = newId();

    // Get current clock for seq
    const currentState = this.db
      .select()
      .from(sectionCrdtStates)
      .where(
        and(
          eq(sectionCrdtStates.documentId, params.documentId),
          eq(sectionCrdtStates.sectionId, params.sectionKey)
        )
      )
      .get();
    const seq = (currentState?.clock ?? 0) + 1;

    // Persist raw update
    const updateBlob = Buffer.from(params.updateBase64, 'base64');
    this.db.insert(sectionCrdtUpdates).values({
      id,
      documentId: params.documentId,
      sectionId: params.sectionKey,
      updateBlob,
      clientId: params.agentId,
      seq,
      createdAt: now,
    }).run();

    // Merge update into existing snapshot via Loro CRDT primitives (SSoT: crdt-primitives).
    // crdt_apply_update is idempotent — applying same update twice yields same result.
    // Uses a lazy async import that is safe since applyCrdtUpdate is already async.
    // Falls back to raw update blob if WASM is unavailable or if the update bytes
    // are not valid Loro binary (graceful degradation — no crash).
    const existingState = currentState?.crdtState as Buffer | null;
    let newState: Buffer;
    {
      const crdtPrimitives = await _loadCrdtPrimitives();
      if (crdtPrimitives !== null) {
        try {
          const merged = crdtPrimitives.crdt_apply_update(
            existingState ?? Buffer.alloc(0),
            updateBlob,
          );
          // If WASM returns empty bytes, fall back to raw update blob to avoid
          // corrupting state with an empty buffer.
          newState = merged.length > 0 ? merged : updateBlob;
        } catch {
          // Invalid Loro bytes (e.g. test fixtures using raw binary) — degrade gracefully.
          newState = updateBlob;
        }
      } else {
        newState = updateBlob;
      }
    }

    // Upsert state
    this.db
      .insert(sectionCrdtStates)
      .values({
        documentId: params.documentId,
        sectionId: params.sectionKey,
        clock: seq,
        updatedAt: now,
        crdtState: newState,
      })
      .onConflictDoUpdate({
        target: [sectionCrdtStates.documentId, sectionCrdtStates.sectionId],
        set: { clock: seq, updatedAt: now, crdtState: newState },
      })
      .run();

    const crdtUpdate: CrdtUpdate = {
      documentId: params.documentId,
      sectionKey: params.sectionKey,
      updateBase64: params.updateBase64,
      agentId: params.agentId,
      createdAt: now,
    };

    // Emit to subscribers
    this.bus.emit(`crdt:${params.documentId}:${params.sectionKey}`, crdtUpdate);

    // Compute Loro VersionVector for stateVectorBase64 field
    const crdtPrimitivesForSv = await _loadCrdtPrimitives();
    const svBase64 = crdtPrimitivesForSv
      ? crdtPrimitivesForSv.crdt_state_vector(newState).toString('base64')
      : newState.toString('base64'); // WASM unavailable: use snapshot as fallback

    return {
      documentId: params.documentId,
      sectionKey: params.sectionKey,
      stateVectorBase64: svBase64,
      snapshotBase64: newState.toString('base64'),
      updatedAt: now,
    };
  }

  async getCrdtState(documentId: string, sectionKey: string): Promise<CrdtState | null> {
    this._assertOpen();
    const row = this.db
      .select()
      .from(sectionCrdtStates)
      .where(
        and(
          eq(sectionCrdtStates.documentId, documentId),
          eq(sectionCrdtStates.sectionId, sectionKey)
        )
      )
      .get();
    if (!row) return null;
    const stateBlob = row.crdtState as Buffer;

    // Compute Loro VersionVector for stateVectorBase64 field
    const crdtPrimitivesForSv = await _loadCrdtPrimitives();
    const svBase64 = crdtPrimitivesForSv
      ? crdtPrimitivesForSv.crdt_state_vector(stateBlob).toString('base64')
      : stateBlob.toString('base64'); // WASM unavailable: use snapshot as fallback

    return {
      documentId,
      sectionKey,
      stateVectorBase64: svBase64,
      snapshotBase64: stateBlob.toString('base64'),
      updatedAt: row.updatedAt,
    };
  }

  subscribeSection(documentId: string, sectionKey: string): AsyncIterable<CrdtUpdate> {
    const bus = this.bus;
    const channel = `crdt:${documentId}:${sectionKey}`;
    return {
      [Symbol.asyncIterator]() {
        const queue: CrdtUpdate[] = [];
        let resolve: ((value: IteratorResult<CrdtUpdate>) => void) | null = null;
        let done = false;

        const handler = (update: CrdtUpdate) => {
          if (done) return;
          if (resolve) {
            const r = resolve;
            resolve = null;
            r({ value: update, done: false });
          } else {
            queue.push(update);
          }
        };

        bus.on(channel, handler);

        return {
          next(): Promise<IteratorResult<CrdtUpdate>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false });
            }
            if (done) {
              return Promise.resolve({ value: undefined as unknown as CrdtUpdate, done: true });
            }
            return new Promise((res) => { resolve = res; });
          },
          return(): Promise<IteratorResult<CrdtUpdate>> {
            done = true;
            bus.off(channel, handler);
            return Promise.resolve({ value: undefined as unknown as CrdtUpdate, done: true });
          },
        };
      },
    };
  }

  // ── LeaseOps ──────────────────────────────────────────────────

  async acquireLease(params: AcquireLeaseParams): Promise<Lease | null> {
    this._assertOpen();
    const now = Date.now();
    const expiresAt = now + params.ttlMs;

    // Check for existing non-expired lease
    const existing = this.db
      .select()
      .from(sectionLeases)
      .where(eq(sectionLeases.resource, params.resource))
      .get();

    if (existing) {
      const isActive = isNotExpired(existing.expiresAt);
      if (isActive && existing.holder !== params.holder) {
        // Another holder has an active lease — cannot acquire
        return null;
      }
      // Same holder or expired — update
      this.db
        .update(sectionLeases)
        .set({ holder: params.holder, expiresAt, acquiredAt: now })
        .where(eq(sectionLeases.resource, params.resource))
        .run();
    } else {
      this.db.insert(sectionLeases).values({
        id: newId(),
        resource: params.resource,
        holder: params.holder,
        acquiredAt: now,
        expiresAt,
      }).run();
    }

    return {
      id: existing?.id ?? newId(),
      resource: params.resource,
      holder: params.holder,
      expiresAt,
      acquiredAt: now,
    };
  }

  async renewLease(resource: string, holder: string, ttlMs: number): Promise<Lease | null> {
    this._assertOpen();
    const row = this.db
      .select()
      .from(sectionLeases)
      .where(eq(sectionLeases.resource, resource))
      .get();

    if (!row || row.holder !== holder) return null;

    const now = Date.now();
    const expiresAt = now + ttlMs;
    this.db
      .update(sectionLeases)
      .set({ expiresAt })
      .where(eq(sectionLeases.resource, resource))
      .run();

    return {
      id: row.id,
      resource,
      holder,
      expiresAt,
      acquiredAt: row.acquiredAt,
    };
  }

  async releaseLease(resource: string, holder: string): Promise<boolean> {
    this._assertOpen();
    const row = this.db
      .select()
      .from(sectionLeases)
      .where(eq(sectionLeases.resource, resource))
      .get();
    if (!row || row.holder !== holder) return false;

    this.db.delete(sectionLeases).where(eq(sectionLeases.resource, resource)).run();
    return true;
  }

  async getLease(resource: string): Promise<Lease | null> {
    this._assertOpen();
    const row = this.db
      .select()
      .from(sectionLeases)
      .where(eq(sectionLeases.resource, resource))
      .get();
    if (!row || !isNotExpired(row.expiresAt)) return null;
    return {
      id: row.id,
      resource,
      holder: row.holder,
      expiresAt: row.expiresAt,
      acquiredAt: row.acquiredAt,
    };
  }

  // ── PresenceOps ───────────────────────────────────────────────

  async joinPresence(
    documentId: string,
    agentId: string,
    meta?: Record<string, unknown>
  ): Promise<PresenceEntry> {
    const now = Date.now();
    const key = `${documentId}::${agentId}`;
    const entry: PresenceRecord = {
      agentId,
      documentId,
      meta,
      lastSeen: now,
      expiresAt: now + this.config.presenceTtlMs!,
    };
    this.presenceMap.set(key, entry);
    return entry;
  }

  async leavePresence(documentId: string, agentId: string): Promise<void> {
    this.presenceMap.delete(`${documentId}::${agentId}`);
  }

  async listPresence(documentId: string): Promise<PresenceEntry[]> {
    const now = Date.now();
    const results: PresenceEntry[] = [];
    for (const record of this.presenceMap.values()) {
      if (record.documentId === documentId && record.lastSeen + this.config.presenceTtlMs! > now) {
        results.push(record);
      }
    }
    return results;
  }

  async heartbeatPresence(documentId: string, agentId: string): Promise<void> {
    const key = `${documentId}::${agentId}`;
    const record = this.presenceMap.get(key);
    if (record) {
      const now = Date.now();
      record.lastSeen = now;
      record.expiresAt = now + this.config.presenceTtlMs!;
    }
  }

  // ── ScratchpadOps ─────────────────────────────────────────────

  async sendScratchpad(params: SendScratchpadParams): Promise<ScratchpadMessage> {
    this._assertOpen();
    const now = Date.now();
    const ttlMs = params.ttlMs ?? SCRATCHPAD_DEFAULT_TTL_MS;
    const exp = ttlMs === 0 ? 0 : now + ttlMs;
    const id = newId();

    this.db.insert(scratchpadEntries).values({
      id,
      toAgentId: params.toAgentId,
      fromAgentId: params.fromAgentId,
      payloadJson: JSON.stringify(params.payload),
      createdAt: now,
      exp,
    }).run();

    return {
      id,
      toAgentId: params.toAgentId,
      fromAgentId: params.fromAgentId,
      payload: params.payload,
      createdAt: now,
      exp,
    };
  }

  async pollScratchpad(agentId: string, limit = 50): Promise<ScratchpadMessage[]> {
    this._assertOpen();
    const now = Date.now();
    const rows = this.db
      .select()
      .from(scratchpadEntries)
      .where(eq(scratchpadEntries.toAgentId, agentId))
      .orderBy(asc(scratchpadEntries.createdAt))
      .limit(limit * 2) // Over-fetch to allow filtering
      .all();

    return rows
      .filter((r) => isNotExpired(r.exp))
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        toAgentId: r.toAgentId,
        fromAgentId: r.fromAgentId,
        payload: (() => {
          try { return JSON.parse(r.payloadJson); } catch { return {}; }
        })(),
        createdAt: r.createdAt,
        exp: r.exp,
      }));
  }

  async deleteScratchpadMessage(id: string, agentId: string): Promise<boolean> {
    this._assertOpen();
    const row = this.db
      .select()
      .from(scratchpadEntries)
      .where(eq(scratchpadEntries.id, id))
      .get();
    if (!row || row.toAgentId !== agentId) return false;
    this.db.delete(scratchpadEntries).where(eq(scratchpadEntries.id, id)).run();
    return true;
  }

  // ── A2AOps ────────────────────────────────────────────────────

  async sendA2AMessage(params: {
    toAgentId: string;
    envelopeJson: string;
    ttlMs?: number;
  }): Promise<{ success: boolean; error?: string; message?: A2AMessage }> {
    this._assertOpen();
    const now = Date.now();
    const ttlMs = params.ttlMs ?? A2A_DEFAULT_TTL_MS;
    const exp = ttlMs === 0 ? 0 : now + ttlMs;
    const id = newId();

    this.db.insert(agentInboxMessages).values({
      id,
      toAgentId: params.toAgentId,
      envelopeJson: params.envelopeJson,
      createdAt: now,
      exp,
    }).run();

    return {
      success: true,
      message: {
        id,
        toAgentId: params.toAgentId,
        envelopeJson: params.envelopeJson,
        createdAt: now,
        exp,
      },
    };
  }

  async pollA2AInbox(
    agentId: string,
    limit = 50,
    since?: number,
    order: 'asc' | 'desc' = 'desc',
  ): Promise<A2AMessage[]> {
    this._assertOpen();
    const clampedLimit = Math.min(Math.max(1, limit), 500);
    const rows = this.db
      .select()
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.toAgentId, agentId))
      .orderBy(order === 'asc' ? asc(agentInboxMessages.createdAt) : desc(agentInboxMessages.createdAt))
      .limit(clampedLimit * 2)
      .all();

    return rows
      .filter((r) => isNotExpired(r.exp) && (since === undefined || r.createdAt > since))
      .slice(0, clampedLimit)
      .map((r) => ({
        id: r.id,
        toAgentId: r.toAgentId,
        envelopeJson: r.envelopeJson,
        createdAt: r.createdAt,
        exp: r.exp,
      }));
  }

  async deleteA2AMessage(id: string, agentId: string): Promise<boolean> {
    this._assertOpen();
    const row = this.db
      .select()
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.id, id))
      .get();
    if (!row || row.toAgentId !== agentId) return false;
    this.db.delete(agentInboxMessages).where(eq(agentInboxMessages.id, id)).run();
    return true;
  }

  // ── SearchOps ─────────────────────────────────────────────────

  async indexDocument(documentId: string, content: string): Promise<void> {
    this._assertOpen();
    // Gracefully degrade if onnxruntime-node is not installed
    try {
      const { embed: embedText } = await import('../embeddings.js');
      const embedding = await embedText(content);
      if (!embedding) return;

      const now = Date.now();
      const doc = this.db
        .select({ versionCount: documents.versionCount })
        .from(documents)
        .where(eq(documents.id, documentId))
        .get();
      if (!doc) return;

      const blob = Buffer.from(new Float32Array(embedding).buffer);

      this.db
        .insert(sectionEmbeddings)
        .values({
          id: newId(),
          documentId,
          versionNumber: doc.versionCount,
          sectionKey: '__full__',
          embeddingBlob: blob,
          dimensions: embedding.length,
          modelId: 'local',
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [sectionEmbeddings.documentId, sectionEmbeddings.sectionKey],
          set: {
            embeddingBlob: blob,
            versionNumber: doc.versionCount,
            createdAt: now,
          },
        })
        .run();
    } catch (_) {
      // onnxruntime-node not installed or embedding failed — degrade gracefully
    }
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    this._assertOpen();
    try {
      const { embed: embedText } = await import('../embeddings.js');
      const queryEmbedding = await embedText(params.query);
      if (!queryEmbedding) return [];

      const rows = this.db
        .select({
          documentId: sectionEmbeddings.documentId,
          embeddingBlob: sectionEmbeddings.embeddingBlob,
          dimensions: sectionEmbeddings.dimensions,
        })
        .from(sectionEmbeddings)
        .where(eq(sectionEmbeddings.sectionKey, '__full__'))
        .all();

      if (rows.length === 0) return [];

      const queryVec = new Float32Array(queryEmbedding);
      const scored: { documentId: string; score: number }[] = [];

      for (const row of rows) {
        const blob = row.embeddingBlob as Buffer;
        const docVec = new Float32Array(blob.buffer, blob.byteOffset, row.dimensions);
        const score = cosineSimilarity(queryVec, docVec);
        if (score >= (params.minScore ?? 0)) {
          scored.push({ documentId: row.documentId, score });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, params.topK ?? 10);

      // Fetch document metadata
      const results: SearchResult[] = [];
      for (const { documentId, score } of top) {
        const doc = this.db
          .select({ slug: documents.slug, title: documents.title })
          .from(documents)
          .where(eq(documents.id, documentId))
          .get();
        if (doc) {
          results.push({ documentId, slug: doc.slug, title: doc.title, score });
        }
      }
      return results;
    } catch (_) {
      return [];
    }
  }

  // ── IdentityOps ───────────────────────────────────────────────

  async registerAgentPubkey(
    agentId: string,
    pubkeyHex: string,
    label?: string
  ): Promise<AgentPubkeyRecord> {
    this._assertOpen();
    const now = Date.now();

    // Idempotent — don't create duplicates
    const existing = this.db
      .select()
      .from(agentPubkeys)
      .where(eq(agentPubkeys.agentId, agentId))
      .get();
    if (existing) {
      return {
        agentId: existing.agentId,
        pubkeyHex: existing.pubkeyHex,
        label: existing.label ?? undefined,
        createdAt: existing.createdAt,
        revokedAt: existing.revokedAt ?? undefined,
      };
    }

    this.db.insert(agentPubkeys).values({
      id: newId(),
      agentId,
      pubkeyHex,
      label: label ?? null,
      createdAt: now,
      revokedAt: null,
    }).run();

    return { agentId, pubkeyHex, label, createdAt: now };
  }

  async lookupAgentPubkey(agentId: string): Promise<AgentPubkeyRecord | null> {
    this._assertOpen();
    const row = this.db
      .select()
      .from(agentPubkeys)
      .where(eq(agentPubkeys.agentId, agentId))
      .get();
    if (!row) return null;
    return {
      agentId: row.agentId,
      pubkeyHex: row.pubkeyHex,
      label: row.label ?? undefined,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt ?? undefined,
    };
  }

  async revokeAgentPubkey(agentId: string, _pubkeyHex: string): Promise<boolean> {
    this._assertOpen();
    const row = this.db
      .select()
      .from(agentPubkeys)
      .where(eq(agentPubkeys.agentId, agentId))
      .get();
    if (!row) return false;
    this.db
      .update(agentPubkeys)
      .set({ revokedAt: Date.now() })
      .where(eq(agentPubkeys.agentId, agentId))
      .run();
    return true;
  }

  async recordSignatureNonce(
    agentId: string,
    nonce: string,
    ttlMs = 5 * 60_000
  ): Promise<boolean> {
    this._assertOpen();
    const existing = this.db
      .select()
      .from(agentSignatureNonces)
      .where(eq(agentSignatureNonces.nonce, nonce))
      .get();
    if (existing) return false;

    const now = Date.now();
    this.db.insert(agentSignatureNonces).values({
      nonce,
      agentId,
      firstSeen: now,
      expiresAt: now + ttlMs,
    }).run();
    return true;
  }

  async hasNonceBeenUsed(agentId: string, nonce: string): Promise<boolean> {
    this._assertOpen();
    const row = this.db
      .select()
      .from(agentSignatureNonces)
      .where(and(eq(agentSignatureNonces.nonce, nonce), eq(agentSignatureNonces.agentId, agentId)))
      .get();
    return !!row;
  }

  // ── New interface stubs (T353) ─────────────────────────────────
  // These methods are defined in the Backend interface for PostgresBackend.
  // LocalBackend stubs throw NotImplemented so CI surfaces missing impls clearly.

  async listAgentPubkeys(_userId?: string): Promise<import('./index.js').AgentPubkeyRecord[]> {
    throw new Error('LocalBackend: listAgentPubkeys not yet implemented');
  }
  async listContributors(_documentId: string): Promise<import('../core/backend.js').ContributorRecord[]> {
    throw new Error('LocalBackend: listContributors not yet implemented');
  }
  async getApprovalChain(_documentId: string): Promise<import('../core/backend.js').ApprovalChainResult> {
    throw new Error('LocalBackend: getApprovalChain not yet implemented');
  }
  async createCollection(_params: import('../core/backend.js').CreateCollectionParams): Promise<import('../core/backend.js').Collection> {
    throw new Error('LocalBackend: createCollection not yet implemented');
  }
  async getCollection(_slug: string): Promise<import('../core/backend.js').Collection | null> {
    throw new Error('LocalBackend: getCollection not yet implemented');
  }
  async listCollections(_params?: import('../core/backend.js').ListCollectionsParams): Promise<import('../core/backend.js').ListResult<import('../core/backend.js').Collection>> {
    throw new Error('LocalBackend: listCollections not yet implemented');
  }
  async addDocToCollection(_collectionSlug: string, _documentSlug: string, _position?: number): Promise<void> {
    throw new Error('LocalBackend: addDocToCollection not yet implemented');
  }
  async removeDocFromCollection(_collectionSlug: string, _documentSlug: string): Promise<boolean> {
    throw new Error('LocalBackend: removeDocFromCollection not yet implemented');
  }
  async reorderCollection(_collectionSlug: string, _orderedSlugs: string[]): Promise<void> {
    throw new Error('LocalBackend: reorderCollection not yet implemented');
  }
  async exportCollection(_collectionSlug: string): Promise<import('../core/backend.js').CollectionExport> {
    throw new Error('LocalBackend: exportCollection not yet implemented');
  }
  async createDocumentLink(_params: import('../core/backend.js').CreateDocLinkParams): Promise<import('../core/backend.js').DocumentLink> {
    throw new Error('LocalBackend: createDocumentLink not yet implemented');
  }
  async getDocumentLinks(_documentId: string): Promise<import('../core/backend.js').DocumentLink[]> {
    throw new Error('LocalBackend: getDocumentLinks not yet implemented');
  }
  async deleteDocumentLink(_documentId: string, _linkId: string): Promise<boolean> {
    throw new Error('LocalBackend: deleteDocumentLink not yet implemented');
  }
  async getGlobalGraph(_params?: { maxNodes?: number }): Promise<import('../core/backend.js').GraphResult> {
    throw new Error('LocalBackend: getGlobalGraph not yet implemented');
  }
  async createWebhook(_params: import('../core/backend.js').CreateWebhookParams): Promise<import('../core/backend.js').Webhook> {
    throw new Error('LocalBackend: createWebhook not yet implemented');
  }
  async listWebhooks(_userId: string): Promise<import('../core/backend.js').Webhook[]> {
    throw new Error('LocalBackend: listWebhooks not yet implemented');
  }
  async deleteWebhook(_id: string, _userId: string): Promise<boolean> {
    throw new Error('LocalBackend: deleteWebhook not yet implemented');
  }
  async testWebhook(_id: string): Promise<import('../core/backend.js').WebhookTestResult> {
    throw new Error('LocalBackend: testWebhook not yet implemented');
  }
  async createSignedUrl(_params: import('../core/backend.js').CreateSignedUrlParams): Promise<import('../core/backend.js').SignedUrl> {
    throw new Error('LocalBackend: createSignedUrl not yet implemented');
  }
  async verifySignedUrl(_token: string): Promise<{ documentId: string; permission: 'read' | 'write' } | null> {
    throw new Error('LocalBackend: verifySignedUrl not yet implemented');
  }
  async getDocumentAccess(_documentId: string): Promise<import('../core/backend.js').AccessControlList> {
    throw new Error('LocalBackend: getDocumentAccess not yet implemented');
  }
  async grantDocumentAccess(_documentId: string, _params: import('../core/backend.js').GrantAccessParams): Promise<void> {
    throw new Error('LocalBackend: grantDocumentAccess not yet implemented');
  }
  async revokeDocumentAccess(_documentId: string, _userId: string): Promise<boolean> {
    throw new Error('LocalBackend: revokeDocumentAccess not yet implemented');
  }
  async setDocumentVisibility(_documentId: string, _visibility: import('../core/backend.js').DocumentVisibility): Promise<void> {
    throw new Error('LocalBackend: setDocumentVisibility not yet implemented');
  }
  async createOrganization(_params: import('../core/backend.js').CreateOrgParams): Promise<import('../core/backend.js').Organization> {
    throw new Error('LocalBackend: createOrganization not yet implemented');
  }
  async getOrganization(_slug: string): Promise<import('../core/backend.js').Organization | null> {
    throw new Error('LocalBackend: getOrganization not yet implemented');
  }
  async listOrganizations(_userId: string): Promise<import('../core/backend.js').Organization[]> {
    throw new Error('LocalBackend: listOrganizations not yet implemented');
  }
  async addOrgMember(_orgSlug: string, _userId: string, _role?: string): Promise<void> {
    throw new Error('LocalBackend: addOrgMember not yet implemented');
  }
  async removeOrgMember(_orgSlug: string, _userId: string): Promise<boolean> {
    throw new Error('LocalBackend: removeOrgMember not yet implemented');
  }
  async createApiKey(_params: import('../core/backend.js').CreateApiKeyParams): Promise<import('../core/backend.js').ApiKeyWithSecret> {
    throw new Error('LocalBackend: createApiKey not yet implemented');
  }
  async listApiKeys(_userId: string): Promise<import('../core/backend.js').ApiKey[]> {
    throw new Error('LocalBackend: listApiKeys not yet implemented');
  }
  async deleteApiKey(_id: string, _userId: string): Promise<boolean> {
    throw new Error('LocalBackend: deleteApiKey not yet implemented');
  }
  async rotateApiKey(_id: string, _userId: string): Promise<import('../core/backend.js').ApiKeyWithSecret> {
    throw new Error('LocalBackend: rotateApiKey not yet implemented');
  }

  // ── CrSqlite sync ops (T404, T405) ───────────────────────────

  /**
   * Returns all changes made to this database since `dbVersion`.
   *
   * Wraps: SELECT * FROM crsql_changes WHERE db_version > ?
   *
   * The changeset is serialized as a compact binary format:
   *   [4-byte row count LE] [per-row entries...]
   *
   * Each row entry:
   *   [1-byte col count] [table name: 1-byte len + bytes]
   *   [col values: per column — 1-byte type tag + payload]
   *
   * Type tags: 0=null, 1=integer (8-byte LE), 2=real (8-byte IEEE 754),
   *            3=text (4-byte len LE + UTF-8 bytes), 4=blob (4-byte len LE + bytes)
   *
   * DR-P2-03: Binary wire format to minimize size. Callers needing HTTP
   * transport MUST base64-encode the returned Uint8Array.
   *
   * dbVersion=0 returns the full history.
   * Returns empty Uint8Array (not null) when no changes exist.
   *
   * @throws CrSqliteNotLoadedError when hasCRR is false.
   */
  async getChangesSince(dbVersion: bigint): Promise<Uint8Array> {
    this._assertOpen();
    if (!this.hasCRR) {
      const { CrSqliteNotLoadedError } = await import('../crsqlite-loader.js');
      throw new CrSqliteNotLoadedError();
    }

    // better-sqlite3 is synchronous; wrap in resolved Promise at boundary only.
    const rows = this.rawDb
      .prepare('SELECT * FROM crsql_changes WHERE db_version > ?')
      .all(dbVersion.toString()) as CrSqliteChangeRow[];

    return serializeChangeset(rows);
  }

  /**
   * Applies a changeset received from a peer.
   *
   * Steps (all in a single better-sqlite3 transaction — synchronous):
   *  1. Deserialize the changeset from Uint8Array wire format.
   *  2. INSERT each row into crsql_changes (cr-sqlite applies LWW for all
   *     relational columns).
   *  3. Post-process rows where the table is `section_crdt_states` and the
   *     column is `crdt_state`: fetch local blob, merge via crdt_merge_updates,
   *     write merged result back. (DR-P2-04 MANDATORY — not LWW.)
   *  4. Recompute documents.version_count for any document_id seen in the
   *     changeset (spec §6 of P2-crr-column-strategy.md).
   *  5. Return SELECT crsql_db_version() as bigint.
   *
   * Idempotent: cr-sqlite guarantees idempotency for relational columns; the
   * Loro merge is also idempotent (CRDT property).
   *
   * Invalid crdt_state blob in the changeset: logs a warning and retains the
   * local blob rather than corrupting the transaction.
   *
   * @throws CrSqliteNotLoadedError when hasCRR is false.
   * @returns New local db_version after applying.
   */
  async applyChanges(changeset: Uint8Array): Promise<bigint> {
    this._assertOpen();
    if (!this.hasCRR) {
      const { CrSqliteNotLoadedError } = await import('../crsqlite-loader.js');
      throw new CrSqliteNotLoadedError();
    }

    const rows = deserializeChangeset(changeset);
    if (rows.length === 0) {
      // Nothing to apply — return current db_version.
      const versionRow = this.rawDb
        .prepare('SELECT crsql_db_version() AS v')
        .get() as { v: number };
      return BigInt(versionRow.v);
    }

    // Collect document IDs that appear in the changeset so we can recompute
    // version_count (spec §6 of P2-crr-column-strategy.md).
    const affectedDocIds = new Set<string>();

    // Track section_crdt_states rows needing Loro merge (DR-P2-04).
    // Structure: { documentId, sectionId, incomingBlob }
    const crdtStateUpdates: Array<{
      documentId: string;
      sectionId: string;
      incomingBlob: Buffer;
    }> = [];

    // Identify crdt_state rows before applying (pre-scan the incoming changeset).
    for (const row of rows) {
      if (row.tableName === 'documents' && row.pk !== null) {
        // pk is the document id for the documents table.
        const docId = typeof row.pk === 'string' ? row.pk : String(row.pk);
        affectedDocIds.add(docId);
      }
      if (row.tableName === 'versions' && row.documentId !== null) {
        const docId = typeof row.documentId === 'string'
          ? row.documentId
          : String(row.documentId);
        affectedDocIds.add(docId);
      }
      if (row.tableName === 'section_crdt_states' && row.crdtStateBlob !== null) {
        // DR-P2-04: this column MUST use Loro merge — capture incoming blob.
        const incoming = row.crdtStateBlob instanceof Buffer
          ? row.crdtStateBlob
          : Buffer.from(row.crdtStateBlob as Uint8Array);
        crdtStateUpdates.push({
          documentId: String(row.documentId ?? row.pk ?? ''),
          sectionId: String(row.sectionId ?? ''),
          incomingBlob: incoming,
        });
      }
    }

    // Execute everything in a single synchronous transaction.
    const applyTx = this.rawDb.transaction(() => {
      // Step 2: Insert rows into crsql_changes.
      const insertStmt = this.rawDb.prepare(
        'INSERT INTO crsql_changes ' +
        '("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq") ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const row of rows) {
        insertStmt.run(
          row.tableName,
          row.pk,
          row.cid,
          row.val,
          row.colVersion,
          row.dbVersion,
          row.siteId,
          row.cl,
          row.seq,
        );
      }

      // Step 3: DR-P2-04 — Loro merge for section_crdt_states.crdt_state.
      if (crdtStateUpdates.length > 0) {
        // Lazy import of crdt_merge_updates (sync function, no await needed).
        // We require the module synchronously since better-sqlite3 transactions
        // MUST NOT be async. The module is pre-loaded by the time we reach here
        // because crdt-primitives is a plain CJS-compatible module.
        let mergeFn: ((updates: Buffer[]) => Buffer) | null = null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const crdtPrimitives = require('../crdt-primitives.js') as typeof import('../crdt-primitives.js');
          mergeFn = crdtPrimitives.crdt_merge_updates;
        } catch {
          // WASM not available — fallback: keep local blob (safe, no corruption).
          console.warn(
            '[LocalBackend] applyChanges: crdt-primitives WASM unavailable — ' +
            'crdt_state Loro merge skipped; local blob retained (no corruption).'
          );
        }

        if (mergeFn !== null) {
          const fetchLocalStmt = this.rawDb.prepare(
            'SELECT crdt_state FROM section_crdt_states ' +
            'WHERE document_id = ? AND section_id = ?'
          );
          const writeBackStmt = this.rawDb.prepare(
            'UPDATE section_crdt_states SET crdt_state = ? ' +
            'WHERE document_id = ? AND section_id = ?'
          );

          for (const update of crdtStateUpdates) {
            const localRow = fetchLocalStmt.get(
              update.documentId,
              update.sectionId
            ) as { crdt_state: Buffer | null } | undefined;

            const localBlob: Buffer | null = localRow?.crdt_state ?? null;

            if (localBlob === null || localBlob.length === 0) {
              // No local state — incoming blob wins (no merge needed).
              writeBackStmt.run(update.incomingBlob, update.documentId, update.sectionId);
              continue;
            }

            let mergedBlob: Buffer;
            try {
              mergedBlob = mergeFn([localBlob, update.incomingBlob]);
            } catch (err) {
              // Invalid incoming blob — log warning and keep local blob.
              // Per T405 acceptance criterion: "logs a warning and reverts only
              // the blob column to local state (does not corrupt entire transaction)."
              console.warn(
                '[LocalBackend] applyChanges: Loro merge failed for ' +
                `section_crdt_states(${update.documentId}, ${update.sectionId}) — ` +
                `retaining local blob. Error: ${(err as Error).message}`
              );
              writeBackStmt.run(localBlob, update.documentId, update.sectionId);
              continue;
            }

            writeBackStmt.run(mergedBlob, update.documentId, update.sectionId);
          }
        }
      }

      // Step 4: Recompute version_count for affected document IDs.
      if (affectedDocIds.size > 0) {
        const recomputeStmt = this.rawDb.prepare(
          'UPDATE documents SET version_count = ' +
          '(SELECT COUNT(*) FROM versions WHERE document_id = documents.id) ' +
          'WHERE id = ?'
        );
        for (const docId of affectedDocIds) {
          recomputeStmt.run(docId);
        }
      }

      // Step 5: Return new db_version.
      const versionRow = this.rawDb
        .prepare('SELECT crsql_db_version() AS v')
        .get() as { v: number };
      return BigInt(versionRow.v);
    });

    return applyTx() as bigint;
  }

  // ── BlobOps ───────────────────────────────────────────────────

  async attachBlob(params: AttachBlobParams): Promise<BlobAttachment> {
    this._assertOpen();
    return Promise.resolve(this.blobAdapter.attachBlob(params));
  }

  async getBlob(
    docSlug: string,
    blobName: string,
    opts?: { includeData?: boolean }
  ): Promise<BlobData | null> {
    this._assertOpen();
    return Promise.resolve(this.blobAdapter.getBlob(docSlug, blobName, opts));
  }

  async listBlobs(docSlug: string): Promise<BlobAttachment[]> {
    this._assertOpen();
    return Promise.resolve(this.blobAdapter.listBlobs(docSlug));
  }

  async detachBlob(docSlug: string, blobName: string, detachedBy: string): Promise<boolean> {
    this._assertOpen();
    return Promise.resolve(this.blobAdapter.detachBlob(docSlug, blobName, detachedBy));
  }

  async fetchBlobByHash(hash: string): Promise<Buffer | null> {
    this._assertOpen();
    return Promise.resolve(this.blobAdapter.fetchBlobByHash(hash));
  }

  // ── ExportOps (T427.6) ────────────────────────────────────────

  /**
   * Export a single document to a file on disk.
   *
   * Content retrieval strategy (spec §11 — LocalBackend):
   *  1. Call listVersions(doc.id) to get all version entries (ascending).
   *  2. Take the last entry (highest versionNumber = latest).
   *  3. Check if storageType=filesystem → read from blobs/<contentHash>.
   *  4. Otherwise read inline from the compressedData column (raw UTF-8 bytes).
   *
   * @throws {ExportError} DOC_NOT_FOUND when the slug does not exist.
   * @throws {ExportError} VERSION_NOT_FOUND when the document has no versions.
   * @throws {ExportError} WRITE_FAILED on I/O error.
   */
  async exportDocument(params: ExportDocumentParams): Promise<ExportDocumentResult> {
    this._assertOpen();

    const { slug, format } = params;

    // 1. Resolve slug → document.
    const doc = await this.getDocumentBySlug(slug);
    if (!doc) {
      throw new ExportError('DOC_NOT_FOUND', `Document not found: ${slug}`);
    }

    // 2. Get latest version.
    const versionRows = this.db
      .select()
      .from(versions)
      .where(eq(versions.documentId, doc.id))
      .orderBy(asc(versions.versionNumber))
      .all();

    if (versionRows.length === 0) {
      throw new ExportError('VERSION_NOT_FOUND', `Document ${slug} has no versions`);
    }

    const latestRow = versionRows[versionRows.length - 1]!;

    // 3. Retrieve content.
    let content: string;
    if (latestRow.storageType === 'filesystem' && latestRow.storageKey) {
      // Large content stored as raw UTF-8 on disk (no compression in LocalBackend).
      const blobPath = path.join(this.config.storagePath!, 'blobs', latestRow.storageKey);
      const blobBytes = fs.readFileSync(blobPath);
      content = blobBytes.toString('utf8');
    } else if (latestRow.compressedData) {
      // Small content stored inline as raw UTF-8 bytes (LocalBackend stores uncompressed).
      const buf = latestRow.compressedData instanceof Buffer
        ? latestRow.compressedData
        : Buffer.from(latestRow.compressedData as ArrayBuffer);
      content = buf.toString('utf8');
    } else {
      throw new ExportError('VERSION_NOT_FOUND', `Version content missing for ${slug}`);
    }

    // 4. Build contributors list from version history.
    const contributors = [
      ...new Set(versionRows.map((r) => r.createdBy).filter((c): c is string => Boolean(c))),
    ];

    // 5. Compute content hash and exportedAt timestamp.
    const exportedAt = new Date().toISOString();
    const computedContentHash = contentHashHex(content);

    // 6. Build DocumentExportState.
    const state: DocumentExportState = {
      title: doc.title,
      slug: doc.slug,
      version: latestRow.versionNumber,
      state: doc.state,
      contributors,
      contentHash: computedContentHash,
      exportedAt,
      content,
      labels: doc.labels ?? null,
      createdBy: doc.createdBy ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      versionCount: doc.versionCount,
      chainRef: null, // T384 stub: BFT chain not yet integrated in LocalBackend
    };

    // 7. Write and return.
    return writeExportFile(state, params, this.config.identityPath);
  }

  /**
   * Export all documents to a directory.
   *
   * Iterates via listDocuments (cursor-based pagination).
   * Individual document failures are collected in skipped, not thrown.
   */
  async exportAll(params: ExportAllParams): Promise<ExportAllResult> {
    this._assertOpen();

    const { format, outputDir, state: filterState, includeMetadata, sign } = params;

    const exported: ExportDocumentResult[] = [];
    const skipped: Array<{ slug: string; reason: string }> = [];
    let cursor: string | undefined = undefined;

    // Paginate through all documents.
    for (;;) {
      const page = await this.listDocuments({
        cursor,
        limit: 50,
        state: filterState as import('../sdk/lifecycle.js').DocumentState | undefined,
      });

      for (const doc of page.items) {
        const outputPath = exportAllFilePath(outputDir, doc.slug, format);
        try {
          const result = await this.exportDocument({
            slug: doc.slug,
            format,
            outputPath,
            includeMetadata,
            sign,
          });
          exported.push(result);
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          skipped.push({ slug: doc.slug, reason });
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
   * Import a document from a file on disk.
   *
   * Parsing strategy:
   *  - .md / .llmtxt: parse YAML frontmatter; body follows closing fence.
   *  - .json: parse JSON; use 'content' field as body.
   *  - .txt: entire file is body; slug derived from filename stem.
   *
   * Conflict strategy:
   *  - 'create': throw ExportError('SLUG_EXISTS') if slug is already in use.
   *  - 'new_version' (default): append a new version to the existing document.
   *
   * @throws {ExportError} PARSE_FAILED on I/O or parse errors.
   * @throws {ExportError} HASH_MISMATCH when frontmatter content_hash mismatches.
   * @throws {ExportError} SLUG_EXISTS when onConflict='create' and slug exists.
   */
  async importDocument(params: ImportDocumentParams): Promise<ImportDocumentResult> {
    this._assertOpen();

    const { filePath, importedBy, onConflict = 'new_version' } = params;

    // 1. Parse the file — throws PARSE_FAILED or HASH_MISMATCH on error.
    const parsed = parseImportFile(filePath);
    const { slug, title, content } = parsed;

    // 2. Check for an existing document with the same slug.
    const existing = await this.getDocumentBySlug(slug);

    if (existing !== null) {
      if (onConflict === 'create') {
        throw new ExportError(
          'SLUG_EXISTS',
          `A document with slug "${slug}" already exists. Use onConflict='new_version' to append.`,
        );
      }

      // onConflict = 'new_version': publish a new version on the existing document.
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

    // 3. No existing document — create a new one with the imported slug/title.
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
}

// ── CrSqlite changeset wire format (T404/T405) ────────────────
//
// Binary encoding for the cr-sqlite changeset. Keeps the changeset compact
// while remaining fully self-describing. All integers are little-endian.
//
// Wire format (T404 getChangesSince output / T405 applyChanges input):
//   Header:  4 bytes — row count (uint32 LE)
//   Per row: see encodeChangeRow / decodeChangeRow below.
//
// Column value type tags (1 byte):
//   0 = null
//   1 = integer (8 bytes signed LE)
//   2 = real    (8 bytes IEEE 754 double LE)
//   3 = text    (4 bytes len LE) + UTF-8 bytes
//   4 = blob    (4 bytes len LE) + raw bytes

/** Raw row from `SELECT * FROM crsql_changes`. */
interface CrSqliteChangeRow {
  /** crsql_changes column: "table" */
  tableName: string;
  /** crsql_changes column: pk */
  pk: string | number | Buffer | null;
  /** crsql_changes column: cid (column id) */
  cid: string;
  /** crsql_changes column: val */
  val: string | number | Buffer | null;
  /** crsql_changes column: col_version */
  colVersion: number;
  /** crsql_changes column: db_version */
  dbVersion: number;
  /** crsql_changes column: site_id */
  siteId: Buffer | null;
  /** crsql_changes column: cl (causal length) */
  cl: number;
  /** crsql_changes column: seq */
  seq: number;

  // Derived helpers populated by deserializeChangeset (not from raw row):
  documentId?: string | null;
  sectionId?: string | null;
  crdtStateBlob?: Buffer | null;
}

type CrSqliteValue = string | number | Buffer | null;

function encodeValue(buf: Buffer[], v: CrSqliteValue): void {
  if (v === null || v === undefined) {
    buf.push(Buffer.from([0]));
    return;
  }
  if (typeof v === 'number') {
    const tag = Number.isInteger(v) ? Buffer.from([1]) : Buffer.from([2]);
    const b = Buffer.allocUnsafe(8);
    if (Number.isInteger(v)) {
      b.writeBigInt64LE(BigInt(v));
    } else {
      b.writeDoubleBE(v); // Note: using writeDoubleBE for cross-arch portability
    }
    buf.push(tag, b);
    return;
  }
  if (typeof v === 'string') {
    const text = Buffer.from(v, 'utf8');
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32LE(text.length);
    buf.push(Buffer.from([3]), lenBuf, text);
    return;
  }
  // blob (Buffer / Uint8Array)
  const blobBuf = v instanceof Buffer ? v : Buffer.from(v as Uint8Array);
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32LE(blobBuf.length);
  buf.push(Buffer.from([4]), lenBuf, blobBuf);
}

function decodeValue(data: Buffer, offset: number): { value: CrSqliteValue; next: number } {
  const tag = data[offset]!;
  offset += 1;
  if (tag === 0) return { value: null, next: offset };
  if (tag === 1) {
    const n = data.readBigInt64LE(offset);
    // Safe cast: cr-sqlite version/seq numbers fit in Number range.
    return { value: Number(n), next: offset + 8 };
  }
  if (tag === 2) {
    const f = data.readDoubleBE(offset);
    return { value: f, next: offset + 8 };
  }
  if (tag === 3) {
    const len = data.readUInt32LE(offset);
    offset += 4;
    const str = data.slice(offset, offset + len).toString('utf8');
    return { value: str, next: offset + len };
  }
  if (tag === 4) {
    const len = data.readUInt32LE(offset);
    offset += 4;
    const blob = Buffer.from(data.slice(offset, offset + len));
    return { value: blob, next: offset + len };
  }
  throw new Error(`[CrSqlite] Unknown value tag: ${tag}`);
}

/** Fixed-order column list matching SELECT * FROM crsql_changes column order. */
const CRSQL_COLS = ['tableName', 'pk', 'cid', 'val', 'colVersion', 'dbVersion', 'siteId', 'cl', 'seq'] as const;

function serializeChangeset(rows: CrSqliteChangeRow[]): Uint8Array {
  const parts: Buffer[] = [];

  const countBuf = Buffer.allocUnsafe(4);
  countBuf.writeUInt32LE(rows.length);
  parts.push(countBuf);

  for (const row of rows) {
    // Encode 9 fixed columns in order.
    encodeValue(parts, row.tableName);
    encodeValue(parts, row.pk);
    encodeValue(parts, row.cid);
    encodeValue(parts, row.val);
    encodeValue(parts, row.colVersion);
    encodeValue(parts, row.dbVersion);
    encodeValue(parts, row.siteId);
    encodeValue(parts, row.cl);
    encodeValue(parts, row.seq);
  }

  return Buffer.concat(parts);
}

function deserializeChangeset(data: Uint8Array): CrSqliteChangeRow[] {
  if (data.length === 0) return [];

  const buf = data instanceof Buffer ? data : Buffer.from(data);
  let offset = 0;

  const rowCount = buf.readUInt32LE(offset);
  offset += 4;

  const rows: CrSqliteChangeRow[] = [];

  for (let i = 0; i < rowCount; i++) {
    const values: CrSqliteValue[] = [];
    for (let c = 0; c < CRSQL_COLS.length; c++) {
      const result = decodeValue(buf, offset);
      values.push(result.value);
      offset = result.next;
    }

    const row: CrSqliteChangeRow = {
      tableName: values[0] as string,
      pk: values[1] as CrSqliteValue,
      cid: values[2] as string,
      val: values[3] as CrSqliteValue,
      colVersion: values[4] as number,
      dbVersion: values[5] as number,
      siteId: values[6] as Buffer | null,
      cl: values[7] as number,
      seq: values[8] as number,
    };

    // Populate derived helpers for DR-P2-04 detection.
    // cid identifies the column name in the row; val is the column value.
    if (row.tableName === 'section_crdt_states' && row.cid === 'crdt_state') {
      row.crdtStateBlob = row.val instanceof Buffer
        ? row.val
        : (row.val !== null && row.val !== undefined ? Buffer.from(String(row.val)) : null);
      // pk for section_crdt_states is composite JSON: {"document_id":"...","section_id":"..."}
      if (typeof row.pk === 'string') {
        try {
          const parsed = JSON.parse(row.pk) as Record<string, string>;
          row.documentId = parsed.document_id ?? null;
          row.sectionId = parsed.section_id ?? null;
        } catch {
          // Fallback: treat pk as document_id
          row.documentId = row.pk;
          row.sectionId = null;
        }
      }
    }

    if (row.tableName === 'versions' && row.cid === 'document_id') {
      row.documentId = typeof row.val === 'string' ? row.val : null;
    }

    rows.push(row);
  }

  return rows;
}

// ── Utility ───────────────────────────────────────────────────

/** Brute-force cosine similarity between two Float32Arrays. */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
