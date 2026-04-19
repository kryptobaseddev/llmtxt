/**
 * observer-agent — reference example for the LLMtxt SDK.
 *
 * Demonstrates:
 *  - Passive document monitoring via SSE (watchDocument from llmtxt)
 *  - CRDT section subscription via loro-sync-v1 WebSocket (subscribeSection from llmtxt/crdt)
 *  - Event hash chain integrity verification
 *  - Ed25519 agent identity for API authentication (llmtxt/identity)
 *  - Strict vs. lenient verification modes (--verify-mode)
 *
 * This agent writes NO content — it is a pure read-only observer. It tracks
 * every event, verifies the event hash chain, and reports chain breaks.
 *
 * CLI:
 *   node index.js --slug my-doc
 *   node index.js --slug my-doc --verify-mode strict
 *   node index.js --help
 *
 * Environment variables (see .env.example):
 *   LLMTXT_API_KEY    Bearer token (required)
 *   LLMTXT_API_BASE   API base URL (default: https://api.llmtxt.my)
 */

import { createIdentity }            from 'llmtxt/identity';
import { watchDocument }             from 'llmtxt';
import { subscribeSection }          from 'llmtxt/crdt';
import { parseArgs }                 from 'node:util';
import { createHash }                from 'node:crypto';

// ── CLI argument parsing ──────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    slug:          { type: 'string',  short: 's' },
    'verify-mode': { type: 'string',  short: 'v', default: 'lenient' },
    timeout:       { type: 'string',  short: 't', default: '300000' },
    sections:      { type: 'string',  short: 'x', default: '' },
    help:          { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  console.log(`
observer-agent — LLMtxt reference example

Usage:
  node index.js --slug <slug> [options]

Options:
  --slug, -s           Document slug to observe (required)
  --verify-mode, -v    "strict" exits 1 on chain breaks; "lenient" warns only (default: lenient)
  --timeout, -t        Duration to observe in ms (default: 300000)
  --sections, -x       Comma-separated section IDs to watch via CRDT (default: auto)
  --help, -h           Show this help text

Environment:
  LLMTXT_API_KEY     Bearer token (required)
  LLMTXT_API_BASE    API base URL (default: https://api.llmtxt.my)

Examples:
  # Observe with default settings (lenient mode, 5 min)
  LLMTXT_API_KEY=sk-... node index.js --slug my-doc

  # Strict mode: exit non-zero if chain breaks detected
  LLMTXT_API_KEY=sk-... node index.js --slug my-doc --verify-mode strict

  # Watch specific sections via CRDT WebSocket
  LLMTXT_API_KEY=sk-... node index.js --slug my-doc --sections "introduction,summary"
`);
  process.exit(0);
}

if (!values.slug) {
  console.error('[observer-agent] ERROR: --slug is required. Run with --help for usage.');
  process.exit(1);
}

// ── Configuration ─────────────────────────────────────────────────────────────

const API_KEY     = process.env.LLMTXT_API_KEY ?? '';
const API_BASE    = (process.env.LLMTXT_API_BASE ?? 'https://api.llmtxt.my').replace(/\/$/, '');
const SLUG        = values.slug;
const TIMEOUT_MS  = Number(values.timeout);
const STRICT_MODE = values['verify-mode'] === 'strict';
const SECTION_IDS = values.sections
  ? values.sections.split(',').map((s) => s.trim()).filter(Boolean)
  : [];

if (!API_KEY) {
  console.error('[observer-agent] ERROR: LLMTXT_API_KEY env var is required.');
  process.exit(1);
}

// ── State ─────────────────────────────────────────────────────────────────────

/** Running metrics accumulated during the observation window. */
const metrics = {
  eventsTotal:       0,
  chainBreaks:       0,
  crdtBytesTotal:    0,
  crdtMessages:      0,
  versionEvents:     0,
  transitionEvents:  0,
  otherEvents:       0,
};

/** Ordered list of events received via SSE, used for hash chain verification. */
const eventLog = [];

/** Latest CRDT text per section, keyed by section ID. */
const latestSectionText = new Map();

/** Unsubscribe functions for CRDT WebSocket subscriptions. */
const crdtUnsubs = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Make an authenticated GET request and parse the JSON response.
 *
 * The observer only makes GET requests so no Ed25519 signing is needed for
 * API calls — the Bearer token is sufficient. Signing is still used to
 * register the agent pubkey at startup.
 *
 * @param {string} path  API path (e.g. '/api/v1/documents/my-doc/events')
 * @returns {Promise<unknown>}
 */
async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  });
  let json;
  try { json = await res.json(); } catch { json = {}; }
  if (!res.ok) {
    const msg = (json?.message ?? json?.error) ?? JSON.stringify(json);
    throw new Error(`GET ${path} -> ${res.status}: ${msg}`);
  }
  return json.result ?? json.data ?? json;
}

/**
 * Categorise an SSE event by type and update metrics.
 *
 * @param {{ event_type: string, payload?: unknown }} evt
 */
function categoriseEvent(evt) {
  const t = evt.event_type ?? '';
  metrics.eventsTotal++;

  if (t.includes('version') || t.includes('published')) {
    metrics.versionEvents++;
  } else if (t.includes('transition') || t.includes('state')) {
    metrics.transitionEvents++;
  } else {
    metrics.otherEvents++;
  }

  // Record the event for chain verification
  eventLog.push({
    ts:          Date.now(),
    type:        t,
    hash:        evt.hash     ?? null,
    prevHash:    evt.prevHash ?? null,
    payload:     evt.payload  ?? null,
  });
}

/**
 * Verify the event hash chain.
 *
 * Each event should reference the hash of the previous event via prevHash.
 * A break in the chain means either an event was dropped or tampered with.
 *
 * @returns {{ valid: boolean, breaks: number, checked: number }}
 */
function verifyHashChain() {
  let lastHash = null;
  let breaks   = 0;
  let checked  = 0;

  for (const evt of eventLog) {
    // Only verify events that actually carry hash fields
    if (evt.hash == null) continue;
    checked++;

    if (lastHash != null && evt.prevHash != null && evt.prevHash !== lastHash) {
      breaks++;
      console.warn(`[observer-agent] CHAIN BREAK at event type=${evt.type}`);
      console.warn(`[observer-agent]   expected prevHash=${lastHash.slice(0, 16)}...`);
      console.warn(`[observer-agent]   got      prevHash=${evt.prevHash.slice(0, 16)}...`);
    }

    lastHash = evt.hash;
  }

  return { valid: breaks === 0, breaks, checked };
}

/**
 * Open a loro-sync-v1 CRDT subscription for a section.
 *
 * subscribeSection() opens a WebSocket that emits SectionDelta events on each
 * incremental Loro update received from the server. Each delta carries:
 *   - text:        current full plain-text content of the section
 *   - updateBytes: raw Loro binary update bytes (Uint8Array)
 *
 * This lets us passively monitor the live CRDT state without polling REST.
 *
 * @param {string} sectionId  Section identifier (e.g. 'introduction')
 */
function openCrdtSubscription(sectionId) {
  const unsub = subscribeSection(
    SLUG,
    sectionId,
    (delta) => {
      const bytes = delta.updateBytes.length;
      metrics.crdtBytesTotal += bytes;
      metrics.crdtMessages++;

      // Cache the latest text so we can compare hashes at end of run
      latestSectionText.set(sectionId, delta.text);

      console.log(
        `[observer-agent] CRDT[${sectionId}] delta: ${bytes} bytes, ` +
        `text_len=${delta.text.length}, total_crdt=${metrics.crdtBytesTotal}`,
      );
    },
    {
      baseUrl: API_BASE,
      token:   API_KEY,
      onError: (err) => {
        console.warn(`[observer-agent] CRDT[${sectionId}] error: ${err}`);
      },
    },
  );

  crdtUnsubs.push(unsub);
  console.log(`[observer-agent] CRDT[${sectionId}] subscribeSection() opened (loro-sync-v1)`);
}

/**
 * Close all CRDT WebSocket subscriptions cleanly.
 */
function closeCrdtSubscriptions() {
  for (const unsub of crdtUnsubs) {
    try { unsub(); } catch { /* best-effort */ }
  }
  crdtUnsubs.length = 0;
  console.log('[observer-agent] CRDT subscriptions closed.');
}

/**
 * Perform a final chain check and convergence report, then print a summary.
 *
 * @returns {boolean}  true if all checks passed
 */
async function finalReport() {
  console.log('\n[observer-agent] === Final Report ===');

  // Re-verify chain from the full event log
  const chain = verifyHashChain();
  metrics.chainBreaks = chain.breaks;

  // Optionally fetch all events from the server for a deeper chain check
  let serverChainValid = null;
  try {
    const eventsData = await apiGet(`/api/v1/documents/${SLUG}/events?limit=200`);
    const serverEvents = Array.isArray(eventsData) ? eventsData : (eventsData.events ?? []);

    let lastServerHash = null;
    let serverBreaks   = 0;
    for (const evt of serverEvents) {
      if (!evt.hash) continue;
      if (lastServerHash && evt.prevHash && evt.prevHash !== lastServerHash) {
        serverBreaks++;
        console.warn(`[observer-agent] SERVER CHAIN BREAK: event id=${evt.id}`);
      }
      lastServerHash = evt.hash;
    }
    serverChainValid = serverBreaks === 0;
    console.log(`[observer-agent] Server event log: ${serverEvents.length} events, chain_valid=${serverChainValid}`);
  } catch (err) {
    console.warn(`[observer-agent] Could not fetch server events: ${err.message}`);
  }

  // Print metrics
  console.log(`[observer-agent] Total SSE events        : ${metrics.eventsTotal}`);
  console.log(`[observer-agent] Version events          : ${metrics.versionEvents}`);
  console.log(`[observer-agent] Transition events       : ${metrics.transitionEvents}`);
  console.log(`[observer-agent] Other events            : ${metrics.otherEvents}`);
  console.log(`[observer-agent] Chain breaks (client)   : ${chain.breaks} / ${chain.checked} checked`);
  console.log(`[observer-agent] Chain valid (client)    : ${chain.valid}`);
  console.log(`[observer-agent] Chain valid (server)    : ${serverChainValid ?? 'not checked'}`);
  console.log(`[observer-agent] CRDT messages           : ${metrics.crdtMessages}`);
  console.log(`[observer-agent] CRDT bytes total        : ${metrics.crdtBytesTotal}`);

  // Section text hashes (useful for auditing convergence)
  if (latestSectionText.size > 0) {
    console.log('[observer-agent] Section hashes (SHA-256 prefix):');
    for (const [sid, text] of latestSectionText) {
      const hash = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
      console.log(`[observer-agent]   ${sid}: ${hash}... (${text.length} chars)`);
    }
  }

  // Overall pass/fail
  const passed = chain.valid && (serverChainValid !== false);
  console.log(`\n[observer-agent] RESULT: ${passed ? 'PASS' : 'FAIL'} (verify-mode=${STRICT_MODE ? 'strict' : 'lenient'})`);
  return passed;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Step 1: Generate an ephemeral Ed25519 identity.
  //
  // The observer registers itself so the backend knows it's a legitimate agent.
  // Since this is read-only, no signing of document writes is required.
  console.log('[observer-agent] Generating Ed25519 identity...');
  const identity = await createIdentity();
  const agentId  = `observer-agent-${identity.pubkeyHex.slice(0, 8)}`;

  console.log(`[observer-agent] Agent ID    : ${agentId}`);
  console.log(`[observer-agent] Pubkey      : ${identity.pubkeyHex.slice(0, 16)}...`);
  console.log(`[observer-agent] Document    : ${SLUG}`);
  console.log(`[observer-agent] Verify mode : ${STRICT_MODE ? 'strict' : 'lenient'}`);
  console.log(`[observer-agent] Timeout     : ${TIMEOUT_MS}ms\n`);

  // Register pubkey (best-effort — non-fatal if it fails)
  try {
    const regBody = JSON.stringify({ agent_id: agentId, pubkey_hex: identity.pubkeyHex, label: 'observer-agent reference example' });
    const sigHeaders = await identity.buildSignatureHeaders('POST', '/api/v1/agents/keys', regBody, agentId);
    const regRes = await fetch(`${API_BASE}/api/v1/agents/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}`, 'X-Agent-Id': agentId, ...sigHeaders },
      body: regBody,
    });
    if (regRes.ok || regRes.status === 409) {
      console.log('[observer-agent] Pubkey registered.');
    } else {
      console.warn(`[observer-agent] Pubkey registration returned ${regRes.status} (non-fatal)`);
    }
  } catch (err) {
    console.warn(`[observer-agent] Pubkey registration failed (non-fatal): ${err.message}`);
  }

  // Step 2: Open CRDT subscriptions for the requested section IDs.
  //
  // If --sections was provided, subscribe to each one via subscribeSection().
  // The CRDT WebSocket emits a SectionDelta on every loro-sync-v1 Update frame,
  // giving us the live text without polling the REST API.
  if (SECTION_IDS.length > 0) {
    for (const sid of SECTION_IDS) {
      openCrdtSubscription(sid);
    }
  } else {
    console.log('[observer-agent] No --sections specified; skipping CRDT subscriptions.');
    console.log('[observer-agent] (Tip: add --sections "introduction,summary" to observe CRDT.)');
  }

  // Step 3: Subscribe to the SSE event stream and observe passively.
  console.log(`\n[observer-agent] Connecting to SSE stream for "${SLUG}"...`);

  const ac      = new AbortController();
  const timerId = setTimeout(() => ac.abort(), TIMEOUT_MS);

  try {
    for await (const evt of watchDocument(API_BASE, SLUG, { apiKey: API_KEY, signal: ac.signal })) {
      categoriseEvent(evt);

      // Log each event with type and a truncated payload summary
      const payloadStr = JSON.stringify(evt.payload ?? {}).slice(0, 80);
      console.log(`[observer-agent] Event #${metrics.eventsTotal}: ${evt.event_type} | ${payloadStr}`);

      // Inline chain check: compare this event's prevHash against the last known hash
      if (eventLog.length >= 2) {
        const prev = eventLog[eventLog.length - 2];
        const curr = eventLog[eventLog.length - 1];
        if (prev.hash && curr.prevHash && curr.prevHash !== prev.hash) {
          console.warn(`[observer-agent] CHAIN BREAK detected at event #${metrics.eventsTotal}!`);
          if (STRICT_MODE) {
            console.error('[observer-agent] Strict mode: aborting on chain break.');
            ac.abort();
          }
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(`[observer-agent] Stream error: ${err.message}`);
    }
  } finally {
    clearTimeout(timerId);
  }

  // Step 4: Close CRDT connections and print the final report.
  closeCrdtSubscriptions();
  const passed = await finalReport();

  // Exit with non-zero code if strict mode and any issues found.
  if (STRICT_MODE && !passed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[observer-agent] Fatal:', err.message);
  process.exit(1);
});
