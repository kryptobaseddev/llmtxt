/**
 * Unit tests for the API client's CSRF protection (T850).
 *
 * The Fastify backend rejects cookie-authenticated state-changing requests
 * (POST/PUT/PATCH/DELETE) with `FST_CSRF_MISSING_SECRET` when the
 * `x-csrf-token` header is missing. The client must:
 *   - Lazily fetch GET /api/csrf-token on first state-changing call.
 *   - Cache the token across subsequent calls (single-flight under load).
 *   - Skip the CSRF dance for GET requests and for `/auth/*` (better-auth
 *     manages its own CSRF).
 *   - Retry once on a CSRF-shaped 403 with a fresh token.
 *
 * Run with:
 *   node --import tsx/esm --test src/__tests__/csrf-client.test.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Force a deterministic API_BASE before importing the client so test
// assertions can match on URL substrings.
process.env.VITE_API_BASE = 'https://test-api.example';

const { api, __resetCsrfCacheForTesting } = await import('../lib/api/client.js');

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

interface MockResponse {
  status?: number;
  ok?: boolean;
  body?: unknown;
}

let calls: RecordedCall[] = [];
let responses: MockResponse[] = [];
const realFetch = globalThis.fetch;

function makeResponse(spec: MockResponse): Response {
  const status = spec.status ?? 200;
  const ok = spec.ok ?? (status >= 200 && status < 300);
  const bodyText = JSON.stringify(spec.body ?? {});
  const headers = new Headers({ 'content-type': 'application/json' });
  // Construct a Response-shaped object with the methods the client uses.
  return {
    status,
    ok,
    statusText: ok ? 'OK' : 'Error',
    headers,
    json: async () => spec.body ?? {},
    text: async () => bodyText,
    clone() {
      return makeResponse(spec);
    },
  } as unknown as Response;
}

function installFetchMock() {
  calls = [];
  // Default to single OK response if no responses queued.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v;
    }
    calls.push({ url, method, headers, body: init?.body });
    const next = responses.shift();
    return next ? makeResponse(next) : makeResponse({ status: 200, body: {} });
  }) as typeof fetch;
}

beforeEach(() => {
  __resetCsrfCacheForTesting();
  responses = [];
  installFetchMock();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── GET requests never fetch CSRF token ────────────────────────────────────

describe('CSRF: safe methods', () => {
  it('GET request does not fetch /api/csrf-token and sends no x-csrf-token', async () => {
    responses = [{ status: 200, body: { id: 'doc-1' } }];
    await api.getDocument('doc-1');
    assert.equal(calls.length, 1, 'exactly one network call');
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, 'https://test-api.example/documents/doc-1');
    assert.equal(calls[0].headers['x-csrf-token'], undefined);
  });

  it('GET text endpoint also skips CSRF', async () => {
    responses = [{ status: 200, body: 'raw text' }];
    await api.getRawContent('doc-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers['x-csrf-token'], undefined);
  });
});

// ── State-changing methods fetch + attach CSRF ─────────────────────────────

describe('CSRF: state-changing methods', () => {
  it('POST /compress fetches /api/csrf-token first, then sends x-csrf-token', async () => {
    responses = [
      { status: 200, body: { csrfToken: 'tkn-abc' } }, // GET /api/csrf-token
      { status: 200, body: { slug: 'new-doc' } }, // POST /compress
    ];
    await api.createDocument('hello world');
    assert.equal(calls.length, 2, 'two calls: csrf-token then compress');
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, 'https://test-api.example/api/csrf-token');
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].url, 'https://test-api.example/compress');
    assert.equal(calls[1].headers['x-csrf-token'], 'tkn-abc');
    assert.equal(calls[1].headers['content-type'], 'application/json');
  });

  it('PUT /documents/{slug} attaches x-csrf-token', async () => {
    responses = [
      { status: 200, body: { csrfToken: 'tkn-put' } },
      { status: 200, body: { slug: 'doc-1', version: 2 } },
    ];
    await api.updateDocument('doc-1', 'updated', 'changelog');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, 'PUT');
    assert.equal(calls[1].headers['x-csrf-token'], 'tkn-put');
  });

  it('caches token: second POST reuses cached CSRF token (no second GET)', async () => {
    responses = [
      { status: 200, body: { csrfToken: 'tkn-cached' } },
      { status: 200, body: {} }, // first POST
      { status: 200, body: {} }, // second POST — no extra csrf fetch in between
    ];
    await api.createDocument('first');
    await api.createDocument('second');
    assert.equal(calls.length, 3, 'one csrf + two compress, NOT four');
    assert.equal(calls[1].headers['x-csrf-token'], 'tkn-cached');
    assert.equal(calls[2].headers['x-csrf-token'], 'tkn-cached');
  });

  it('single-flight: concurrent POSTs share one CSRF token fetch', async () => {
    responses = [
      { status: 200, body: { csrfToken: 'tkn-shared' } },
      { status: 200, body: {} },
      { status: 200, body: {} },
      { status: 200, body: {} },
    ];
    await Promise.all([
      api.createDocument('a'),
      api.createDocument('b'),
      api.createDocument('c'),
    ]);
    // 1 csrf-token GET + 3 POSTs = 4 calls, NOT 6 (which would mean each POST
    // triggered its own csrf-token fetch).
    assert.equal(calls.length, 4, 'one csrf fetch shared by three concurrent POSTs');
    const csrfFetches = calls.filter((c) => c.url.endsWith('/api/csrf-token'));
    assert.equal(csrfFetches.length, 1);
    const posts = calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 3);
    for (const p of posts) assert.equal(p.headers['x-csrf-token'], 'tkn-shared');
  });
});

// ── /auth/* paths are exempt ───────────────────────────────────────────────

describe('CSRF: /auth/* paths skip CSRF (better-auth handles it)', () => {
  it('signInAnonymous (POST /auth/sign-in/anonymous) makes no csrf-token fetch', async () => {
    responses = [{ status: 200, body: { user: { id: 'anon' } } }];
    await api.signInAnonymous();
    assert.equal(calls.length, 1, 'exactly one POST, no csrf detour');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'https://test-api.example/auth/sign-in/anonymous');
    assert.equal(calls[0].headers['x-csrf-token'], undefined);
  });

  it('signOut (POST /auth/sign-out) skips CSRF', async () => {
    responses = [{ status: 200, body: {} }];
    await api.signOut();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers['x-csrf-token'], undefined);
  });

  it('getSession (GET /auth/get-session) is a GET, never CSRF', async () => {
    responses = [{ status: 200, body: { session: null } }];
    await api.getSession();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].headers['x-csrf-token'], undefined);
  });
});

// ── Retry on stale CSRF (FST_CSRF_MISSING_SECRET) ─────────────────────────

describe('CSRF: retry on stale token', () => {
  it('on FST_CSRF_MISSING_SECRET 403, refreshes token and retries once successfully', async () => {
    responses = [
      { status: 200, body: { csrfToken: 'tkn-stale' } }, // initial fetch
      {
        status: 403,
        body: { code: 'FST_CSRF_MISSING_SECRET', message: 'Missing csrf secret' },
      },
      { status: 200, body: { csrfToken: 'tkn-fresh' } }, // refresh
      { status: 200, body: { slug: 'ok' } }, // retried POST succeeds
    ];
    const result = await api.createDocument('content');
    assert.deepEqual(result, { slug: 'ok' });
    assert.equal(calls.length, 4);
    assert.equal(calls[1].headers['x-csrf-token'], 'tkn-stale');
    assert.equal(calls[3].headers['x-csrf-token'], 'tkn-fresh');
  });

  it('on retry that ALSO fails, surfaces the second 403 error message', async () => {
    responses = [
      { status: 200, body: { csrfToken: 'tkn1' } },
      {
        status: 403,
        body: { code: 'FST_CSRF_MISSING_SECRET', message: 'Missing csrf secret' },
      },
      { status: 200, body: { csrfToken: 'tkn2' } },
      {
        status: 403,
        body: { code: 'FST_CSRF_INVALID_TOKEN', message: 'Invalid csrf token' },
      },
    ];
    await assert.rejects(api.createDocument('x'), /Invalid csrf token/);
    assert.equal(calls.length, 4);
  });

  it('non-CSRF 403 (e.g., auth) is NOT retried — surfaces immediately', async () => {
    responses = [
      { status: 200, body: { csrfToken: 'tkn' } },
      {
        status: 403,
        body: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
      },
    ];
    await assert.rejects(api.createDocument('x'), /Insufficient permissions/);
    // Only 2 calls: csrf fetch + the failed POST. No retry, no extra csrf fetch.
    assert.equal(calls.length, 2);
  });
});

// ── Network resilience ─────────────────────────────────────────────────────

describe('CSRF: network resilience', () => {
  it('if csrf-token endpoint fails, POST proceeds without header (server will reject if it cares)', async () => {
    responses = [
      { status: 500, body: { error: 'csrf service down' } }, // csrf fetch fails
      { status: 200, body: { ok: true } }, // POST sent without header, server accepts
    ];
    await api.createDocument('content');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].headers['x-csrf-token'], undefined);
  });
});
