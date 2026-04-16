/**
 * shared/base.js — Base class for all LLMtxt demo agents.
 *
 * Handles:
 *  - AgentIdentity: Ed25519 keypair persisted per agent under ~/.llmtxt/demo-agents/<name>.key
 *  - Pubkey registration against the API (idempotent on 409 duplicate agent_id)
 *  - API key from LLMTXT_API_KEY env var
 *  - Authenticated fetch helper that signs requests with Ed25519
 *  - A2A message envelope send/poll
 *  - LeaseManager integration
 *
 * All imports come from the public SDK (llmtxt package) — no internal imports.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
// Noble v3 requires sha512 for sync methods in Node.js
ed.hashes.sha512 = sha512;

import {
  AgentIdentity,
  bodyHashHex,
  buildCanonicalPayload,
  randomNonceHex,
  LeaseManager,
  watchDocument,
} from 'llmtxt';

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_API_BASE = 'https://api.llmtxt.my';

// ── Per-agent key persistence ─────────────────────────────────────────────────

function agentKeyPath(agentId) {
  const dir = join(homedir(), '.llmtxt', 'demo-agents');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${agentId}.key`);
}

/** Load existing key from disk or generate+persist a new one. */
async function loadOrGenerateKey(agentId) {
  const keyPath = agentKeyPath(agentId);
  if (existsSync(keyPath)) {
    try {
      const raw = JSON.parse(readFileSync(keyPath, 'utf8'));
      const sk = Buffer.from(raw.sk, 'hex');
      const pk = Buffer.from(raw.pk, 'hex');
      return AgentIdentity.fromSeed(sk);
    } catch {
      // Corrupt file — regenerate below
    }
  }

  // Generate fresh keypair
  const sk = Buffer.from(ed.utils.randomSecretKey());
  const pk = Buffer.from(await ed.getPublicKeyAsync(sk));
  const payload = { sk: sk.toString('hex'), pk: pk.toString('hex') };
  writeFileSync(keyPath, JSON.stringify(payload), { mode: 0o600 });
  return AgentIdentity.fromSeed(sk);
}

// ── AgentBase ─────────────────────────────────────────────────────────────────

export class AgentBase {
  /**
   * @param {string} agentId   Stable identifier, e.g. 'writerbot-demo'
   * @param {object} [opts]
   * @param {string} [opts.apiBase]  Override API base URL
   */
  constructor(agentId, opts = {}) {
    this.agentId = agentId;
    this.apiBase = (opts.apiBase || process.env.LLMTXT_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '');
    this.apiKey = process.env.LLMTXT_API_KEY || '';
    /** @type {AgentIdentity|null} */
    this.identity = null;
    this._leaseManager = null;
  }

  // ── Initialization ────────────────────────────────────────────────────────

  /**
   * Load or generate the Ed25519 identity, then register the pubkey with the API.
   * Must be called before any signed request.
   */
  async init() {
    this.identity = await loadOrGenerateKey(this.agentId);
    await this._registerPubkey();
    console.log(`[${this.agentId}] initialized, pubkey=${this.identity.pubkeyHex.slice(0, 12)}...`);
  }

  async _registerPubkey() {
    const body = JSON.stringify({
      agent_id: this.agentId,
      pubkey_hex: this.identity.pubkeyHex,
      label: `${this.agentId} demo key`,
    });
    try {
      const res = await fetch(`${this.apiBase}/api/v1/agents/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body,
      });
      // 409 = already registered — that is fine
      if (!res.ok && res.status !== 409) {
        const txt = await res.text();
        console.warn(`[${this.agentId}] pubkey registration returned ${res.status}: ${txt}`);
      }
    } catch (err) {
      console.warn(`[${this.agentId}] pubkey registration error (non-fatal):`, err.message);
    }
  }

  // ── Authenticated fetch ───────────────────────────────────────────────────

  /**
   * Signed fetch — attaches Ed25519 signature headers for state-mutating requests.
   *
   * @param {string} path       Path starting with '/', e.g. '/api/v1/documents'
   * @param {object} [options]
   * @param {string} [options.method]
   * @param {string} [options.body]
   * @param {boolean} [options.skipSignature]  Skip Ed25519 headers (for GET or bootstrap)
   * @returns {Promise<Response>}
   */
  async _fetch(path, options = {}) {
    const { method = 'GET', body, skipSignature = false } = options;
    const url = `${this.apiBase}${path}`;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };

    if (!skipSignature && this.identity && method !== 'GET') {
      const sigHeaders = await this.identity.buildSignatureHeaders(
        method,
        path,
        body ?? '',
        this.agentId,
      );
      Object.assign(headers, sigHeaders);
    }

    return fetch(url, { method, headers, body });
  }

  /**
   * Convenience: _fetch + parse JSON. Throws on non-ok.
   */
  async _api(path, options = {}) {
    const res = await this._fetch(path, options);
    let json;
    try {
      json = await res.json();
    } catch {
      json = {};
    }
    if (!res.ok) {
      const msg = (json && (json.message || json.error)) || JSON.stringify(json);
      throw new Error(`[${this.agentId}] API ${options.method || 'GET'} ${path} → ${res.status}: ${msg}`);
    }
    return json.result ?? json.data ?? json;
  }

  // ── Document helpers ──────────────────────────────────────────────────────

  /** Create a new document. Returns { slug, ... } */
  async createDocument(content, opts = {}) {
    return this._api('/api/v1/compress', {
      method: 'POST',
      body: JSON.stringify({
        content,
        format: opts.format ?? 'markdown',
        createdBy: this.agentId,
      }),
    });
  }

  /** Overwrite document content (creates new version). */
  async updateDocument(slug, content, changelog) {
    return this._api(`/api/v1/documents/${slug}`, {
      method: 'PUT',
      body: JSON.stringify({ content, changelog, createdBy: this.agentId }),
    });
  }

  /** Fetch raw text content of a document. */
  async getContent(slug) {
    const res = await this._fetch(`/api/v1/documents/${slug}/raw`);
    if (!res.ok) throw new Error(`[${this.agentId}] GET raw ${slug} → ${res.status}`);
    return res.text();
  }

  /** Get document metadata. */
  async getDocument(slug) {
    return this._api(`/api/v1/documents/${slug}`);
  }

  /** Transition lifecycle state. */
  async transition(slug, state, reason) {
    return this._api(`/api/v1/documents/${slug}/transition`, {
      method: 'POST',
      body: JSON.stringify({ state, reason }),
    });
  }

  /** Get current approvals for a document. */
  async getApprovals(slug) {
    return this._api(`/api/v1/documents/${slug}/approvals`);
  }

  /** Get BFT quorum status. */
  async getBftStatus(slug) {
    return this._api(`/api/v1/documents/${slug}/bft/status`);
  }

  /** Submit a BFT-signed approval. */
  async bftApprove(slug, atVersion, comment) {
    if (!this.identity) throw new Error('Agent not initialized');

    const timestampMs = Date.now();
    // Canonical: slug\nagentId\nstatus\natVersion\ntimestamp
    const canonical = [slug, this.agentId, 'approved', atVersion, timestampMs].join('\n');
    const msgBytes = new TextEncoder().encode(canonical);
    const sigBytes = await this.identity.sign(msgBytes);
    const sigHex = Buffer.from(sigBytes).toString('hex');

    return this._api(`/api/v1/documents/${slug}/bft/approve`, {
      method: 'POST',
      body: JSON.stringify({
        comment,
        atVersion,
        signatureHex: sigHex,
        timestampMs,
      }),
    });
  }

  // ── Event streaming ───────────────────────────────────────────────────────

  /**
   * Returns AsyncIterable<DocumentEventLogEntry> of live events via SSE.
   */
  watchEvents(slug, opts = {}) {
    return watchDocument(this.apiBase, slug, {
      apiKey: this.apiKey,
      signal: opts.signal,
    });
  }

  // ── Leases ────────────────────────────────────────────────────────────────

  _getLeaseManager() {
    if (!this._leaseManager) {
      this._leaseManager = new LeaseManager(this.apiBase, this.apiKey);
    }
    return this._leaseManager;
  }

  async acquireLease(slug, sectionId, durationSeconds = 30, reason) {
    // Each acquire creates a fresh LeaseManager (single-lease-at-a-time per manager)
    const lm = new LeaseManager(this.apiBase, this.apiKey);
    const lease = await lm.acquire(slug, sectionId, durationSeconds, reason);
    // Store it so release() can be called
    this._activeLeaseManagers = this._activeLeaseManagers ?? [];
    this._activeLeaseManagers.push(lm);
    return { lease, manager: lm };
  }

  async releaseLease(manager) {
    try {
      await manager.release();
    } catch {
      // Best-effort release
    }
  }

  // ── A2A messaging ─────────────────────────────────────────────────────────

  /**
   * Send a signed A2A envelope to another agent's inbox.
   *
   * @param {string} toAgentId   Recipient agent_id
   * @param {string} contentType MIME type, e.g. 'application/json'
   * @param {object} payload     JSON-serialisable payload
   */
  async sendA2A(toAgentId, contentType, payload) {
    if (!this.identity) throw new Error('Agent not initialized');

    const payloadJson = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64');
    const nonce = randomBytes(16).toString('hex');
    const timestampMs = Date.now();

    // Build canonical string matching what the backend verifies:
    // from\nto\nnonce\ntimestamp_ms\ncontent_type\npayload_hash_hex
    const payloadHashHex = createHash('sha256').update(payloadJson, 'utf8').digest('hex');
    const canonical = [
      this.agentId,
      toAgentId,
      nonce,
      timestampMs,
      contentType,
      payloadHashHex,
    ].join('\n');

    const canonicalBytes = Buffer.from(canonical, 'utf8');
    const sigBytes = await this.identity.sign(canonicalBytes);
    const sigHex = Buffer.from(sigBytes).toString('hex');

    const envelope = {
      from: this.agentId,
      to: toAgentId,
      nonce,
      timestamp_ms: timestampMs,
      content_type: contentType,
      payload: payloadB64,
      signature: sigHex,
    };

    const res = await this._fetch(`/api/v1/agents/${encodeURIComponent(toAgentId)}/inbox`, {
      method: 'POST',
      body: JSON.stringify({ envelope }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`[${this.agentId}] A2A → ${toAgentId} returned ${res.status}: ${txt}`);
    }
    console.log(`[${this.agentId}] A2A → ${toAgentId}: ${contentType}`);
    return res.json();
  }

  /**
   * Poll this agent's inbox for messages.
   * @returns {Promise<Array>}
   */
  async pollInbox() {
    try {
      const result = await this._api(`/api/v1/agents/${encodeURIComponent(this.agentId)}/inbox`);
      return Array.isArray(result) ? result : (result.messages ?? []);
    } catch {
      return [];
    }
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  log(msg) {
    console.log(`[${this.agentId}] ${msg}`);
  }
}
