/**
 * createversion-autoindex.test.ts
 *
 * T819 integration test: verifies that LocalBackend.publishVersion automatically
 * indexes document content for semantic search, so that search() returns hits
 * after push without the caller explicitly calling indexDocument.
 *
 * Gated by RUN_ONNX_TESTS environment variable in CI environments where the
 * all-MiniLM-L6-v2 ONNX model (~90 MB) may not be cached.
 *
 * Refs: T819, T818, T780
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LocalBackend } from '../local/local-backend.js';

// ---------------------------------------------------------------------------
// Skip gate: in CI without the ONNX model, skip to avoid network dependency
// ---------------------------------------------------------------------------

const SKIP_ONNX = Boolean(process.env.CI) && !process.env.RUN_ONNX_TESTS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llmtxt-autoindex-test-'));
}

async function cleanupBackend(backend: LocalBackend, dir: string): Promise<void> {
  try {
    await backend.close();
  } catch {
    // ignore
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('createVersion auto-index → search returns hits (T819)', () => {
  let backend: LocalBackend;
  let dir: string;

  before(async () => {
    dir = tmpDir();
    backend = new LocalBackend({ storagePath: dir, wal: false, leaseReaperIntervalMs: 0 });
    await backend.open();
  });

  after(async () => {
    await cleanupBackend(backend, dir);
  });

  (SKIP_ONNX ? it.skip : it)(
    'publishVersion auto-indexes and search returns hits for the correct document',
    async () => {
      // --- Arrange: create 3 documents with semantically distinct content ---
      const authDoc = await backend.createDocument({
        title: 'Auth with JWT refresh tokens in Redis',
        createdBy: 'test-agent',
      });
      const paymentDoc = await backend.createDocument({
        title: 'Payment via Stripe checkout',
        createdBy: 'test-agent',
      });
      const monitoringDoc = await backend.createDocument({
        title: 'Monitoring with Prometheus metrics',
        createdBy: 'test-agent',
      });

      // --- Act: push a version for each document (auto-index fires here) ---
      await backend.publishVersion({
        documentId: authDoc.id,
        content: '# Auth\n## JWT refresh token rotation in Redis\n\nUse Redis to store refresh tokens with short TTLs and automatic rotation on each use.',
        patchText: '',
        createdBy: 'test-agent',
        changelog: 'initial',
      });
      await backend.publishVersion({
        documentId: paymentDoc.id,
        content: '# Payments\n## Stripe checkout integration\n\nUse Stripe Checkout for PCI-compliant payment flows with hosted payment pages.',
        patchText: '',
        createdBy: 'test-agent',
        changelog: 'initial',
      });
      await backend.publishVersion({
        documentId: monitoringDoc.id,
        content: '# Monitoring\n## Prometheus metrics and alerting\n\nExpose /metrics endpoint and configure Prometheus scrape intervals and alert rules.',
        patchText: '',
        createdBy: 'test-agent',
        changelog: 'initial',
      });

      // --- Wait for fire-and-forget indexing to complete ---
      // indexDocument is async and called without await inside publishVersion.
      // A 2-second sleep provides sufficient headroom for ONNX embedding (~200 ms typical).
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // --- Assert: search for JWT content returns at least 1 hit ---
      const results = await backend.search({ query: 'JWT refresh token Redis', topK: 5 });

      assert.ok(
        results.length > 0,
        `Expected search results for "JWT refresh token Redis" but got 0. Auto-index may not have fired.`
      );

      // The top result should be the auth document
      const topResult = results[0];
      assert.strictEqual(
        topResult.documentId,
        authDoc.id,
        `Top result documentId "${topResult.documentId}" does not match auth doc "${authDoc.id}". ` +
          `Top result score=${topResult.score.toFixed(4)}`
      );
    }
  );

  (SKIP_ONNX ? it.skip : it)(
    'search returns 0 results when no versions have been published (baseline)',
    async () => {
      // Create a separate backend to ensure clean state
      const dir2 = tmpDir();
      const backend2 = new LocalBackend({ storagePath: dir2, wal: false, leaseReaperIntervalMs: 0 });
      await backend2.open();
      try {
        // Create a document but do NOT push a version
        await backend2.createDocument({ title: 'Unpublished doc', createdBy: 'test-agent' });

        const results = await backend2.search({ query: 'JWT refresh token Redis', topK: 5 });
        assert.strictEqual(
          results.length,
          0,
          'Expected 0 results for a backend with no published versions'
        );
      } finally {
        await cleanupBackend(backend2, dir2);
      }
    }
  );
});
