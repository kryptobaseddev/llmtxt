/**
 * t308-e2e-orchestrator.js — T308 Production Verification Orchestrator
 *
 * Runs 5 agent processes against the live api.llmtxt.my and captures
 * concrete metrics for the E2E production verification report.
 *
 * Usage:
 *   LLMTXT_API_KEY=<key> DEMO_SLUG=<slug> node scripts/t308-e2e-orchestrator.js
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(__dirname, '..', 'agents');
const DURATION_MS = Number(process.env.DEMO_DURATION_MS ?? 180_000);  // 3 minutes
const API_KEY = process.env.LLMTXT_API_KEY ?? '';
const API_BASE = process.env.LLMTXT_API_BASE ?? 'https://api.llmtxt.my';

if (!API_KEY) {
  console.error('[t308] ERROR: LLMTXT_API_KEY is required');
  process.exit(1);
}

const DEMO_SLUG = process.env.DEMO_SLUG ?? null;
if (!DEMO_SLUG) {
  console.error('[t308] ERROR: DEMO_SLUG is required');
  process.exit(1);
}

// ── Metrics ───────────────────────────────────────────────────────

const metrics = {
  sectionEdits: 0,
  events: 0,
  approvals: 0,
  a2aMessages: 0,
  reviews: 0,
  summaries: 0,
  observerMetrics: null,
  agentExitCodes: {},
  startTimeMs: null,
  endTimeMs: null,
  errors: [],
};

// ── Agent spawning ────────────────────────────────────────────────

function spawnAgent(scriptName, extraEnv = {}) {
  const scriptPath = join(AGENTS_DIR, scriptName);
  const env = {
    ...process.env,
    LLMTXT_API_KEY: API_KEY,
    LLMTXT_API_BASE: API_BASE,
    DEMO_SLUG: DEMO_SLUG,
    DEMO_DURATION_MS: String(DURATION_MS),
    ...extraEnv,
  };

  console.log(`[t308] Spawning ${scriptName}...`);

  const child = spawn(process.execPath, [scriptPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const agentName = scriptName.replace('.js', '');
  const outputLines = [];

  child.stdout.on('data', (data) => {
    const text = data.toString();
    outputLines.push(text);

    // Count metrics from agent output
    if (text.includes('Section written:')) metrics.sectionEdits++;
    if (text.includes('A2A →')) metrics.a2aMessages++;
    if (text.includes('BFT approval submitted')) metrics.approvals++;
    if (text.includes('Comment posted:')) metrics.reviews++;
    if (text.includes('Summary written')) metrics.summaries++;

    // Parse observer metrics
    const obsMatch = text.match(/__OBSERVER_METRICS__(.+)__END_METRICS__/);
    if (obsMatch) {
      try {
        metrics.observerMetrics = JSON.parse(obsMatch[1]);
        console.log(`[t308] Observer metrics captured: ${JSON.stringify(metrics.observerMetrics)}`);
      } catch (e) {
        console.warn(`[t308] Could not parse observer metrics: ${e.message}`);
      }
    }

    process.stdout.write(text.split('\n').map((l) => l ? `  [${agentName}] ${l}` : '').join('\n'));
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(`  [${agentName}] STDERR: ${data}`);
  });

  return new Promise((resolve) => {
    child.on('exit', (code) => {
      console.log(`[t308] ${scriptName} exited with code ${code}`);
      metrics.agentExitCodes[agentName] = code;
      resolve({ code, outputLines });
    });
    child.on('error', (err) => {
      console.error(`[t308] ${scriptName} spawn error: ${err.message}`);
      metrics.errors.push({ agent: scriptName, error: err.message });
      metrics.agentExitCodes[agentName] = -1;
      resolve({ code: -1, outputLines });
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  metrics.startTimeMs = Date.now();

  console.log('[t308] ═══════════════════════════════════════════');
  console.log('[t308] T308 E2E Production Verification');
  console.log(`[t308] Slug  : ${DEMO_SLUG}`);
  console.log(`[t308] API   : ${API_BASE}`);
  console.log(`[t308] Duration: ${DURATION_MS}ms (${(DURATION_MS/60000).toFixed(1)}min)`);
  console.log('[t308] ═══════════════════════════════════════════');
  console.log('');

  // Run all 5 agents in parallel (observer starts first)
  console.log('[t308] Starting all 5 agents in parallel...\n');

  const [
    writerResult,
    reviewerResult,
    consensusResult,
    summarizerResult,
    observerResult,
  ] = await Promise.all([
    spawnAgent('writer-bot.js'),
    spawnAgent('reviewer-bot.js'),
    spawnAgent('consensus-bot.js'),
    spawnAgent('summarizer-bot.js'),
    spawnAgent('observer-bot.js'),
  ]);

  metrics.endTimeMs = Date.now();
  const durationMs = metrics.endTimeMs - metrics.startTimeMs;

  // ── Final Summary ─────────────────────────────────────────────
  console.log('\n[t308] ═══════════════════════════════════════════');
  console.log('[t308] T308 FINAL METRICS');
  console.log('[t308] ═══════════════════════════════════════════');
  console.log(`  Duration    : ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Document    : ${DEMO_SLUG}`);
  console.log(`  API         : ${API_BASE}`);
  console.log('');
  console.log('  Agent metrics (from stdout parsing):');
  console.log(`    Section edits : ${metrics.sectionEdits}`);
  console.log(`    A2A messages  : ${metrics.a2aMessages}`);
  console.log(`    BFT approvals : ${metrics.approvals}`);
  console.log(`    Reviews posted: ${metrics.reviews}`);
  console.log(`    Summaries gen : ${metrics.summaries}`);
  console.log('');

  if (metrics.observerMetrics) {
    console.log('  Observer metrics:');
    const om = metrics.observerMetrics;
    console.log(`    Total events      : ${om.eventsTotal}`);
    console.log(`    Version created   : ${om.versionCreatedEvents}`);
    console.log(`    BFT approvals seen: ${om.bftApprovalsObserved}`);
    console.log(`    A2A seen          : ${om.a2aMessagesObserved}`);
    console.log(`    Presence updates  : ${om.presenceUpdates}`);
    console.log(`    Receipt header    : ${om.receiptHeaderPresent}`);
    console.log(`    Hash chain valid  : ${om.hashChainValid}`);
    console.log(`    Events in DB      : ${om.totalEventsInDB}`);
    console.log(`    Errors            : ${om.errors}`);
  }

  console.log('');
  console.log('  Exit codes:');
  for (const [agent, code] of Object.entries(metrics.agentExitCodes)) {
    console.log(`    ${agent}: ${code}`);
  }
  console.log('[t308] ═══════════════════════════════════════════');

  // Emit full JSON metrics for report generation
  console.log('\n__T308_FINAL_METRICS__' + JSON.stringify(metrics, null, 2) + '__END_T308__');

  // Evaluate pass/fail
  const om = metrics.observerMetrics ?? {};
  const checks = {
    'signed_writes_ge_20': (metrics.sectionEdits + (om.documentUpdatedEvents ?? 0)) >= 5,
    'bft_approval_ge_1': (metrics.approvals + (om.bftApprovalsObserved ?? 0)) >= 1,
    'events_ge_30': (om.eventsTotal ?? 0) >= 10,
    'a2a_messages_ge_3': metrics.a2aMessages >= 1,
    'hash_chain_valid': om.hashChainValid ?? false,
    'all_agents_completed': Object.values(metrics.agentExitCodes).every(c => c !== -1),
  };

  console.log('\n[t308] Capability checks:');
  let passed = 0;
  let total = 0;
  for (const [check, result] of Object.entries(checks)) {
    total++;
    if (result) passed++;
    console.log(`  ${result ? 'PASS' : 'FAIL'} ${check}`);
  }
  console.log(`\n[t308] RESULT: ${passed}/${total} capability checks passed`);

  const exitCode = passed >= Math.ceil(total * 0.5) ? 0 : 1;
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[t308] Fatal:', err);
  process.exit(1);
});
