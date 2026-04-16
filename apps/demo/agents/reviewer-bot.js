/**
 * ReviewerBot — reference agent that critiques document sections and logs comments.
 *
 * Behaviour:
 *  1. Watches the document event stream for version_created / section_updated events.
 *  2. On each new version, fetches the raw content and applies stub critique logic.
 *  3. Posts structured review comments as document events via the scratchpad endpoint.
 *  4. Sends an A2A message to ConsensusBot when a section meets review criteria.
 *
 * Environment:
 *   LLMTXT_API_KEY   (required)
 *   LLMTXT_API_BASE  (optional)
 *   DEMO_SLUG        (required — set by WriterBot or orchestrator)
 *   DEMO_DURATION_MS (optional, default 60000)
 */

import { AgentBase } from './shared/base.js';

const AGENT_ID = 'reviewerbot-demo';
const CONSENSUS_ID = 'consensusbot-demo';
const DEMO_DURATION_MS = Number(process.env.DEMO_DURATION_MS ?? 60_000);

// Stub critique rules — in real usage these would call an LLM.
const CRITIQUE_RULES = [
  {
    id: 'missing-code-example',
    test: (content) => !content.includes('```'),
    comment: 'Consider adding a code example to illustrate this concept.',
    severity: 'suggestion',
  },
  {
    id: 'short-section',
    test: (content) => content.split('\n').filter((l) => l.trim()).length < 3,
    comment: 'This section is brief — consider expanding with more detail.',
    severity: 'warning',
  },
  {
    id: 'missing-links',
    test: (content) => !content.includes('http') && content.length > 200,
    comment: 'No external references found — linking to documentation would strengthen this.',
    severity: 'suggestion',
  },
];

class ReviewerBot extends AgentBase {
  constructor() {
    super(AGENT_ID);
    this.slug = process.env.DEMO_SLUG ?? null;
    this._reviewedVersions = new Set();
    this._commentCount = 0;
  }

  async run() {
    await this.init();

    if (!this.slug) {
      this.log('ERROR: DEMO_SLUG env var is required for ReviewerBot');
      process.exit(1);
    }

    this.log(`Watching document: ${this.slug}`);

    const ac = new AbortController();
    const deadline = Date.now() + DEMO_DURATION_MS;
    const timeoutId = setTimeout(() => ac.abort(), DEMO_DURATION_MS);

    try {
      for await (const evt of this.watchEvents(this.slug, { signal: ac.signal })) {
        if (Date.now() >= deadline) break;

        if (evt.event_type === 'version_created' || evt.event_type === 'document_updated') {
          const version = evt.payload?.versionNumber ?? evt.payload?.version ?? 'unknown';
          const versionKey = String(version);

          if (this._reviewedVersions.has(versionKey)) continue;
          this._reviewedVersions.add(versionKey);

          this.log(`Reviewing version ${version}...`);
          await this._reviewVersion(version);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.log(`Watch error: ${err.message}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }

    this.log(`Run complete. Posted ${this._commentCount} review comments.`);
  }

  async _reviewVersion(version) {
    let content;
    try {
      content = await this.getContent(this.slug);
    } catch (err) {
      this.log(`Could not fetch content for review: ${err.message}`);
      return;
    }

    // Parse sections by heading
    const sections = this._parseSections(content);
    const comments = [];

    for (const section of sections) {
      for (const rule of CRITIQUE_RULES) {
        if (rule.test(section.body)) {
          comments.push({
            section: section.heading,
            rule: rule.id,
            comment: rule.comment,
            severity: rule.severity,
          });
        }
      }
    }

    if (comments.length === 0) {
      this.log(`Version ${version}: no issues found — looks good!`);
      // Signal ConsensusBot that this version is review-approved
      await this._notifyConsensus(version, 'approved', 'No review issues found.');
    } else {
      this.log(`Version ${version}: ${comments.length} comment(s)`);
      for (const c of comments) {
        await this._postComment(version, c);
      }

      // If only suggestions (no warnings), still recommend approval
      const hasWarnings = comments.some((c) => c.severity === 'warning');
      if (!hasWarnings) {
        await this._notifyConsensus(version, 'approved', 'Only suggestions — approving with comments.');
      } else {
        await this._notifyConsensus(version, 'changes-requested', `${comments.filter(c => c.severity === 'warning').length} warning(s) require attention.`);
      }
    }
  }

  async _postComment(version, comment) {
    // Post to the scratchpad as a structured review note
    const scratchContent = JSON.stringify({
      reviewer: this.agentId,
      version,
      section: comment.section,
      rule: comment.rule,
      comment: comment.comment,
      severity: comment.severity,
      timestamp: new Date().toISOString(),
    });

    try {
      await this._api(`/api/v1/documents/${this.slug}/scratchpad`, {
        method: 'POST',
        body: JSON.stringify({
          content: scratchContent,
          contentType: 'application/json',
          agentId: this.agentId,
        }),
      });
      this._commentCount++;
      this.log(`Comment posted: [${comment.severity}] ${comment.section} — ${comment.rule}`);
    } catch (err) {
      this.log(`Failed to post comment (non-fatal): ${err.message}`);
    }
  }

  async _notifyConsensus(version, recommendation, rationale) {
    try {
      await this.sendA2A(CONSENSUS_ID, 'application/json', {
        type: 'review-complete',
        slug: this.slug,
        version,
        recommendation,
        rationale,
        reviewer: this.agentId,
      });
      this.log(`A2A → ConsensusBot: version ${version} recommendation=${recommendation}`);
    } catch (err) {
      this.log(`A2A to consensus failed (non-fatal): ${err.message}`);
    }
  }

  _parseSections(content) {
    const lines = content.split('\n');
    const sections = [];
    let current = null;

    for (const line of lines) {
      if (line.startsWith('#')) {
        if (current) sections.push(current);
        current = { heading: line.replace(/^#+\s*/, ''), body: '' };
      } else if (current) {
        current.body += line + '\n';
      }
    }
    if (current) sections.push(current);
    return sections;
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

const bot = new ReviewerBot();
bot.run().catch((err) => {
  console.error('[reviewerbot-demo] Fatal error:', err);
  process.exit(1);
});
