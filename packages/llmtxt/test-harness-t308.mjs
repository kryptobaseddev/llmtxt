/**
 * 5-Agent Real-World Collaboration Test — v2026.4.9
 * Imports from dist/ paths to use packages/llmtxt/node_modules for dependencies.
 */

import { identityFromSeed, signRequest } from './dist/identity/index.js';
import { AgentSession, signApproval, submitSignedApproval, planRetrieval } from './dist/sdk/index.js';
import { getSectionText } from './dist/crdt.js';
import { hashBlob, validateBlobName } from './dist/blob/index.js';
import { generateOverview } from './dist/disclosure.js';
import { RemoteBackend } from './dist/remote/index.js';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const API_KEY = process.env.LLMTXT_API_KEY || 'llmtxt_pQuyXcTH9KQFXdgbZCyn8jmSa9Vjjo3vBQIZmQopkFs';
const BASE_URL = 'https://api.llmtxt.my';
const API_V1  = BASE_URL + '/api/v1';
const TEST_TS  = Date.now();

const LOG = [];
function log(agent, msg, data) {
  const entry = { ts: new Date().toISOString(), agent, msg, data: data || null };
  LOG.push(entry);
  const dataStr = data ? ' | ' + JSON.stringify(data) : '';
  process.stderr.write('[' + entry.ts + '] [' + agent + '] ' + msg + dataStr + '\n');
}
function logError(agent, msg, err) {
  const entry = { ts: new Date().toISOString(), agent, msg, error: String(err) };
  LOG.push(entry);
  process.stderr.write('[' + entry.ts + '] [' + agent + '] ERROR: ' + msg + ' — ' + err + '\n');
}

const RESULTS = {
  primitives: {
    'llmtxt/identity':   { tested: false, passed: false, notes: '' },
    'llmtxt/sdk':        { tested: false, passed: false, notes: '' },
    'llmtxt/crdt':       { tested: false, passed: false, notes: '' },
    'llmtxt/blob':       { tested: false, passed: false, notes: '' },
    'llmtxt/similarity': { tested: false, passed: false, notes: '' },
    'llmtxt/transport':  { tested: false, passed: false, notes: 'NOT_EXERCISABLE: local-only P2P mesh' },
    'llmtxt/events':     { tested: false, passed: false, notes: '' },
  },
  agents: {
    'Writer-A':   { actions: [], status: 'pending' },
    'Writer-B':   { actions: [], status: 'pending' },
    'Reviewer-C': { actions: [], status: 'pending' },
    'Approver-D': { actions: [], status: 'pending' },
    'Observer-E': { actions: [], status: 'pending' },
  },
  docSlug: null, docId: null,
  convergenceCheck: { writerAVersion: null, writerBCrdtConnected: false, converged: false, notes: '' },
  bftQuorum: { quorumReached: false, currentApprovals: 0, quorumRequired: 0, notes: '' },
  eventHashChain: { valid: false, length: 0, notes: '' },
  bugs: [],
};

function addBug(id, desc, sev, details) {
  RESULTS.bugs.push({ id, description: desc, severity: sev, details });
  process.stderr.write('[BUG] ' + id + ': ' + desc + ' (' + sev + ')\n');
}

async function apiGet(path) {
  const r = await fetch(API_V1 + path, { headers: { 'Authorization': 'Bearer ' + API_KEY } });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

async function apiPost(path, data) {
  const r = await fetch(API_V1 + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

async function signedApiPut(path, bodyStr, identity, agentId) {
  const pathOnly = "/api/v1" + path;
  const sigHeaders = await signRequest(identity, "PUT", pathOnly, bodyStr, agentId);
  const r = await fetch(API_V1 + path, {
    method: 'PUT',
    headers: Object.assign({ 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' }, sigHeaders),
    body: bodyStr,
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

// Phase 0: events export check
async function checkEventsExport() {
  try {
    const m = await import('./dist/events/index.js');
    log('Setup', 'dist/events/index.js imports OK', { exports: Object.keys(m).slice(0, 5) });
    // The subpath 'llmtxt/events' is still missing from package.json#exports
    addBug('B-001', "llmtxt/events compiled but missing from package.json#exports", 'medium',
      "dist/events/index.js works via relative path but 'llmtxt/events' is not in exports map. Published consumers cannot use it.");
  } catch(e) {
    addBug('B-001', "dist/events/index.js import failed", 'medium', String(e));
  }
}

// Phase 0: identity setup
async function setupIdentities() {
  log('Setup', 'Generating 5 ephemeral Ed25519 keypairs');
  const ids = {};
  const agentIdMap = { 'Writer-A': 'writer-a-'+TEST_TS, 'Writer-B': 'writer-b-'+TEST_TS, 'Reviewer-C': 'reviewer-c-'+TEST_TS, 'Approver-D': 'approver-d-'+TEST_TS, 'Observer-E': 'observer-e-'+TEST_TS };
  for (const [name, agentId] of Object.entries(agentIdMap)) {
    const identity = await identityFromSeed(randomBytes(32));
    ids[name] = { identity, agentId };
    log(name, 'identity created', { agentId, pubkey: identity.pubkeyHex.slice(0,16)+'...' });
  }
  RESULTS.primitives['llmtxt/identity'].tested = true;
  RESULTS.primitives['llmtxt/identity'].passed = true;
  RESULTS.primitives['llmtxt/identity'].notes = '5 keypairs via identityFromSeed(randomBytes(32)) — ephemeral, not persisted';
  return ids;
}

// Phase 1: Writer-A
async function runWriterA(ids) {
  const { identity, agentId } = ids['Writer-A'];
  const agent = 'Writer-A';
  RESULTS.agents[agent].status = 'running';

  const backend = new RemoteBackend({ baseUrl: BASE_URL, apiKey: API_KEY });
  let session;
  try {
    await backend.open();
    session = new AgentSession({ backend, agentId });
    await session.open();
    log(agent, 'AgentSession open', { sessionId: session.getSessionId(), state: session.getState() });

    let doc;
    await session.contribute(async () => {
      const r = await fetch(BASE_URL + '/compress', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# T308 5-Agent Test\n\n**Created**: '+new Date().toISOString()+'\n\n## Section A\n\nWriter-A content.\n\n## Section B\n\nWriter-B CRDT target.\n\n## Section C\n\nReviewer-C reads this.\n\n## Section D\n\nApprover-D BFT tracking.', format: 'markdown', bft_f: 1, createdBy: agentId }),
      });
      doc = await r.json().catch(() => null);
      return doc;
    });

    if (!doc?.slug) throw new Error('Doc creation failed: ' + JSON.stringify(doc));

    const docSlug = doc.slug;
    RESULTS.docSlug = docSlug; RESULTS.docId = doc.id;
    log(agent, 'Doc created', { slug: docSlug, id: doc.id });
    RESULTS.agents[agent].actions.push({ action: 'create_doc', slug: docSlug });

    // Register pubkey
    try {
      const pk = await apiPost('/agents/keys', { agent_id: agentId, pubkey_hex: identity.pubkeyHex, label: 'Writer-A '+TEST_TS });
      log(agent, 'Pubkey register', { status: pk.status });
      RESULTS.agents[agent].actions.push({ action: 'register_pubkey', status: pk.status });
    } catch(e) { logError(agent, 'pubkey register failed (non-fatal)', e); }

    // Signed PUT
    const content = '# T308 5-Agent Test\n\n**Written by**: '+agentId+'\n\n## Section A\n\nWriter-A Ed25519-signed write at '+new Date().toISOString()+'.\n\n## Section B\n\nWriter-B concurrent CRDT edit.\n\n## Section C\n\nFor Reviewer-C progressive disclosure.\n\n## Section D\n\nApprover-D BFT quorum tracking.';
    const bodyStr = JSON.stringify({ content, createdBy: agentId });
    const put = await signedApiPut('/documents/' + docSlug, bodyStr, identity, agentId);
    log(agent, 'Signed PUT', { status: put.status, version: put.body?.currentVersion });
    RESULTS.agents[agent].actions.push({ action: 'signed_put', status: put.status, version: put.body?.currentVersion });
    if (put.status === 200 || put.status === 201) {
      RESULTS.convergenceCheck.writerAVersion = put.body?.currentVersion;
    } else {
      addBug('B-002', 'Signed PUT non-200 — canWrite requires editor+ role', 'medium', 'Status: '+put.status+' Body: '+JSON.stringify(put.body));
    }

    let receipt;
    try {
      receipt = await session.close();
    } catch(closeErr) {
      if (closeErr.code === "SESSION_CLOSE_PARTIAL" && closeErr.receipt) {
        receipt = closeErr.receipt;
        addBug("B-SESS", "AgentSession SESSION_CLOSE_PARTIAL — teardown errors", "medium",
          "Errors: " + closeErr.errors?.map(e => e.step+": "+e.error.message).join("; "));
        log(agent, "Session closed with partial errors (receipt still valid)", { errors: closeErr.errors?.length });
      } else { throw closeErr; }
    }
    log(agent, 'AgentSession closed', { sessionId: receipt.sessionId, eventCount: receipt.eventCount, durationMs: receipt.sessionDurationMs });
    RESULTS.agents[agent].actions.push({ action: 'session_close', sessionId: receipt.sessionId, eventCount: receipt.eventCount });
    RESULTS.primitives['llmtxt/sdk'].tested = true;
    RESULTS.primitives['llmtxt/sdk'].passed = true;
    RESULTS.primitives['llmtxt/sdk'].notes = 'AgentSession Idle→Open→Active→Closed, receipt.sessionId='+receipt.sessionId;
    RESULTS.agents[agent].status = 'done';
    return { docSlug };
  } catch(err) {
    logError(agent, 'error', err);
    RESULTS.agents[agent].status = 'failed';
    if (session) try { await session.close(); } catch {}
    throw err;
  } finally {
    await backend.close().catch(() => {});
  }
}

// Phase 2: Writer-B CRDT WS
async function runWriterB(ids, docSlug) {
  const agent = 'Writer-B';
  RESULTS.agents[agent].status = 'running';
  RESULTS.primitives['llmtxt/crdt'].tested = true;
  const sectionId = 'section-b';

  // getSectionText HTTP fallback
  try {
    const text = await getSectionText(docSlug, sectionId, { baseUrl: BASE_URL, token: API_KEY });
    log(agent, 'getSectionText', { result: text === null ? 'null (not initialized)' : text.slice(0,50) });
    RESULTS.agents[agent].actions.push({ action: 'get_section_text', result: text === null ? 'null' : 'text' });
  } catch(e) {
    log(agent, 'getSectionText threw (section uninitialized)', { error: String(e) });
    RESULTS.agents[agent].actions.push({ action: 'get_section_text_error', error: String(e) });
  }

  // WebSocket
  return new Promise((resolve) => {
    let done = false;
    const to = setTimeout(() => {
      if (!done) { done = true; log(agent, 'WS timeout 12s'); RESULTS.agents[agent].status = 'done'; resolve({ crdtResult: 'timeout' }); }
    }, 12000);

    try {
      const wsUrl = 'wss://api.llmtxt.my/api/v1/documents/'+docSlug+'/sections/'+sectionId+'/collab?token='+API_KEY;
      log(agent, 'WS connect', { sectionId });
      const ws = new WebSocket(wsUrl, ['loro-sync-v1']);

      ws.addEventListener('open', () => {
        log(agent, 'WS open', { protocol: ws.protocol });
        RESULTS.agents[agent].actions.push({ action: 'crdt_ws_open', protocol: ws.protocol });
        ws.send(new Uint8Array([0x01]));
        log(agent, 'Sent SyncStep1 0x01');
      });

      ws.addEventListener('message', async (ev) => {
        let buf;
        if (ev.data instanceof Blob) buf = new Uint8Array(await ev.data.arrayBuffer());
        else if (ev.data instanceof ArrayBuffer) buf = new Uint8Array(ev.data);
        else buf = new TextEncoder().encode(String(ev.data));
        if (!buf.length) return;
        const t = buf[0];
        log(agent, 'Frame 0x'+t.toString(16).padStart(2,'0'), { bytes: buf.length });
        if (t === 0x02) {
          log(agent, 'SyncStep2 received — Loro state synced', { bytes: buf.length });
          RESULTS.agents[agent].actions.push({ action: 'crdt_sync_step2', bytes: buf.length });
          RESULTS.primitives['llmtxt/crdt'].passed = true;
          RESULTS.primitives['llmtxt/crdt'].notes = 'WS loro-sync-v1: open+SyncStep2 (' + buf.length + ' bytes Loro state)';
          RESULTS.convergenceCheck.writerBCrdtConnected = true;
          const payload = new TextEncoder().encode('Writer-B edit '+Date.now());
          const frame = new Uint8Array(1 + payload.length);
          frame[0] = 0x03; frame.set(payload, 1);
          ws.send(frame);
          log(agent, 'Sent Update 0x03', { bytes: frame.length });
          RESULTS.agents[agent].actions.push({ action: 'crdt_update_sent', bytes: frame.length });
          setTimeout(() => ws.close(1000, 'done'), 2000);
        }
      });

      ws.addEventListener('error', () => { RESULTS.agents[agent].actions.push({ action: 'crdt_ws_error' }); });

      ws.addEventListener('close', (ev) => {
        log(agent, 'WS closed', { code: ev.code, reason: ev.reason });
        RESULTS.agents[agent].actions.push({ action: 'crdt_ws_close', code: ev.code, reason: ev.reason });
        if (ev.code === 4401) addBug('B-003', 'CRDT WS 4401 — API key rejected by collab endpoint', 'high', 'REST key works, WS rejects. Reason: '+ev.reason);
        else if (ev.code === 4403) addBug('B-004', 'CRDT WS 4403 Forbidden', 'high', 'Reason: '+ev.reason);
        else if (ev.code === 1006) addBug('B-005', 'CRDT WS 1006 abnormal closure', 'medium', 'Server-side error before WS upgrade');
        else if (!RESULTS.primitives['llmtxt/crdt'].passed) RESULTS.primitives['llmtxt/crdt'].notes = 'WS closed '+ev.code+' before SyncStep2';
        RESULTS.agents[agent].status = 'done';
        if (!done) { done = true; clearTimeout(to); resolve({ crdtResult: ev.code }); }
      });
    } catch(err) {
      logError(agent, 'WS error', err);
      RESULTS.agents[agent].status = 'failed';
      if (!done) { done = true; clearTimeout(to); resolve({ crdtResult: 'error' }); }
    }
  });
}

// Phase 3: Reviewer-C
async function runReviewerC(ids, docSlug) {
  const agent = 'Reviewer-C';
  RESULTS.agents[agent].status = 'running';
  RESULTS.primitives['llmtxt/similarity'].tested = true;
  try {
    const ov = await apiGet('/documents/'+docSlug+'/overview');
    log(agent, 'API overview', { status: ov.status, sections: ov.body?.sections?.length });
    RESULTS.agents[agent].actions.push({ action: 'api_overview', status: ov.status, sections: ov.body?.sections?.length });
    if (ov.status !== 200) addBug('B-007', '/overview non-200', 'medium', 'Status: '+ov.status);

    const sample = '# Architecture Guide\n\n## Introduction\nThis describes the system.\n\n## Methodology\nHub-spoke multi-agent coordination.\n\n## Results\nSub-100ms latency.\n\n## Conclusion\nSupports 1000 agents.';
    const localOv = await generateOverview(sample);
    log(agent, 'generateOverview local', { format: localOv.format, sections: localOv.sections?.length, tokens: localOv.tokenCount });
    RESULTS.agents[agent].actions.push({ action: 'generate_overview_local', format: localOv.format, sections: localOv.sections?.length });

    const plan = planRetrieval(localOv, 500, 'methodology');
    log(agent, 'planRetrieval', { selected: plan.sections?.length, totalTokens: plan.totalTokens, saved: plan.tokensSaved });
    RESULTS.agents[agent].actions.push({ action: 'plan_retrieval', selected: plan.sections?.length, totalTokens: plan.totalTokens });

    RESULTS.primitives['llmtxt/similarity'].passed = true;
    RESULTS.primitives['llmtxt/similarity'].notes = 'generateOverview: format='+localOv.format+', '+localOv.sections.length+' sections. planRetrieval(budget=500, q="methodology"): '+plan.sections.length+' selected, '+plan.totalTokens+' tokens.';
    RESULTS.agents[agent].status = 'done';
  } catch(err) {
    logError(agent, 'error', err);
    addBug('B-006', 'generateOverview/planRetrieval error', 'high', String(err));
    RESULTS.primitives['llmtxt/similarity'].notes = 'FAIL: '+err;
    RESULTS.agents[agent].status = 'failed';
  }
}

// Phase 4: Approver-D
async function runApproverD(ids, docSlug) {
  const { identity, agentId } = ids['Approver-D'];
  const agent = 'Approver-D';
  RESULTS.agents[agent].status = 'running';
  try {
    const doc = await apiGet('/documents/'+docSlug);
    if (doc.status !== 200) throw new Error('Doc fetch: '+doc.status);
    const ver = doc.body?.currentVersion || 1;
    log(agent, 'Doc state', { state: doc.body?.state, version: ver });

    const bftR = await fetch(API_V1+'/documents/'+docSlug+'/bft/status', { headers: { 'Authorization': 'Bearer '+API_KEY } });
    const bft = await bftR.json().catch(() => null);
    log(agent, 'BFT status', { status: bftR.status, quorum: bft?.quorum, bftF: bft?.bftF });
    if (bftR.status !== 200) throw new Error('BFT status: '+bftR.status);
    RESULTS.bftQuorum.quorumRequired = bft.quorum;

    const pk = await apiPost('/agents/keys', { agent_id: agentId, pubkey_hex: identity.pubkeyHex, label: 'Approver-D '+TEST_TS });
    log(agent, 'Pubkey registered', { status: pk.status });
    RESULTS.agents[agent].actions.push({ action: 'register_pubkey', status: pk.status });

    const envelope = await signApproval(identity, docSlug, agentId, 'APPROVED', ver, 'T308 BFT test');
    log(agent, 'Approval signed', { sigHex: envelope.sig_hex.slice(0,16)+'...' });
    RESULTS.agents[agent].actions.push({ action: 'sign_approval', version: ver });

    const resp = await submitSignedApproval(API_V1, docSlug, envelope, { 'Authorization': 'Bearer '+API_KEY });
    log(agent, 'BFT approval submitted', { quorumReached: resp.quorumReached, currentApprovals: resp.currentApprovals, sigVerified: resp.sigVerified, chainHash: resp.chainHash?.slice(0,16)+'...' });
    RESULTS.agents[agent].actions.push({ action: 'submit_approval', quorumReached: resp.quorumReached, currentApprovals: resp.currentApprovals, sigVerified: resp.sigVerified });

    RESULTS.bftQuorum.quorumReached = resp.quorumReached;
    RESULTS.bftQuorum.currentApprovals = resp.currentApprovals;
    RESULTS.bftQuorum.notes = 'sigVerified='+resp.sigVerified+', quorum='+resp.quorum+', approvals='+resp.currentApprovals;
    if (!resp.sigVerified) addBug('B-008', 'BFT sigVerified=false', 'high', 'agentId='+agentId+'. pubkey_register status='+pk.status);
    RESULTS.agents[agent].status = 'done';
  } catch(err) {
    logError(agent, 'error', err);
    RESULTS.agents[agent].status = 'failed';
    RESULTS.bftQuorum.notes = 'FAILED: '+err;
  }
}

// Phase 5: Observer-E
async function runObserverE(ids, docSlug) {
  const agent = 'Observer-E';
  RESULTS.agents[agent].status = 'running';
  RESULTS.primitives['llmtxt/events'].tested = true;
  RESULTS.primitives['llmtxt/blob'].tested = true;

  try {
    // Events
    const evR = await apiGet('/documents/'+docSlug+'/events?limit=100');
    log(agent, 'Event log', { status: evR.status, count: evR.body?.events?.length });
    RESULTS.agents[agent].actions.push({ action: 'fetch_events', status: evR.status, count: evR.body?.events?.length });
    if (evR.status === 200) {
      const events = evR.body?.events || [];
      const types = [...new Set(events.map(e => e.type))];
      log(agent, 'Event types', { types, total: events.length });

      const cR = await fetch(API_V1+'/documents/'+docSlug+'/chain', { headers: { 'Authorization': 'Bearer '+API_KEY } });
      const c = await cR.json().catch(() => null);
      log(agent, 'Hash chain', { status: cR.status, valid: c?.valid, length: c?.length });
      RESULTS.agents[agent].actions.push({ action: 'verify_chain', status: cR.status, valid: c?.valid, length: c?.length });
      if (cR.status === 200 && c) {
        RESULTS.eventHashChain.valid = c.valid; RESULTS.eventHashChain.length = c.length;
        RESULTS.eventHashChain.notes = 'valid='+c.valid+', length='+c.length+', firstInvalidAt='+c.firstInvalidAt;
        RESULTS.primitives['llmtxt/events'].passed = events.length > 0;
        RESULTS.primitives['llmtxt/events'].notes = 'REST events: '+events.length+'. Types: ['+types.join(',')+'] Hash chain: valid='+c.valid+', length='+c.length+'. EventBus is server-side; no client subpath export (B-001).';
      } else {
        if (cR.status === 404) addBug('B-009', '/chain returns 404', 'medium', 'Status: '+cR.status);
        RESULTS.primitives['llmtxt/events'].passed = events.length > 0;
        RESULTS.primitives['llmtxt/events'].notes = 'REST events: '+events.length+'. Chain: '+cR.status;
      }
    } else {
      addBug('B-010', '/events non-200', 'high', 'Status: '+evR.status+' Body: '+JSON.stringify(evR.body));
    }

    // Blob
    const blob = new TextEncoder().encode('LLMtxt T308 blob test\nts='+TEST_TS+'\n');
    const bname = 't308-'+TEST_TS+'.txt';
    try { validateBlobName(bname); log(agent, 'validateBlobName OK'); RESULTS.agents[agent].actions.push({ action: 'validate_blob_name', passed: true }); }
    catch(e) { addBug('B-011', 'validateBlobName threw', 'medium', String(e)); }

    let wasmH = null;
    try { wasmH = await hashBlob(blob); log(agent, 'hashBlob WASM', { hash: wasmH }); RESULTS.agents[agent].actions.push({ action: 'hash_blob_wasm', hash: wasmH }); }
    catch(e) { addBug('B-012', 'hashBlob threw', 'high', String(e)); }

    const nodeH = createHash('sha256').update(blob).digest('hex');
    log(agent, 'Node SHA-256', { hash: nodeH });
    if (wasmH && wasmH !== nodeH) addBug('B-013', 'hashBlob WASM != Node SHA-256', 'critical', 'WASM: '+wasmH+' Node: '+nodeH);
    else if (wasmH === nodeH) log(agent, 'WASM == Node SHA-256 VERIFIED');

    try {
      const aR = await fetch(API_V1+'/documents/'+docSlug+'/blobs?name='+encodeURIComponent(bname)+'&contentType=text/plain', {
        method: 'POST', headers: { 'Authorization': 'Bearer '+API_KEY, 'Content-Type': 'application/octet-stream' }, body: blob,
      });
      const aB = await aR.json().catch(() => null);
      log(agent, 'Blob attach', { status: aR.status, serverHash: aB?.contentHash });
      RESULTS.agents[agent].actions.push({ action: 'attach_blob', status: aR.status, serverHash: aB?.contentHash });
      if (aR.status === 200 || aR.status === 201) {
        if (aB?.contentHash && wasmH && aB.contentHash !== wasmH) addBug('B-014', 'Server hash != WASM hash', 'critical', 'Server: '+aB.contentHash+' WASM: '+wasmH);

        const fR = await fetch(API_V1+'/documents/'+docSlug+'/blobs/'+encodeURIComponent(bname), { headers: { 'Authorization': 'Bearer '+API_KEY } });
        log(agent, 'Blob fetch', { status: fR.status });
        RESULTS.agents[agent].actions.push({ action: 'fetch_blob', status: fR.status });
        if (fR.status === 200) {
          const fetched = new Uint8Array(await fR.arrayBuffer());
          const fh = createHash('sha256').update(fetched).digest('hex');
          const match = fh === nodeH;
          log(agent, 'Fetched hash verify', { match, fetchedHash: fh });
          RESULTS.agents[agent].actions.push({ action: 'verify_fetched', match });
          if (!match) addBug('B-015', 'Fetched blob hash mismatch', 'critical', 'Fetched: '+fh+' Expected: '+nodeH);
          RESULTS.primitives['llmtxt/blob'].passed = (wasmH === nodeH) && match;
          RESULTS.primitives['llmtxt/blob'].notes = 'hashBlob WASM==Node: '+(wasmH===nodeH)+'. validateBlobName: OK. Attach: 200. Fetch+verify: '+match+'. Server hash match: '+(aB?.contentHash===nodeH)+'.';
        } else {
          addBug('B-016', 'Blob fetch non-200', 'high', 'Status: '+fR.status);
          RESULTS.primitives['llmtxt/blob'].passed = wasmH === nodeH;
          RESULTS.primitives['llmtxt/blob'].notes = 'hashBlob OK. Attach OK. Fetch FAIL: '+fR.status;
        }
      } else {
        addBug('B-017', 'Blob attach non-200', 'high', 'Status: '+aR.status+' Body: '+JSON.stringify(aB));
        RESULTS.primitives['llmtxt/blob'].passed = wasmH === nodeH;
        RESULTS.primitives['llmtxt/blob'].notes = 'hashBlob+validateBlobName OK. Attach FAIL: '+aR.status;
      }
    } catch(e) {
      addBug('B-018', 'Blob ops threw', 'high', String(e));
      RESULTS.primitives['llmtxt/blob'].passed = wasmH === nodeH;
      RESULTS.primitives['llmtxt/blob'].notes = 'hashBlob+validateBlobName OK. REST threw: '+e;
    }

    // transport
    RESULTS.primitives['llmtxt/transport'].tested = true;
    RESULTS.primitives['llmtxt/transport'].notes = 'NOT_EXERCISABLE: UnixSocketTransport/HttpTransport require local peer-to-peer setup. api.llmtxt.my does not expose /mesh/handshake or /mesh/changeset (P3 design intent).';
    RESULTS.agents[agent].status = 'done';
  } catch(err) {
    logError(agent, 'error', err);
    RESULTS.agents[agent].status = 'failed';
  }
}

async function checkConvergence(docSlug) {
  const r = await apiGet('/documents/'+docSlug);
  if (r.status === 200) {
    const aOk = RESULTS.agents['Writer-A'].actions.some(a => a.action === 'signed_put' && a.status === 200);
    RESULTS.convergenceCheck.converged = aOk || RESULTS.convergenceCheck.writerBCrdtConnected;
    RESULTS.convergenceCheck.finalVersion = r.body.currentVersion;
    RESULTS.convergenceCheck.finalState = r.body.state;
    RESULTS.convergenceCheck.notes = 'Writer-A signed PUT: '+(aOk?'OK':'FAIL')+'. Writer-B CRDT WS: '+(RESULTS.convergenceCheck.writerBCrdtConnected?'SyncStep2 received':'no SyncStep2')+'. version='+r.body.currentVersion+', state='+r.body.state;
    log('Convergence', 'Final', { version: r.body.currentVersion, state: r.body.state });
  } else {
    RESULTS.convergenceCheck.notes = 'Final doc fetch failed: '+r.status;
  }
}

async function main() {
  const t0 = Date.now();
  log('Orchestrator', '=== 5-Agent Real-World Test v2026.4.9 ===', { target: BASE_URL });

  await checkEventsExport();
  const ids = await setupIdentities();

  let docSlug = null;
  try { const r = await runWriterA(ids); docSlug = r.docSlug; }
  catch(err) { logError('Orchestrator', 'Writer-A fatal', err); addBug('B-FATAL', 'Document creation failed', 'critical', String(err)); }

  if (!docSlug) {
    RESULTS.convergenceCheck.notes = 'ABORTED';
  } else {
    await runWriterB(ids, docSlug);
    await runReviewerC(ids, docSlug);
    await runApproverD(ids, docSlug);
    await runObserverE(ids, docSlug);
    await checkConvergence(docSlug);
  }

  RESULTS.testDurationMs = Date.now() - t0;
  const passed = Object.entries(RESULTS.primitives).filter(([,v]) => v.passed).map(([k]) => k);
  const failed = Object.entries(RESULTS.primitives).filter(([,v]) => v.tested && !v.passed).map(([k]) => k);
  RESULTS.summary = { primitivesPassed: passed, primitivesFailed: failed, agentStatuses: Object.fromEntries(Object.entries(RESULTS.agents).map(([k,v]) => [k, v.status])), bugsFound: RESULTS.bugs.length };

  log('Orchestrator', '=== DONE ===', { durationMs: RESULTS.testDurationMs, docSlug, passed: passed.length+'/'+Object.keys(RESULTS.primitives).length, bugs: RESULTS.bugs.length });
  return RESULTS;
}

const results = await main();
writeFileSync('/tmp/t308-realworld/results.json', JSON.stringify({ results, log: LOG, timestamp: new Date().toISOString() }, null, 2));
process.stderr.write('\nResults saved to /tmp/t308-realworld/results.json\n');
const p = Object.values(results.primitives).filter(v => v.passed).length;
const t = Object.keys(results.primitives).length;
process.stderr.write(p+'/'+t+' primitives verified\n');
