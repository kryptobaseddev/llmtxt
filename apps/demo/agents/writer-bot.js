/**
 * WriterBot — reference agent that creates and updates document sections.
 *
 * Behaviour:
 *  1. Creates (or receives slug via env) a new Markdown document.
 *  2. Acquires an advisory lease on each section before writing.
 *  3. Pushes an initial draft then iteratively expands sections every INTERVAL ms.
 *  4. Transitions the document to REVIEW after all sections are written.
 *  5. Listens for A2A "request-summary" messages and delegates to SummarizerBot.
 *
 * Environment:
 *   LLMTXT_API_KEY  (required)
 *   LLMTXT_API_BASE (optional, defaults to https://api.llmtxt.my)
 *   DEMO_SLUG       (optional; if set, appends sections to an existing doc)
 *   DEMO_DURATION_MS (optional; how long to run, default 60000)
 */

import { AgentBase } from './shared/base.js';
import { LeaseConflictError } from 'llmtxt';

const AGENT_ID = 'writerbot-demo';
const SUMMARIZER_ID = 'summarizerbot-demo';
const INTERVAL_MS = 4000;
const DEMO_DURATION_MS = Number(process.env.DEMO_DURATION_MS ?? 60_000);

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

class WriterBot extends AgentBase {
  constructor() {
    super(AGENT_ID);
    this.slug = process.env.DEMO_SLUG ?? null;
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
      // Broadcast slug so other agents can pick it up
      process.stdout.write(`DEMO_SLUG=${this.slug}\n`);
    } else {
      this.log(`Adopting existing document: ${this.slug}`);
    }

    let sectionIdx = 1;

    // Step 2: iteratively add sections
    while (Date.now() < deadline && sectionIdx < SECTIONS.length) {
      await this.sleep(INTERVAL_MS);
      const section = SECTIONS[sectionIdx];

      // Acquire advisory lease
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
        // Get current content and append section
        let current = '';
        try {
          current = await this.getContent(this.slug);
        } catch {
          current = '';
        }

        const updated = current.trim() + '\n\n' + section.heading + '\n\n' + section.content;
        await this.updateDocument(this.slug, updated, `WriterBot: added section "${section.id}"`);
        this.log(`Section written: ${section.id}`);
        sectionIdx++;

        // Ask SummarizerBot to update executive summary via A2A
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

    // Step 3: transition to REVIEW
    if (this.slug) {
      try {
        await this.transition(this.slug, 'REVIEW', 'WriterBot: initial draft complete, requesting review');
        this.log(`Document ${this.slug} transitioned to REVIEW`);
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
