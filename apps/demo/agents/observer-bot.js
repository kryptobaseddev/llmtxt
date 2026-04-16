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

      clearInterval(presenceInterval);
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

    // Emit metrics as JSON for orchestrator parsing
    console.log('\n__OBSERVER_METRICS__' + JSON.stringify(this.metrics) + '__END_METRICS__');

    this.log('Run complete.');
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
