/**
 * Integration tests for Fastify bodyLimit enforcement — T108.1 / T467.
 *
 * Verifies that the Fastify server is configured with
 * bodyLimit = CONTENT_LIMITS.maxDocumentSize so that:
 *   - Requests whose body is ≤ maxDocumentSize are accepted (200).
 *   - Requests whose body exceeds maxDocumentSize are rejected with 413
 *     before any route handler runs.
 *
 * The test builds a minimal Fastify instance with the same bodyLimit value
 * as index.ts — without requiring a real database or auth stack — so the
 * tests are fast, deterministic, and free of external dependencies.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { CONTENT_LIMITS } from 'llmtxt';

// ── Test app ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal Fastify instance that mirrors the bodyLimit set in index.ts.
 * A single POST /echo route echoes the raw body so we can verify 200 vs 413.
 */
async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // Mirror the bodyLimit from index.ts [T467 / T108.1]
    bodyLimit: CONTENT_LIMITS.maxDocumentSize,
  });

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  app.post<{ Body: Buffer }>('/echo', async (_req, reply) => {
    return reply.status(200).send({ ok: true, size: _req.body.length });
  });

  await app.ready();
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Fastify bodyLimit — CONTENT_LIMITS.maxDocumentSize', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildTestApp();
  });

  after(async () => {
    await app.close();
  });

  it('accepts a body exactly one byte below the limit (maxDocumentSize - 1)', async () => {
    const size = CONTENT_LIMITS.maxDocumentSize - 1;
    const body = Buffer.alloc(size, 'x');

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/octet-stream' },
      payload: body,
    });

    assert.equal(
      res.statusCode,
      200,
      `Expected 200 for body of ${size} bytes, got ${res.statusCode}: ${res.body}`,
    );
  });

  it('rejects a body exactly one byte above the limit (maxDocumentSize + 1) with 413', async () => {
    const size = CONTENT_LIMITS.maxDocumentSize + 1;
    const body = Buffer.alloc(size, 'x');

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/octet-stream' },
      payload: body,
    });

    assert.equal(
      res.statusCode,
      413,
      `Expected 413 for body of ${size} bytes, got ${res.statusCode}: ${res.body}`,
    );
  });

  it('accepts a small body well below the limit', async () => {
    const body = Buffer.from(JSON.stringify({ content: 'hello world' }), 'utf-8');

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/octet-stream' },
      payload: body,
    });

    assert.equal(res.statusCode, 200, `Expected 200 for small body: ${res.body}`);
  });

  it('CONTENT_LIMITS.maxDocumentSize is 10 MB (sanity check)', () => {
    assert.equal(CONTENT_LIMITS.maxDocumentSize, 10 * 1024 * 1024);
  });
});
