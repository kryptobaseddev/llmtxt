/**
 * orchestrator.js — Spawns all 4 demo agents and coordinates the demo cycle.
 *
 * Mode A (default): Runs all agents as child processes on the current machine.
 * The orchestrator:
 *  1. Runs WriterBot first to create the document and obtain DEMO_SLUG.
 *  2. Passes DEMO_SLUG to the other 3 agents via env vars.
 *  3. Waits for all agents to finish (or timeout).
 *  4. Prints a final summary of events, approvals, and A2A messages.
 *
 * Usage:
 *   LLMTXT_API_KEY=<key> node scripts/orchestrator.js
 *
 * Options (env vars):
 *   DEMO_SLUG        — Skip creation; use existing slug.
 *   DEMO_DURATION_MS — How long each agent runs (default: 60000).
 *   LLMTXT_API_BASE  — Override API base URL.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(__dirname, '..', 'agents');
const DURATION_MS = Number(process.env.DEMO_DURATION_MS ?? 60_000);
const API_KEY = process.env.LLMTXT_API_KEY ?? '';
const API_BASE = process.env.LLMTXT_API_BASE ?? 'https://api.llmtxt.my';

if (!API_KEY) {
  console.error('[orchestrator] ERROR: LLMTXT_API_KEY is required');
  process.exit(1);
}

// ── Metrics collection ────────────────────────────────────────────────────────

const metrics = {
  sectionEdits: 0,
  events: 0,
  approvals: 0,
  a2aMessages: 0,
  slug: null,
};

// ── Process management ────────────────────────────────────────────────────────

/**
 * Spawn a Node.js child process for a given agent script.
 * Returns a Promise that resolves when the process exits.
 */
function spawnAgent(scriptName, extraEnv = {}) {
  const scriptPath = join(AGENTS_DIR, scriptName);
  const env = {
    ...process.env,
    LLMTXT_API_KEY: API_KEY,
    LLMTXT_API_BASE: API_BASE,
    DEMO_DURATION_MS: String(DURATION_MS),
    ...extraEnv,
  };

  console.log(`[orchestrator] Spawning ${scriptName}...`);

  const child = spawn(process.execPath, [scriptPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let writerSlug = null;

  child.stdout.on('data', (data) => {
    const text = data.toString();
    // Parse DEMO_SLUG announcement from WriterBot
    const slugMatch = text.match(/^DEMO_SLUG=([a-z0-9_-]+)/m);
    if (slugMatch) {
      writerSlug = slugMatch[1];
      metrics.slug = writerSlug;
    }

    // Count section edits from WriterBot output
    if (text.includes('Section written:')) metrics.sectionEdits++;
    if (text.includes('A2A →')) metrics.a2aMessages++;
    if (text.includes('BFT approval submitted')) metrics.approvals++;

    process.stdout.write(text.split('\n').map((l) => `  ${l}`).join('\n'));
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(`  [${scriptName}] STDERR: ${data}`);
  });

  return new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      console.log(`[orchestrator] ${scriptName} exited with code ${code}`);
      resolve({ code, slug: writerSlug });
    });
    child.on('error', reject);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[orchestrator] Starting LLMtxt 4-agent demo');
  console.log(`[orchestrator] Duration: ${DURATION_MS}ms | API: ${API_BASE}`);
  console.log('');

  let slug = process.env.DEMO_SLUG ?? null;

  // Phase 1: Start WriterBot first to create the document
  console.log('[orchestrator] Phase 1: WriterBot creating document...');
  // Run WriterBot for a short period to get the slug, then let it continue
  const writerEnv = slug ? { DEMO_SLUG: slug } : {};

  const writerPromise = spawnAgent('writer-bot.js', writerEnv);

  // Wait up to 10s for the slug to be emitted, then start other agents
  if (!slug) {
    await new Promise((resolve) => {
      const interval = setInterval(() => {
        if (metrics.slug) {
          slug = metrics.slug;
          console.log(`[orchestrator] Document created: ${slug}`);
          clearInterval(interval);
          resolve();
        }
      }, 500);
      // Fall back if writer doesn't emit slug within 15s
      setTimeout(() => {
        clearInterval(interval);
        if (!slug) {
          console.warn('[orchestrator] WriterBot did not emit DEMO_SLUG within 15s — other agents will wait');
        }
        resolve();
      }, 15_000);
    });
  }

  if (!slug) {
    console.error('[orchestrator] No DEMO_SLUG available — aborting');
    process.exit(1);
  }

  // Phase 2: Start other 3 agents in parallel
  console.log(`\n[orchestrator] Phase 2: Starting reviewer, consensus, and summarizer for slug=${slug}\n`);

  const sharedEnv = { DEMO_SLUG: slug };

  const [writerResult, reviewerResult, consensusResult, summarizerResult] = await Promise.all([
    writerPromise,
    spawnAgent('reviewer-bot.js', sharedEnv),
    spawnAgent('consensus-bot.js', sharedEnv),
    spawnAgent('summarizer-bot.js', sharedEnv),
  ]);

  // Phase 3: Summary
  console.log('\n[orchestrator] ─── Demo Complete ───────────────────────────────────');
  console.log(`  Document slug : ${slug}`);
  console.log(`  Document URL  : ${API_BASE.replace('api.', 'www.')}/doc/${slug}`);
  console.log(`  Section edits : ${metrics.sectionEdits}`);
  console.log(`  A2A messages  : ${metrics.a2aMessages}`);
  console.log(`  BFT approvals : ${metrics.approvals}`);
  console.log('');
  console.log(`  Exit codes: writer=${writerResult.code} reviewer=${reviewerResult.code} consensus=${consensusResult.code} summarizer=${summarizerResult.code}`);
  console.log('[orchestrator] ─────────────────────────────────────────────────────');

  // Validation gate
  const passed =
    metrics.sectionEdits >= 5 &&
    metrics.a2aMessages >= 3 &&
    metrics.approvals >= 1;

  if (passed) {
    console.log('[orchestrator] VALIDATION PASSED: all acceptance criteria met');
    process.exit(0);
  } else {
    console.warn('[orchestrator] VALIDATION PARTIAL: not all criteria met');
    console.warn(`  Need: sectionEdits>=5 (got ${metrics.sectionEdits}), a2a>=3 (got ${metrics.a2aMessages}), approvals>=1 (got ${metrics.approvals})`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[orchestrator] Fatal:', err);
  process.exit(1);
});
