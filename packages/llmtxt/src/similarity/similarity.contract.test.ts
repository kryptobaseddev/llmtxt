/**
 * Contract tests for the llmtxt/similarity subpath.
 *
 * Purpose: assert the stable public API surface of `llmtxt/similarity` so that
 * any rename, removal, or signature change is caught immediately.
 *
 * The llmtxt/similarity subpath is a flat source file at src/similarity.ts.
 * These tests import from it directly (one directory up) to mirror the
 * compiled subpath import `llmtxt/similarity`.
 *
 * Exported symbols:
 *   Types:     SimilarityRankResult
 *   Functions: contentSimilarity, extractNgrams, extractWordShingles,
 *              fingerprintSimilarity, jaccardSimilarity, minHashFingerprint,
 *              rankBySimilarity, textSimilarity (alias for jaccardSimilarity)
 *
 * All functions are backed by crates/llmtxt-core via WASM (SSoT rule).
 * Contract tests verify: export existence, return types, and behavioural
 * invariants (identity, symmetry, range).
 *
 * Test runner: node:test (native). No vitest.
 * Run with the package-level test script: pnpm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── Imports — similarity subpath source (../similarity.ts = llmtxt/similarity)

import {
  contentSimilarity,
  extractNgrams,
  extractWordShingles,
  fingerprintSimilarity,
  jaccardSimilarity,
  minHashFingerprint,
  rankBySimilarity,
  textSimilarity,
} from '../similarity.js';

// ── 1. Export existence ───────────────────────────────────────────────────────

describe('llmtxt/similarity — export existence', () => {
  it('contentSimilarity is exported as a function', () => {
    assert.equal(typeof contentSimilarity, 'function');
  });

  it('extractNgrams is exported as a function', () => {
    assert.equal(typeof extractNgrams, 'function');
  });

  it('extractWordShingles is exported as a function', () => {
    assert.equal(typeof extractWordShingles, 'function');
  });

  it('fingerprintSimilarity is exported as a function', () => {
    assert.equal(typeof fingerprintSimilarity, 'function');
  });

  it('jaccardSimilarity is exported as a function', () => {
    assert.equal(typeof jaccardSimilarity, 'function');
  });

  it('minHashFingerprint is exported as a function', () => {
    assert.equal(typeof minHashFingerprint, 'function');
  });

  it('rankBySimilarity is exported as a function', () => {
    assert.equal(typeof rankBySimilarity, 'function');
  });

  it('textSimilarity is exported as a function (backward-compat alias for jaccardSimilarity)', () => {
    assert.equal(typeof textSimilarity, 'function');
  });
});

// ── 2. contentSimilarity — range and symmetry ─────────────────────────────────

describe('llmtxt/similarity — contentSimilarity contract', () => {
  it('returns a number', () => {
    const score = contentSimilarity('hello world', 'hello world');
    assert.equal(typeof score, 'number');
  });

  it('identical texts return score close to 1.0', () => {
    const score = contentSimilarity('the quick brown fox', 'the quick brown fox');
    assert.ok(score >= 0.9,
      `identical text similarity must be >= 0.9, got ${score}`);
  });

  it('completely different texts return score close to 0', () => {
    const score = contentSimilarity('aaaa bbbb', 'xxxx yyyy');
    assert.ok(score <= 0.5,
      `unrelated text similarity must be <= 0.5, got ${score}`);
  });

  it('score is in range [0.0, 1.0]', () => {
    const score = contentSimilarity('foo bar baz', 'qux quux corge');
    assert.ok(score >= 0.0 && score <= 1.0,
      `score must be in [0.0, 1.0], got ${score}`);
  });

  it('symmetry: contentSimilarity(a, b) === contentSimilarity(b, a)', () => {
    const a = 'machine learning model';
    const b = 'model training pipeline';
    const ab = contentSimilarity(a, b);
    const ba = contentSimilarity(b, a);
    assert.equal(ab, ba, `symmetry violated: ${ab} != ${ba}`);
  });
});

// ── 3. jaccardSimilarity / textSimilarity ─────────────────────────────────────

describe('llmtxt/similarity — jaccardSimilarity contract', () => {
  it('returns a number', () => {
    assert.equal(typeof jaccardSimilarity('foo', 'foo'), 'number');
  });

  it('identical texts return score close to 1.0', () => {
    const score = jaccardSimilarity('hello world', 'hello world');
    assert.ok(score >= 0.9,
      `identical text score must be >= 0.9, got ${score}`);
  });

  it('score is in range [0.0, 1.0]', () => {
    const score = jaccardSimilarity('abc def', 'ghi jkl');
    assert.ok(score >= 0.0 && score <= 1.0,
      `score must be in [0.0, 1.0], got ${score}`);
  });

  it('symmetry: jaccardSimilarity(a, b) === jaccardSimilarity(b, a)', () => {
    const a = 'agent collaboration';
    const b = 'collaboration tools';
    assert.equal(jaccardSimilarity(a, b), jaccardSimilarity(b, a));
  });

  it('textSimilarity is a backward-compat alias — same result as jaccardSimilarity', () => {
    const a = 'foo bar baz';
    const b = 'foo baz qux';
    assert.equal(textSimilarity(a, b), jaccardSimilarity(a, b));
  });
});

// ── 4. extractNgrams ─────────────────────────────────────────────────────────

describe('llmtxt/similarity — extractNgrams contract', () => {
  it('returns an array', () => {
    const result = extractNgrams('hello', 3);
    assert.ok(Array.isArray(result));
  });

  it('produces character n-grams of the specified size', () => {
    const result = extractNgrams('hello', 3);
    for (const gram of result) {
      assert.equal(gram.length, 3,
        `n-gram "${gram}" has length ${gram.length}, expected 3`);
    }
  });

  it('empty string returns empty array', () => {
    const result = extractNgrams('', 3);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('short text (shorter than n) returns empty array', () => {
    const result = extractNgrams('hi', 3);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('default n is 3', () => {
    const withDefault = extractNgrams('hello world');
    const withExplicit = extractNgrams('hello world', 3);
    assert.deepEqual(withDefault, withExplicit);
  });
});

// ── 5. extractWordShingles ────────────────────────────────────────────────────

describe('llmtxt/similarity — extractWordShingles contract', () => {
  it('returns an array', () => {
    const result = extractWordShingles('the quick brown fox', 2);
    assert.ok(Array.isArray(result));
  });

  it('each shingle contains exactly n words', () => {
    const result = extractWordShingles('the quick brown fox', 2);
    for (const shingle of result) {
      const wordCount = shingle.trim().split(/\s+/).length;
      assert.equal(wordCount, 2,
        `shingle "${shingle}" has ${wordCount} words, expected 2`);
    }
  });

  it('empty string returns empty array', () => {
    const result = extractWordShingles('', 2);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('default shingle size is 2', () => {
    const withDefault = extractWordShingles('the quick brown fox');
    const withExplicit = extractWordShingles('the quick brown fox', 2);
    assert.deepEqual(withDefault, withExplicit);
  });
});

// ── 6. minHashFingerprint ─────────────────────────────────────────────────────

describe('llmtxt/similarity — minHashFingerprint contract', () => {
  it('returns an array of numbers', () => {
    const fp = minHashFingerprint('hello world');
    assert.ok(Array.isArray(fp));
    assert.ok(fp.length > 0);
    for (const val of fp) {
      assert.equal(typeof val, 'number');
    }
  });

  it('default fingerprint has 64 values', () => {
    const fp = minHashFingerprint('sample text for fingerprinting');
    assert.equal(fp.length, 64);
  });

  it('numHashes parameter controls output length', () => {
    const fp32 = minHashFingerprint('sample text', 32, 3);
    assert.equal(fp32.length, 32);
    const fp128 = minHashFingerprint('sample text', 128, 3);
    assert.equal(fp128.length, 128);
  });

  it('same text produces identical fingerprint (deterministic)', () => {
    const fp1 = minHashFingerprint('deterministic text', 64, 3);
    const fp2 = minHashFingerprint('deterministic text', 64, 3);
    assert.deepEqual(fp1, fp2);
  });

  it('different texts produce different fingerprints', () => {
    const fp1 = minHashFingerprint('text about machine learning', 64, 3);
    const fp2 = minHashFingerprint('completely different content here', 64, 3);
    assert.notDeepEqual(fp1, fp2);
  });
});

// ── 7. fingerprintSimilarity ──────────────────────────────────────────────────

describe('llmtxt/similarity — fingerprintSimilarity contract', () => {
  it('returns a number in [0.0, 1.0]', () => {
    const fp1 = minHashFingerprint('hello world', 32, 3);
    const fp2 = minHashFingerprint('hello earth', 32, 3);
    const score = fingerprintSimilarity(fp1, fp2);
    assert.equal(typeof score, 'number');
    assert.ok(score >= 0.0 && score <= 1.0,
      `score must be in [0.0, 1.0], got ${score}`);
  });

  it('identical fingerprints return 1.0', () => {
    const fp = minHashFingerprint('same text', 32, 3);
    const score = fingerprintSimilarity(fp, fp);
    assert.equal(score, 1.0);
  });

  it('empty arrays return 0', () => {
    const score = fingerprintSimilarity([], []);
    assert.equal(score, 0);
  });

  it('mismatched lengths return 0', () => {
    const score = fingerprintSimilarity([1, 2, 3], [1, 2]);
    assert.equal(score, 0);
  });

  it('symmetry: fingerprintSimilarity(a, b) === fingerprintSimilarity(b, a)', () => {
    const fp1 = minHashFingerprint('agent alpha', 32, 3);
    const fp2 = minHashFingerprint('agent beta', 32, 3);
    assert.equal(fingerprintSimilarity(fp1, fp2), fingerprintSimilarity(fp2, fp1));
  });
});

// ── 8. rankBySimilarity ───────────────────────────────────────────────────────

describe('llmtxt/similarity — rankBySimilarity contract', () => {
  it('returns an array of SimilarityRankResult', () => {
    const results = rankBySimilarity('machine learning', [
      'deep learning models',
      'baking recipes',
      'neural network training',
    ]);
    assert.ok(Array.isArray(results));
    for (const r of results) {
      assert.equal(typeof r.index, 'number');
      assert.equal(typeof r.score, 'number');
    }
  });

  it('returns results sorted by descending score', () => {
    const results = rankBySimilarity('machine learning models', [
      'cooking food recipes',
      'machine learning deep neural models',
      'furniture woodworking carpentry',
    ]);
    for (let i = 0; i < results.length - 1; i++) {
      assert.ok(results[i].score >= results[i + 1].score,
        `results must be sorted descending: index ${i} score ${results[i].score} < index ${i+1} score ${results[i+1].score}`);
    }
  });

  it('each result index is a valid candidate index', () => {
    const candidates = ['alpha', 'beta', 'gamma'];
    const results = rankBySimilarity('alpha test', candidates);
    for (const r of results) {
      assert.ok(r.index >= 0 && r.index < candidates.length,
        `index ${r.index} out of range [0, ${candidates.length})`);
    }
  });

  it('returns empty array for empty candidates', () => {
    const results = rankBySimilarity('query', []);
    assert.ok(Array.isArray(results));
    assert.equal(results.length, 0);
  });

  it('accepts optional method option without throwing', () => {
    assert.doesNotThrow(() => {
      rankBySimilarity('query', ['candidate one', 'candidate two'], {
        method: 'ngram',
      });
    });
  });

  it('accepts optional threshold option without throwing', () => {
    assert.doesNotThrow(() => {
      rankBySimilarity('query', ['candidate one', 'candidate two'], {
        threshold: 0.1,
      });
    });
  });
});
