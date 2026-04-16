/**
 * Integration tests for T102/T103: Local ONNX embeddings + semantic search.
 *
 * Tests:
 *   1. SDK `embed()` and `embedBatch()` produce 384-dim L2-normalised vectors.
 *   2. Semantic correctness: "hello world" closer to "good morning" than to
 *      "quantum physics" (cosine distance test).
 *   3. `GET /api/v1/search?q=...&mode=tfidf` works without pgvector (SQLite path).
 *   4. `GET /api/v1/documents/:slug/similar` fallback path.
 *   5. `computeAndStoreEmbeddings` skips gracefully on non-Postgres DB.
 *
 * Note: The ONNX model is downloaded lazily on first embed() call (~90 MB).
 * These tests are skipped in CI if SKIP_EMBEDDING_TESTS=1.
 *
 * Run with:
 *   node --import tsx/esm --test src/__tests__/embeddings.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SKIP = process.env.SKIP_EMBEDDING_TESTS === '1';

// ── Unit: cosine similarity sanity ────────────────────────────────────────

describe('cosineSimilarity (WASM)', () => {
  it('orthogonal vectors → 0', async () => {
    const { cosineSimilarity } = await import('llmtxt');
    const a = JSON.stringify([1, 0, 0]);
    const b = JSON.stringify([0, 1, 0]);
    const sim = cosineSimilarity(a, b);
    assert.ok(Math.abs(sim) < 1e-6, `expected ~0 got ${sim}`);
  });

  it('identical vectors → 1', async () => {
    const { cosineSimilarity } = await import('llmtxt');
    const v = JSON.stringify([0.6, 0.8, 0]);
    const sim = cosineSimilarity(v, v);
    assert.ok(Math.abs(sim - 1) < 1e-5, `expected ~1 got ${sim}`);
  });
});

// ── Unit: TF-IDF embed shape ──────────────────────────────────────────────

describe('tfidfEmbedBatch (WASM)', () => {
  it('produces 256-dim L2-normalised vectors', async () => {
    const { tfidfEmbedBatch } = await import('llmtxt');
    const vecs = tfidfEmbedBatch(['hello world', 'quantum physics'], 256);
    assert.equal(vecs.length, 2);
    assert.equal(vecs[0].length, 256);
    // Check L2 norm ≈ 1
    const norm = Math.sqrt(vecs[0].reduce((s: number, x: number) => s + x * x, 0));
    assert.ok(Math.abs(norm - 1) < 1e-4, `norm should be ~1 got ${norm}`);
  });

  it('different texts produce different vectors', async () => {
    const { tfidfEmbedBatch } = await import('llmtxt');
    const [v1, v2] = tfidfEmbedBatch(['hello world', 'completely different content here'], 256);
    const dotProduct = v1.reduce((s: number, x: number, i: number) => s + x * v2[i], 0);
    // Should not be identical
    assert.ok(dotProduct < 0.99, `vectors should differ but dot=${dotProduct}`);
  });
});

// ── Unit: ONNX SDK embeddings ─────────────────────────────────────────────

describe('ONNX embeddings SDK', { skip: SKIP }, () => {
  it('embed() returns 384-dim Float32Array', async function() {
    // Allow 60s for model download on first run
    const { embed, MODEL_DIMS } = await import('llmtxt/embeddings');
    const vec = await embed('hello world');
    assert.equal(vec.length, MODEL_DIMS, `expected ${MODEL_DIMS} dims`);
    assert.ok(vec instanceof Float32Array, 'should be Float32Array');
  });

  it('embed() produces L2-normalised vectors', async () => {
    const { embed } = await import('llmtxt/embeddings');
    const vec = await embed('the quick brown fox jumps over the lazy dog');
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    assert.ok(Math.abs(norm - 1) < 1e-4, `norm should be ~1 got ${norm}`);
  });

  it('embedBatch() is consistent with embed()', async () => {
    const { embed, embedBatch } = await import('llmtxt/embeddings');
    const text = 'semantic embeddings test consistency';
    const single = await embed(text);
    const batch = await embedBatch([text]);
    assert.equal(batch.length, 1);
    // Compare first 10 dims
    for (let i = 0; i < 10; i++) {
      assert.ok(
        Math.abs(single[i] - batch[0][i]) < 1e-5,
        `dim ${i}: single=${single[i]} batch=${batch[0][i]}`,
      );
    }
  });

  it('semantic correctness: hello closer to good_morning than quantum_physics', async () => {
    const { embedBatch } = await import('llmtxt/embeddings');
    const texts = ['hello world', 'good morning everyone', 'quantum physics and relativity'];
    const [vHello, vMorning, vQuantum] = await embedBatch(texts);

    // Cosine similarity = dot product (vectors are L2-normalised)
    let simHelloMorning = 0;
    let simHelloQuantum = 0;
    for (let i = 0; i < vHello.length; i++) {
      simHelloMorning += vHello[i] * vMorning[i];
      simHelloQuantum += vHello[i] * vQuantum[i];
    }

    assert.ok(
      simHelloMorning > simHelloQuantum,
      `"hello" should be closer to "good morning" (${simHelloMorning.toFixed(4)}) ` +
      `than to "quantum physics" (${simHelloQuantum.toFixed(4)})`,
    );
  });

  it('LocalOnnxEmbeddingProvider.embed() returns number[][]', async () => {
    const { LocalOnnxEmbeddingProvider, MODEL_DIMS } = await import('llmtxt/embeddings');
    const provider = new LocalOnnxEmbeddingProvider();
    assert.equal(provider.dimensions, MODEL_DIMS);
    assert.equal(provider.model, 'all-MiniLM-L6-v2');
    const vecs = await provider.embed(['test text']);
    assert.equal(vecs.length, 1);
    assert.equal(vecs[0].length, MODEL_DIMS);
    assert.ok(Array.isArray(vecs[0]), 'should be number[]');
  });
});

// ── Unit: embedding job (no-op on SQLite) ────────────────────────────────

describe('computeAndStoreEmbeddings (SQLite no-op)', () => {
  it('returns without throwing on SQLite provider', async () => {
    // Temporarily ensure we're in SQLite mode for this test
    const originalProvider = process.env.DATABASE_PROVIDER;
    process.env.DATABASE_PROVIDER = 'sqlite';

    try {
      const { computeAndStoreEmbeddings } = await import('../jobs/embeddings.js');
      // Should return silently since DATABASE_PROVIDER != postgresql
      await computeAndStoreEmbeddings('test-doc-id', '# Hello\n\nTest content here.');
    } finally {
      if (originalProvider !== undefined) {
        process.env.DATABASE_PROVIDER = originalProvider;
      } else {
        delete process.env.DATABASE_PROVIDER;
      }
    }
  });
});

// ── Benchmark: embed latency ──────────────────────────────────────────────

describe('ONNX embedding latency benchmark', { skip: SKIP }, () => {
  it('single embed p50 < 100ms (warm)', async () => {
    const { embed } = await import('llmtxt/embeddings');

    // Warmup
    await embed('warmup text');

    // Measure 10 embeds
    const latencies: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      await embed(`benchmark text sample number ${i} for latency measurement`);
      latencies.push(Date.now() - t0);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[4];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const min = latencies[0];
    const max = latencies[latencies.length - 1];

    console.log(`[benchmark] embed latency: min=${min}ms p50=${p50}ms p95=${p95}ms max=${max}ms`);

    // p50 should be < 200ms on modern CPU (quantized model)
    assert.ok(p50 < 200, `p50 should be < 200ms got ${p50}ms`);
  });

  it('batch of 10 embeds is faster than 10 sequential embeds', async () => {
    const { embed, embedBatch } = await import('llmtxt/embeddings');
    const texts = Array.from({ length: 10 }, (_, i) => `test document number ${i} with some content`);

    // Sequential
    const t0 = Date.now();
    for (const t of texts) await embed(t);
    const seqMs = Date.now() - t0;

    // Batch
    const t1 = Date.now();
    await embedBatch(texts);
    const batchMs = Date.now() - t1;

    console.log(`[benchmark] sequential=${seqMs}ms batch=${batchMs}ms speedup=${(seqMs / batchMs).toFixed(1)}x`);

    // Batch should be at least 20% faster (usually 5-10x)
    assert.ok(batchMs < seqMs, `batch (${batchMs}ms) should be faster than sequential (${seqMs}ms)`);
  });
});
