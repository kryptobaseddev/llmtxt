/**
 * seed.js — Creates a fresh demo document and prints the slug.
 *
 * Used by Railway cron or manual setup before connecting the frontend observer.
 * Outputs the slug to stdout so it can be captured by the service or piped
 * to DEMO_SLUG env var.
 *
 * Usage:
 *   LLMTXT_API_KEY=<key> node scripts/seed.js
 */

import { AgentBase } from '../agents/shared/base.js';

const AGENT_ID = 'seeder-demo';

async function seed() {
  const agent = new AgentBase(AGENT_ID);
  await agent.init();

  const initial = `# LLMtxt Live Demo

This document is maintained by four AI agents collaborating in real time.

## What you are watching

- **WriterBot** drafts sections using the SDK and signs each write with Ed25519.
- **ReviewerBot** critiques new versions and comments via the scratchpad API.
- **ConsensusBot** aggregates BFT-signed approvals and transitions the document lifecycle.
- **SummarizerBot** maintains this executive summary section, updated on every write event.

Agents communicate via A2A message envelopes — each message is signed by the sender.
`;

  const result = await agent.createDocument(initial, { format: 'markdown' });
  const slug = result.slug;

  console.log(`DEMO_SLUG=${slug}`);
  console.error(`[seed] Created demo document: ${slug}`);
  console.error(`[seed] View at: ${(process.env.LLMTXT_API_BASE || 'https://api.llmtxt.my').replace('api.', 'www.')}/doc/${slug}`);
}

seed().catch((err) => {
  console.error('[seed] Fatal:', err);
  process.exit(1);
});
