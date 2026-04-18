/**
 * Security primitives tests — T473 (constant-time comparison) + T475 (content hash verification).
 *
 * Validates:
 *   1. constantTimeEqHex — delegates to crates/llmtxt-core::crypto::constant_time_eq_hex
 *      via WASM. Guarantees timing-safe hex digest comparison.
 *   2. verifyContentHash — delegates hash_content + constant_time_eq_hex via WASM.
 *      Client-side MITM-detection helper for SDK consumers.
 *
 * Test runner: node:test (native, no vitest dependency).
 * Run with:
 *   node --import tsx/esm --test src/__tests__/security-primitives.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { constantTimeEqHex, verifyContentHash, hashContent } from '../wasm.js';

// Known SHA-256 vectors (verified independently)
const HELLO_HASH = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const HELLO_WORLD_HASH = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// ── constantTimeEqHex ────────────────────────────────────────────────────────

describe('constantTimeEqHex (S-01 / T108.7)', () => {
  it('returns true for identical digests', () => {
    assert.strictEqual(constantTimeEqHex(HELLO_HASH, HELLO_HASH), true);
  });

  it('returns true for identical empty strings', () => {
    assert.strictEqual(constantTimeEqHex('', ''), true);
  });

  it('returns false for different digests of same length', () => {
    assert.strictEqual(constantTimeEqHex(HELLO_HASH, HELLO_WORLD_HASH), false);
  });

  it('returns false when lengths differ', () => {
    assert.strictEqual(constantTimeEqHex(HELLO_HASH, HELLO_HASH.slice(0, 32)), false);
    assert.strictEqual(constantTimeEqHex('', 'a'), false);
    assert.strictEqual(constantTimeEqHex('a', ''), false);
  });

  it('returns false when one character differs (single-byte change)', () => {
    const modified = HELLO_HASH.slice(0, -1) + (HELLO_HASH.endsWith('4') ? '5' : '4');
    assert.strictEqual(constantTimeEqHex(HELLO_HASH, modified), false);
  });

  it('is symmetric: eq(a, b) === eq(b, a)', () => {
    assert.strictEqual(
      constantTimeEqHex(HELLO_HASH, HELLO_WORLD_HASH),
      constantTimeEqHex(HELLO_WORLD_HASH, HELLO_HASH)
    );
    assert.strictEqual(
      constantTimeEqHex(HELLO_HASH, HELLO_HASH),
      constantTimeEqHex(HELLO_HASH, HELLO_HASH)
    );
  });
});

// ── verifyContentHash ────────────────────────────────────────────────────────

describe('verifyContentHash (T-02 / T108.9)', () => {
  it('returns true when content matches the expected hash', () => {
    assert.strictEqual(verifyContentHash('hello', HELLO_HASH), true);
  });

  it('returns true for empty content against the empty-string SHA-256', () => {
    assert.strictEqual(verifyContentHash('', EMPTY_HASH), true);
  });

  it('returns false when content has been tampered (different content, same expected hash)', () => {
    // "hello world" does NOT match the hash of "hello"
    assert.strictEqual(verifyContentHash('hello world', HELLO_HASH), false);
  });

  it('returns false when the expected hash is wrong for the content', () => {
    assert.strictEqual(verifyContentHash('hello', HELLO_WORLD_HASH), false);
  });

  it('returns false when the expected hash is the empty string', () => {
    // sha256("hello") != "" — length mismatch path in constant_time_eq_hex
    assert.strictEqual(verifyContentHash('hello', ''), false);
  });

  it('round-trip: hashContent output passes verifyContentHash', () => {
    const content = 'Round-trip: this content was hashed by hash_content and verified in constant time.';
    const digest = hashContent(content);
    assert.strictEqual(verifyContentHash(content, digest), true);
  });

  it('round-trip: tampered content fails verifyContentHash', () => {
    const content = 'Original content for round-trip tamper test.';
    const digest = hashContent(content);
    const tampered = content + ' (tampered)';
    assert.strictEqual(verifyContentHash(tampered, digest), false);
  });

  it('round-trip: multi-paragraph content verifies correctly', () => {
    const content = `# Document Title\n\nFirst paragraph with agent content.\n\n## Section Two\n\nSecond section with more details.`;
    const digest = hashContent(content);
    assert.strictEqual(verifyContentHash(content, digest), true);
    // Tamper: remove a newline
    assert.strictEqual(verifyContentHash(content.replace('\n\n', '\n'), digest), false);
  });

  it('is case-sensitive: uppercase hash does not match lowercase hash output', () => {
    // hash_content always returns lowercase hex; uppercase should not match
    assert.strictEqual(verifyContentHash('hello', HELLO_HASH.toUpperCase()), false);
  });
});
