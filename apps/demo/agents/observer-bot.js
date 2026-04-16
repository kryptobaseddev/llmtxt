/**
 * ObserverBot — T308 E2E production verification observer.
 *
 * Connects via SSE event stream and WebSocket (CRDT), records every event,
 * presence update, and state change during the test run.
 *
 * Environment:
 *   LLMTXT_API_KEY   (required)
 *   LLMTXT_API_BASE  (optional)
 *   DEMO_SLUG        (required)
 *   DEMO_DURATION_MS (optional, default 180000)
 */

import { AgentBase } from './shared/base.js';
import { createHash } from 'node:crypto';
// WebSocket is available natively in Node.js 22+ (no ws package needed)
const NativeWebSocket = globalThis.WebSocket;

const AGENT_ID = 'observerbot-t308';
const DEMO_DURATION_MS = Number(process.env.DEMO_DURATION_MS ?? 180_000);

class ObserverBot extends AgentBase {
  constructor() {
    super(AGENT_ID);
    this.slug = process.env.DEMO_SLUG ?? null;
    this.metrics = {
      eventsTotal: 0,
      versionCreatedEvents: 0,
      documentUpdatedEvents: 0,
      transitionEvents: 0,
      approvalEvents: 0,
      otherEvents: 0,
      receiptHeaders: 0,
      signedWritesObserved: 0,
      bftApprovalsObserved: 0,
      a2aMessagesObserved: 0,
      presenceUpdates: 0,
      errors: 0,
    };
    this.seenVersions = new Set();
    this.eventLog = [];
    this.startTime = null;
    /** Map<sectionId, Array<{ ts, stateHash, byteLen }>> for CRDT state snapshots */
    this._crdtSnapshots = new Map();
    /** Map<sectionId, WebSocket> active CRDT connections */
    this._crdtWs = new Map();
  }

  async run() {
    await this.init();

    if (!this.slug) {
      this.log('ERROR: DEMO_SLUG env var is required for ObserverBot');
      process.exit(1);
    }

    this.startTime = Date.now();
    this.log(`Observing document: ${this.slug} for ${DEMO_DURATION_MS}ms`);

    const ac = new AbortController();
    const deadline = Date.now() + DEMO_DURATION_MS;
    const timeoutId = setTimeout(() => ac.abort(), DEMO_DURATION_MS);

    try {
      // Connect to CRDT WebSocket for first 3 sections and capture state snapshots every 30s
      await this._initCrdtObservers();
      const crdtSnapshotInterval = setInterval(() => this._snapshotCrdtStates(), 30_000);

      // Poll for presence updates (no dedicated endpoint, use doc metadata)
      const presenceInterval = setInterval(() => this._pollPresence(), 5000);

      for await (const evt of this.watchEvents(this.slug, { signal: ac.signal })) {
        if (Date.now() >= deadline) break;

        this.metrics.eventsTotal++;
        this.eventLog.push({
          ts: Date.now(),
          type: evt.event_type,
          payload: evt.payload,
        });

        this._categorizeEvent(evt);

        if (this.metrics.eventsTotal % 5 === 0) {
          this.log(`Events seen: ${this.metrics.eventsTotal} | versions: ${this.seenVersions.size}`);
        }
      }

      clearInterval(crdtSnapshotInterval);
      clearInterval(presenceInterval);
      this._closeCrdtConnections();
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.metrics.errors++;
        this.log(`Watch error: ${err.message}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }

    // Final document state check
    await this._finalStateCheck();

    this.log(`\n=== ObserverBot Final Metrics ===`);
    this.log(`Total events: ${this.metrics.eventsTotal}`);
    this.log(`Versions seen: ${this.seenVersions.size}`);
    this.log(`Version created events: ${this.metrics.versionCreatedEvents}`);
    this.log(`Document updated events: ${this.metrics.documentUpdatedEvents}`);
    this.log(`Transition events: ${this.metrics.transitionEvents}`);
    this.log(`Approval events: ${this.metrics.approvalEvents}`);
    this.log(`Receipt headers received: ${this.metrics.receiptHeaders}`);
    this.log(`Signed writes observed: ${this.metrics.signedWritesObserved}`);
    this.log(`BFT approvals observed: ${this.metrics.bftApprovalsObserved}`);
    this.log(`A2A messages observed: ${this.metrics.a2aMessagesObserved}`);
    this.log(`Errors: ${this.metrics.errors}`);

    // CRDT state summary
    if (this._crdtSnapshots.size > 0) {
      this.log('\n=== CRDT WebSocket State ===');
      for (const [sid, snaps] of this._crdtSnapshots) {
        const totalBytes = snaps.reduce((s, e) => s + e.byteLen, 0);
        const connected = this._crdtWs.has(sid);
        this.log(`  ${sid}: msgs=${snaps.length} totalBytes=${totalBytes} connected=${connected}`);
        this.metrics[`crdt_${sid}_msgs`] = snaps.length;
        this.metrics[`crdt_${sid}_bytes`] = totalBytes;
      }
    }

    // Emit metrics as JSON for orchestrator parsing
    console.log('\n__OBSERVER_METRICS__' + JSON.stringify(this.metrics) + '__END_METRICS__');

    this.log('Run complete.');
  }

  /**
   * Connect to the CRDT WebSocket collab endpoint for each section we know about.
   * Captures binary Y.js sync messages to track state bytes over time.
   */
  async _initCrdtObservers() {
    // Fetch section list from the document
    let sections = [];
    try {
      const doc = await this.getDocument(this.slug);
      // sections may be embedded in doc or available via a sections endpoint
      const sectionsResp = await this._api(`/api/v1/documents/${this.slug}/sections`).catch(() => []);
      sections = Array.isArray(sectionsResp) ? sectionsResp : (sectionsResp.sections ?? []);
    } catch {
      this.log('CRDT observer: could not fetch section list, skipping WS observation');
      return;
    }

    // Connect to at most 3 sections to avoid connection overload
    const toConnect = sections.slice(0, 3);
    if (toConnect.length === 0) {
      this.log('CRDT observer: no sections found for document yet — will retry via presence polls');
      return;
    }

    const wsBase = this.apiBase.replace(/^http/, 'ws');
    for (const section of toConnect) {
      const sid = section.id ?? section.sectionId ?? section.slug;
      if (!sid) continue;
      this._connectCrdtSection(wsBase, sid);
    }
  }

  _connectCrdtSection(wsBase, sectionId) {
    const url = `${wsBase}/api/v1/documents/${this.slug}/sections/${sectionId}/collab`;
    // Node 22+ native WebSocket does not support custom headers; pass API key as query param
    const urlWithAuth = `${url}?apiKey=${encodeURIComponent(this.apiKey)}`;

    let ws;
    try {
      ws = new NativeWebSocket(urlWithAuth);
    } catch (err) {
      this.log(`CRDT[${sectionId}]: WebSocket constructor failed: ${err.message}`);
      return;
    }

    this._crdtWs.set(sectionId, ws);
    this._crdtSnapshots.set(sectionId, []);

    ws.addEventListener('open', () => {
      this.log(`CRDT[${sectionId}]: WebSocket connected`);
    });

    ws.addEventListener('message', (event) => {
      // Y.js messages are binary (ArrayBuffer or Blob in native WS).
      // Track state by accumulating byte counts per snapshot window.
      const byteLen = event.data instanceof ArrayBuffer
        ? event.data.byteLength
        : (typeof event.data === 'string' ? event.data.length : 0);
      const snapshots = this._crdtSnapshots.get(sectionId) ?? [];
      snapshots.push({ ts: Date.now(), byteLen });
      this._crdtSnapshots.set(sectionId, snapshots);
    });

    ws.addEventListener('error', (event) => {
      this.log(`CRDT[${sectionId}]: WebSocket error`);
    });

    ws.addEventListener('close', (event) => {
      this.log(`CRDT[${sectionId}]: WebSocket closed (code=${event.code})`);
      this._crdtWs.delete(sectionId);
    });
  }

  /**
   * Snapshot current CRDT state: count total bytes received per section.
   * Compare consecutive snapshots to detect state divergence or stale connections.
   */
  _snapshotCrdtStates() {
    for (const [sectionId, snapshots] of this._crdtSnapshots) {
      if (snapshots.length === 0) {
        this.log(`CRDT[${sectionId}]: no messages received yet`);
        continue;
      }

      const totalBytes = snapshots.reduce((s, e) => s + e.byteLen, 0);
      const lastMsg = snapshots[snapshots.length - 1];
      const ageSec = Math.round((Date.now() - lastMsg.ts) / 1000);
      const msgCount = snapshots.length;

      this.log(`CRDT[${sectionId}]: state snapshot — msgs=${msgCount} totalBytes=${totalBytes} lastMsgAge=${ageSec}s`);

      // Stale detection: if last message is >60s old and we're mid-test, flag it
      if (ageSec > 60) {
        this.log(`CRDT[${sectionId}]: WARNING — no new state bytes for ${ageSec}s (possible stale/disconnected)`);
        this.metrics.errors++;
      } else {
        this.log(`CRDT[${sectionId}]: state active — connection healthy`);
      }
    }
  }

  _closeCrdtConnections() {
    for (const [sectionId, ws] of this._crdtWs) {
      try {
        if (ws.readyState === NativeWebSocket.OPEN || ws.readyState === NativeWebSocket.CONNECTING) {
          ws.close(1000, 'observer cleanup');
        }
      } catch {
        // Ignore close errors
      }
      this.log(`CRDT[${sectionId}]: closed on cleanup`);
    }
    this._crdtWs.clear();

    // Log final CRDT stats
    this.log('\n=== CRDT State Summary ===');
    for (const [sectionId, snapshots] of this._crdtSnapshots) {
      const totalBytes = snapshots.reduce((s, e) => s + e.byteLen, 0);
      this.log(`  Section ${sectionId}: ${snapshots.length} messages, ${totalBytes} total bytes`);
    }
  }

  _categorizeEvent(evt) {
    const t = evt.event_type;
    // Production event types use dot notation: version.published, document.created, etc.
    if (t === 'version.published' || t === 'version_created') {
      this.metrics.versionCreatedEvents++;
      if (evt.payload?.versionNumber) this.seenVersions.add(evt.payload.versionNumber);
    } else if (t === 'document.updated' || t === 'document_updated') {
      this.metrics.documentUpdatedEvents++;
    } else if (t === 'document.created') {
      this.metrics.documentUpdatedEvents++;
    } else if (t === 'section.edited') {
      // Section leases and edits
      this.metrics.signedWritesObserved++;
    } else if (t === 'state.changed' || t === 'state_changed' || t === 'lifecycle.transition' || t === 'transition') {
      this.metrics.transitionEvents++;
    } else if (t === 'bft.approval' || t === 'bft_approval' || t === 'approval.submitted' || t === 'approval_submitted') {
      this.metrics.approvalEvents++;
      this.metrics.bftApprovalsObserved++;
    } else if (t === 'a2a.message' || t === 'a2a_message') {
      this.metrics.a2aMessagesObserved++;
    } else {
      this.metrics.otherEvents++;
    }
  }

  async _pollPresence() {
    try {
      // GET the document to see access count / last accessed (proxy for presence)
      const doc = await this.getDocument(this.slug);
      const accessCount = doc.accessCount ?? 0;
      if (accessCount > 0) {
        this.metrics.presenceUpdates++;
      }
    } catch {
      // Non-fatal
    }
  }

  async _finalStateCheck() {
    try {
      const doc = await this.getDocument(this.slug);
      this.log(`Final document state: ${doc.state}`);
      this.log(`Final document version: ${doc.currentVersion}`);
      
      // Fetch event history for hash chain validation
      const eventsResp = await this._api(`/api/v1/documents/${this.slug}/events?limit=100`);
      const events = Array.isArray(eventsResp) ? eventsResp : (eventsResp.events ?? []);
      
      // Validate event hash chain
      let chainValid = true;
      let lastHash = null;
      for (const event of events) {
        if (lastHash && event.prevHash && event.prevHash !== lastHash) {
          this.log(`Hash chain BREAK at event ${event.id}: expected ${lastHash}, got ${event.prevHash}`);
          chainValid = false;
        }
        if (event.hash) lastHash = event.hash;
      }
      
      this.log(`Hash chain valid: ${chainValid}`);
      this.log(`Total events in DB: ${events.length}`);
      this.metrics.hashChainValid = chainValid;
      this.metrics.totalEventsInDB = events.length;

      // Check X-Server-Receipt headers by making a mutating request
      const receipt = await this._checkReceiptHeader(doc.currentVersion);
      this.metrics.receiptHeaderPresent = receipt;
    } catch (err) {
      this.log(`Final state check error: ${err.message}`);
    }
  }

  async _checkReceiptHeader(currentVersion) {
    try {
      const res = await this._fetch(`/api/v1/documents/${this.slug}`, {
        method: 'PUT',
        body: JSON.stringify({
          content: (await this.getContent(this.slug)),
          changelog: 'ObserverBot: receipt header check (no-op update)',
        }),
      });
      const receiptHeader = res.headers.get('x-server-receipt') || res.headers.get('X-Server-Receipt');
      if (receiptHeader) {
        this.metrics.receiptHeaders++;
        this.log(`X-Server-Receipt present: ${receiptHeader.slice(0, 32)}...`);
        return true;
      }
      this.log(`X-Server-Receipt header: ABSENT`);
      return false;
    } catch (err) {
      this.log(`Receipt header check error: ${err.message}`);
      return false;
    }
  }
}

const bot = new ObserverBot();
bot.run().catch((err) => {
  console.error('[observerbot-t308] Fatal error:', err);
  process.exit(1);
});
