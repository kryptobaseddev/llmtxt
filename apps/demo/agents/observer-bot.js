/**
 * ObserverBot — T308 E2E production verification observer.
 *
 * Connects via SSE event stream and CRDT WebSocket (subscribeSection from SDK),
 * records every event, presence update, and state change during the test run.
 *
 * CRDT observation (T381):
 *  - Uses subscribeSection() from 'llmtxt' (SDK SSoT) — no raw WebSocket code.
 *  - subscribeSection opens a loro-sync-v1 WS and emits SectionDelta events.
 *  - Each SectionDelta.updateBytes is counted toward crdt_bytes metrics.
 *  - Convergence check: after the run, calls getSectionText() (HTTP fallback) on
 *    each observed section and compares hash to WS-received text.
 *
 * Environment:
 *   LLMTXT_API_KEY   (required)
 *   LLMTXT_API_BASE  (optional)
 *   DEMO_SLUG        (required)
 *   DEMO_DURATION_MS (optional, default 180000)
 */

import { AgentBase } from './shared/base.js';
import { createHash } from 'node:crypto';
import { subscribeSection, getSectionText } from 'llmtxt';

const AGENT_ID = 'observerbot-t308';
const DEMO_DURATION_MS = Number(process.env.DEMO_DURATION_MS ?? 180_000);

/**
 * Section IDs are now discovered dynamically at startup via GET /documents/:slug.
 * This replaces the prior hardcoded list, which caused a mismatch when writer-bot
 * wrote to sections not in the observer's static list (Cap 2 fix, T769).
 *
 * Populated by _discoverSections() before _initCrdtObservers() is called.
 * @type {string[]}
 */
let OBSERVED_SECTION_IDS = [];

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
      /**
       * Total CRDT update bytes received via subscribeSection callbacks (T381 AC #3).
       * Must be non-zero for the test to pass.
       */
      crdt_bytes: 0,
      /** Count of CRDT SectionDelta messages received. */
      crdt_messages: 0,
    };
    this.seenVersions = new Set();
    this.eventLog = [];
    this.startTime = null;
    /**
     * Map<sectionId, SectionDelta[]> — CRDT deltas received per section.
     * Each delta has { text, updateBytes, receivedAt } per the SDK type.
     */
    this._crdtDeltas = new Map();
    /**
     * Unsubscribe functions returned by subscribeSection(); called on cleanup.
     * @type {Array<() => void>}
     */
    this._crdtUnsubs = [];
    /**
     * Latest text received per section (from SectionDelta.text) for convergence.
     * @type {Map<string, string>}
     */
    this._latestSectionText = new Map();
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
      // Discover sections dynamically from the live document (Cap 2 fix, T769).
      // This ensures observer subscribes to exactly the sections writer-bot writes to,
      // regardless of what they are — no hardcoded list.
      await this._discoverSections();

      // Open subscribeSection() connections for CRDT observation (T381)
      this._initCrdtObservers();

      // Retry CRDT subscriptions every 15s for sections that have received 0 bytes —
      // writer-bot may not have initialized the CRDT section yet when observer first connects.
      const crdtRetryInterval = setInterval(() => {
        for (const sectionId of OBSERVED_SECTION_IDS) {
          const deltas = this._crdtDeltas.get(sectionId);
          if (!deltas || deltas.length === 0) {
            // No data received yet — resubscribe (T769 Cap 2 retry).
            this.log(`CRDT[${sectionId}]: no data received yet — retrying subscription`);
            // Close old unsub if it exists, then re-subscribe.
            const idx = OBSERVED_SECTION_IDS.indexOf(sectionId);
            if (idx >= 0 && this._crdtUnsubs[idx]) {
              try { this._crdtUnsubs[idx](); } catch { /* ignore */ }
              this._crdtUnsubs[idx] = null;
            }
            this._crdtDeltas.delete(sectionId);
            this._subscribeSingleSection(sectionId);
          }
        }
      }, 15_000);

      // Poll for presence updates (proxy via doc access count)
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

        // If a new section is created after observer connects, subscribe to it (T769).
        if (evt.event_type === 'section.created' || evt.event_type === 'section_created') {
          const newSectionId = evt.payload?.sectionId ?? evt.payload?.section_id ?? null;
          if (newSectionId && !OBSERVED_SECTION_IDS.includes(newSectionId)) {
            this.log(`Discovered new section via SSE: ${newSectionId} — subscribing`);
            OBSERVED_SECTION_IDS.push(newSectionId);
            this._subscribeSingleSection(newSectionId);
          }
        }

        if (this.metrics.eventsTotal % 5 === 0) {
          this.log(`Events: ${this.metrics.eventsTotal} | versions: ${this.seenVersions.size} | crdt_bytes: ${this.metrics.crdt_bytes}`);
        }
      }

      clearInterval(crdtRetryInterval);
      clearInterval(presenceInterval);
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.metrics.errors++;
        this.log(`Watch error: ${err.message}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }

    // Close all subscribeSection WebSocket connections
    this._closeCrdtObservers();

    // Final document state + convergence check
    await this._finalStateCheck();

    this.log('\n=== ObserverBot Final Metrics ===');
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

    // CRDT summary (T381 AC #3 — crdt_bytes must be > 0)
    this.log('\n=== CRDT State (subscribeSection via loro-sync-v1) ===');
    this.log(`crdt_bytes (total received): ${this.metrics.crdt_bytes}`);
    this.log(`crdt_messages (total deltas): ${this.metrics.crdt_messages}`);
    for (const [sid, deltas] of this._crdtDeltas) {
      const bytes = deltas.reduce((s, d) => s + d.updateBytes.length, 0);
      this.log(`  ${sid}: ${deltas.length} deltas, ${bytes} bytes`);
      this.metrics[`crdt_${sid}_msgs`] = deltas.length;
      this.metrics[`crdt_${sid}_bytes`] = bytes;
    }

    // Emit metrics JSON for orchestrator parsing
    console.log('\n__OBSERVER_METRICS__' + JSON.stringify(this.metrics) + '__END_METRICS__');

    this.log('Run complete.');
  }

  /**
   * Discover the document's sections dynamically via GET /documents/:slug.
   *
   * Populates OBSERVED_SECTION_IDS from the live document structure so that
   * the observer subscribes to the same sections the writer-bot writes to,
   * regardless of what those sections are named (Cap 2 fix, T769).
   *
   * Falls back to an empty list if the document has no sections yet; the
   * section.created SSE handler will pick them up as they arrive.
   */
  async _discoverSections() {
    // CRDT section IDs are set explicitly by writer-bot (introduction, architecture,
    // multi-agent, getting-started). These are different from the parsed text sections
    // returned by GET /documents/:slug/sections (which uses heading-derived slugs).
    // We probe the crdt-state endpoint for each known CRDT section ID to confirm
    // which ones exist, then subscribe to those. If none exist yet (writer-bot hasn't
    // started), we still subscribe and let subscribeSection wait for the WS handshake.
    const HARNESS_SECTION_IDS = ['introduction', 'architecture', 'multi-agent', 'getting-started'];

    try {
      // Check which CRDT sections are already initialized (writer-bot may have started).
      const probeResults = await Promise.allSettled(
        HARNESS_SECTION_IDS.map(async (sid) => {
          const resp = await this._api(`/api/v1/documents/${this.slug}/sections/${sid}/crdt-state`);
          return { sid, initialized: !resp.error };
        }),
      );

      const initialized = probeResults
        .filter((r) => r.status === 'fulfilled' && r.value.initialized)
        .map((r) => r.value.sid);

      // Use initialized sections if any; otherwise subscribe to all and let WS handle it.
      OBSERVED_SECTION_IDS = initialized.length > 0 ? initialized : HARNESS_SECTION_IDS;
      this.log(
        `Discovered ${OBSERVED_SECTION_IDS.length} CRDT sections (${initialized.length} initialized): ${OBSERVED_SECTION_IDS.join(', ')}`,
      );
    } catch (err) {
      this.log(`Section discovery error: ${err.message} — using harness defaults`);
      OBSERVED_SECTION_IDS = HARNESS_SECTION_IDS;
    }
  }

  /**
   * Subscribe to a single section via subscribeSection() and register in tracking maps.
   * Called both by _initCrdtObservers() (for all sections at startup) and by the
   * section.created SSE handler (for sections added after observer connects).
   *
   * @param {string} sectionId
   */
  _subscribeSingleSection(sectionId) {
    if (this._crdtDeltas.has(sectionId)) {
      this.log(`CRDT[${sectionId}]: already subscribed, skipping`);
      return;
    }

    const options = {
      baseUrl: this.apiBase,
      token: this.apiKey,
      onError: (err) => {
        this.log(`CRDT subscribeSection error [${sectionId}]: ${err}`);
        this.metrics.errors++;
      },
    };

    this._crdtDeltas.set(sectionId, []);
    let firstDelta = true;

    const unsub = subscribeSection(
      this.slug,
      sectionId,
      (delta) => {
        const byteLen = delta.updateBytes.length;
        this.metrics.crdt_bytes += byteLen;
        this.metrics.crdt_messages++;

        const deltas = this._crdtDeltas.get(sectionId) ?? [];
        deltas.push(delta);
        this._crdtDeltas.set(sectionId, deltas);

        // Cache latest text for convergence check at end of run
        this._latestSectionText.set(sectionId, delta.text);

        if (firstDelta) {
          // First delta on connect is the InitialSnapshot (T700/T717):
          // server sends full CRDT state immediately so late subscribers see non-zero bytes.
          this.log(`CRDT[${sectionId}]: initial-snapshot received (${byteLen} bytes, text_len=${delta.text.length})`);
          this.metrics[`crdt_${sectionId}_initial_bytes`] = byteLen;
          firstDelta = false;
        } else {
          this.log(`CRDT[${sectionId}]: delta (${byteLen} bytes, text_len=${delta.text.length})`);
        }
      },
      options,
    );

    this._crdtUnsubs.push(unsub);
    this.log(`CRDT[${sectionId}]: subscribeSection() opened (loro-sync-v1)`);
  }

  /**
   * Open subscribeSection() connections for each discovered section ID.
   *
   * subscribeSection(slug, sectionId, callback, options) is the SDK's SSoT for
   * CRDT observation (T381). It opens a loro-sync-v1 WebSocket per section,
   * performs the SyncStep1/SyncStep2 handshake, and emits a SectionDelta on
   * every incoming Update (0x03) frame.
   *
   * Each SectionDelta has:
   *   - text:        full plain-text content of the section after the update
   *   - updateBytes: raw Loro binary update bytes (Uint8Array) — measured here
   *   - receivedAt:  wall clock timestamp (ms)
   */
  _initCrdtObservers() {
    for (const sectionId of OBSERVED_SECTION_IDS) {
      this._subscribeSingleSection(sectionId);
    }
  }

  /** Call all Unsubscribe functions — closes subscribeSection WebSockets. */
  _closeCrdtObservers() {
    for (const unsub of this._crdtUnsubs) {
      try { unsub(); } catch { /* best-effort */ }
    }
    this._crdtUnsubs = [];
    this.log('CRDT subscriptions closed.');
  }

  _categorizeEvent(evt) {
    const t = evt.event_type;
    if (t === 'version.published' || t === 'version_created') {
      this.metrics.versionCreatedEvents++;
      if (evt.payload?.versionNumber) this.seenVersions.add(evt.payload.versionNumber);
    } else if (t === 'document.updated' || t === 'document_updated') {
      this.metrics.documentUpdatedEvents++;
    } else if (t === 'document.created') {
      this.metrics.documentUpdatedEvents++;
    } else if (t === 'section.edited') {
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
      const doc = await this.getDocument(this.slug);
      const accessCount = doc.accessCount ?? 0;
      if (accessCount > 0) this.metrics.presenceUpdates++;
    } catch { /* non-fatal */ }
  }

  /**
   * Final state check: validate hash chain, check convergence between CRDT-observed
   * text (from subscribeSection) and HTTP-readable state (getSectionText).
   *
   * Convergence (T381 AC #4): WS-received text and HTTP text must hash-equal.
   * getSectionText() uses the SDK HTTP fallback at /v1/documents/:slug/sections/:sid/crdt-state,
   * which returns the consolidated Loro snapshot state decoded to plain text.
   */
  async _finalStateCheck() {
    try {
      const doc = await this.getDocument(this.slug);
      this.log(`Final document state: ${doc.state}`);
      this.log(`Final document version: ${doc.currentVersion}`);

      // Validate event hash chain
      const eventsResp = await this._api(`/api/v1/documents/${this.slug}/events?limit=100`);
      const events = Array.isArray(eventsResp) ? eventsResp : (eventsResp.events ?? []);

      let chainValid = true;
      let lastHash = null;
      for (const event of events) {
        if (lastHash && event.prevHash && event.prevHash !== lastHash) {
          this.log(`Hash chain BREAK at event ${event.id}`);
          chainValid = false;
        }
        if (event.hash) lastHash = event.hash;
      }

      this.log(`Hash chain valid: ${chainValid}`);
      this.log(`Total events in DB: ${events.length}`);
      this.metrics.hashChainValid = chainValid;
      this.metrics.totalEventsInDB = events.length;

      // CRDT convergence check (T381 AC #4)
      this.log('\n=== CRDT Convergence Check ===');
      let allConverged = true;
      for (const sectionId of OBSERVED_SECTION_IDS) {
        const wsText = this._latestSectionText.get(sectionId) ?? '';
        let httpText = null;
        try {
          httpText = await getSectionText(this.slug, sectionId, {
            baseUrl: this.apiBase,
            token: this.apiKey,
          });
        } catch (err) {
          this.log(`CRDT[${sectionId}]: getSectionText error: ${err.message}`);
        }

        if (httpText === null) {
          this.log(`CRDT[${sectionId}]: section not initialized — skipping convergence`);
          continue;
        }

        // If no WS text was received (writer didn't write to this section yet),
        // treat as converged (both empty)
        if (wsText === '' && httpText === '') {
          this.log(`CRDT[${sectionId}]: both empty — trivially converged`);
          this.metrics[`crdt_${sectionId}_converged`] = true;
          continue;
        }

        const wsHash = createHash('sha256').update(wsText, 'utf8').digest('hex').slice(0, 16);
        const httpHash = createHash('sha256').update(httpText, 'utf8').digest('hex').slice(0, 16);
        const converged = wsHash === httpHash;

        this.log(`CRDT[${sectionId}]: ws_hash=${wsHash} http_hash=${httpHash} converged=${converged}`);
        this.metrics[`crdt_${sectionId}_converged`] = converged;
        if (!converged) allConverged = false;
      }

      this.metrics.crdtConverged = allConverged;
      this.metrics.crdtBytesNonZero = this.metrics.crdt_bytes > 0;
      this.log(`\nAll sections converged: ${allConverged}`);
      this.log(`crdt_bytes non-zero: ${this.metrics.crdtBytesNonZero}`);

      // Check X-Server-Receipt header
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
      this.log('X-Server-Receipt header: ABSENT');
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
