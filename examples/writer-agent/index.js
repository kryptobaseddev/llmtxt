/**
 * writer-agent — reference example for the LLMtxt SDK.
 *
 * Demonstrates:
 *  - Generating a fresh Ed25519 keypair at runtime (llmtxt/identity)
 *  - Registering the pubkey with the API (POST /api/v1/agents/keys)
 *  - Signing every mutating HTTP request with X-Agent-* headers
 *  - Creating a document via POST /api/v1/compress
 *  - Writing a section via PUT /api/v1/documents/:slug/sections/:id
 *  - Submitting a version via POST /api/v1/documents/:slug/versions
 *  - Transitioning the document to REVIEW
 *
 * CLI:
 *   node index.js --slug my-doc --section-id intro --content "Hello world."
 *   node index.js --help
 *
 * Environment variables (see .env.example):
 *   LLMTXT_API_KEY    Bearer token (required)
 *   LLMTXT_API_BASE   API base URL (default: https://api.llmtxt.my)
 */

import { createIdentity } from 'llmtxt/identity';
import { parseArgs } from 'node:util';

// ── CLI argument parsing ──────────────────────────────────────────────────────

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    slug:       { type: 'string', short: 's' },
    'section-id': { type: 'string', short: 'i', default: 'main' },
    content:    { type: 'string', short: 'c' },
    help:       { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  console.log(`
writer-agent — LLMtxt reference example

Usage:
  node index.js --slug <slug> --section-id <id> --content <text>

Options:
  --slug, -s         Document slug (creates a new doc if omitted)
  --section-id, -i   Section identifier to write (default: "main")
  --content, -c      Text content to write to the section
  --help, -h         Show this help text

Environment:
  LLMTXT_API_KEY     Bearer token (required)
  LLMTXT_API_BASE    API base URL (default: https://api.llmtxt.my)

Example:
  LLMTXT_API_KEY=sk-... node index.js \\
    --slug my-doc \\
    --section-id introduction \\
    --content "# Introduction\\n\\nThis doc is written by a writer-agent."
`);
  process.exit(0);
}

// ── Configuration ─────────────────────────────────────────────────────────────

const API_KEY  = process.env.LLMTXT_API_KEY ?? '';
const API_BASE = (process.env.LLMTXT_API_BASE ?? 'https://api.llmtxt.my').replace(/\/$/, '');

if (!API_KEY) {
  console.error('[writer-agent] ERROR: LLMTXT_API_KEY env var is required.');
  process.exit(1);
}

const sectionId = values['section-id'] ?? 'main';
const content   = values.content ?? '# New Section\n\nContent written by writer-agent.';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Perform a signed HTTP request.
 *
 * For state-mutating methods (POST, PUT, PATCH, DELETE) this function attaches
 * Ed25519 signature headers via the identity returned by createIdentity().
 * The signature binds: METHOD + PATH + TIMESTAMP_MS + AGENT_ID + NONCE + BODY_HASH.
 *
 * @param {import('llmtxt/identity').AgentIdentity} identity
 * @param {string} agentId  Registered agent ID used as X-Agent-Id / X-Agent-Pubkey-Id
 * @param {string} path     Request path (e.g. '/api/v1/compress')
 * @param {object} [opts]   Fetch-style options (method, body)
 * @returns {Promise<Response>}
 */
async function signedFetch(identity, agentId, path, opts = {}) {
  const method = opts.method ?? 'GET';
  const body   = opts.body   ?? '';

  const headers = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${API_KEY}`,
  };

  // Sign all state-mutating requests so the backend can verify the identity
  // of the agent that wrote each section. The buildSignatureHeaders() call
  // produces four X-Agent-* headers that the middleware checks.
  if (method !== 'GET' && identity) {
    const sigHeaders = await identity.buildSignatureHeaders(method, path, body, agentId);
    Object.assign(headers, sigHeaders);
    // X-Agent-Id makes the agent human-readable in server logs
    headers['X-Agent-Id'] = agentId;
  }

  return fetch(`${API_BASE}${path}`, { method, headers, body: body || undefined });
}

/**
 * signedFetch + JSON parse. Throws on non-2xx.
 *
 * @param {import('llmtxt/identity').AgentIdentity} identity
 * @param {string} agentId
 * @param {string} path
 * @param {object} [opts]
 * @returns {Promise<unknown>}
 */
async function api(identity, agentId, path, opts = {}) {
  const res = await signedFetch(identity, agentId, path, opts);
  let json;
  try { json = await res.json(); } catch { json = {}; }
  if (!res.ok) {
    const msg = (json?.message ?? json?.error) ?? JSON.stringify(json);
    throw new Error(`${opts.method ?? 'GET'} ${path} -> ${res.status}: ${msg}`);
  }
  // The API wraps results in { result: ... } or { data: ... }
  return json.result ?? json.data ?? json;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Step 1: Generate a fresh Ed25519 keypair.
  //
  // Keys are ephemeral — never persisted to disk in this example. Each run
  // of this agent produces a fresh identity, which is the correct default for
  // reference examples. Production agents should persist keypairs securely.
  console.log('[writer-agent] Generating Ed25519 identity...');
  const identity = await createIdentity();
  const agentId  = `writer-agent-${identity.pubkeyHex.slice(0, 8)}`;

  console.log(`[writer-agent] Agent ID : ${agentId}`);
  console.log(`[writer-agent] Pubkey   : ${identity.pubkeyHex.slice(0, 16)}...`);

  // Step 2: Register the pubkey so the backend can verify our request signatures.
  //
  // This call is idempotent — repeat runs with the same pubkey return 409 which
  // is treated as success. Without registration the backend rejects signed writes.
  console.log('[writer-agent] Registering pubkey...');
  const regBody = JSON.stringify({
    agent_id:   agentId,
    pubkey_hex: identity.pubkeyHex,
    label:      'writer-agent reference example',
  });
  const regRes = await signedFetch(identity, agentId, '/api/v1/agents/keys', {
    method: 'POST',
    body:   regBody,
  });
  if (!regRes.ok && regRes.status !== 409) {
    const txt = await regRes.text();
    console.warn(`[writer-agent] Pubkey registration returned ${regRes.status}: ${txt}`);
  } else {
    console.log('[writer-agent] Pubkey registered (or already known).');
  }

  // Step 3: Resolve or create the target document.
  let slug = values.slug;
  if (!slug) {
    // No slug provided — create a fresh document with placeholder content.
    console.log('[writer-agent] No --slug provided; creating new document...');
    const doc = await api(identity, agentId, '/api/v1/compress', {
      method: 'POST',
      body: JSON.stringify({
        content:   `# New Document\n\nCreated by writer-agent.\n`,
        format:    'markdown',
        createdBy: agentId,
      }),
    });
    slug = doc.slug;
    console.log(`[writer-agent] Created document: ${slug}`);
  } else {
    console.log(`[writer-agent] Using existing document: ${slug}`);
  }

  // Step 4: Write the section content via PUT.
  //
  // Every PUT is signed with Ed25519. The backend verifies the signature
  // against the pubkey registered in Step 2 and records the agent ID as the
  // author of this section revision. This creates a tamper-evident audit trail.
  console.log(`[writer-agent] Writing section "${sectionId}"...`);
  const putBody = JSON.stringify({
    content:   content,
    changelog: `writer-agent: updated section ${sectionId}`,
    createdBy: agentId,
  });
  await api(identity, agentId, `/api/v1/documents/${slug}/sections/${sectionId}`, {
    method: 'PUT',
    body:   putBody,
  });
  console.log(`[writer-agent] Section "${sectionId}" written (signed PUT).`);

  // Step 5: Submit a version so reviewers can see a stable snapshot.
  console.log('[writer-agent] Submitting version...');
  try {
    const ver = await api(identity, agentId, `/api/v1/documents/${slug}/versions`, {
      method: 'POST',
      body:   JSON.stringify({
        changelog: `writer-agent: initial version of section ${sectionId}`,
        createdBy: agentId,
      }),
    });
    console.log(`[writer-agent] Version submitted: ${ver.versionNumber ?? ver.id ?? '(unknown)'}`);
  } catch (err) {
    // Non-fatal — document may not require explicit version creation
    console.warn(`[writer-agent] Version submit skipped: ${err.message}`);
  }

  // Step 6: Transition to REVIEW so the reviewer-agent can pick it up.
  console.log('[writer-agent] Transitioning document to REVIEW...');
  try {
    await api(identity, agentId, `/api/v1/documents/${slug}/transition`, {
      method: 'POST',
      body:   JSON.stringify({
        state:  'REVIEW',
        reason: `writer-agent: draft complete, requesting review`,
      }),
    });
    console.log('[writer-agent] Document is now in REVIEW state.');
  } catch (err) {
    console.warn(`[writer-agent] Transition skipped (doc may already be in REVIEW): ${err.message}`);
  }

  // Done — print a summary for the operator.
  console.log('\n[writer-agent] === Summary ===');
  console.log(`  Document  : ${API_BASE}/api/v1/documents/${slug}`);
  console.log(`  Section   : ${sectionId}`);
  console.log(`  Agent ID  : ${agentId}`);
  console.log(`  Pubkey    : ${identity.pubkeyHex.slice(0, 16)}...`);
  console.log(`  All writes signed with Ed25519 (${identity.pubkeyHex.length / 2} byte key)`);
}

main().catch((err) => {
  console.error('[writer-agent] Fatal:', err.message);
  process.exit(1);
});
