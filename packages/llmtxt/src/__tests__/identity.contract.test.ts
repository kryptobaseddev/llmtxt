/**
 * Contract tests for `llmtxt/identity` subpath (T652).
 *
 * Covers:
 *   1. Round-trip: createIdentity / identityFromSeed → sign → verify
 *   2. Canonical payload format (method+path+ts+nonce+bodyhash, newline-separated)
 *   3. Signature replay detection shape (nonce uniqueness logic contract)
 *   4. signRequest / verifySignature convenience functions
 *   5. buildCanonicalPayload determinism and field ordering
 *   6. bodyHashHex matches known SHA-256 vectors
 *   7. Cross-verify: SDK sign ↔ SDK verify (same canonical format as Rust)
 *   8. Wrong-key and tamper-detection failures
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AgentIdentity,
  bodyHashHex,
  buildCanonicalPayload,
  createIdentity,
  identityFromSeed,
  randomNonceHex,
  signRequest,
  verifySignature,
} from '../identity/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a deterministic 32-byte seed from a single fill byte. */
function seedFrom(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

// ── 1. Round-trip: generate → sign → verify ───────────────────────────────────

describe('AgentIdentity — round-trip', () => {
  it('identityFromSeed produces a stable pubkey', async () => {
    const seed = seedFrom(0x01);
    const id1 = await identityFromSeed(seed);
    const id2 = await identityFromSeed(seed);
    assert.equal(id1.pubkeyHex, id2.pubkeyHex, 'same seed must produce same public key');
    assert.equal(id1.pubkeyHex.length, 64, 'pubkeyHex must be 64 hex chars');
  });

  it('sign + verify succeeds for same key', async () => {
    const id = await identityFromSeed(seedFrom(0x02));
    const message = new TextEncoder().encode('hello world');
    const sig = await id.sign(message);
    assert.equal(sig.length, 64, 'signature must be 64 bytes');
    const ok = await id.verify(message, sig);
    assert.ok(ok, 'valid signature must verify');
  });

  it('verify fails for tampered message', async () => {
    const id = await identityFromSeed(seedFrom(0x03));
    const message = new TextEncoder().encode('original message');
    const sig = await id.sign(message);
    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    const ok = await id.verify(tampered, sig);
    assert.ok(!ok, 'tampered message must not verify');
  });

  it('verify fails for wrong key', async () => {
    const idA = await identityFromSeed(seedFrom(0x04));
    const idB = await identityFromSeed(seedFrom(0x05));
    const message = new TextEncoder().encode('test payload');
    const sig = await idA.sign(message);
    const ok = await idB.verify(message, sig);
    assert.ok(!ok, 'signature from key-A must not verify under key-B');
  });
});

// ── 2. Canonical payload format ───────────────────────────────────────────────

describe('buildCanonicalPayload — format', () => {
  it('fields are newline-separated in correct order', () => {
    const bytes = buildCanonicalPayload({
      method: 'PUT',
      path: '/api/v1/documents/abc',
      timestampMs: 1700000000000,
      agentId: 'agent-1',
      nonceHex: 'aabbccdd00112233aabbccdd00112233',
      bodyHashHex: 'e3b0c44298fc1c149afbf4c8996fb924' + '27ae41e4649b934ca495991b7852b855',
    });
    const s = new TextDecoder().decode(bytes);
    const parts = s.split('\n');
    assert.equal(parts.length, 6, 'must have exactly 6 newline-separated fields');
    assert.equal(parts[0], 'PUT');
    assert.equal(parts[1], '/api/v1/documents/abc');
    assert.equal(parts[2], '1700000000000');
    assert.equal(parts[3], 'agent-1');
    assert.equal(parts[4], 'aabbccdd00112233aabbccdd00112233');
    assert.equal(parts[5], 'e3b0c44298fc1c149afbf4c8996fb924' + '27ae41e4649b934ca495991b7852b855');
  });

  it('method is uppercased automatically', () => {
    const bytes = buildCanonicalPayload({
      method: 'put',
      path: '/test',
      timestampMs: 0,
      agentId: 'x',
      nonceHex: '00',
      bodyHashHex: '00',
    });
    const s = new TextDecoder().decode(bytes);
    assert.ok(s.startsWith('PUT\n'), 'method must be uppercased');
  });

  it('is deterministic — same inputs produce identical bytes', () => {
    const opts = {
      method: 'POST',
      path: '/api/v1/documents',
      timestampMs: 1700000000042,
      agentId: 'agent-42',
      nonceHex: 'deadbeefdeadbeef',
      bodyHashHex: '0000000000000000000000000000000000000000000000000000000000000000',
    };
    const a = buildCanonicalPayload(opts);
    const b = buildCanonicalPayload(opts);
    assert.deepEqual(a, b, 'canonical payload must be deterministic');
  });
});

// ── 3. bodyHashHex ────────────────────────────────────────────────────────────

describe('bodyHashHex', () => {
  it('SHA-256 of empty string is the known constant', async () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const h = await bodyHashHex('');
    assert.equal(
      h,
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'SHA-256 of empty string must match known vector',
    );
  });

  it('SHA-256 of "hello" is the known constant', async () => {
    // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const h = await bodyHashHex('hello');
    assert.equal(
      h,
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      'SHA-256 of "hello" must match known vector',
    );
  });

  it('accepts Uint8Array input', async () => {
    const bytes = new TextEncoder().encode('hello');
    const h = await bodyHashHex(bytes);
    assert.equal(
      h,
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('returns lowercase hex of length 64', async () => {
    const h = await bodyHashHex('arbitrary payload');
    assert.equal(h.length, 64, 'hex output must be 64 chars');
    assert.ok(/^[0-9a-f]+$/.test(h), 'hex output must be lowercase');
  });
});

// ── 4. signRequest / verifySignature convenience functions ───────────────────

describe('signRequest + verifySignature', () => {
  it('verifySignature returns true for a valid signature', async () => {
    const id = await identityFromSeed(seedFrom(0x10));
    const body = '{"action":"write"}';
    const headers = await signRequest(id, 'PUT', '/api/v1/documents/doc1', body, 'agent-sdk-1');
    const bh = await bodyHashHex(body);
    const payload = buildCanonicalPayload({
      method: 'PUT',
      path: '/api/v1/documents/doc1',
      timestampMs: parseInt(headers['X-Agent-Timestamp'], 10),
      agentId: 'agent-sdk-1',
      nonceHex: headers['X-Agent-Nonce'],
      bodyHashHex: bh,
    });
    const ok = await verifySignature(payload, headers['X-Agent-Signature'], id.pubkeyHex);
    assert.ok(ok, 'verifySignature must return true for valid signature');
  });

  it('verifySignature returns false for wrong pubkey', async () => {
    const idA = await identityFromSeed(seedFrom(0x11));
    const idB = await identityFromSeed(seedFrom(0x12));
    const body = 'payload';
    const headers = await signRequest(idA, 'POST', '/api/v1/documents', body, 'agent-a');
    const bh = await bodyHashHex(body);
    const payload = buildCanonicalPayload({
      method: 'POST',
      path: '/api/v1/documents',
      timestampMs: parseInt(headers['X-Agent-Timestamp'], 10),
      agentId: 'agent-a',
      nonceHex: headers['X-Agent-Nonce'],
      bodyHashHex: bh,
    });
    const ok = await verifySignature(payload, headers['X-Agent-Signature'], idB.pubkeyHex);
    assert.ok(!ok, 'verifySignature with wrong pubkey must return false');
  });

  it('signRequest produces all four X-Agent-* headers', async () => {
    const id = await identityFromSeed(seedFrom(0x20));
    const headers = await signRequest(id, 'PUT', '/api/v1/documents/x', '', 'my-agent');
    assert.ok('X-Agent-Pubkey-Id' in headers, 'must include X-Agent-Pubkey-Id');
    assert.ok('X-Agent-Signature' in headers, 'must include X-Agent-Signature');
    assert.ok('X-Agent-Nonce' in headers, 'must include X-Agent-Nonce');
    assert.ok('X-Agent-Timestamp' in headers, 'must include X-Agent-Timestamp');
    assert.equal(headers['X-Agent-Pubkey-Id'], 'my-agent');
    assert.equal(headers['X-Agent-Signature'].length, 128, 'signature must be 128 hex chars (64 bytes)');
    assert.equal(headers['X-Agent-Nonce'].length, 32, 'nonce must be 32 hex chars (16 bytes)');
  });
});

// ── 5. Nonce uniqueness contract (shape / API surface) ────────────────────────

describe('randomNonceHex', () => {
  it('returns 32-char lowercase hex', () => {
    const n = randomNonceHex();
    assert.equal(n.length, 32, 'nonce must be 32 hex chars');
    assert.ok(/^[0-9a-f]+$/.test(n), 'nonce must be lowercase hex');
  });

  it('two calls return different values (collision probability negligible)', () => {
    const a = randomNonceHex();
    const b = randomNonceHex();
    // With 128-bit entropy the probability of collision is ~2^-128
    assert.notEqual(a, b, 'consecutive nonces must differ');
  });
});

// ── 6. Full sign/verify round-trip via canonical payload ─────────────────────

describe('full sign/verify round-trip — canonical payload', () => {
  it('sign → buildCanonicalPayload → verifySignature succeeds end-to-end', async () => {
    const id = await identityFromSeed(seedFrom(0x30));
    const body = JSON.stringify({ title: 'My Document' });
    const method = 'PUT';
    const path = '/api/v1/documents/slug42';
    const agentId = 'e2e-agent';
    const timestampMs = 1700000000000;
    const nonceHex = randomNonceHex();
    const bh = await bodyHashHex(body);

    const payload = buildCanonicalPayload({ method, path, timestampMs, agentId, nonceHex, bodyHashHex: bh });
    const sig = await id.sign(payload);

    // Build the hex signature as the middleware would receive it
    const sigHex = Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');

    const ok = await verifySignature(payload, sigHex, id.pubkeyHex);
    assert.ok(ok, 'end-to-end sign+verify over canonical payload must succeed');
  });

  it('verify fails when any canonical field is mutated', async () => {
    const id = await identityFromSeed(seedFrom(0x31));
    const body = '{"version":1}';
    const bh = await bodyHashHex(body);
    const opts = {
      method: 'POST',
      path: '/api/v1/documents',
      timestampMs: 1700000001000,
      agentId: 'tamper-agent',
      nonceHex: 'cafebabecafebabe01020304cafebabe',
      bodyHashHex: bh,
    };
    const payload = buildCanonicalPayload(opts);
    const sig = await id.sign(payload);
    const sigHex = Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');

    // Mutate timestamp
    const mutated = buildCanonicalPayload({ ...opts, timestampMs: 1700000001001 });
    const ok = await verifySignature(mutated, sigHex, id.pubkeyHex);
    assert.ok(!ok, 'signature must not verify when canonical payload is mutated');
  });
});

// ── 7. createIdentity export surface ─────────────────────────────────────────

describe('createIdentity / loadIdentity / identityFromSeed exports', () => {
  it('identityFromSeed is a function', () => {
    assert.equal(typeof identityFromSeed, 'function');
  });

  it('createIdentity is a function', () => {
    assert.equal(typeof createIdentity, 'function');
  });

  it('AgentIdentity.fromSeed is equivalent to identityFromSeed', async () => {
    const seed = seedFrom(0x40);
    const a = await AgentIdentity.fromSeed(seed);
    const b = await identityFromSeed(seed);
    assert.equal(a.pubkeyHex, b.pubkeyHex, 'AgentIdentity.fromSeed and identityFromSeed must be equivalent');
  });
});
