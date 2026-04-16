/**
 * SummarizerBot — maintains a live executive summary section.
 *
 * Behaviour:
 *  1. Watches the document event stream for version_created events.
 *  2. Also polls its A2A inbox for "request-summary" messages from WriterBot.
 *  3. On trigger, fetches the raw content, generates a stub summary, and
 *     appends / replaces the "Executive Summary" section.
 *  4. Uses an advisory lease on the 'executive-summary' section before writing.
 *
 * In production, step 3 would call an LLM with the full document content.
 * This implementation uses a deterministic stub summarizer.
 *
 * Environment:
 *   LLMTXT_API_KEY   (required)
 *   LLMTXT_API_BASE  (optional)
 *   DEMO_SLUG        (required)
 *   DEMO_DURATION_MS (optional, default 60000)
 */

import { AgentBase } from './shared/base.js';
import { LeaseConflictError } from 'llmtxt';

const AGENT_ID = 'summarizerbot-demo';
const SECTION_ID = 'executive-summary';
const POLL_INTERVAL_MS = 5000;
const DEMO_DURATION_MS = Number(process.env.DEMO_DURATION_MS ?? 60_000);

class SummarizerBot extends AgentBase {
  constructor() {
    super(AGENT_ID);
    this.slug = process.env.DEMO_SLUG ?? null;
    this._lastSummarizedVersion = -1;
    this._summaryCount = 0;
  }

  async run() {
    await this.init();

    if (!this.slug) {
      this.log('ERROR: DEMO_SLUG env var is required for SummarizerBot');
      process.exit(1);
    }

    this.log(`Summarizing document: ${this.slug}`);

    const deadline = Date.now() + DEMO_DURATION_MS;

    // Run event watch and inbox poll concurrently via a simple loop
    while (Date.now() < deadline) {
      await Promise.all([
        this._checkInbox(),
        this._checkEvents(),
      ]);
      await this.sleep(POLL_INTERVAL_MS);
    }

    this.log(`Run complete. Generated ${this._summaryCount} summaries.`);
  }

  async _checkInbox() {
    const messages = await this.pollInbox();
    for (const msg of messages) {
      try {
        await this._handleA2AMessage(msg);
      } catch (err) {
        this.log(`Inbox message error: ${err.message}`);
      }
    }
  }

  async _handleA2AMessage(msg) {
    const envelope = msg.envelope ?? msg;
    if (!envelope?.payload) return;

    let payload;
    try {
      const decoded = Buffer.from(envelope.payload, 'base64').toString('utf8');
      payload = JSON.parse(decoded);
    } catch {
      return;
    }

    if (payload.type !== 'request-summary') return;
    if (payload.slug !== this.slug) return;

    this.log(`A2A request-summary received from ${envelope.from} (trigger: ${payload.trigger})`);
    await this._generateAndWriteSummary(`A2A trigger: ${payload.trigger} — section ${payload.section}`);
  }

  async _checkEvents() {
    // Light-weight version check — compare current latest version to last summarized
    try {
      const doc = await this.getDocument(this.slug);
      const latestVersion = doc.version ?? doc.latestVersion ?? 0;
      if (latestVersion > this._lastSummarizedVersion) {
        await this._generateAndWriteSummary(`New version detected: ${latestVersion}`);
        this._lastSummarizedVersion = latestVersion;
      }
    } catch {
      // Non-fatal — will retry next cycle
    }
  }

  async _generateAndWriteSummary(trigger) {
    let content;
    try {
      content = await this.getContent(this.slug);
    } catch (err) {
      this.log(`Could not fetch content for summary: ${err.message}`);
      return;
    }

    const summary = this._stubSummarize(content);

    // Acquire advisory lease
    let leaseHandle = null;
    try {
      leaseHandle = await this.acquireLease(this.slug, SECTION_ID, 30, 'SummarizerBot updating executive summary');
    } catch (err) {
      if (err instanceof LeaseConflictError || err.name === 'LeaseConflictError') {
        this.log(`Lease conflict on ${SECTION_ID} — skipping this round`);
        return;
      }
      this.log(`Lease acquire failed (non-fatal): ${err.message}`);
    }

    try {
      // Replace or append executive summary section
      const updated = this._upsertSummarySection(content, summary);
      await this.updateDocument(this.slug, updated, `SummarizerBot: updated executive summary (${trigger})`);
      this._summaryCount++;
      this.log(`Summary written (${trigger}): ${summary.slice(0, 80)}...`);
    } catch (err) {
      this.log(`Failed to write summary: ${err.message}`);
    } finally {
      if (leaseHandle) {
        await this.releaseLease(leaseHandle.manager);
      }
    }
  }

  /**
   * Stub summarizer — extracts headings and first sentences from each section.
   * Replace with an LLM call in production.
   */
  _stubSummarize(content) {
    const lines = content.split('\n');
    const headings = lines
      .filter((l) => l.startsWith('#') && !l.startsWith('# Executive Summary'))
      .map((l) => l.replace(/^#+\s*/, '').trim());

    const firstSentences = lines
      .filter((l) => l.trim().length > 40 && !l.startsWith('#') && !l.startsWith('`') && !l.startsWith('-'))
      .slice(0, 3)
      .map((l) => l.trim());

    const sectionList = headings.map((h) => `- ${h}`).join('\n');
    const excerpt = firstSentences[0] ? firstSentences[0].slice(0, 120) + '...' : '';

    return `**Generated at ${new Date().toISOString()}**

This document covers ${headings.length} section(s): ${headings.slice(0, 3).join(', ')}${headings.length > 3 ? ', and more' : ''}.

${excerpt}

**Sections:**
${sectionList || '(no sections yet)'}`;
  }

  /**
   * Upsert the "# Executive Summary" section.
   * If it already exists, replaces it. Otherwise appends it.
   */
  _upsertSummarySection(content, summaryBody) {
    const summaryHeading = '# Executive Summary';

    // Remove any existing summary section
    const withoutSummary = content.replace(
      /# Executive Summary[\s\S]*?(?=\n# |\n## |\z|$)/m,
      '',
    ).trim();

    return `${summaryHeading}\n\n${summaryBody}\n\n${withoutSummary}`;
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

const bot = new SummarizerBot();
bot.run().catch((err) => {
  console.error('[summarizerbot-demo] Fatal error:', err);
  process.exit(1);
});
