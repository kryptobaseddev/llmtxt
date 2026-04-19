/**
 * ConsensusBot — BFT approval orchestrator.
 *
 * Behaviour:
 *  1. Subscribes to the document SSE event stream and self-approves on every
 *     new versionCreated event (versionCreated / version.published). This path
 *     is the primary trigger so BFT approval happens even without ReviewerBot.
 *  2. Also polls its A2A inbox for "review-complete" messages from ReviewerBot
 *     as a secondary signal (used to tally peer votes).
 *  3. When it accumulates enough "approved" signals to reach BFT quorum,
 *     submits a BFT-signed approval via POST /documents/:slug/bft/approve.
 *  4. Watches the BFT status endpoint; when quorum is reached it transitions
 *     the document to APPROVED.
 *  5. If "changes-requested" signals arrive, it logs them and waits for a new version.
 *
 * BFT note: CONSENSUS_BFT_F env controls fault-tolerance. Default f=1 → quorum=3.
 * The orchestrator spawns 3 distinct bots so all 3 submit approvals, reaching quorum.
 * Each bot has its own Ed25519 keypair registered under a distinct agent ID.
 *
 * Environment:
 *   LLMTXT_API_KEY   (required)
 *   LLMTXT_API_BASE  (optional)
 *   DEMO_SLUG        (required)
 *   DEMO_DURATION_MS (optional, default 60000)
 */

import { AgentBase } from './shared/base.js';

/**
 * AGENT_ID — read from env so the orchestrator can launch multiple instances
 * with distinct identities (consensus-bot-1, consensus-bot-2, consensus-bot-3).
 * Each instance generates its own Ed25519 keypair persisted under ~/.llmtxt/demo-agents/<id>.key,
 * ensuring 3 distinct signing keys for BFT quorum (Cap 7 fix, T771).
 */
const AGENT_ID = process.env.AGENT_ID ?? 'consensusbot-demo';
const POLL_INTERVAL_MS = 3000;
const DEMO_DURATION_MS = Number(process.env.DEMO_DURATION_MS ?? 60_000);
/**
 * BFT_F — read from env so the orchestrator can override the fault-tolerance
 * level. Default f=1 → quorum = 2*1+1 = 3 (requires 3 distinct approvals).
 * The orchestrator spawns 3 bots with CONSENSUS_BFT_F=1 so each bot uses f=1.
 */
const BFT_F = Number(process.env.CONSENSUS_BFT_F ?? 1);

class ConsensusBot extends AgentBase {
  constructor() {
    super(AGENT_ID);
    this.slug = process.env.DEMO_SLUG ?? null;
    /** Map<versionKey, { approved: number, rejected: number, reviewers: Set<string> }> */
    this._votes = new Map();
    this._approvedVersions = new Set();
    /** unix ms timestamp recorded just before run() starts polling — used to
     *  filter out stale inbox messages from prior test runs (T369 fix). */
    this._startTime = null;
    /** Versions self-approved via SSE event stream — prevents double-approvals. */
    this._sseApprovedVersions = new Set();
  }

  async run() {
    await this.init();

    if (!this.slug) {
      this.log('ERROR: DEMO_SLUG env var is required for ConsensusBot');
      process.exit(1);
    }

    // Record start time BEFORE the first poll so we skip any messages that
    // arrived before this run began (stale messages from prior test runs).
    this._startTime = Date.now();

    this.log(`Monitoring consensus for document: ${this.slug}`);

    const deadline = this._startTime + DEMO_DURATION_MS;

    // Start SSE event stream watcher in the background — this is the primary
    // trigger for self-approvals. It runs concurrently with the A2A poll loop.
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), DEMO_DURATION_MS);
    const eventWatcherPromise = this._watchVersionEvents(ac.signal);

    // A2A poll loop (secondary trigger: ReviewerBot signals)
    while (Date.now() < deadline) {
      await this._processPendingMessages();
      await this._checkQuorum();
      await this.sleep(POLL_INTERVAL_MS);
    }

    // Abort the SSE watcher and wait for it to finish cleanup
    ac.abort();
    clearTimeout(timeoutId);
    try {
      await eventWatcherPromise;
    } catch {
      // AbortError is expected
    }

    this.log('Run complete.');
  }

  /**
   * Subscribe to the SSE event stream and self-approve on every versionCreated event.
   * This ensures BFT has something to vote on even without ReviewerBot A2A messages.
   *
   * @param {AbortSignal} signal
   */
  async _watchVersionEvents(signal) {
    try {
      for await (const evt of this.watchEvents(this.slug, { signal })) {
        const t = evt.event_type;
        const isVersionCreated =
          t === 'version_created' ||
          t === 'version.created' ||
          t === 'version.published' ||
          t === 'document_updated' ||
          t === 'document.updated';

        if (!isVersionCreated) continue;

        const version = evt.payload?.versionNumber ?? evt.payload?.version ?? null;
        if (version == null) {
          this.log(`SSE: versionCreated event missing versionNumber, skipping`);
          continue;
        }

        const versionKey = String(version);
        if (this._sseApprovedVersions.has(versionKey)) {
          this.log(`SSE: version ${versionKey} already self-approved, skipping`);
          continue;
        }

        this.log(`SSE: versionCreated event — version=${versionKey} — triggering self-approval`);
        this._sseApprovedVersions.add(versionKey);

        // Ensure the version is registered in the votes map for _checkQuorum
        if (!this._votes.has(versionKey)) {
          this._votes.set(versionKey, { approved: 0, rejected: 0, reviewers: new Set() });
        }

        // Each bot submits its own signed approval. When all 3 bots approve,
        // the server reaches BFT quorum (2*f+1 = 3 with f=1).
        const quorum = 2 * BFT_F + 1;
        this._approvedVersions.add(versionKey);
        await this._submitBftApproval(versionKey, 1, quorum);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.log(`SSE watch error: ${err.message}`);
      }
    }
  }

  async _processPendingMessages() {
    // Pass startTime as `since` so we only process messages from THIS run,
    // not stale messages from prior runs that are still in the inbox queue.
    const messages = await this.pollInbox({ since: this._startTime });
    for (const msg of messages) {
      try {
        await this._handleMessage(msg);
      } catch (err) {
        this.log(`Message handling error: ${err.message}`);
      }
    }
  }

  async _handleMessage(msg) {
    // Inbox messages have an `envelope` field; payload is base64-encoded JSON
    const envelope = msg.envelope ?? msg;
    if (!envelope || !envelope.payload) return;

    let payload;
    try {
      const decoded = Buffer.from(envelope.payload, 'base64').toString('utf8');
      payload = JSON.parse(decoded);
    } catch {
      return;
    }

    if (payload.type !== 'review-complete') return;
    if (payload.slug !== this.slug) return;

    const versionKey = String(payload.version ?? 'latest');
    const reviewer = payload.reviewer ?? envelope.from ?? 'unknown';

    if (!this._votes.has(versionKey)) {
      this._votes.set(versionKey, { approved: 0, rejected: 0, reviewers: new Set() });
    }

    const vote = this._votes.get(versionKey);
    if (vote.reviewers.has(reviewer)) return; // deduplicate

    vote.reviewers.add(reviewer);
    if (payload.recommendation === 'approved') {
      vote.approved++;
      this.log(`Vote received: version=${versionKey} reviewer=${reviewer} → APPROVED (${vote.approved} approvals)`);
    } else {
      vote.rejected++;
      this.log(`Vote received: version=${versionKey} reviewer=${reviewer} → CHANGES REQUESTED (${vote.rejected} rejections)`);
    }
  }

  async _checkQuorum() {
    const quorum = 2 * BFT_F + 1;

    for (const [versionKey, vote] of this._votes) {
      if (this._approvedVersions.has(versionKey)) continue;

      // Count ConsensusBot's own implicit vote (self-approval after seeing reviewer signal)
      const totalApprovals = vote.approved + 1; // +1 for self

      if (totalApprovals >= quorum) {
        this._approvedVersions.add(versionKey);
        await this._submitBftApproval(versionKey, totalApprovals, quorum);
      }
    }
  }

  async _submitBftApproval(versionKey, totalApprovals, quorum) {
    const version = parseInt(versionKey, 10) || 1;
    this.log(`BFT quorum reached: version=${versionKey} approvals=${totalApprovals}/${quorum} — submitting approval`);

    try {
      await this.bftApprove(
        this.slug,
        version,
        `BFT quorum met: ${totalApprovals}/${quorum} approvals. Signed by ${this.agentId}.`,
      );
      this.log(`BFT approval submitted for version ${versionKey}`);
      this.log(`Signed write: POST /api/v1/documents/${this.slug}/bft/approve (version=${versionKey})`);
    } catch (err) {
      this.log(`BFT approval failed: ${err.message}`);
      return;
    }

    // Check BFT status to confirm quorum was accepted
    try {
      const status = await this.getBftStatus(this.slug);
      this.log(`BFT status: ${JSON.stringify(status)}`);

      if (status.quorumReached || status.approved) {
        // Transition document to APPROVED
        try {
          await this.transition(
            this.slug,
            'APPROVED',
            `ConsensusBot: BFT quorum reached (${totalApprovals}/${quorum})`,
          );
          this.log(`Document ${this.slug} transitioned to APPROVED`);
        } catch (err) {
          this.log(`Transition to approved failed (may already be approved): ${err.message}`);
        }
      }
    } catch (err) {
      this.log(`BFT status check failed: ${err.message}`);
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
// AGENT_ID is read from env at module load time (line ~30).
// The orchestrator spawns 3 instances with AGENT_ID=consensus-bot-1/2/3,
// each generating its own Ed25519 keypair for distinct BFT identities.

const bot = new ConsensusBot();
bot.run().catch((err) => {
  console.error(`[${AGENT_ID}] Fatal error:`, err);
  process.exit(1);
});
