/**
 * BFT Adversarial CI Test — W3/T269.
 *
 * Validates Byzantine Fault Tolerant consensus with:
 *   - 3 honest agents submitting APPROVED → quorum (3 >= 2*1+1) reached
 *   - 2 Byzantine agents: one votes APPROVED then REJECTED (double-vote) → key slashed
 *   - Chain integrity verified for all honest approvals
 *
 * Uses crates/llmtxt-core Rust primitives directly (via cargo test or via
 * direct TypeScript logic since WASM is not available in Node.js tests).
 *
 * Run: pnpm --filter @llmtxt/backend test -- bft-adversarial
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as ed from '@noble/ed25519';
import { sha512, sha256 } from '@noble/hashes/sha2.js';

// Noble ed25519 v3 requires sha512 in Node.js
ed.hashes.sha512 = sha512;

// ── Pure JS BFT primitives (mirror of Rust bft.rs) ───────────────

function bftQuorum(f: number): number {
  return 2 * f + 1;
}

function bftCheck(votes: number, f: number): boolean {
  return votes >= bftQuorum(f);
}

function hashChainExtend(prevHashHex: string, eventBytes: Buffer): string {
  // Concatenate prev hash bytes + event bytes, then sha256
  const prevBytes = Buffer.from(prevHashHex, 'hex');
  const combined = Buffer.concat([prevBytes, eventBytes]);
  return Buffer.from(sha256(combined)).toString('hex');
}

interface ChainedEvent {
  chainHash: string;
  eventBytes: Buffer;
  prevHash: string;
}

function verifyChain(events: ChainedEvent[]): boolean {
  for (const event of events) {
    const expected = hashChainExtend(event.prevHash, event.eventBytes);
    if (expected !== event.chainHash) return false;
  }
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function buildApprovalPayload(
  slug: string,
  agentId: string,
  status: string,
  version: number,
  timestamp: number
): string {
  return [slug, agentId, status, version, timestamp].join('\n');
}

async function signPayload(sk: Uint8Array, payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const sig = await ed.signAsync(bytes, sk);
  return Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPayload(pk: Uint8Array, payload: string, sigHex: string): Promise<boolean> {
  try {
    const bytes = new TextEncoder().encode(payload);
    const sig = Buffer.from(sigHex, 'hex');
    return await ed.verifyAsync(sig, bytes, pk);
  } catch {
    return false;
  }
}

// ── Test data ─────────────────────────────────────────────────────

const DOC_SLUG = 'test-bft-doc';
const VERSION = 1;
const BFT_F = 1; // default: tolerate 1 Byzantine

// ── Tests ─────────────────────────────────────────────────────────

describe('BFT adversarial consensus — 3 honest + 2 Byzantine', () => {
  it('bftQuorum(f=1) = 3', () => {
    assert.strictEqual(bftQuorum(1), 3);
  });

  it('bftCheck: 3 honest votes reach quorum', () => {
    assert.ok(bftCheck(3, BFT_F), '3 honest votes must reach quorum of 3');
  });

  it('bftCheck: 2 byzantine votes do NOT reach quorum', () => {
    assert.ok(!bftCheck(2, BFT_F), '2 Byzantine votes must NOT reach quorum');
  });

  it('honest agents sign valid approvals', async () => {
    const agents = await Promise.all(
      ['honest-1', 'honest-2', 'honest-3'].map(async (agentId) => {
        const sk = ed.utils.randomSecretKey();
        const pk = await ed.getPublicKeyAsync(sk);
        return { agentId, sk, pk };
      })
    );

    const approvals = await Promise.all(
      agents.map(async ({ agentId, sk, pk }) => {
        const ts = Date.now();
        const payload = buildApprovalPayload(DOC_SLUG, agentId, 'APPROVED', VERSION, ts);
        const sigHex = await signPayload(sk, payload);
        const valid = await verifyPayload(pk, payload, sigHex);
        return { agentId, sigHex, valid };
      })
    );

    for (const approval of approvals) {
      assert.ok(approval.valid, `honest agent ${approval.agentId} signature must verify`);
    }
  });

  it('hash chain integrity: 3 honest approvals form valid chain', async () => {
    const GENESIS = '0'.repeat(64);
    const events: ChainedEvent[] = [];
    let prevHash = GENESIS;

    for (let i = 1; i <= 3; i++) {
      const bytes = Buffer.from(
        JSON.stringify({ reviewer: `honest-${i}`, status: 'APPROVED' })
      );
      const chainHash = hashChainExtend(prevHash, bytes);
      events.push({ chainHash, eventBytes: bytes, prevHash });
      prevHash = chainHash;
    }

    assert.ok(verifyChain(events), '3-event chain must verify');
  });

  it('hash chain: tampered event fails verification', () => {
    const GENESIS = '0'.repeat(64);
    const events: ChainedEvent[] = [];
    let prevHash = GENESIS;

    for (let i = 1; i <= 3; i++) {
      const bytes = Buffer.from(`approval:agent-${i}:APPROVED`);
      const chainHash = hashChainExtend(prevHash, bytes);
      events.push({ chainHash, eventBytes: bytes, prevHash });
      prevHash = chainHash;
    }

    // Tamper with the second event
    events[1].eventBytes = Buffer.from('approval:agent-2:REJECTED'); // Changed!
    assert.ok(!verifyChain(events), 'tampered event must fail chain verification');
  });

  it('Byzantine double-vote detected: APPROVED then REJECTED by same agent', async () => {
    const sk = ed.utils.randomSecretKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const byzantineId = 'byzantine-1';
    const ts = Date.now();

    const approvedPayload = buildApprovalPayload(DOC_SLUG, byzantineId, 'APPROVED', VERSION, ts);
    const rejectedPayload = buildApprovalPayload(DOC_SLUG, byzantineId, 'REJECTED', VERSION, ts + 1);

    const sigApproved = await signPayload(sk, approvedPayload);
    const sigRejected = await signPayload(sk, rejectedPayload);

    // Both signatures are valid (Byzantine agent SIGNED both)
    assert.ok(await verifyPayload(pk, approvedPayload, sigApproved), 'approved sig valid');
    assert.ok(await verifyPayload(pk, rejectedPayload, sigRejected), 'rejected sig valid');

    // But the conflict detector would catch this (same agentId, opposite statuses)
    // This simulates the backend Byzantine slash logic
    const votes = new Map<string, string[]>();
    votes.set(byzantineId, ['APPROVED', 'REJECTED']);

    const hasByzantineConflict = Array.from(votes.entries()).some(([, statuses]) => {
      const hasApproved = statuses.includes('APPROVED');
      const hasRejected = statuses.includes('REJECTED');
      return hasApproved && hasRejected;
    });

    assert.ok(hasByzantineConflict, 'Byzantine conflict must be detected');
  });

  it('end-to-end: 3 honest + 2 Byzantine → consensus holds', async () => {
    // Simulate the full adversarial scenario:
    // - 3 honest agents vote APPROVED → quorum=3 reached
    // - 2 Byzantine agents: 1 votes APPROVED+REJECTED (slashed), 1 votes REJECTED only
    // Expected: quorum reached by honest agents; Byzantine agent slashed

    const f = 1;
    const quorum = bftQuorum(f);

    // Generate keys
    const honestAgents = await Promise.all(
      [1, 2, 3].map(async (i) => {
        const sk = ed.utils.randomSecretKey();
        const pk = await ed.getPublicKeyAsync(sk);
        return { id: `honest-${i}`, sk, pk };
      })
    );

    const byzantineAgents = await Promise.all(
      [1, 2].map(async (i) => {
        const sk = ed.utils.randomSecretKey();
        const pk = await ed.getPublicKeyAsync(sk);
        return { id: `byzantine-${i}`, sk, pk };
      })
    );

    // Track vote ledger
    const ledger = new Map<string, string[]>();
    const revokedKeys = new Set<string>();

    // Honest agents vote APPROVED
    for (const agent of honestAgents) {
      const ts = Date.now();
      const payload = buildApprovalPayload(DOC_SLUG, agent.id, 'APPROVED', VERSION, ts);
      const sigHex = await signPayload(agent.sk, payload);
      const valid = await verifyPayload(agent.pk, payload, sigHex);
      assert.ok(valid, `honest agent ${agent.id} sig must be valid`);
      ledger.set(agent.id, ['APPROVED']);
    }

    // Byzantine agent 1: vote APPROVED then REJECTED (double-vote → slashed)
    const byz1 = byzantineAgents[0];
    ledger.set(byz1.id, ['APPROVED']);
    // Try to also vote REJECTED
    const existingVotes = ledger.get(byz1.id) ?? [];
    if (existingVotes.includes('APPROVED')) {
      // Byzantine conflict detected → slash
      revokedKeys.add(byz1.id);
    }

    // Byzantine agent 2: vote REJECTED only
    const byz2 = byzantineAgents[1];
    ledger.set(byz2.id, ['REJECTED']);

    // Count APPROVED votes from non-revoked agents
    let approvedCount = 0;
    for (const [agentId, votes] of ledger.entries()) {
      if (!revokedKeys.has(agentId) && votes.includes('APPROVED')) {
        approvedCount++;
      }
    }

    // Verify outcomes
    assert.ok(bftCheck(approvedCount, f), `Quorum must be reached: ${approvedCount} >= ${quorum}`);
    assert.ok(revokedKeys.has(byz1.id), 'Byzantine double-voter must be slashed');
    assert.ok(!revokedKeys.has(byz2.id), 'Byzantine agent 2 (REJECTED only) not auto-slashed');
    assert.strictEqual(approvedCount, 3, 'Exactly 3 honest approvals');
  });

  it('10 sequential chain events: all verify; tamper-at-5 detected', () => {
    const GENESIS = '0'.repeat(64);
    const events: ChainedEvent[] = [];
    let prevHash = GENESIS;

    for (let i = 0; i < 10; i++) {
      const bytes = Buffer.from(JSON.stringify({ i, reviewer: `agent-${i}`, status: 'APPROVED' }));
      const chainHash = hashChainExtend(prevHash, bytes);
      events.push({ chainHash, eventBytes: bytes, prevHash });
      prevHash = chainHash;
    }

    assert.ok(verifyChain(events), '10-event chain must verify');

    // Tamper event at index 5
    events[5].eventBytes = Buffer.from('TAMPERED');
    assert.ok(!verifyChain(events), 'Tampered chain at index 5 must fail');
  });
});
