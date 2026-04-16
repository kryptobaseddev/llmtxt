/**
 * ConsensusBot — BFT approval orchestrator.
 *
 * Behaviour:
 *  1. Polls its A2A inbox for "review-complete" messages from ReviewerBot.
 *  2. When it accumulates enough "approved" signals to reach BFT quorum (default: 1 peer + self),
 *     submits a BFT-signed approval via POST /documents/:slug/bft/approve.
 *  3. Watches the BFT status endpoint; when quorum is reached it transitions
 *     the document to APPROVED.
 *  4. If "changes-requested" signals arrive, it logs them and waits for a new version.
 *
 * BFT note: For the demo, f=0 → quorum=1 (ConsensusBot alone can approve).
 * In production with multiple ConsensusBot instances, quorum would be 2f+1.
 *
 * Environment:
 *   LLMTXT_API_KEY   (required)
 *   LLMTXT_API_BASE  (optional)
 *   DEMO_SLUG        (required)
 *   DEMO_DURATION_MS (optional, default 60000)
 */

import { AgentBase } from './shared/base.js';

const AGENT_ID = 'consensusbot-demo';
const POLL_INTERVAL_MS = 3000;
const DEMO_DURATION_MS = Number(process.env.DEMO_DURATION_MS ?? 60_000);
// BFT f=0 for single-bot demo (quorum = 2*0+1 = 1)
const BFT_F = 0;

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

    while (Date.now() < deadline) {
      await this._processPendingMessages();
      await this._checkQuorum();
      await this.sleep(POLL_INTERVAL_MS);
    }

    this.log('Run complete.');
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

const bot = new ConsensusBot();
bot.run().catch((err) => {
  console.error('[consensusbot-demo] Fatal error:', err);
  process.exit(1);
});
