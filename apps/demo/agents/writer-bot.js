/**
 * WriterBot — reference agent that creates and updates document sections.
 *
 * Behaviour:
 *  1. Creates (or receives slug via env) a new Markdown document.
 *  2. Acquires an advisory lease on each section before writing.
 *  3. Pushes section content via CRDT WebSocket (loro-sync-v1), NOT REST PUT.
 *  4. Transitions the document to REVIEW after all sections are written.
 *  5. Listens for A2A "request-summary" messages and delegates to SummarizerBot.
 *
 * CRDT writes (T381):
 *  - Opens /api/v1/documents/:slug/sections/:sid/collab via WebSocket.
 *  - Uses loro-sync-v1 subprotocol (binary framing: 0x01 SyncStep1 / 0x03 Update).
 *  - Generates Loro update bytes via crdt_make_incremental_update from the SDK
 *    (llmtxt/crdt-primitives) — no direct loro-crdt import in demo code (SSoT).
 *  - Handles reconnection with exponential backoff on abnormal closure (1006).
 *
 * Environment:
 *   LLMTXT_API_KEY   (required)
 *   LLMTXT_API_BASE  (optional, defaults to https://api.llmtxt.my)
 *   DEMO_SLUG        (optional; if set, appends sections to an existing doc)
 *   DEMO_DURATION_MS (optional; how long to run, default 60000)
 */

import {
  crdt_apply_update,
  crdt_make_incremental_update,
  crdt_new_doc,
} from 'llmtxt/crdt-primitives';
import { LeaseConflictError } from 'llmtxt';
import { AgentBase } from './shared/base.js';

const AGENT_ID = 'writerbot-demo';
const SUMMARIZER_ID = 'summarizerbot-demo';
const INTERVAL_MS = 4000;
const DEMO_DURATION_MS = Number(process.env.DEMO_DURATION_MS ?? 60_000);

/** Loro binary message type constants (loro-sync-v1, spec P1 §3.2). */
const MSG_SYNC_STEP_1 = 0x01;
const MSG_SYNC_STEP_2 = 0x02;
const MSG_UPDATE      = 0x03;

/** Prepend a 1-byte type prefix to a Uint8Array payload; return ArrayBuffer for WS.send(). */
function framed(msgType, payload) {
  const out = new Uint8Array(1 + payload.length);
  out[0] = msgType;
  out.set(payload, 1);
  return out.buffer;
}

// Simulated section content — in real usage, an LLM would generate this.
const SECTIONS = [
  {
    id: 'introduction',
    heading: '# Introduction',
    content: `LLMtxt is a collaborative document protocol built for AI agents.
It provides primitive operations — compression, patching, CRDT merges, progressive
disclosure, BFT consensus, and signed identity — so that multiple agents can safely
edit the same document without conflicts.`,
  },
  {
    id: 'architecture',
    heading: '## Architecture',
    content: `The system is split into three layers:

1. **Core primitives** (crates/llmtxt-core): Rust/WASM — hashing, compression, CRDT, Ed25519.
2. **SDK** (packages/llmtxt): TypeScript wrappers — watchDocument, LeaseManager, AgentIdentity.
3. **Backend** (apps/backend): Fastify — REST + WebSocket + SSE + BFT consensus.

Agents communicate through a REST API backed by Postgres and a CRDT sync layer.`,
  },
  {
    id: 'multi-agent',
    heading: '## Multi-Agent Collaboration',
    content: `Four reference agents demonstrate the protocol:

- **WriterBot**: Creates and expands sections; acquires advisory leases before editing.
- **ReviewerBot**: Watches events, critiques content, adds inline comments.
- **ConsensusBot**: Collects BFT-signed approvals; transitions to APPROVED at quorum.
- **SummarizerBot**: Maintains a rolling executive summary updated on each write event.

Agents communicate out-of-band via A2A message envelopes signed with Ed25519.`,
  },
  {
    id: 'getting-started',
    heading: '## Getting Started',
    content: `Install the SDK:

\`\`\`bash
npm install llmtxt
\`\`\`

Create an agent identity and register it:

\`\`\`ts
import { AgentIdentity } from 'llmtxt';
const identity = await AgentIdentity.generate();
// POST /api/v1/agents/keys  { agent_id, pubkey_hex: identity.pubkeyHex }
\`\`\`

Then use watchDocument to stream real-time events:

\`\`\`ts
import { watchDocument } from 'llmtxt';
for await (const evt of watchDocument(apiBase, slug)) {
  console.log(evt.event_type, evt.payload);
}
\`\`\``,
  },
];

/**
 * CrdtSectionWriter — manages a loro-sync-v1 WebSocket connection to a single
 * section's collab endpoint. Handles the SyncStep1/SyncStep2 handshake and
 * exposes sendUpdate() to push incremental Loro update frames.
 *
 * Reconnection: exponential backoff (1s → 2s → 4s → 8s → 16s) on abnormal
 * closure (e.g. 1006 due to network interruption). Stops after maxRetries.
 */
class CrdtSectionWriter {
  /**
   * @param {string} wsBase     WebSocket base URL (ws:// or wss://)
   * @param {string} slug       Document slug
   * @param {string} sectionId  Section identifier (e.g. 'introduction')
   * @param {string} apiKey     Bearer token — passed as ?token= query param
   * @param {(msg: string) => void} log  Logger function
   */
  constructor(wsBase, slug, sectionId, apiKey, log) {
    this._wsBase = wsBase;
    this._slug = slug;
    this._sectionId = sectionId;
    this._apiKey = apiKey;
    this._log = log;
    /** @type {WebSocket|null} */
    this._ws = null;
    /**
     * Local Loro state buffer maintained across reconnections.
     * Starts as a fresh empty doc; advanced on each sendUpdate() call.
     * Uses crdt_new_doc() from SDK primitives — no direct loro-crdt import.
     */
    this._localState = crdt_new_doc();
    this._closed = false;
    this._retryCount = 0;
    this._maxRetries = 5;
    /** Updates queued before the WS connection is OPEN. */
    this._pendingUpdates = [];
    /**
     * Resolvers for waitUntilOpen() callers; flushed on the 'open' event.
     * @type {Array<() => void>}
     */
    this._openResolvers = [];
  }

  /** Build the authenticated collab WebSocket URL for this section. */
  _buildUrl() {
    const path = `/api/v1/documents/${encodeURIComponent(this._slug)}/sections/${encodeURIComponent(this._sectionId)}/collab`;
    return `${this._wsBase}${path}?token=${encodeURIComponent(this._apiKey)}`;
  }

  /**
   * Open the WebSocket and initiate the loro-sync-v1 handshake.
   *
   * SyncStep1 (0x01): sends empty VersionVector payload, signalling "I have
   * nothing — send me everything." The server responds with SyncStep2 (0x02)
   * carrying the full section state, which we receive but do not need to apply
   * (writer-bot is only concerned with pushing updates, not reading back state).
   */
  connect() {
    if (this._closed) return;

    const url = this._buildUrl();
    this._log(`CRDT[${this._sectionId}]: connecting (loro-sync-v1)`);

    const ws = new globalThis.WebSocket(url, ['loro-sync-v1']);
    ws.binaryType = 'arraybuffer';
    this._ws = ws;

    ws.addEventListener('open', () => {
      this._log(`CRDT[${this._sectionId}]: connected`);
      this._retryCount = 0;

      // SyncStep1: empty VersionVector → ask server for full state diff.
      ws.send(framed(MSG_SYNC_STEP_1, new Uint8Array(0)));

      // Flush any updates that were queued before the connection was ready.
      for (const updateBytes of this._pendingUpdates) {
        ws.send(framed(MSG_UPDATE, updateBytes));
      }
      this._pendingUpdates = [];

      // Notify all waiters (e.g. callers of waitUntilOpen).
      for (const resolve of this._openResolvers) resolve();
      this._openResolvers = [];
    });

    ws.addEventListener('message', (event) => {
      const raw = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : new Uint8Array(event.data);
      if (raw.length === 0 || raw[0] === 0x00 || raw[0] === 0x7b) return;

      const msgType = raw[0];
      const payload = raw.subarray(1);

      if (msgType === MSG_SYNC_STEP_2) {
        // Server diff received — acknowledged; we don't need to import it
        // because writer-bot only pushes, it doesn't read back state.
        this._log(`CRDT[${this._sectionId}]: SyncStep2 received (${payload.length} bytes)`);
      } else if (msgType === MSG_UPDATE) {
        this._log(`CRDT[${this._sectionId}]: peer Update received (${payload.length} bytes)`);
      }
    });

    ws.addEventListener('error', () => {
      this._log(`CRDT[${this._sectionId}]: WebSocket error`);
    });

    ws.addEventListener('close', (event) => {
      this._log(`CRDT[${this._sectionId}]: closed (code=${event.code})`);
      this._ws = null;

      if (!this._closed && this._retryCount < this._maxRetries) {
        const delayMs = Math.min(1000 * 2 ** this._retryCount, 16_000);
        this._retryCount++;
        this._log(`CRDT[${this._sectionId}]: reconnecting in ${delayMs}ms (attempt ${this._retryCount}/${this._maxRetries})`);
        setTimeout(() => this.connect(), delayMs);
      } else if (this._retryCount >= this._maxRetries) {
        this._log(`CRDT[${this._sectionId}]: max reconnect attempts exhausted`);
      }
    });
  }

  /**
   * Resolve once the WebSocket is OPEN, or after timeoutMs (non-fatal).
   *
   * @param {number} [timeoutMs=5000]
   * @returns {Promise<void>}
   */
  waitUntilOpen(timeoutMs = 5000) {
    if (this._ws && this._ws.readyState === globalThis.WebSocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this._openResolvers.indexOf(resolve);
        if (idx !== -1) this._openResolvers.splice(idx, 1);
        resolve(); // non-fatal timeout — WS may still connect later
      }, timeoutMs);
      this._openResolvers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Append `text` to this section via a Loro CRDT incremental update.
   *
   * Uses crdt_make_incremental_update() from llmtxt/crdt-primitives (SSoT —
   * no direct loro-crdt import in demo code). The resulting Loro binary update
   * bytes are sent as a 0x03 MSG_UPDATE frame over the WebSocket.
   *
   * If the WS is not yet OPEN, the update is queued and flushed on connect.
   *
   * @param {string} text  Text to append to the section's Loro "content" root.
   * @returns {number}     Number of update bytes sent (or queued).
   */
  sendUpdate(text) {
    // crdt_make_incremental_update produces Loro binary bytes for the delta
    // operation of appending `text` to the section's "content" LoroText root.
    // It reads the current content length from this._localState to determine
    // the insert position, so the local state MUST be current.
    const updateBuf = crdt_make_incremental_update(this._localState, text);

    // Advance local state: apply the update we just sent so that the next
    // sendUpdate() call produces a correct delta relative to the new state.
    // crdt_apply_update merges the update blob into the existing snapshot.
    this._localState = crdt_apply_update(this._localState, updateBuf);

    const updateBytes = new Uint8Array(updateBuf.buffer, updateBuf.byteOffset, updateBuf.byteLength);

    if (this._ws && this._ws.readyState === globalThis.WebSocket.OPEN) {
      this._ws.send(framed(MSG_UPDATE, updateBytes));
      this._log(`CRDT[${this._sectionId}]: sent Update (${updateBytes.length} bytes)`);
    } else {
      this._pendingUpdates.push(updateBytes);
      this._log(`CRDT[${this._sectionId}]: queued Update (${updateBytes.length} bytes — WS not ready)`);
    }
    return updateBytes.length;
  }

  /** Permanently close the WebSocket connection (no more reconnects). */
  close() {
    this._closed = true;
    if (this._ws && (
      this._ws.readyState === globalThis.WebSocket.OPEN ||
      this._ws.readyState === globalThis.WebSocket.CONNECTING
    )) {
      this._ws.close(1000, 'writer done');
    }
  }
}

class WriterBot extends AgentBase {
  constructor() {
    super(AGENT_ID);
    this.slug = process.env.DEMO_SLUG ?? null;
    /** @type {Map<string, CrdtSectionWriter>} Active CRDT writers by section ID. */
    this._crdtWriters = new Map();
    /** Cumulative CRDT bytes sent across all sections — reported for observer verification. */
    this.crdtBytesSent = 0;
  }

  async run() {
    await this.init();
    const deadline = Date.now() + DEMO_DURATION_MS;

    // Step 1: create or adopt document
    if (!this.slug) {
      this.log('Creating new demo document...');
      const initial = this._buildDocument([SECTIONS[0]]);
      const result = await this.createDocument(initial, { format: 'markdown' });
      this.slug = result.slug;
      this.log(`Created document: ${this.slug}`);
      this.log(`Signed write: POST /api/v1/compress (initial doc creation)`);
      // Broadcast slug so other agents can pick it up via env
      process.stdout.write(`DEMO_SLUG=${this.slug}\n`);
    } else {
      this.log(`Adopting existing document: ${this.slug}`);
    }

    // Build WebSocket base URL: http → ws, https → wss
    const wsBase = this.apiBase.startsWith('https://')
      ? this.apiBase.replace('https://', 'wss://')
      : this.apiBase.replace('http://', 'ws://');

    let sectionIdx = 1;

    // Step 2: iteratively push sections via CRDT WebSocket
    while (Date.now() < deadline && sectionIdx < SECTIONS.length) {
      await this.sleep(INTERVAL_MS);
      const section = SECTIONS[sectionIdx];

      // Acquire advisory lease before writing
      let leaseHandle = null;
      try {
        leaseHandle = await this.acquireLease(this.slug, section.id, 30, `WriterBot expanding ${section.id}`);
        this.log(`Lease acquired for section: ${section.id}`);
      } catch (err) {
        if (err instanceof LeaseConflictError || err.name === 'LeaseConflictError') {
          this.log(`Lease conflict on ${section.id} (held by ${err.holder}) — skipping this round`);
          continue;
        }
        this.log(`Lease acquire error (non-fatal): ${err.message}`);
      }

      try {
        // Open (or reuse) a CRDT WebSocket writer for this section.
        let writer = this._crdtWriters.get(section.id);
        if (!writer) {
          writer = new CrdtSectionWriter(
            wsBase,
            this.slug,
            section.id,
            this.apiKey,
            this.log.bind(this),
          );
          this._crdtWriters.set(section.id, writer);
          writer.connect();
          // Wait up to 5s for the WS handshake before trying to send
          await writer.waitUntilOpen(5000);
        }

        // Build full section text and push as a Loro CRDT update
        const sectionText = `${section.heading}\n\n${section.content}\n\n`;
        const bytesSent = writer.sendUpdate(sectionText);
        this.crdtBytesSent += bytesSent;
        this.log(`Section "${section.id}" written via CRDT WS (${bytesSent} bytes)`);

        sectionIdx++;

        // Notify SummarizerBot via A2A
        try {
          await this.sendA2A(SUMMARIZER_ID, 'application/json', {
            type: 'request-summary',
            slug: this.slug,
            trigger: 'section-added',
            section: section.id,
          });
        } catch (a2aErr) {
          this.log(`A2A to summarizer failed (non-fatal): ${a2aErr.message}`);
        }
      } finally {
        if (leaseHandle) {
          await this.releaseLease(leaseHandle.manager);
        }
      }
    }

    // Close all CRDT writers cleanly
    for (const [sid, writer] of this._crdtWriters) {
      writer.close();
      this.log(`CRDT[${sid}]: writer closed`);
    }
    this.log(`Total CRDT bytes sent via WebSocket: ${this.crdtBytesSent}`);

    // Step 3: transition to REVIEW
    if (this.slug) {
      try {
        await this.transition(this.slug, 'REVIEW', 'WriterBot: initial draft complete, requesting review');
        this.log(`Document ${this.slug} transitioned to REVIEW`);
        this.log(`Signed write: POST /api/v1/documents/${this.slug}/transition (REVIEW)`);
      } catch (err) {
        this.log(`Transition to review failed: ${err.message}`);
      }
    }

    this.log('Run complete.');
  }

  _buildDocument(sections) {
    return sections.map((s) => `${s.heading}\n\n${s.content}`).join('\n\n');
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

const bot = new WriterBot();
bot.run().catch((err) => {
  console.error('[writerbot-demo] Fatal error:', err);
  process.exit(1);
});
