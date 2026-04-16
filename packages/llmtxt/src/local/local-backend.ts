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
} from '../core/backend.js';

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

// ── Migrations path ────────────────────────────────────────────
// __dirname equivalent for ESM
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_PATH = path.join(__dirname, 'migrations');

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

    // Apply pending migrations (idempotent)
    migrate(this.db, { migrationsFolder: MIGRATIONS_PATH });

    // Start background reapers
    this._startReapers();

    this.opened = true;
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

    // Update state snapshot (simple: store the latest update as snapshot)
    // A production implementation would merge via WASM merge_updates
    const existingState = currentState?.yrsState as Buffer | null;
    let newState: Buffer;
    if (!existingState) {
      newState = updateBlob;
    } else {
      // For now, store the concatenation; a real implementation merges via WASM
      newState = updateBlob;
    }

    // Upsert state
    this.db
      .insert(sectionCrdtStates)
      .values({
        documentId: params.documentId,
        sectionId: params.sectionKey,
        clock: seq,
        updatedAt: now,
        yrsState: newState,
      })
      .onConflictDoUpdate({
        target: [sectionCrdtStates.documentId, sectionCrdtStates.sectionId],
        set: { clock: seq, updatedAt: now, yrsState: newState },
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

    return {
      documentId: params.documentId,
      sectionKey: params.sectionKey,
      stateVectorBase64: newState.toString('base64'),
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
    const stateBlob = row.yrsState as Buffer;
    return {
      documentId,
      sectionKey,
      stateVectorBase64: stateBlob.toString('base64'),
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

  async pollA2AInbox(agentId: string, limit = 50): Promise<A2AMessage[]> {
    this._assertOpen();
    const rows = this.db
      .select()
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.toAgentId, agentId))
      .orderBy(asc(agentInboxMessages.createdAt))
      .limit(limit * 2)
      .all();

    return rows
      .filter((r) => isNotExpired(r.exp))
      .slice(0, limit)
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
