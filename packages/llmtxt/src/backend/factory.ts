/**
 * createBackend — topology-aware Backend factory (T439).
 *
 * Dispatches to the appropriate Backend implementation based on the
 * topology field in the supplied {@link TopologyConfig}:
 *
 *   - `standalone`  → {@link LocalBackend}  (embedded SQLite, zero network)
 *   - `hub-spoke`   → {@link RemoteBackend} (ephemeral) or {@link HubSpokeBackend} (persistLocally=true)
 *   - `mesh`        → {@link MeshBackend}   stub (delegates to LocalBackend; T386 fills real sync engine)
 *
 * All validation from ARCH-T429 §3.3 is enforced via
 * {@link validateTopologyConfig} before any backend is constructed.
 *
 * @module backend/factory
 *
 * @example Standalone
 * ```ts
 * import { createBackend } from 'llmtxt';
 * const backend = await createBackend({ topology: 'standalone' });
 * await backend.open();
 * ```
 *
 * @example Hub-spoke ephemeral
 * ```ts
 * const backend = await createBackend({
 *   topology: 'hub-spoke',
 *   hubUrl: 'https://api.llmtxt.my',
 *   apiKey: process.env.LLMTXT_API_KEY,
 * });
 * await backend.open();
 * ```
 *
 * @example Hub-spoke persistent spoke
 * ```ts
 * const backend = await createBackend({
 *   topology: 'hub-spoke',
 *   hubUrl: 'https://api.llmtxt.my',
 *   apiKey: process.env.LLMTXT_API_KEY,
 *   persistLocally: true,
 *   storagePath: '/var/agent/local.db',
 * });
 * await backend.open();
 * ```
 *
 * @example Mesh (stub — T386 required for real sync)
 * ```ts
 * const backend = await createBackend({
 *   topology: 'mesh',
 *   storagePath: '/var/agent/mesh.db',
 * });
 * await backend.open(); // emits 'mesh:sync-engine-not-started' warning
 * ```
 */

// Type-only imports so that `import 'llmtxt'` does NOT trigger better-sqlite3
// / drizzle-orm / postgres module resolution at load time. Actual class
// construction happens inside createBackend() via dynamic import.
//
// Rationale: consumers like CLEO call `await import('llmtxt')` to reach a
// single utility (generateOverview). Before this patch a top-level
// `import { LocalBackend }` forced Node to resolve the entire LocalBackend
// dependency chain (better-sqlite3 native addon, drizzle-orm, etc.) even
// when createBackend was never called. Since v2026.4.7 moved those deps
// from optionalDependencies to peer-optional, lightweight consumers hit
// ERR_MODULE_NOT_FOUND on the import itself. Deferring to runtime removes
// the coupling.
import type { LocalBackend } from '../local/index.js';
import type { RemoteBackend } from '../remote/index.js';
import type { Backend, BackendConfig } from '../core/backend.js';
import { validateTopologyConfig, TopologyConfigError } from '../topology.js';
import type {
  TopologyConfig,
  HubSpokeConfig,
  MeshConfig,
} from '../topology.js';

// Re-export error types so callers can import them from one place
export { TopologyConfigError } from '../topology.js';

// ── MeshNotImplementedError ─────────────────────────────────────────────────

/**
 * Thrown when a mesh-specific sync method is called on {@link MeshBackend}
 * before the T386 P2P sync engine has been installed.
 *
 * The MeshBackend stub delegates all standard Backend interface methods to its
 * internal LocalBackend. Only the T386-specific mesh methods (peer negotiation,
 * changeset exchange, etc.) throw this error, so agents that do not call those
 * methods can use MeshBackend today without blocking on T386.
 *
 * To resolve: implement T386 (P2P Mesh Sync Engine) and replace the stub with
 * the real MeshBackend from packages/llmtxt/src/mesh/.
 */
export class MeshNotImplementedError extends Error {
  readonly code = 'MESH_NOT_IMPLEMENTED';

  constructor(method: string) {
    super(
      `MeshBackend.${method}() is not yet implemented. ` +
        'The P2P mesh sync engine ships in T386. ' +
        'Use topology: "standalone" for local-only operation or ' +
        'topology: "hub-spoke" for multi-agent coordination until T386 is available.',
    );
    this.name = 'MeshNotImplementedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── HubUnreachableError ────────────────────────────────────────────────────

/**
 * Thrown when a hub-and-spoke spoke cannot reach the hub for a write operation.
 *
 * Ephemeral spokes MUST fail fast with this error — writes are never silently
 * dropped (ARCH-T429 §7.1). The `cause` property holds the underlying network
 * error for diagnostics.
 */
export class HubUnreachableError extends Error {
  readonly code = 'HUB_UNREACHABLE';
  readonly cause: unknown;

  constructor(operation: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(
      `HubUnreachableError: hub is unreachable during "${operation}". ` +
        `Writes must not be silently dropped. Cause: ${causeMsg}. ` +
        'Check network connectivity and hub URL. (ARCH-T429 §7.1)',
    );
    this.name = 'HubUnreachableError';
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── HubWriteQueueFullError ─────────────────────────────────────────────────

/**
 * Thrown when a persistent spoke's write queue exceeds the 1000-entry limit
 * (ARCH-T429 §7.1). The 1001st write while the hub is unreachable must be
 * rejected with this error rather than silently dropped or discarded.
 */
export class HubWriteQueueFullError extends Error {
  readonly code = 'HUB_WRITE_QUEUE_FULL';
  readonly queueSize: number;

  constructor(queueSize: number) {
    super(
      `HubWriteQueueFullError: persistent spoke write queue is full (${queueSize} entries). ` +
        'Maximum queue size is 1000 entries (ARCH-T429 §7.1). ' +
        'Resolve hub connectivity before issuing more writes.',
    );
    this.name = 'HubWriteQueueFullError';
    this.queueSize = queueSize;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── HubSpokeBackend ─────────────────────────────────────────────────────────

/**
 * Composite Backend for hub-and-spoke topology with `persistLocally=true`.
 *
 * Routing semantics (ARCH-T429 §5.2 persistent spoke):
 * - Reads (documents, versions, events, CRDT sections, presence) → LocalBackend (replica).
 * - Writes (createDocument, publishVersion, A2A, scratchpad, leases) → RemoteBackend (hub).
 * - CRDT applyCrdtUpdate → RemoteBackend (hub is authoritative); local replica is updated
 *   on next background sync.
 * - Signed URLs, webhooks, org/API-key ops → RemoteBackend (hub-owned resources).
 *
 * TODO(T449): Implement write-queue persistence in local SQLite (`hub_write_queue` table)
 * so queued writes survive agent restart. Current behaviour: writes fail fast when the
 * hub is unreachable, matching ephemeral-spoke semantics. Track in T449.
 *
 * TODO(T449): Implement background sync loop (poll hub for new events and replicate to
 * local replica). Current behaviour: local replica is only updated when hub writes
 * are acknowledged inline.
 */
export class HubSpokeBackend implements Backend {
  readonly config: BackendConfig;

  private readonly local: LocalBackend;
  private readonly remote: RemoteBackend;

  constructor(options: { local: LocalBackend; remote: RemoteBackend; config: BackendConfig }) {
    this.local = options.local;
    this.remote = options.remote;
    this.config = options.config;
  }

  /**
   * Wrap a hub write operation so network failures surface as HubUnreachableError
   * rather than raw fetch errors. This ensures writes are never silently dropped
   * (ARCH-T429 §7.1).
   */
  private async _hubWrite<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      // Re-wrap as HubUnreachableError so callers get a typed signal
      throw new HubUnreachableError(operation, err);
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async open(): Promise<void> {
    // Open local replica first (applies SQLite migrations), then verify hub reachability
    await this.local.open();
    await this.remote.open();
  }

  async close(): Promise<void> {
    await this.remote.close();
    await this.local.close();
  }

  // ── DocumentOps — reads from local replica, writes to hub ────

  async createDocument(params: Parameters<Backend['createDocument']>[0]) {
    return this._hubWrite('createDocument', () => this.remote.createDocument(params));
  }

  async getDocument(id: string) {
    return this.local.getDocument(id);
  }

  async getDocumentBySlug(slug: string) {
    return this.local.getDocumentBySlug(slug);
  }

  async listDocuments(params?: Parameters<Backend['listDocuments']>[0]) {
    return this.local.listDocuments(params);
  }

  async deleteDocument(id: string) {
    return this._hubWrite('deleteDocument', () => this.remote.deleteDocument(id));
  }

  // ── VersionOps — reads from local, writes to hub ─────────────

  async publishVersion(params: Parameters<Backend['publishVersion']>[0]) {
    return this._hubWrite('publishVersion', () => this.remote.publishVersion(params));
  }

  async getVersion(documentId: string, versionNumber: number) {
    return this.local.getVersion(documentId, versionNumber);
  }

  async listVersions(documentId: string) {
    return this.local.listVersions(documentId);
  }

  async transitionVersion(params: Parameters<Backend['transitionVersion']>[0]) {
    return this._hubWrite('transitionVersion', () => this.remote.transitionVersion(params));
  }

  // ── ApprovalOps — hub is authoritative ──────────────────────

  async submitSignedApproval(params: Parameters<Backend['submitSignedApproval']>[0]) {
    return this._hubWrite('submitSignedApproval', () => this.remote.submitSignedApproval(params));
  }

  async getApprovalProgress(documentId: string, versionNumber: number) {
    return this._hubWrite('getApprovalProgress', () => this.remote.getApprovalProgress(documentId, versionNumber));
  }

  async getApprovalPolicy(documentId: string) {
    return this._hubWrite('getApprovalPolicy', () => this.remote.getApprovalPolicy(documentId));
  }

  async setApprovalPolicy(documentId: string, policy: Parameters<Backend['setApprovalPolicy']>[1]) {
    return this._hubWrite('setApprovalPolicy', () => this.remote.setApprovalPolicy(documentId, policy));
  }

  // ── ContributorOps ────────────────────────────────────────────

  async listContributors(documentId: string) {
    return this.local.listContributors(documentId);
  }

  // ── BftOps ────────────────────────────────────────────────────

  async getApprovalChain(documentId: string) {
    return this.remote.getApprovalChain(documentId);
  }

  // ── EventOps — reads from local, writes to hub ───────────────

  async appendEvent(params: Parameters<Backend['appendEvent']>[0]) {
    return this._hubWrite('appendEvent', () => this.remote.appendEvent(params));
  }

  async queryEvents(params: Parameters<Backend['queryEvents']>[0]) {
    return this.local.queryEvents(params);
  }

  subscribeStream(documentId: string) {
    // Local in-process EventEmitter for low-latency subscription
    return this.local.subscribeStream(documentId);
  }

  // ── CrdtOps — hub is authoritative; local replica lags ───────

  async applyCrdtUpdate(params: Parameters<Backend['applyCrdtUpdate']>[0]) {
    // Hub applies the update; local replica will catch up on next sync
    return this._hubWrite('applyCrdtUpdate', () => this.remote.applyCrdtUpdate(params));
  }

  async getCrdtState(documentId: string, sectionKey: string) {
    return this.local.getCrdtState(documentId, sectionKey);
  }

  subscribeSection(documentId: string, sectionKey: string) {
    return this.local.subscribeSection(documentId, sectionKey);
  }

  // ── LeaseOps — hub is authoritative (distributed lock) ───────

  async acquireLease(params: Parameters<Backend['acquireLease']>[0]) {
    return this._hubWrite('acquireLease', () => this.remote.acquireLease(params));
  }

  async renewLease(resource: string, holder: string, ttlMs: number) {
    return this._hubWrite('renewLease', () => this.remote.renewLease(resource, holder, ttlMs));
  }

  async releaseLease(resource: string, holder: string) {
    return this._hubWrite('releaseLease', () => this.remote.releaseLease(resource, holder));
  }

  async getLease(resource: string) {
    return this.remote.getLease(resource);
  }

  // ── PresenceOps — local in-process ───────────────────────────

  async joinPresence(documentId: string, agentId: string, meta?: Record<string, unknown>) {
    return this.local.joinPresence(documentId, agentId, meta);
  }

  async leavePresence(documentId: string, agentId: string) {
    return this.local.leavePresence(documentId, agentId);
  }

  async listPresence(documentId: string) {
    return this.local.listPresence(documentId);
  }

  async heartbeatPresence(documentId: string, agentId: string) {
    return this.local.heartbeatPresence(documentId, agentId);
  }

  // ── ScratchpadOps — hub ───────────────────────────────────────

  async sendScratchpad(params: Parameters<Backend['sendScratchpad']>[0]) {
    return this._hubWrite('sendScratchpad', () => this.remote.sendScratchpad(params));
  }

  async pollScratchpad(agentId: string, limit?: number) {
    return this._hubWrite('pollScratchpad', () => this.remote.pollScratchpad(agentId, limit));
  }

  async deleteScratchpadMessage(id: string, agentId: string) {
    return this._hubWrite('deleteScratchpadMessage', () => this.remote.deleteScratchpadMessage(id, agentId));
  }

  // ── A2AOps — hub ──────────────────────────────────────────────

  async sendA2AMessage(params: Parameters<Backend['sendA2AMessage']>[0]) {
    return this._hubWrite('sendA2AMessage', () => this.remote.sendA2AMessage(params));
  }

  async pollA2AInbox(agentId: string, limit?: number, since?: number, order?: 'asc' | 'desc') {
    return this._hubWrite('pollA2AInbox', () => this.remote.pollA2AInbox(agentId, limit, since, order));
  }

  async deleteA2AMessage(id: string, agentId: string) {
    return this._hubWrite('deleteA2AMessage', () => this.remote.deleteA2AMessage(id, agentId));
  }

  // ── SearchOps — local replica ─────────────────────────────────

  async indexDocument(documentId: string, content: string) {
    return this.local.indexDocument(documentId, content);
  }

  async search(params: Parameters<Backend['search']>[0]) {
    return this.local.search(params);
  }

  // ── IdentityOps — hub ─────────────────────────────────────────

  async registerAgentPubkey(agentId: string, pubkeyHex: string, label?: string) {
    return this.remote.registerAgentPubkey(agentId, pubkeyHex, label);
  }

  async lookupAgentPubkey(agentId: string) {
    return this.remote.lookupAgentPubkey(agentId);
  }

  async listAgentPubkeys(userId?: string) {
    return this.remote.listAgentPubkeys(userId);
  }

  async revokeAgentPubkey(agentId: string, pubkeyHex: string) {
    return this.remote.revokeAgentPubkey(agentId, pubkeyHex);
  }

  async recordSignatureNonce(agentId: string, nonce: string, ttlMs?: number) {
    return this.remote.recordSignatureNonce(agentId, nonce, ttlMs);
  }

  async hasNonceBeenUsed(agentId: string, nonce: string) {
    return this.remote.hasNonceBeenUsed(agentId, nonce);
  }

  // ── CollectionOps — hub ───────────────────────────────────────

  async createCollection(params: Parameters<Backend['createCollection']>[0]) {
    return this.remote.createCollection(params);
  }

  async getCollection(slug: string) {
    return this.local.getCollection(slug);
  }

  async listCollections(params?: Parameters<Backend['listCollections']>[0]) {
    return this.local.listCollections(params);
  }

  async addDocToCollection(collectionSlug: string, documentSlug: string, position?: number) {
    return this.remote.addDocToCollection(collectionSlug, documentSlug, position);
  }

  async removeDocFromCollection(collectionSlug: string, documentSlug: string) {
    return this.remote.removeDocFromCollection(collectionSlug, documentSlug);
  }

  async reorderCollection(collectionSlug: string, orderedSlugs: string[]) {
    return this.remote.reorderCollection(collectionSlug, orderedSlugs);
  }

  async exportCollection(collectionSlug: string) {
    return this.remote.exportCollection(collectionSlug);
  }

  // ── CrossDocOps — hub ─────────────────────────────────────────

  async createDocumentLink(params: Parameters<Backend['createDocumentLink']>[0]) {
    return this.remote.createDocumentLink(params);
  }

  async getDocumentLinks(documentId: string) {
    return this.local.getDocumentLinks(documentId);
  }

  async deleteDocumentLink(documentId: string, linkId: string) {
    return this.remote.deleteDocumentLink(documentId, linkId);
  }

  async getGlobalGraph(params?: Parameters<Backend['getGlobalGraph']>[0]) {
    return this.local.getGlobalGraph(params);
  }

  // ── WebhookOps — hub ──────────────────────────────────────────

  async createWebhook(params: Parameters<Backend['createWebhook']>[0]) {
    return this.remote.createWebhook(params);
  }

  async listWebhooks(userId: string) {
    return this.remote.listWebhooks(userId);
  }

  async deleteWebhook(id: string, userId: string) {
    return this.remote.deleteWebhook(id, userId);
  }

  async testWebhook(id: string) {
    return this.remote.testWebhook(id);
  }

  // ── SignedUrlOps — hub ────────────────────────────────────────

  async createSignedUrl(params: Parameters<Backend['createSignedUrl']>[0]) {
    return this.remote.createSignedUrl(params);
  }

  async verifySignedUrl(token: string) {
    return this.remote.verifySignedUrl(token);
  }

  // ── AccessControlOps — hub ────────────────────────────────────

  async getDocumentAccess(documentId: string) {
    return this.remote.getDocumentAccess(documentId);
  }

  async grantDocumentAccess(documentId: string, params: Parameters<Backend['grantDocumentAccess']>[1]) {
    return this.remote.grantDocumentAccess(documentId, params);
  }

  async revokeDocumentAccess(documentId: string, userId: string) {
    return this.remote.revokeDocumentAccess(documentId, userId);
  }

  async setDocumentVisibility(documentId: string, visibility: Parameters<Backend['setDocumentVisibility']>[1]) {
    return this.remote.setDocumentVisibility(documentId, visibility);
  }

  // ── OrganizationOps — hub ─────────────────────────────────────

  async createOrganization(params: Parameters<Backend['createOrganization']>[0]) {
    return this.remote.createOrganization(params);
  }

  async getOrganization(slug: string) {
    return this.remote.getOrganization(slug);
  }

  async listOrganizations(userId: string) {
    return this.remote.listOrganizations(userId);
  }

  async addOrgMember(orgSlug: string, userId: string, role?: string) {
    return this.remote.addOrgMember(orgSlug, userId, role);
  }

  async removeOrgMember(orgSlug: string, userId: string) {
    return this.remote.removeOrgMember(orgSlug, userId);
  }

  // ── ApiKeyOps — hub ───────────────────────────────────────────

  async createApiKey(params: Parameters<Backend['createApiKey']>[0]) {
    return this.remote.createApiKey(params);
  }

  async listApiKeys(userId: string) {
    return this.remote.listApiKeys(userId);
  }

  async deleteApiKey(id: string, userId: string) {
    return this.remote.deleteApiKey(id, userId);
  }

  async rotateApiKey(id: string, userId: string) {
    return this.remote.rotateApiKey(id, userId);
  }

  // ── BlobOps — local (blobs are written locally in hub-spoke) ─────────────────

  async attachBlob(params: Parameters<Backend['attachBlob']>[0]) {
    return this.local.attachBlob(params);
  }

  async getBlob(docSlug: string, blobName: string, opts?: Parameters<Backend['getBlob']>[2]) {
    return this.local.getBlob(docSlug, blobName, opts);
  }

  async listBlobs(docSlug: string) {
    return this.local.listBlobs(docSlug);
  }

  async detachBlob(docSlug: string, blobName: string, detachedBy: string) {
    return this.local.detachBlob(docSlug, blobName, detachedBy);
  }

  async fetchBlobByHash(hash: string) {
    return this.local.fetchBlobByHash(hash);
  }

  // ── ExportOps (T427.6) — writes to local disk ─────────────────────────────────

  async exportDocument(params: Parameters<Backend['exportDocument']>[0]) {
    // Export fetches content from hub (remote has the authoritative content),
    // then writes to local disk. We delegate to local which fetches from its replica.
    return this.local.exportDocument(params);
  }

  async exportAll(params: Parameters<Backend['exportAll']>[0]) {
    return this.local.exportAll(params);
  }

  async importDocument(params: Parameters<Backend['importDocument']>[0]) {
    return this.local.importDocument(params);
  }

  // ── CrSqlite changeset sync (P2.6/P2.7) — delegates to LocalBackend ────────

  async getChangesSince(dbVersion: bigint): Promise<Uint8Array> {
    return this.local.getChangesSince(dbVersion);
  }

  async applyChanges(changeset: Uint8Array): Promise<bigint> {
    return this.local.applyChanges(changeset);
  }
}

// ── MeshBackend ─────────────────────────────────────────────────────────────

/**
 * Stub Backend for mesh topology.
 *
 * All standard {@link Backend} interface methods delegate to an internal
 * {@link LocalBackend}. This means a mesh-topology agent can do meaningful
 * local work (create docs, publish versions, etc.) today, before T386
 * (P2P Mesh Sync Engine) is installed.
 *
 * The P2P sync engine (peer discovery, cr-sqlite changeset exchange,
 * Ed25519 mutual handshake) is provided by T386. Until T386 ships, this
 * stub emits a warning on `open()` to signal that sync is not active.
 * T386-specific mesh methods that are not part of the Backend interface
 * throw {@link MeshNotImplementedError} with a clear follow-up pointer.
 *
 * @see ARCH-T429 §10 — Integration with T386 (P2P Mesh)
 * @see T386 — P2P Mesh Sync Engine (fills this stub)
 */
export class MeshBackend implements Backend {
  readonly config: BackendConfig;

  private readonly local: LocalBackend;
  private readonly meshConfig: MeshConfig;

  constructor(options: { local: LocalBackend; meshConfig: MeshConfig; config: BackendConfig }) {
    this.local = options.local;
    this.meshConfig = options.meshConfig;
    this.config = options.config;
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async open(): Promise<void> {
    await this.local.open();
    // Emit warning: sync engine not started yet (T386 pending)
    // Using process.emitWarning so it shows in node output without crashing.
    // T386 will replace this with the real peer discovery + sync loop.
    process.emitWarning(
      'MeshBackend: P2P sync engine is not started. ' +
        `Mesh peers configured: ${JSON.stringify(this.meshConfig.peers ?? [])}. ` +
        'Documents written locally will NOT sync to peers until T386 is installed. ' +
        'See: https://github.com/llmtxt/llmtxt/issues (T386)',
      { code: 'mesh:sync-engine-not-started' },
    );
  }

  async close(): Promise<void> {
    // T386 will add: stop sync engine, delete peer advertisement file, close peer connections
    await this.local.close();
  }

  // ── All Backend interface methods delegate to local ───────────

  async createDocument(params: Parameters<Backend['createDocument']>[0]) {
    return this.local.createDocument(params);
  }

  async getDocument(id: string) {
    return this.local.getDocument(id);
  }

  async getDocumentBySlug(slug: string) {
    return this.local.getDocumentBySlug(slug);
  }

  async listDocuments(params?: Parameters<Backend['listDocuments']>[0]) {
    return this.local.listDocuments(params);
  }

  async deleteDocument(id: string) {
    return this.local.deleteDocument(id);
  }

  async publishVersion(params: Parameters<Backend['publishVersion']>[0]) {
    return this.local.publishVersion(params);
  }

  async getVersion(documentId: string, versionNumber: number) {
    return this.local.getVersion(documentId, versionNumber);
  }

  async listVersions(documentId: string) {
    return this.local.listVersions(documentId);
  }

  async transitionVersion(params: Parameters<Backend['transitionVersion']>[0]) {
    return this.local.transitionVersion(params);
  }

  async submitSignedApproval(params: Parameters<Backend['submitSignedApproval']>[0]) {
    return this.local.submitSignedApproval(params);
  }

  async getApprovalProgress(documentId: string, versionNumber: number) {
    return this.local.getApprovalProgress(documentId, versionNumber);
  }

  async getApprovalPolicy(documentId: string) {
    return this.local.getApprovalPolicy(documentId);
  }

  async setApprovalPolicy(documentId: string, policy: Parameters<Backend['setApprovalPolicy']>[1]) {
    return this.local.setApprovalPolicy(documentId, policy);
  }

  async listContributors(documentId: string) {
    return this.local.listContributors(documentId);
  }

  async getApprovalChain(documentId: string) {
    return this.local.getApprovalChain(documentId);
  }

  async appendEvent(params: Parameters<Backend['appendEvent']>[0]) {
    return this.local.appendEvent(params);
  }

  async queryEvents(params: Parameters<Backend['queryEvents']>[0]) {
    return this.local.queryEvents(params);
  }

  subscribeStream(documentId: string) {
    return this.local.subscribeStream(documentId);
  }

  async applyCrdtUpdate(params: Parameters<Backend['applyCrdtUpdate']>[0]) {
    return this.local.applyCrdtUpdate(params);
  }

  async getCrdtState(documentId: string, sectionKey: string) {
    return this.local.getCrdtState(documentId, sectionKey);
  }

  subscribeSection(documentId: string, sectionKey: string) {
    return this.local.subscribeSection(documentId, sectionKey);
  }

  async acquireLease(params: Parameters<Backend['acquireLease']>[0]) {
    return this.local.acquireLease(params);
  }

  async renewLease(resource: string, holder: string, ttlMs: number) {
    return this.local.renewLease(resource, holder, ttlMs);
  }

  async releaseLease(resource: string, holder: string) {
    return this.local.releaseLease(resource, holder);
  }

  async getLease(resource: string) {
    return this.local.getLease(resource);
  }

  async joinPresence(documentId: string, agentId: string, meta?: Record<string, unknown>) {
    return this.local.joinPresence(documentId, agentId, meta);
  }

  async leavePresence(documentId: string, agentId: string) {
    return this.local.leavePresence(documentId, agentId);
  }

  async listPresence(documentId: string) {
    return this.local.listPresence(documentId);
  }

  async heartbeatPresence(documentId: string, agentId: string) {
    return this.local.heartbeatPresence(documentId, agentId);
  }

  async sendScratchpad(params: Parameters<Backend['sendScratchpad']>[0]) {
    return this.local.sendScratchpad(params);
  }

  async pollScratchpad(agentId: string, limit?: number) {
    return this.local.pollScratchpad(agentId, limit);
  }

  async deleteScratchpadMessage(id: string, agentId: string) {
    return this.local.deleteScratchpadMessage(id, agentId);
  }

  async sendA2AMessage(params: Parameters<Backend['sendA2AMessage']>[0]) {
    return this.local.sendA2AMessage(params);
  }

  async pollA2AInbox(agentId: string, limit?: number, since?: number, order?: 'asc' | 'desc') {
    return this.local.pollA2AInbox(agentId, limit, since, order);
  }

  async deleteA2AMessage(id: string, agentId: string) {
    return this.local.deleteA2AMessage(id, agentId);
  }

  async indexDocument(documentId: string, content: string) {
    return this.local.indexDocument(documentId, content);
  }

  async search(params: Parameters<Backend['search']>[0]) {
    return this.local.search(params);
  }

  async registerAgentPubkey(agentId: string, pubkeyHex: string, label?: string) {
    return this.local.registerAgentPubkey(agentId, pubkeyHex, label);
  }

  async lookupAgentPubkey(agentId: string) {
    return this.local.lookupAgentPubkey(agentId);
  }

  async listAgentPubkeys(userId?: string) {
    return this.local.listAgentPubkeys(userId);
  }

  async revokeAgentPubkey(agentId: string, pubkeyHex: string) {
    return this.local.revokeAgentPubkey(agentId, pubkeyHex);
  }

  async recordSignatureNonce(agentId: string, nonce: string, ttlMs?: number) {
    return this.local.recordSignatureNonce(agentId, nonce, ttlMs);
  }

  async hasNonceBeenUsed(agentId: string, nonce: string) {
    return this.local.hasNonceBeenUsed(agentId, nonce);
  }

  async createCollection(params: Parameters<Backend['createCollection']>[0]) {
    return this.local.createCollection(params);
  }

  async getCollection(slug: string) {
    return this.local.getCollection(slug);
  }

  async listCollections(params?: Parameters<Backend['listCollections']>[0]) {
    return this.local.listCollections(params);
  }

  async addDocToCollection(collectionSlug: string, documentSlug: string, position?: number) {
    return this.local.addDocToCollection(collectionSlug, documentSlug, position);
  }

  async removeDocFromCollection(collectionSlug: string, documentSlug: string) {
    return this.local.removeDocFromCollection(collectionSlug, documentSlug);
  }

  async reorderCollection(collectionSlug: string, orderedSlugs: string[]) {
    return this.local.reorderCollection(collectionSlug, orderedSlugs);
  }

  async exportCollection(collectionSlug: string) {
    return this.local.exportCollection(collectionSlug);
  }

  async createDocumentLink(params: Parameters<Backend['createDocumentLink']>[0]) {
    return this.local.createDocumentLink(params);
  }

  async getDocumentLinks(documentId: string) {
    return this.local.getDocumentLinks(documentId);
  }

  async deleteDocumentLink(documentId: string, linkId: string) {
    return this.local.deleteDocumentLink(documentId, linkId);
  }

  async getGlobalGraph(params?: Parameters<Backend['getGlobalGraph']>[0]) {
    return this.local.getGlobalGraph(params);
  }

  async createWebhook(params: Parameters<Backend['createWebhook']>[0]) {
    return this.local.createWebhook(params);
  }

  async listWebhooks(userId: string) {
    return this.local.listWebhooks(userId);
  }

  async deleteWebhook(id: string, userId: string) {
    return this.local.deleteWebhook(id, userId);
  }

  async testWebhook(id: string) {
    return this.local.testWebhook(id);
  }

  async createSignedUrl(params: Parameters<Backend['createSignedUrl']>[0]) {
    return this.local.createSignedUrl(params);
  }

  async verifySignedUrl(token: string) {
    return this.local.verifySignedUrl(token);
  }

  async getDocumentAccess(documentId: string) {
    return this.local.getDocumentAccess(documentId);
  }

  async grantDocumentAccess(documentId: string, params: Parameters<Backend['grantDocumentAccess']>[1]) {
    return this.local.grantDocumentAccess(documentId, params);
  }

  async revokeDocumentAccess(documentId: string, userId: string) {
    return this.local.revokeDocumentAccess(documentId, userId);
  }

  async setDocumentVisibility(documentId: string, visibility: Parameters<Backend['setDocumentVisibility']>[1]) {
    return this.local.setDocumentVisibility(documentId, visibility);
  }

  async createOrganization(params: Parameters<Backend['createOrganization']>[0]) {
    return this.local.createOrganization(params);
  }

  async getOrganization(slug: string) {
    return this.local.getOrganization(slug);
  }

  async listOrganizations(userId: string) {
    return this.local.listOrganizations(userId);
  }

  async addOrgMember(orgSlug: string, userId: string, role?: string) {
    return this.local.addOrgMember(orgSlug, userId, role);
  }

  async removeOrgMember(orgSlug: string, userId: string) {
    return this.local.removeOrgMember(orgSlug, userId);
  }

  async createApiKey(params: Parameters<Backend['createApiKey']>[0]) {
    return this.local.createApiKey(params);
  }

  async listApiKeys(userId: string) {
    return this.local.listApiKeys(userId);
  }

  async deleteApiKey(id: string, userId: string) {
    return this.local.deleteApiKey(id, userId);
  }

  async rotateApiKey(id: string, userId: string) {
    return this.local.rotateApiKey(id, userId);
  }

  // ── BlobOps — local ──────────────────────────────────────────────────────────

  async attachBlob(params: Parameters<Backend['attachBlob']>[0]) {
    return this.local.attachBlob(params);
  }

  async getBlob(docSlug: string, blobName: string, opts?: Parameters<Backend['getBlob']>[2]) {
    return this.local.getBlob(docSlug, blobName, opts);
  }

  async listBlobs(docSlug: string) {
    return this.local.listBlobs(docSlug);
  }

  async detachBlob(docSlug: string, blobName: string, detachedBy: string) {
    return this.local.detachBlob(docSlug, blobName, detachedBy);
  }

  async fetchBlobByHash(hash: string) {
    return this.local.fetchBlobByHash(hash);
  }

  // ── ExportOps (T427.6) ────────────────────────────────────────────────────────

  async exportDocument(params: Parameters<Backend['exportDocument']>[0]) {
    return this.local.exportDocument(params);
  }

  async exportAll(params: Parameters<Backend['exportAll']>[0]) {
    return this.local.exportAll(params);
  }

  async importDocument(params: Parameters<Backend['importDocument']>[0]) {
    return this.local.importDocument(params);
  }

  // ── CrSqlite changeset sync (P2.6/P2.7) — delegates to LocalBackend ────────

  async getChangesSince(dbVersion: bigint): Promise<Uint8Array> {
    return this.local.getChangesSince(dbVersion);
  }

  async applyChanges(changeset: Uint8Array): Promise<bigint> {
    return this.local.applyChanges(changeset);
  }
}

// ── createBackend ────────────────────────────────────────────────────────────

/**
 * Create a Backend instance appropriate for the given topology config.
 *
 * This is the primary entry point for all agent code that needs a Backend.
 * Prefer this over constructing LocalBackend or RemoteBackend directly.
 *
 * Validation (ARCH-T429 §3.3) runs before any backend is constructed:
 * - `hub-spoke` without `hubUrl` → throws {@link TopologyConfigError}
 * - `hub-spoke` with `persistLocally=true` without `storagePath` → throws {@link TopologyConfigError}
 * - `mesh` without `storagePath` → throws {@link TopologyConfigError}
 * - Unknown `topology` value → throws {@link TopologyConfigError}
 *
 * The returned backend must have `open()` called before use.
 *
 * @param config - A validated {@link TopologyConfig}. Unknown shapes are
 *   rejected by {@link validateTopologyConfig} before dispatch.
 * @returns A {@link Backend} instance for the requested topology.
 *
 * @throws {@link TopologyConfigError} when config is invalid.
 */
export async function createBackend(config: TopologyConfig): Promise<Backend> {
  // Validate first — throws TopologyConfigError on any violation (§3.3)
  validateTopologyConfig(config);

  switch (config.topology) {
    case 'standalone': {
      const { LocalBackend } = await import('../local/index.js');
      return new LocalBackend({
        storagePath: config.storagePath,
        identityPath: config.identityPath,
        // crsqliteExtPath is passed through if provided (T385 integration)
        ...(config.crsqliteExtPath !== undefined
          ? { crsqliteExtPath: config.crsqliteExtPath }
          : {}),
      });
    }

    case 'hub-spoke': {
      const remoteConfig: BackendConfig = {
        baseUrl: config.hubUrl,
        apiKey: config.apiKey,
        identityPath: config.identityPath,
      };

      if (config.persistLocally === true) {
        // Persistent spoke: LocalBackend replica + RemoteBackend for hub writes
        // TODO(T449): implement write-queue persistence so queued writes survive restart
        // TODO(T449): implement background sync loop to replicate hub state to local replica
        const localConfig: BackendConfig = {
          storagePath: config.storagePath,
          identityPath: config.identityPath,
        };
        const [{ LocalBackend }, { RemoteBackend }] = await Promise.all([
          import('../local/index.js'),
          import('../remote/index.js'),
        ]);
        const local = new LocalBackend(localConfig);
        const remote = new RemoteBackend(remoteConfig);
        return new HubSpokeBackend({
          local,
          remote,
          config: { ...localConfig, ...remoteConfig },
        });
      }

      // Ephemeral swarm worker: pure RemoteBackend, no local .db
      const { RemoteBackend } = await import('../remote/index.js');
      return new RemoteBackend(remoteConfig);
    }

    case 'mesh': {
      // MeshBackend stub: delegates all Backend interface methods to LocalBackend.
      // The P2P sync engine (peer discovery, cr-sqlite changeset exchange) ships in T386.
      // TODO(T386): replace stub with real MeshBackend from packages/llmtxt/src/mesh/
      const localConfig: BackendConfig = {
        storagePath: config.storagePath,
        identityPath: config.identityPath,
      };
      const { LocalBackend } = await import('../local/index.js');
      const local = new LocalBackend(localConfig);
      return new MeshBackend({
        local,
        meshConfig: config as MeshConfig,
        config: localConfig,
      });
    }
  }
}
