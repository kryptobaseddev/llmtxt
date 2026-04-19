/**
 * reviewer-agent — reference example for the LLMtxt SDK.
 *
 * Demonstrates:
 *  - Subscribing to a document SSE event stream (watchDocument from llmtxt)
 *  - Fetching version content on each versionCreated event
 *  - Applying review rules to section content
 *  - Posting structured review comments to the scratchpad endpoint
 *  - Sending a signed A2A envelope to a consensus agent
 *  - Loading review rules from a JSON file (--review-rules)
 *
 * CLI:
 *   node index.js --slug my-doc
 *   node index.js --slug my-doc --review-rules ./rules.json
 *   node index.js --help
 *
 * Environment variables (see .env.example):
 *   LLMTXT_API_KEY    Bearer token (required)
 *   LLMTXT_API_BASE   API base URL (default: https://api.llmtxt.my)
 */

import { createIdentity } from 'llmtxt/identity';
import { watchDocument }  from 'llmtxt';
import { parseArgs }      from 'node:util';
import { readFileSync }   from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';

// ── CLI argument parsing ──────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    slug:           { type: 'string', short: 's' },
    'review-rules': { type: 'string', short: 'r' },
    timeout:        { type: 'string', short: 't', default: '120000' },
    help:           { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  console.log(`
reviewer-agent — LLMtxt reference example

Usage:
  node index.js --slug <slug> [--review-rules <file>]

Options:
  --slug, -s           Document slug to monitor (required)
  --review-rules, -r   Path to a JSON file with review rules (optional)
  --timeout, -t        How long to watch in ms (default: 120000)
  --help, -h           Show this help text

Review rules JSON format:
  [
    { "id": "rule-id", "test": "no-code", "comment": "Add a code example.", "severity": "warning" },
    ...
  ]

  Supported test values:
    "no-code"     — triggers when section has no code fences
    "too-short"   — triggers when section has fewer than 3 non-empty lines
    "no-links"    — triggers when section > 200 chars and has no URLs

Environment:
  LLMTXT_API_KEY     Bearer token (required)
  LLMTXT_API_BASE    API base URL (default: https://api.llmtxt.my)

Example:
  LLMTXT_API_KEY=sk-... node index.js --slug my-doc --review-rules ./rules.json
`);
  process.exit(0);
}

if (!values.slug) {
  console.error('[reviewer-agent] ERROR: --slug is required. Run with --help for usage.');
  process.exit(1);
}

// ── Configuration ─────────────────────────────────────────────────────────────

const API_KEY    = process.env.LLMTXT_API_KEY ?? '';
const API_BASE   = (process.env.LLMTXT_API_BASE ?? 'https://api.llmtxt.my').replace(/\/$/, '');
const SLUG       = values.slug;
const TIMEOUT_MS = Number(values.timeout);

if (!API_KEY) {
  console.error('[reviewer-agent] ERROR: LLMTXT_API_KEY env var is required.');
  process.exit(1);
}

// ── Review rules ──────────────────────────────────────────────────────────────

// Default rules — in production these would call an LLM critique API.
const DEFAULT_RULES = [
  {
    id: 'no-code-example',
    // Triggers if section body contains no markdown code fence
    test: (text) => !text.includes('```'),
    comment: 'Consider adding a code example to illustrate this concept.',
    severity: 'suggestion',
  },
  {
    id: 'too-short',
    // Triggers if section has fewer than 3 non-empty lines
    test: (text) => text.split('\n').filter((l) => l.trim()).length < 3,
    comment: 'This section is brief — consider expanding with more detail.',
    severity: 'warning',
  },
  {
    id: 'no-links',
    // Triggers for long sections that include no hyperlinks
    test: (text) => !text.includes('http') && text.length > 200,
    comment: 'No external references found — linking to documentation would strengthen this.',
    severity: 'suggestion',
  },
];

/**
 * Load review rules from a JSON file if --review-rules was provided.
 * Falls back to DEFAULT_RULES on parse error.
 *
 * Each rule in the JSON file must have:
 *   { "id": string, "test": "no-code"|"too-short"|"no-links", "comment": string, "severity": string }
 *
 * @returns {Array<{ id: string, test: (text: string) => boolean, comment: string, severity: string }>}
 */
function loadRules() {
  if (!values['review-rules']) return DEFAULT_RULES;

  try {
    const raw = JSON.parse(readFileSync(values['review-rules'], 'utf8'));
    // Map declarative test names to predicate functions
    const TEST_MAP = {
      'no-code':  (t) => !t.includes('```'),
      'too-short': (t) => t.split('\n').filter((l) => l.trim()).length < 3,
      'no-links': (t) => !t.includes('http') && t.length > 200,
    };
    return raw.map((r) => ({
      id: r.id,
      test: TEST_MAP[r.test] ?? (() => false),
      comment: r.comment ?? '(no comment)',
      severity: r.severity ?? 'suggestion',
    }));
  } catch (err) {
    console.warn(`[reviewer-agent] Could not load rules file: ${err.message}. Using defaults.`);
    return DEFAULT_RULES;
  }
}

const RULES = loadRules();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build signed fetch for mutating HTTP requests.
 *
 * @param {import('llmtxt/identity').AgentIdentity} identity
 * @param {string} agentId
 * @param {string} path
 * @param {object} [opts]
 */
async function signedFetch(identity, agentId, path, opts = {}) {
  const method = opts.method ?? 'GET';
  const body   = opts.body   ?? '';

  const headers = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${API_KEY}`,
  };

  if (method !== 'GET' && identity) {
    // Sign: METHOD + PATH + TIMESTAMP_MS + AGENT_ID + NONCE + BODY_HASH
    const sigHeaders = await identity.buildSignatureHeaders(method, path, body, agentId);
    Object.assign(headers, sigHeaders);
    headers['X-Agent-Id'] = agentId;
  }

  return fetch(`${API_BASE}${path}`, { method, headers, body: body || undefined });
}

async function api(identity, agentId, path, opts = {}) {
  const res = await signedFetch(identity, agentId, path, opts);
  let json;
  try { json = await res.json(); } catch { json = {}; }
  if (!res.ok) {
    const msg = (json?.message ?? json?.error) ?? JSON.stringify(json);
    throw new Error(`${opts.method ?? 'GET'} ${path} -> ${res.status}: ${msg}`);
  }
  return json.result ?? json.data ?? json;
}

/**
 * Parse markdown content into an array of { heading, body } sections.
 *
 * @param {string} content  Raw markdown text
 * @returns {Array<{ heading: string, body: string }>}
 */
function parseSections(content) {
  const lines    = content.split('\n');
  const sections = [];
  let current    = null;

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

/**
 * Apply RULES to each section and return all triggered comments.
 *
 * @param {Array<{ heading: string, body: string }>} sections
 * @returns {Array<{ section: string, rule: string, comment: string, severity: string }>}
 */
function applyRules(sections) {
  const comments = [];
  for (const { heading, body } of sections) {
    for (const rule of RULES) {
      if (rule.test(body)) {
        comments.push({ section: heading, rule: rule.id, comment: rule.comment, severity: rule.severity });
      }
    }
  }
  return comments;
}

/**
 * Post a review comment to the document scratchpad.
 * Scratchpad is a structured JSON store visible to all agents watching the doc.
 *
 * @param {import('llmtxt/identity').AgentIdentity} identity
 * @param {string} agentId
 * @param {string} slug
 * @param {object} comment
 */
async function postComment(identity, agentId, slug, comment) {
  const scratchContent = JSON.stringify({
    reviewer:  agentId,
    slug,
    section:   comment.section,
    rule:      comment.rule,
    comment:   comment.comment,
    severity:  comment.severity,
    timestamp: new Date().toISOString(),
  });

  await api(identity, agentId, `/api/v1/documents/${slug}/scratchpad`, {
    method: 'POST',
    body: JSON.stringify({
      content:     scratchContent,
      contentType: 'application/json',
      agentId,
    }),
  });

  console.log(`[reviewer-agent]   [${comment.severity}] "${comment.section}": ${comment.rule}`);
}

/**
 * Send a signed A2A envelope to the consensus agent's inbox.
 *
 * A2A (Agent-to-Agent) envelopes carry a signed payload that the recipient can
 * verify. The signature covers: from + to + nonce + timestamp + content_type + payload_hash.
 *
 * @param {import('llmtxt/identity').AgentIdentity} identity
 * @param {string} agentId
 * @param {string} slug
 * @param {string|number} version
 * @param {'approved'|'changes-requested'} recommendation
 * @param {string} rationale
 */
async function sendA2AToConsensus(identity, agentId, slug, version, recommendation, rationale) {
  // In a real deployment, consensus-agent would be a known agent ID. Here we
  // use a conventional name that the consensus agent would register under.
  const toAgentId = 'consensus-agent';

  const payload     = JSON.stringify({ type: 'review-complete', slug, version, recommendation, rationale, reviewer: agentId });
  const payloadB64  = Buffer.from(payload, 'utf8').toString('base64');
  const nonce       = randomBytes(16).toString('hex');
  const timestampMs = Date.now();
  const contentType = 'application/json';

  // Canonical payload: from\nto\nnonce\ntimestamp_ms\ncontent_type\npayload_hash_hex
  const payloadHash = createHash('sha256').update(payload, 'utf8').digest('hex');
  const canonical   = [agentId, toAgentId, nonce, timestampMs, contentType, payloadHash].join('\n');
  const sigBytes    = await identity.sign(Buffer.from(canonical, 'utf8'));
  const sigHex      = Buffer.from(sigBytes).toString('hex');

  const envelope = { from: agentId, to: toAgentId, nonce, timestamp_ms: timestampMs, content_type: contentType, payload: payloadB64, signature: sigHex };

  try {
    const res = await signedFetch(identity, agentId, `/api/v1/agents/${encodeURIComponent(toAgentId)}/inbox`, {
      method: 'POST',
      body:   JSON.stringify({ envelope }),
    });
    if (res.ok) {
      console.log(`[reviewer-agent] A2A -> ${toAgentId}: recommendation=${recommendation}`);
    } else {
      // Non-fatal: consensus agent may not be running
      console.warn(`[reviewer-agent] A2A -> ${toAgentId} returned ${res.status} (non-fatal)`);
    }
  } catch (err) {
    console.warn(`[reviewer-agent] A2A send failed (non-fatal): ${err.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Step 1: Generate an ephemeral Ed25519 identity for this session.
  console.log('[reviewer-agent] Generating Ed25519 identity...');
  const identity = await createIdentity();
  const agentId  = `reviewer-agent-${identity.pubkeyHex.slice(0, 8)}`;

  console.log(`[reviewer-agent] Agent ID  : ${agentId}`);
  console.log(`[reviewer-agent] Pubkey    : ${identity.pubkeyHex.slice(0, 16)}...`);
  console.log(`[reviewer-agent] Document  : ${SLUG}`);
  console.log(`[reviewer-agent] Rules     : ${RULES.length} loaded`);

  // Step 2: Register pubkey so scratchpad POSTs can be verified.
  const regBody = JSON.stringify({ agent_id: agentId, pubkey_hex: identity.pubkeyHex, label: 'reviewer-agent reference example' });
  const regRes  = await signedFetch(identity, agentId, '/api/v1/agents/keys', { method: 'POST', body: regBody });
  if (!regRes.ok && regRes.status !== 409) {
    console.warn(`[reviewer-agent] Pubkey registration returned ${regRes.status}`);
  } else {
    console.log('[reviewer-agent] Pubkey registered.');
  }

  // Step 3: Subscribe to the document SSE event stream.
  //
  // watchDocument() returns an async iterable of DocumentEventLogEntry objects.
  // Each entry has { event_type, payload, ... }. We watch for versionCreated
  // events, then fetch content and apply critique rules.
  console.log(`[reviewer-agent] Subscribing to SSE stream for "${SLUG}"...`);
  console.log(`[reviewer-agent] (Watching for up to ${TIMEOUT_MS}ms)\n`);

  const ac        = new AbortController();
  const timerId   = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const reviewed  = new Set(); // Track version numbers we've already reviewed

  try {
    for await (const evt of watchDocument(API_BASE, SLUG, { apiKey: API_KEY, signal: ac.signal })) {
      const type = evt.event_type;

      // Look for events that signal new content is ready for review.
      // The event type varies slightly between API versions — handle both forms.
      const isVersionEvent =
        type === 'version_created'   ||
        type === 'version.published' ||
        type === 'document_updated'  ||
        type === 'document.updated';

      if (!isVersionEvent) {
        console.log(`[reviewer-agent] Event: ${type} (skipping)`);
        continue;
      }

      // Extract version number; fall back to a timestamp key if not present
      const version    = evt.payload?.versionNumber ?? evt.payload?.version ?? Date.now();
      const versionKey = String(version);
      if (reviewed.has(versionKey)) continue;
      reviewed.add(versionKey);

      console.log(`[reviewer-agent] New version detected: ${version}`);

      // Step 4: Fetch the document's raw content for critique.
      let content;
      try {
        const rawRes = await signedFetch(identity, agentId, `/api/v1/documents/${SLUG}/raw`);
        if (!rawRes.ok) throw new Error(`HTTP ${rawRes.status}`);
        content = await rawRes.text();
      } catch (err) {
        console.warn(`[reviewer-agent] Could not fetch content: ${err.message}`);
        continue;
      }

      // Step 5: Apply review rules to each markdown section.
      const sections = parseSections(content);
      console.log(`[reviewer-agent] Reviewing ${sections.length} section(s)...`);
      const comments = applyRules(sections);

      if (comments.length === 0) {
        console.log('[reviewer-agent] No issues found — content looks good!');
      } else {
        console.log(`[reviewer-agent] Found ${comments.length} comment(s):`);
        for (const c of comments) {
          // Post each comment to the scratchpad so other agents can see it
          try {
            await postComment(identity, agentId, SLUG, c);
          } catch (err) {
            console.warn(`[reviewer-agent] Comment post failed (non-fatal): ${err.message}`);
          }
        }
      }

      // Step 6: Send A2A verdict to consensus agent.
      const hasWarnings    = comments.some((c) => c.severity === 'warning');
      const recommendation = hasWarnings ? 'changes-requested' : 'approved';
      const rationale      = hasWarnings
        ? `${comments.filter((c) => c.severity === 'warning').length} warning(s) require attention.`
        : comments.length === 0
          ? 'No issues found.'
          : 'Only suggestions — approving with comments.';

      await sendA2AToConsensus(identity, agentId, SLUG, version, recommendation, rationale);
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(`[reviewer-agent] Stream error: ${err.message}`);
    }
  } finally {
    clearTimeout(timerId);
  }

  console.log(`\n[reviewer-agent] Done. Reviewed ${reviewed.size} version(s).`);
}

main().catch((err) => {
  console.error('[reviewer-agent] Fatal:', err.message);
  process.exit(1);
});
