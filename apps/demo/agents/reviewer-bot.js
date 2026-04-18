/**
 * ReviewerBot — reference agent that critiques document sections and logs comments.
 *
 * Behaviour:
 *  1. Watches the document event stream for version_created / section_updated events.
 *  2. Uses subscribeSection() from the SDK to receive real-time CRDT deltas — NOT REST GET.
 *  3. On each CRDT delta, applies stub critique rules to the live section text.
 *  4. Posts structured review comments as document events via the scratchpad endpoint.
 *  5. Sends an A2A message to ConsensusBot when a section meets review criteria.
 *
 * CRDT reads (T381):
 *  - subscribeSection() opens a loro-sync-v1 WebSocket per section.
 *  - SectionDelta.text gives the current plain-text after each update — no REST GET needed.
 *  - Reviewer uses CRDT text for critique, completing the CRDT read path.
 *
 * Environment:
 *   LLMTXT_API_KEY   (required)
 *   LLMTXT_API_BASE  (optional)
 *   DEMO_SLUG        (required — set by WriterBot or orchestrator)
 *   DEMO_DURATION_MS (optional, default 60000)
 */

import { AgentBase } from './shared/base.js';
import { subscribeSection } from 'llmtxt';

const AGENT_ID = 'reviewerbot-demo';
const CONSENSUS_ID = 'consensusbot-demo';
const DEMO_DURATION_MS = Number(process.env.DEMO_DURATION_MS ?? 60_000);

/**
 * Section IDs writer-bot writes to — reviewer subscribes to all of these
 * via subscribeSection() to receive live CRDT deltas for critique.
 */
const WATCHED_SECTION_IDS = ['introduction', 'architecture', 'multi-agent', 'getting-started'];

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
    /**
     * Latest CRDT text per section received from subscribeSection deltas.
     * Reviewer uses this for critique instead of REST GET.
     * @type {Map<string, string>}
     */
    this._crdtSectionText = new Map();
    /**
     * Unsubscribe functions from subscribeSection(); closed at end of run.
     * @type {Array<() => void>}
     */
    this._crdtUnsubs = [];
    /** Set of sections already reviewed via CRDT delta to avoid duplicate critiques. */
    this._reviewedCrdtSections = new Set();
  }

  async run() {
    await this.init();

    if (!this.slug) {
      this.log('ERROR: DEMO_SLUG env var is required for ReviewerBot');
      process.exit(1);
    }

    this.log(`Watching document: ${this.slug}`);

    // Open subscribeSection() connections to receive live CRDT updates (T381).
    // Reviewer critiques each section as CRDT deltas arrive — no REST GET fallback.
    this._initCrdtSubscriptions();

    const ac = new AbortController();
    const deadline = Date.now() + DEMO_DURATION_MS;
    const timeoutId = setTimeout(() => ac.abort(), DEMO_DURATION_MS);

    try {
      for await (const evt of this.watchEvents(this.slug, { signal: ac.signal })) {
        if (Date.now() >= deadline) break;

        if (
          evt.event_type === 'version_created' ||
          evt.event_type === 'document_updated' ||
          evt.event_type === 'version.published' ||
          evt.event_type === 'document.updated'
        ) {
          const version = evt.payload?.versionNumber ?? evt.payload?.version ?? 'unknown';
          const versionKey = String(version);

          if (this._reviewedVersions.has(versionKey)) continue;
          this._reviewedVersions.add(versionKey);

          this.log(`Reviewing version ${version} (using CRDT section text)...`);
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

    // Close all subscribeSection WebSocket connections
    this._closeCrdtSubscriptions();

    this.log(`Run complete. Posted ${this._commentCount} review comments.`);
  }

  /**
   * Open subscribeSection() for each section we want to review.
   *
   * On each SectionDelta:
   *  - Update the cached CRDT text for that section.
   *  - Immediately run critique rules on the new text.
   *  - Post any comments to the scratchpad.
   *
   * This is the primary review path — sections are reviewed as CRDT deltas
   * arrive, rather than polling via REST GET on each SSE version event.
   */
  _initCrdtSubscriptions() {
    const options = {
      baseUrl: this.apiBase,
      token: this.apiKey,
      onError: (err) => {
        this.log(`CRDT subscribeSection error: ${err}`);
      },
    };

    for (const sectionId of WATCHED_SECTION_IDS) {
      const unsub = subscribeSection(
        this.slug,
        sectionId,
        (delta) => {
          // Cache latest CRDT text for this section
          this._crdtSectionText.set(sectionId, delta.text);

          this.log(`CRDT[${sectionId}]: delta received (${delta.updateBytes.length} bytes, text_len=${delta.text.length})`);

          // Run critique on the live CRDT text (async, non-blocking)
          this._critiqueSectionCrdt(sectionId, delta.text).catch((err) => {
            this.log(`CRDT critique error on ${sectionId}: ${err.message}`);
          });
        },
        options,
      );

      this._crdtUnsubs.push(unsub);
      this.log(`CRDT[${sectionId}]: subscribeSection() opened (reviewer mode)`);
    }
  }

  /** Close all subscribeSection WebSocket connections. */
  _closeCrdtSubscriptions() {
    for (const unsub of this._crdtUnsubs) {
      try { unsub(); } catch { /* best-effort */ }
    }
    this._crdtUnsubs = [];
    this.log('CRDT subscriptions closed.');
  }

  /**
   * Critique a section's live CRDT text. Called once per delta per section.
   * Deduplicates: only critiques each (sectionId, textHash) once.
   *
   * @param {string} sectionId
   * @param {string} text  Current full section text from SectionDelta.text
   */
  async _critiqueSectionCrdt(sectionId, text) {
    // Skip if text is empty (initial sync before writer has written anything)
    if (!text || text.trim().length === 0) return;

    // Deduplicate by (sectionId, text length) — crude but sufficient for demo
    const key = `${sectionId}:${text.length}`;
    if (this._reviewedCrdtSections.has(key)) return;
    this._reviewedCrdtSections.add(key);

    const comments = [];
    for (const rule of CRITIQUE_RULES) {
      if (rule.test(text)) {
        comments.push({
          section: sectionId,
          rule: rule.id,
          comment: rule.comment,
          severity: rule.severity,
        });
      }
    }

    if (comments.length === 0) {
      this.log(`CRDT[${sectionId}]: no issues — section looks good`);
    } else {
      this.log(`CRDT[${sectionId}]: ${comments.length} comment(s) via CRDT text`);
      for (const c of comments) {
        await this._postComment('crdt-live', c);
      }
    }
  }

  /**
   * Fallback review triggered by SSE version events.
   * Prefers CRDT text if available, falls back to REST GET.
   *
   * @param {string|number} version
   */
  async _reviewVersion(version) {
    // Collect all CRDT-observed section texts
    const crdtTexts = [...this._crdtSectionText.entries()];

    if (crdtTexts.length > 0) {
      // Use CRDT text from subscribeSection deltas — no REST GET needed (T381)
      this.log(`Reviewing version ${version} using ${crdtTexts.length} CRDT section(s)`);
      const combinedText = crdtTexts.map(([sid, text]) => text).join('\n\n');
      await this._reviewContent(version, combinedText);
    } else {
      // Fallback: REST GET if no CRDT text received yet
      this.log(`No CRDT text yet for version ${version} — falling back to REST GET`);
      let content;
      try {
        content = await this.getContent(this.slug);
      } catch (err) {
        this.log(`Could not fetch content for review: ${err.message}`);
        return;
      }
      await this._reviewContent(version, content);
    }
  }

  /**
   * Apply critique rules to combined content and notify ConsensusBot.
   *
   * @param {string|number} version
   * @param {string} content  Full document or combined section text
   */
  async _reviewContent(version, content) {
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
      await this._notifyConsensus(version, 'approved', 'No review issues found.');
    } else {
      this.log(`Version ${version}: ${comments.length} comment(s)`);
      for (const c of comments) {
        await this._postComment(version, c);
      }

      const hasWarnings = comments.some((c) => c.severity === 'warning');
      if (!hasWarnings) {
        await this._notifyConsensus(version, 'approved', 'Only suggestions — approving with comments.');
      } else {
        await this._notifyConsensus(
          version,
          'changes-requested',
          `${comments.filter((c) => c.severity === 'warning').length} warning(s) require attention.`,
        );
      }
    }
  }

  async _postComment(version, comment) {
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
