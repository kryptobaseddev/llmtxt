/**
 * RemoteBackend — thin HTTP/WS client implementing the Backend interface.
 *
 * Delegates all operations to a running LLMtxt API instance (api.llmtxt.my
 * or any compatible self-hosted server). No business logic lives here — this
 * is pure transport.
 *
 * Transport strategy:
 *  - REST (fetch): all CRUD operations
 *  - SSE (fetch + text/event-stream): subscribeStream
 *  - WebSocket (ws): subscribeSection
 *
 * @example
 * ```ts
 * import { RemoteBackend } from 'llmtxt/remote';
 *
 * const backend = new RemoteBackend({
 *   baseUrl: 'https://api.llmtxt.my',
 *   apiKey: process.env.LLMTXT_API_KEY,
 * });
 * await backend.open();
 * const doc = await backend.createDocument({ title: 'Spec', createdBy: 'agent-1' });
 * await backend.close();
 * ```
 */

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
  ExportDocumentParams,
  ExportDocumentResult,
  ExportAllParams,
  ExportAllResult,
} from '../core/backend.js';
import { ExportError } from '../core/backend.js';
import {
  writeExportFile,
  exportAllFilePath,
  contentHashHex,
} from '../export/backend-export.js';
import type { DocumentExportState } from '../export/types.js';

import type { VersionEntry } from '../sdk/versions.js';

// ── Helpers ─────────────────────────────────────────────────────

/** Build an Authorization header value. */
function authHeader(apiKey?: string): Record<string, string> {
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

/**
 * Perform a typed fetch call against the remote API.
 * Throws if the response status is >= 400.
 */
async function apiFetch<T>(
  baseUrl: string,
  apiKey: string | undefined,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...authHeader(apiKey),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RemoteBackend: ${method} ${path} → HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data?: T } | T;
  // APIs typically wrap responses in { data: ... }
  if (json && typeof json === 'object' && 'data' in (json as object)) {
    return (json as { data: T }).data;
  }
  return json as T;
}

// ── RemoteBackend ────────────────────────────────────────────────

export class RemoteBackend implements Backend {
  readonly config: BackendConfig;
  private opened = false;

  constructor(config: BackendConfig) {
    if (!config.baseUrl) {
      throw new Error('RemoteBackend: config.baseUrl is required');
    }
    // Strip trailing slash
    this.config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/$/, ''),
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async open(): Promise<void> {
    if (this.opened) return;
    // No-op: HTTP is stateless. We could do a health check here.
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
  }

  private _assertOpen(): void {
    if (!this.opened) {
      throw new Error('RemoteBackend: call open() before using this instance');
    }
  }

  private fetch<T>(method: string, path: string, body?: unknown): Promise<T> {
    this._assertOpen();
    return apiFetch<T>(this.config.baseUrl!, this.config.apiKey, method, path, body);
  }

  // ── DocumentOps ──────────────────────────────────────────────

  async createDocument(params: CreateDocumentParams): Promise<Document> {
    return this.fetch<Document>('POST', '/v1/documents', params);
  }

  async getDocument(id: string): Promise<Document | null> {
    try {
      return await this.fetch<Document>('GET', `/v1/documents/${id}`);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('HTTP 404')) return null;
      throw e;
    }
  }

  async getDocumentBySlug(slug: string): Promise<Document | null> {
    try {
      return await this.fetch<Document>('GET', `/v1/documents/slug/${slug}`);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('HTTP 404')) return null;
      throw e;
    }
  }

  async listDocuments(params: ListDocumentsParams = {}): Promise<ListResult<Document>> {
    const qs = new URLSearchParams();
    if (params.cursor) qs.set('cursor', params.cursor);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.state) qs.set('state', params.state);
    if (params.createdBy) qs.set('createdBy', params.createdBy);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.fetch<ListResult<Document>>('GET', `/v1/documents${query}`);
  }

  async deleteDocument(id: string): Promise<boolean> {
    try {
      await this.fetch<unknown>('DELETE', `/v1/documents/${id}`);
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('HTTP 404')) return false;
      throw e;
    }
  }

  // ── VersionOps ────────────────────────────────────────────────

  async publishVersion(params: PublishVersionParams): Promise<VersionEntry> {
    return this.fetch<VersionEntry>('POST', `/v1/documents/${params.documentId}/versions`, params);
  }

  async getVersion(documentId: string, versionNumber: number): Promise<VersionEntry | null> {
    try {
      return await this.fetch<VersionEntry>('GET', `/v1/documents/${documentId}/versions/${versionNumber}`);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('HTTP 404')) return null;
      throw e;
    }
  }

  async listVersions(documentId: string): Promise<VersionEntry[]> {
    const result = await this.fetch<{ items: VersionEntry[] } | VersionEntry[]>(
      'GET', `/v1/documents/${documentId}/versions`
    );
    if (Array.isArray(result)) return result;
    return (result as { items: VersionEntry[] }).items;
  }

  async transitionVersion(params: TransitionParams): Promise<{
    success: boolean;
    error?: string;
    document?: Document;
  }> {
    try {
      const doc = await this.fetch<Document>(
        'POST',
        `/v1/documents/${params.documentId}/transition`,
        { to: params.to, changedBy: params.changedBy, reason: params.reason }
      );
      return { success: true, document: doc };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
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
    try {
      const result = await this.fetch<ApprovalResult>(
        'POST',
        `/v1/documents/${params.documentId}/approvals`,
        params
      );
      return { success: true, result };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async getApprovalProgress(documentId: string, versionNumber: number): Promise<ApprovalResult> {
    return this.fetch<ApprovalResult>('GET', `/v1/documents/${documentId}/approvals/${versionNumber}`);
  }

  async getApprovalPolicy(documentId: string): Promise<ApprovalPolicy> {
    return this.fetch<ApprovalPolicy>('GET', `/v1/documents/${documentId}/approval-policy`);
  }

  async setApprovalPolicy(documentId: string, policy: ApprovalPolicy): Promise<void> {
    await this.fetch<void>('PUT', `/v1/documents/${documentId}/approval-policy`, policy);
  }

  // ── EventOps ──────────────────────────────────────────────────

  async appendEvent(params: AppendEventParams): Promise<DocumentEvent> {
    return this.fetch<DocumentEvent>(
      'POST',
      `/v1/documents/${params.documentId}/events`,
      { type: params.type, agentId: params.agentId, payload: params.payload }
    );
  }

  async queryEvents(params: QueryEventsParams): Promise<ListResult<DocumentEvent>> {
    const qs = new URLSearchParams();
    if (params.type) qs.set('type', params.type);
    if (params.since) qs.set('since', params.since);
    if (params.limit) qs.set('limit', String(params.limit));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.fetch<ListResult<DocumentEvent>>('GET', `/v1/documents/${params.documentId}/events${query}`);
  }

  subscribeStream(documentId: string): AsyncIterable<DocumentEvent> {
    const baseUrl = this.config.baseUrl!;
    const apiKey = this.config.apiKey;

    return {
      [Symbol.asyncIterator]() {
        const queue: DocumentEvent[] = [];
        let resolve: ((value: IteratorResult<DocumentEvent>) => void) | null = null;
        let done = false;
        let abortController: AbortController | null = null;

        // Start SSE connection in background
        async function startStream() {
          abortController = new AbortController();
          try {
            const res = await fetch(`${baseUrl}/v1/documents/${documentId}/events/stream`, {
              headers: {
                Accept: 'text/event-stream',
                ...authHeader(apiKey),
              },
              signal: abortController.signal,
            });

            if (!res.ok || !res.body) return;

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (!done) {
              const { value, done: readerDone } = await reader.read();
              if (readerDone) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const event = JSON.parse(line.slice(6)) as DocumentEvent;
                    if (resolve) {
                      const r = resolve;
                      resolve = null;
                      r({ value: event, done: false });
                    } else {
                      queue.push(event);
                    }
                  } catch (_) {
                    // Ignore malformed SSE data
                  }
                }
              }
            }
          } catch (_) {
            // Stream ended or aborted
          }
        }

        startStream().catch(() => {});

        return {
          next(): Promise<IteratorResult<DocumentEvent>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false });
            }
            if (done) {
              return Promise.resolve({ value: undefined as unknown as DocumentEvent, done: true });
            }
            return new Promise((res) => { resolve = res; });
          },
          return(): Promise<IteratorResult<DocumentEvent>> {
            done = true;
            abortController?.abort();
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
    return this.fetch<CrdtState>(
      'POST',
      `/v1/documents/${params.documentId}/crdt/${params.sectionKey}`,
      { updateBase64: params.updateBase64, agentId: params.agentId }
    );
  }

  async getCrdtState(documentId: string, sectionKey: string): Promise<CrdtState | null> {
    try {
      return await this.fetch<CrdtState>('GET', `/v1/documents/${documentId}/crdt/${sectionKey}`);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('HTTP 404')) return null;
      throw e;
    }
  }

  subscribeSection(documentId: string, sectionKey: string): AsyncIterable<CrdtUpdate> {
    const baseUrl = this.config.baseUrl!;
    const apiKey = this.config.apiKey;
    // Convert https:// to wss:// (or http:// to ws://)
    const wsUrl = baseUrl.replace(/^https?/, (m) => (m === 'https' ? 'wss' : 'ws'));

    return {
      [Symbol.asyncIterator]() {
        const queue: CrdtUpdate[] = [];
        let resolve: ((value: IteratorResult<CrdtUpdate>) => void) | null = null;
        let done = false;
        let ws: WebSocket | null = null;

        try {
          const url = `${wsUrl}/v1/documents/${documentId}/crdt/${sectionKey}/ws${apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : ''}`;
          ws = new WebSocket(url);

          ws.onmessage = (evt: MessageEvent) => {
            if (done) return;
            try {
              const update = JSON.parse(evt.data as string) as CrdtUpdate;
              if (resolve) {
                const r = resolve;
                resolve = null;
                r({ value: update, done: false });
              } else {
                queue.push(update);
              }
            } catch (_) {
              // Ignore malformed messages
            }
          };

          ws.onerror = () => {
            done = true;
            if (resolve) {
              const r = resolve;
              resolve = null;
              r({ value: undefined as unknown as CrdtUpdate, done: true });
            }
          };

          ws.onclose = () => {
            done = true;
            if (resolve) {
              const r = resolve;
              resolve = null;
              r({ value: undefined as unknown as CrdtUpdate, done: true });
            }
          };
        } catch (_) {
          done = true;
        }

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
            ws?.close();
            return Promise.resolve({ value: undefined as unknown as CrdtUpdate, done: true });
          },
        };
      },
    };
  }

  // ── LeaseOps ──────────────────────────────────────────────────

  async acquireLease(params: AcquireLeaseParams): Promise<Lease | null> {
    try {
      return await this.fetch<Lease>('POST', '/v1/leases', params);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('HTTP 409')) return null;
      throw e;
    }
  }

  async renewLease(resource: string, holder: string, ttlMs: number): Promise<Lease | null> {
    try {
      return await this.fetch<Lease>('PUT', `/v1/leases/${encodeURIComponent(resource)}`, {
        holder,
        ttlMs,
      });
    } catch (e: unknown) {
      if (e instanceof Error && (e.message.includes('HTTP 404') || e.message.includes('HTTP 403'))) {
        return null;
      }
      throw e;
    }
  }

  async releaseLease(resource: string, holder: string): Promise<boolean> {
    try {
      await this.fetch<void>('DELETE', `/v1/leases/${encodeURIComponent(resource)}`, { holder });
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && (e.message.includes('HTTP 404') || e.message.includes('HTTP 403'))) {
        return false;
      }
      throw e;
    }
  }

  async getLease(resource: string): Promise<Lease | null> {
    try {
      return await this.fetch<Lease>('GET', `/v1/leases/${encodeURIComponent(resource)}`);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('HTTP 404')) return null;
      throw e;
    }
  }

  // ── PresenceOps ───────────────────────────────────────────────

  async joinPresence(
    documentId: string,
    agentId: string,
    meta?: Record<string, unknown>
  ): Promise<PresenceEntry> {
    return this.fetch<PresenceEntry>(
      'POST',
      `/v1/documents/${documentId}/presence`,
      { agentId, meta }
    );
  }

  async leavePresence(documentId: string, agentId: string): Promise<void> {
    await this.fetch<void>('DELETE', `/v1/documents/${documentId}/presence/${agentId}`);
  }

  async listPresence(documentId: string): Promise<PresenceEntry[]> {
    const result = await this.fetch<{ items: PresenceEntry[] } | PresenceEntry[]>(
      'GET', `/v1/documents/${documentId}/presence`
    );
    if (Array.isArray(result)) return result;
    return (result as { items: PresenceEntry[] }).items;
  }

  async heartbeatPresence(documentId: string, agentId: string): Promise<void> {
    await this.fetch<void>('POST', `/v1/documents/${documentId}/presence/${agentId}/heartbeat`);
  }

  // ── ScratchpadOps ─────────────────────────────────────────────

  async sendScratchpad(params: SendScratchpadParams): Promise<ScratchpadMessage> {
    return this.fetch<ScratchpadMessage>('POST', '/v1/scratchpad', params);
  }

  async pollScratchpad(agentId: string, limit = 50): Promise<ScratchpadMessage[]> {
    const result = await this.fetch<{ items: ScratchpadMessage[] } | ScratchpadMessage[]>(
      'GET', `/v1/scratchpad/${agentId}?limit=${limit}`
    );
    if (Array.isArray(result)) return result;
    return (result as { items: ScratchpadMessage[] }).items;
  }

  async deleteScratchpadMessage(id: string, agentId: string): Promise<boolean> {
    try {
      await this.fetch<void>('DELETE', `/v1/scratchpad/${agentId}/${id}`);
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('HTTP 404')) return false;
      throw e;
    }
  }

  // ── A2AOps ────────────────────────────────────────────────────

  async sendA2AMessage(params: {
    toAgentId: string;
    envelopeJson: string;
    ttlMs?: number;
  }): Promise<{ success: boolean; error?: string; message?: A2AMessage }> {
    try {
      const message = await this.fetch<A2AMessage>('POST', '/v1/a2a/inbox', params);
      return { success: true, message };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async pollA2AInbox(
    agentId: string,
    limit = 50,
    since?: number,
    order: 'asc' | 'desc' = 'desc',
  ): Promise<A2AMessage[]> {
    let url = `/v1/a2a/inbox/${agentId}?limit=${limit}&order=${order}`;
    if (since !== undefined) url += `&since=${since}`;
    const result = await this.fetch<{ items: A2AMessage[] } | A2AMessage[]>('GET', url);
    if (Array.isArray(result)) return result;
    return (result as { items: A2AMessage[] }).items;
  }

  async deleteA2AMessage(id: string, agentId: string): Promise<boolean> {
    try {
      await this.fetch<void>('DELETE', `/v1/a2a/inbox/${agentId}/${id}`);
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('HTTP 404')) return false;
      throw e;
    }
  }

  // ── SearchOps ─────────────────────────────────────────────────

  async indexDocument(documentId: string, content: string): Promise<void> {
    await this.fetch<void>('POST', `/v1/search/index`, { documentId, content });
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    const result = await this.fetch<{ items: SearchResult[] } | SearchResult[]>(
      'POST', '/v1/search', params
    );
    if (Array.isArray(result)) return result;
    return (result as { items: SearchResult[] }).items;
  }

  // ── IdentityOps ───────────────────────────────────────────────

  async registerAgentPubkey(
    agentId: string,
    pubkeyHex: string,
    label?: string
  ): Promise<AgentPubkeyRecord> {
    return this.fetch<AgentPubkeyRecord>('POST', '/v1/identity/pubkeys', {
      agentId,
      pubkeyHex,
      label,
    });
  }

  async lookupAgentPubkey(agentId: string): Promise<AgentPubkeyRecord | null> {
    try {
      return await this.fetch<AgentPubkeyRecord>('GET', `/v1/identity/pubkeys/${agentId}`);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('HTTP 404')) return null;
      throw e;
    }
  }

  async revokeAgentPubkey(agentId: string, pubkeyHex: string): Promise<boolean> {
    try {
      await this.fetch<void>('DELETE', `/v1/identity/pubkeys/${agentId}`, { pubkeyHex });
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('HTTP 404')) return false;
      throw e;
    }
  }

  async recordSignatureNonce(agentId: string, nonce: string, ttlMs?: number): Promise<boolean> {
    try {
      await this.fetch<void>('POST', '/v1/identity/nonces', { agentId, nonce, ttlMs });
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('HTTP 409')) return false;
      throw e;
    }
  }

  async hasNonceBeenUsed(agentId: string, nonce: string): Promise<boolean> {
    try {
      await this.fetch<void>('GET', `/v1/identity/nonces/${agentId}/${nonce}`);
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('HTTP 404')) return false;
      throw e;
    }
  }

  // ── New interface stubs (T353) ────────────────────────────────────
  // RemoteBackend delegates to api.llmtxt.my. These stubs will be replaced
  // with actual HTTP calls during Wave D.

  async listAgentPubkeys(_userId?: string): Promise<import('../core/backend.js').AgentPubkeyRecord[]> {
    throw new Error('RemoteBackend: listAgentPubkeys not yet implemented');
  }
  async listContributors(_documentId: string): Promise<import('../core/backend.js').ContributorRecord[]> {
    throw new Error('RemoteBackend: listContributors not yet implemented');
  }
  async getApprovalChain(_documentId: string): Promise<import('../core/backend.js').ApprovalChainResult> {
    throw new Error('RemoteBackend: getApprovalChain not yet implemented');
  }
  async createCollection(_params: import('../core/backend.js').CreateCollectionParams): Promise<import('../core/backend.js').Collection> {
    throw new Error('RemoteBackend: createCollection not yet implemented');
  }
  async getCollection(_slug: string): Promise<import('../core/backend.js').Collection | null> {
    throw new Error('RemoteBackend: getCollection not yet implemented');
  }
  async listCollections(_params?: import('../core/backend.js').ListCollectionsParams): Promise<import('../core/backend.js').ListResult<import('../core/backend.js').Collection>> {
    throw new Error('RemoteBackend: listCollections not yet implemented');
  }
  async addDocToCollection(_collectionSlug: string, _documentSlug: string, _position?: number): Promise<void> {
    throw new Error('RemoteBackend: addDocToCollection not yet implemented');
  }
  async removeDocFromCollection(_collectionSlug: string, _documentSlug: string): Promise<boolean> {
    throw new Error('RemoteBackend: removeDocFromCollection not yet implemented');
  }
  async reorderCollection(_collectionSlug: string, _orderedSlugs: string[]): Promise<void> {
    throw new Error('RemoteBackend: reorderCollection not yet implemented');
  }
  async exportCollection(_collectionSlug: string): Promise<import('../core/backend.js').CollectionExport> {
    throw new Error('RemoteBackend: exportCollection not yet implemented');
  }
  async createDocumentLink(_params: import('../core/backend.js').CreateDocLinkParams): Promise<import('../core/backend.js').DocumentLink> {
    throw new Error('RemoteBackend: createDocumentLink not yet implemented');
  }
  async getDocumentLinks(_documentId: string): Promise<import('../core/backend.js').DocumentLink[]> {
    throw new Error('RemoteBackend: getDocumentLinks not yet implemented');
  }
  async deleteDocumentLink(_documentId: string, _linkId: string): Promise<boolean> {
    throw new Error('RemoteBackend: deleteDocumentLink not yet implemented');
  }
  async getGlobalGraph(_params?: { maxNodes?: number }): Promise<import('../core/backend.js').GraphResult> {
    throw new Error('RemoteBackend: getGlobalGraph not yet implemented');
  }
  async createWebhook(_params: import('../core/backend.js').CreateWebhookParams): Promise<import('../core/backend.js').Webhook> {
    throw new Error('RemoteBackend: createWebhook not yet implemented');
  }
  async listWebhooks(_userId: string): Promise<import('../core/backend.js').Webhook[]> {
    throw new Error('RemoteBackend: listWebhooks not yet implemented');
  }
  async deleteWebhook(_id: string, _userId: string): Promise<boolean> {
    throw new Error('RemoteBackend: deleteWebhook not yet implemented');
  }
  async testWebhook(_id: string): Promise<import('../core/backend.js').WebhookTestResult> {
    throw new Error('RemoteBackend: testWebhook not yet implemented');
  }
  async createSignedUrl(_params: import('../core/backend.js').CreateSignedUrlParams): Promise<import('../core/backend.js').SignedUrl> {
    throw new Error('RemoteBackend: createSignedUrl not yet implemented');
  }
  async verifySignedUrl(_token: string): Promise<{ documentId: string; permission: 'read' | 'write' } | null> {
    throw new Error('RemoteBackend: verifySignedUrl not yet implemented');
  }
  async getDocumentAccess(_documentId: string): Promise<import('../core/backend.js').AccessControlList> {
    throw new Error('RemoteBackend: getDocumentAccess not yet implemented');
  }
  async grantDocumentAccess(_documentId: string, _params: import('../core/backend.js').GrantAccessParams): Promise<void> {
    throw new Error('RemoteBackend: grantDocumentAccess not yet implemented');
  }
  async revokeDocumentAccess(_documentId: string, _userId: string): Promise<boolean> {
    throw new Error('RemoteBackend: revokeDocumentAccess not yet implemented');
  }
  async setDocumentVisibility(_documentId: string, _visibility: import('../core/backend.js').DocumentVisibility): Promise<void> {
    throw new Error('RemoteBackend: setDocumentVisibility not yet implemented');
  }
  async createOrganization(_params: import('../core/backend.js').CreateOrgParams): Promise<import('../core/backend.js').Organization> {
    throw new Error('RemoteBackend: createOrganization not yet implemented');
  }
  async getOrganization(_slug: string): Promise<import('../core/backend.js').Organization | null> {
    throw new Error('RemoteBackend: getOrganization not yet implemented');
  }
  async listOrganizations(_userId: string): Promise<import('../core/backend.js').Organization[]> {
    throw new Error('RemoteBackend: listOrganizations not yet implemented');
  }
  async addOrgMember(_orgSlug: string, _userId: string, _role?: string): Promise<void> {
    throw new Error('RemoteBackend: addOrgMember not yet implemented');
  }
  async removeOrgMember(_orgSlug: string, _userId: string): Promise<boolean> {
    throw new Error('RemoteBackend: removeOrgMember not yet implemented');
  }
  async createApiKey(_params: import('../core/backend.js').CreateApiKeyParams): Promise<import('../core/backend.js').ApiKeyWithSecret> {
    throw new Error('RemoteBackend: createApiKey not yet implemented');
  }
  async listApiKeys(_userId: string): Promise<import('../core/backend.js').ApiKey[]> {
    throw new Error('RemoteBackend: listApiKeys not yet implemented');
  }
  async deleteApiKey(_id: string, _userId: string): Promise<boolean> {
    throw new Error('RemoteBackend: deleteApiKey not yet implemented');
  }
  async rotateApiKey(_id: string, _userId: string): Promise<import('../core/backend.js').ApiKeyWithSecret> {
    throw new Error('RemoteBackend: rotateApiKey not yet implemented');
  }

  // ── BlobOps (stubs — T427 does not require remote blob storage) ───────────

  async attachBlob(_params: import('../core/backend.js').AttachBlobParams): Promise<import('../core/backend.js').BlobAttachment> {
    throw new Error('RemoteBackend: attachBlob not yet implemented');
  }

  async getBlob(_docSlug: string, _blobName: string, _opts?: { includeData?: boolean }): Promise<import('../core/backend.js').BlobData | null> {
    throw new Error('RemoteBackend: getBlob not yet implemented');
  }

  async listBlobs(_docSlug: string): Promise<import('../core/backend.js').BlobAttachment[]> {
    throw new Error('RemoteBackend: listBlobs not yet implemented');
  }

  async detachBlob(_docSlug: string, _blobName: string, _detachedBy: string): Promise<boolean> {
    throw new Error('RemoteBackend: detachBlob not yet implemented');
  }

  async fetchBlobByHash(_hash: string): Promise<Buffer | null> {
    throw new Error('RemoteBackend: fetchBlobByHash not yet implemented');
  }

  // ── ExportOps (T427.6) ────────────────────────────────────────────────────

  /**
   * Export a document from the remote backend to a local file.
   *
   * Content retrieval: calls `GET /v1/documents/:slug/versions/:n` and extracts
   * the `content` field. Then serializes and writes locally using writeExportFile.
   *
   * @throws {ExportError} DOC_NOT_FOUND when the slug does not resolve.
   * @throws {ExportError} VERSION_NOT_FOUND when the document has no versions.
   * @throws {ExportError} WRITE_FAILED on I/O error.
   */
  async exportDocument(params: ExportDocumentParams): Promise<ExportDocumentResult> {
    this._assertOpen();

    const { slug, format, includeMetadata, sign } = params;

    // 1. Resolve slug → document.
    const doc = await this.getDocumentBySlug(slug);
    if (!doc) {
      throw new ExportError('DOC_NOT_FOUND', `Document not found: ${slug}`);
    }

    // 2. Determine latest version number.
    const versionList = await this.listVersions(doc.id);
    if (versionList.length === 0) {
      throw new ExportError('VERSION_NOT_FOUND', `Document ${slug} has no versions`);
    }

    // listVersions returns ascending order; last = latest.
    const latestVersion = versionList[versionList.length - 1]!;

    // 3. Fetch full version content via GET /v1/documents/:slug/versions/:n
    const versionData = await this.fetch<{
      content: string;
      contentHash: string;
      versionNumber: number;
      createdBy?: string;
    }>('GET', `/v1/documents/${encodeURIComponent(slug)}/versions/${latestVersion.versionNumber}`);

    const content = versionData.content;

    // 4. Build contributors list from version entries.
    const contributors = [
      ...new Set(
        versionList
          .map((v) => (v as unknown as Record<string, unknown>).createdBy as string | undefined)
          .filter((c): c is string => Boolean(c)),
      ),
    ];

    // 5. Build DocumentExportState.
    const exportedAt = new Date().toISOString();
    const state: DocumentExportState = {
      title: (doc as unknown as Record<string, unknown>).title as string ?? slug,
      slug: doc.slug ?? slug,
      version: latestVersion.versionNumber,
      state: (doc as unknown as Record<string, unknown>).state as string ?? 'DRAFT',
      contributors,
      contentHash: contentHashHex(content),
      exportedAt,
      content,
      labels: (doc as unknown as Record<string, unknown>).labels as string[] | null ?? null,
      createdBy: (doc as unknown as Record<string, unknown>).createdBy as string | null ?? null,
      createdAt: (doc as unknown as Record<string, unknown>).createdAt as number | null ?? null,
      updatedAt: (doc as unknown as Record<string, unknown>).updatedAt as number | null ?? null,
      versionCount: versionList.length,
      chainRef: null, // T384 stub
    };

    // 6. Write and return.
    return writeExportFile(state, params, this.config.identityPath);
  }

  /**
   * Export all documents from the remote backend to a directory.
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

    for (;;) {
      const page = await this.listDocuments({
        cursor,
        limit: 50,
        state: filterState as import('../sdk/lifecycle.js').DocumentState | undefined,
      });

      for (const doc of page.items) {
        const docSlug = doc.slug ?? (doc as unknown as Record<string, unknown>).id as string;
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
}
