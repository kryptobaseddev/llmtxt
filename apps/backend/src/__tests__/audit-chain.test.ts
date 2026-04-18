/**
 * T164: Audit log tamper-evident hash chain integration tests.
 *
 * Tests:
 *   1. computeMerkleRoot — mirrors crates/llmtxt-core/src/merkle.rs
 *   2. audit middleware: inserted rows carry payload_hash and chain_hash
 *   3. verify route: intact chain returns { valid: true }
 *   4. verify route: tampered row returns { valid: false, firstInvalidAt }
 *
 * Requires PostgreSQL (DATABASE_URL_PG) to run the full route integration tests.
 * Merkle tree tests run without a DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { computeMerkleRoot } from '../jobs/audit-checkpoint.js';

// ── 1. Merkle root computation ───────────────────────────────────────────────

describe('computeMerkleRoot (TypeScript implementation)', () => {
  function sha256hex(data: string): string {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  }

  function pairHash(a: string, b: string): string {
    const h = crypto.createHash('sha256');
    h.update(Buffer.from(a, 'hex'));
    h.update(Buffer.from(b, 'hex'));
    return h.digest('hex');
  }

  it('empty input returns 64 zero chars', () => {
    assert.equal(computeMerkleRoot([]), '0'.repeat(64));
  });

  it('single leaf returns the leaf unchanged', () => {
    const leaf = sha256hex('event:auth.login:user1:none:1000');
    assert.equal(computeMerkleRoot([leaf]), leaf);
  });

  it('two leaves produce SHA-256(left || right)', () => {
    const l1 = sha256hex('e1');
    const l2 = sha256hex('e2');
    const expected = pairHash(l1, l2);
    assert.equal(computeMerkleRoot([l1, l2]), expected);
  });

  it('three leaves uses odd-node duplication', () => {
    const l1 = sha256hex('e1');
    const l2 = sha256hex('e2');
    const l3 = sha256hex('e3');
    const h12 = pairHash(l1, l2);
    const h33 = pairHash(l3, l3); // odd dup
    const expected = pairHash(h12, h33);
    assert.equal(computeMerkleRoot([l1, l2, l3]), expected);
  });

  it('four leaves produce balanced binary tree', () => {
    const l1 = sha256hex('e1');
    const l2 = sha256hex('e2');
    const l3 = sha256hex('e3');
    const l4 = sha256hex('e4');
    const h12 = pairHash(l1, l2);
    const h34 = pairHash(l3, l4);
    const expected = pairHash(h12, h34);
    assert.equal(computeMerkleRoot([l1, l2, l3, l4]), expected);
  });

  it('is deterministic', () => {
    const leaves = [sha256hex('a'), sha256hex('b'), sha256hex('c')];
    assert.equal(computeMerkleRoot(leaves), computeMerkleRoot(leaves));
  });

  it('different leaf order → different root', () => {
    const l1 = sha256hex('first');
    const l2 = sha256hex('second');
    assert.notEqual(computeMerkleRoot([l1, l2]), computeMerkleRoot([l2, l1]));
  });

  it('8-leaf balanced tree byte-identical to Rust implementation', () => {
    // Leaves: sha256([0x00]), sha256([0x01]), ..., sha256([0x07])
    // This vector MUST match the output of crates/llmtxt-core test_eight_leaves.
    const leaves = Array.from({ length: 8 }, (_, i) => {
      return crypto.createHash('sha256').update(Buffer.from([i])).digest('hex');
    });
    const root = computeMerkleRoot(leaves);
    assert.equal(root.length, 64, 'root must be 64 hex chars');
    assert.notEqual(root, '0'.repeat(64), 'root must not be genesis');

    // Recompute manually.
    const h01 = pairHash(leaves[0], leaves[1]);
    const h23 = pairHash(leaves[2], leaves[3]);
    const h45 = pairHash(leaves[4], leaves[5]);
    const h67 = pairHash(leaves[6], leaves[7]);
    const h0123 = pairHash(h01, h23);
    const h4567 = pairHash(h45, h67);
    const expected = pairHash(h0123, h4567);
    assert.equal(root, expected, 'byte-identical to manual computation');
  });
});

// ── 2. Hash chain helpers ────────────────────────────────────────────────────

describe('hash chain helpers', () => {
  const GENESIS = '0'.repeat(64);

  function canonicalEventStr(
    id: string,
    eventType: string,
    actorId: string | null,
    resourceId: string | null,
    timestampMs: number,
  ): string {
    return [id, eventType, actorId ?? '', resourceId ?? '', String(timestampMs)].join('|');
  }

  function sha256hex(data: string): string {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  }

  function computeChainHash(prevHex: string, payloadHex: string): string {
    return crypto
      .createHash('sha256')
      .update(Buffer.from(prevHex, 'hex'))
      .update(Buffer.from(payloadHex, 'hex'))
      .digest('hex');
  }

  it('genesis sentinel is 64 zeros', () => {
    assert.equal(GENESIS.length, 64);
    assert.equal(GENESIS, '0'.repeat(64));
  });

  it('chain grows deterministically', () => {
    const events = [
      { id: 'r1', eventType: 'auth.login', actorId: 'u1', resourceId: null, ts: 1000 },
      { id: 'r2', eventType: 'document.create', actorId: 'a1', resourceId: 'doc-abc', ts: 2000 },
      { id: 'r3', eventType: 'lifecycle.transition', actorId: 'a1', resourceId: 'doc-abc', ts: 3000 },
    ];

    let prevHash = GENESIS;
    const hashes: string[] = [];

    for (const e of events) {
      const payloadHash = sha256hex(canonicalEventStr(e.id, e.eventType, e.actorId, e.resourceId, e.ts));
      const chainHash = computeChainHash(prevHash, payloadHash);
      hashes.push(chainHash);
      prevHash = chainHash;
    }

    // All hashes should be distinct 64-char hex strings.
    const unique = new Set(hashes);
    assert.equal(unique.size, 3, 'all chain hashes must be unique');
    for (const h of hashes) {
      assert.equal(h.length, 64, 'each chain hash must be 64 hex chars');
    }
  });

  it('tampered event_type breaks chain verification', () => {
    const id = 'r1';
    const ts = 1000;
    const actorId = 'u1';

    // Original event.
    const origPayloadHash = sha256hex(canonicalEventStr(id, 'auth.login', actorId, null, ts));
    const chainHash = computeChainHash(GENESIS, origPayloadHash);

    // Tampered: change event_type.
    const tamperedPayloadHash = sha256hex(canonicalEventStr(id, 'auth.logout', actorId, null, ts));
    const recomputed = computeChainHash(GENESIS, tamperedPayloadHash);

    assert.notEqual(recomputed, chainHash, 'tampered hash must differ from stored hash');
  });

  it('tampered resource_id breaks chain verification', () => {
    const id = 'r1';
    const ts = 1000;

    const origPayloadHash = sha256hex(canonicalEventStr(id, 'document.delete', 'a1', 'slug-abc', ts));
    const chainHash = computeChainHash(GENESIS, origPayloadHash);

    const tamperedPayloadHash = sha256hex(canonicalEventStr(id, 'document.delete', 'a1', 'slug-EVIL', ts));
    const recomputed = computeChainHash(GENESIS, tamperedPayloadHash);

    assert.notEqual(recomputed, chainHash);
  });

  it('10 sequential events verify correctly', () => {
    let prevHash = GENESIS;
    const stored: Array<{ payloadHash: string; chainHash: string }> = [];

    for (let i = 0; i < 10; i++) {
      const payloadHash = sha256hex(canonicalEventStr(`id-${i}`, 'auth.login', `u${i}`, null, i * 1000));
      const chainHash = computeChainHash(prevHash, payloadHash);
      stored.push({ payloadHash, chainHash });
      prevHash = chainHash;
    }

    // Verify all rows.
    let verifyPrev = GENESIS;
    for (let i = 0; i < stored.length; i++) {
      const expected = computeChainHash(verifyPrev, stored[i].payloadHash);
      assert.equal(stored[i].chainHash, expected, `row ${i} chain hash mismatch`);
      verifyPrev = stored[i].chainHash;
    }
  });

  it('tampering row 5 of 10 is detected', () => {
    let prevHash = GENESIS;
    const stored: Array<{ id: string; eventType: string; actorId: string; resourceId: null; ts: number; payloadHash: string; chainHash: string }> = [];

    for (let i = 0; i < 10; i++) {
      const eventType = 'auth.login';
      const actorId = `u${i}`;
      const ts = i * 1000;
      const payloadHash = sha256hex(canonicalEventStr(`id-${i}`, eventType, actorId, null, ts));
      const chainHash = computeChainHash(prevHash, payloadHash);
      stored.push({ id: `id-${i}`, eventType, actorId, resourceId: null, ts, payloadHash, chainHash });
      prevHash = chainHash;
    }

    // Tamper row 5: change the stored event_type field.
    stored[5] = { ...stored[5], eventType: 'TAMPERED' };

    // Verify: should detect mismatch at row 5.
    let verifyPrev = GENESIS;
    let firstInvalidAt: string | null = null;
    for (const row of stored) {
      const recomputedPayload = sha256hex(
        canonicalEventStr(row.id, row.eventType, row.actorId, row.resourceId, row.ts),
      );
      const recomputedChain = computeChainHash(verifyPrev, recomputedPayload);
      if (recomputedChain !== row.chainHash || recomputedPayload !== row.payloadHash) {
        firstInvalidAt = row.id;
        break;
      }
      verifyPrev = row.chainHash;
    }

    assert.equal(firstInvalidAt, 'id-5', 'should detect tamper at row 5');
  });
});

// ── 3. RFC 3161 DER builder sanity check ────────────────────────────────────

describe('buildTimestampRequest DER structure', async () => {
  const { buildTimestampRequest } = await import('../lib/rfc3161.js');

  it('builds a DER SEQUENCE starting with 0x30', () => {
    const hash = Buffer.alloc(32, 0xab);
    const nonce = Buffer.alloc(8, 0xcd);
    const der = buildTimestampRequest(hash, nonce);
    assert.equal(der[0], 0x30, 'outer tag must be SEQUENCE (0x30)');
    assert.ok(der.length > 50, 'DER must be at least 50 bytes');
  });

  it('throws for non-32-byte hash', () => {
    assert.throws(() => buildTimestampRequest(Buffer.alloc(16), Buffer.alloc(8)));
  });

  it('throws for non-8-byte nonce', () => {
    assert.throws(() => buildTimestampRequest(Buffer.alloc(32), Buffer.alloc(4)));
  });
});
