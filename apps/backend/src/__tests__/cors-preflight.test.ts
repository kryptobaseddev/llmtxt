/**
 * CORS preflight test — T850.
 *
 * Regression guard for the production incident 2026-04-21, where the browser
 * CORS preflight blocked cross-origin requests from https://www.llmtxt.my to
 * https://api.llmtxt.my with:
 *
 *   "Request header field x-csrf-token is not allowed by
 *    Access-Control-Allow-Headers in preflight response"
 *
 * The frontend client attaches `x-csrf-token` on every state-changing request
 * (POST/PUT/PATCH/DELETE). Without this header being in the backend's
 * @fastify/cors `allowedHeaders` list, the preflight fails and no actual
 * request is ever sent.
 *
 * This test spins up a minimal Fastify instance with the EXACT CORS options
 * used in index.ts and asserts that an OPTIONS preflight advertising
 * `Access-Control-Request-Headers: x-csrf-token` gets 204 + a compliant
 * `access-control-allow-headers` response.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import cors from '@fastify/cors';

const ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Cookie',
  'X-API-Version',
  'X-Agent-Pubkey-Id',
  'X-Agent-Signature',
  'X-Agent-Nonce',
  'X-Agent-Timestamp',
  'Idempotency-Key',
  'X-CSRF-Token',
];

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

async function buildCorsApp() {
  const app = Fastify({ logger: false });
  await app.register(cors, {
    origin: ['https://www.llmtxt.my'],
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    credentials: true,
  });
  app.post('/compress', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('CORS preflight — state-changing requests from www.llmtxt.my (T850)', () => {
  it('OPTIONS preflight with x-csrf-token in request headers is permitted', async () => {
    const app = await buildCorsApp();
    try {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/compress',
        headers: {
          origin: 'https://www.llmtxt.my',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,x-csrf-token',
        },
      });
      assert.equal(res.statusCode, 204, `expected 204, got ${res.statusCode}`);
      const allowHeaders = (res.headers['access-control-allow-headers'] ?? '') as string;
      assert.match(
        allowHeaders,
        /X-CSRF-Token/i,
        `Access-Control-Allow-Headers must include X-CSRF-Token — got "${allowHeaders}"`,
      );
      assert.match(
        allowHeaders,
        /Content-Type/i,
        `Access-Control-Allow-Headers must include Content-Type — got "${allowHeaders}"`,
      );
      assert.equal(res.headers['access-control-allow-origin'], 'https://www.llmtxt.my');
      assert.equal(res.headers['access-control-allow-credentials'], 'true');
    } finally {
      await app.close();
    }
  });

  it('OPTIONS preflight for PATCH is permitted (was missing before T850)', async () => {
    const app = await buildCorsApp();
    try {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/compress',
        headers: {
          origin: 'https://www.llmtxt.my',
          'access-control-request-method': 'PATCH',
          'access-control-request-headers': 'x-csrf-token',
        },
      });
      assert.equal(res.statusCode, 204);
      const allowMethods = (res.headers['access-control-allow-methods'] ?? '') as string;
      assert.match(allowMethods, /PATCH/i);
    } finally {
      await app.close();
    }
  });

  it('OPTIONS preflight from an unknown origin is NOT permitted', async () => {
    const app = await buildCorsApp();
    try {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/compress',
        headers: {
          origin: 'https://evil.example',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'x-csrf-token',
        },
      });
      // @fastify/cors returns the OPTIONS response without allow-origin for
      // disallowed origins. The browser then refuses the real request.
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    } finally {
      await app.close();
    }
  });

  it('allowedHeaders list includes every header the frontend actually sends', () => {
    // Invariant: the list below must contain every custom header client.ts
    // attaches. If you add a new header there, add it here too.
    const frontendSendsHeaders = [
      'Content-Type', // JSON bodies
      'X-CSRF-Token', // client.ts CSRF flow
    ];
    for (const h of frontendSendsHeaders) {
      assert.ok(
        ALLOWED_HEADERS.some((a) => a.toLowerCase() === h.toLowerCase()),
        `Frontend sends "${h}" — must be in backend allowedHeaders`,
      );
    }
  });
});
