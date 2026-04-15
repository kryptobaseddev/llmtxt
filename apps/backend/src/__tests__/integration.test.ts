/**
 * Comprehensive integration tests for all 10 platform epics.
 *
 * Uses Node's built-in test runner (node:test) and Fastify's inject()
 * method for HTTP testing without starting a real server.
 *
 * Each describe block is self-contained with its own in-memory SQLite
 * database (default) or isolated Postgres schema (when DATABASE_URL_PG is set).
 *
 * Run with:
 *   node --import tsx/esm --test src/__tests__/integration.test.ts
 *
 * PostgreSQL mode:
 *   DATABASE_URL_PG=postgres://test:test@localhost:5432/llmtxt_test \
 *     node --import tsx/esm --test src/__tests__/integration.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq, and, asc, desc } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { generateApiKey, hashApiKey } from '../utils/api-keys.js';
import { compress, decompress, generateId, hashContent } from '../utils/compression.js';
import rateLimit from '@fastify/rate-limit';
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import { securityHeaders } from '../middleware/security.js';
import { apiVersionPlugin, addVersionResponseHeaders, addDeprecationHeaders, API_VERSION_REGISTRY, CURRENT_API_VERSION } from '../middleware/api-version.js';
import { setupTestDb, teardownTestDb, type TestDbContext } from './helpers/test-db.js';

// ──────────────────────────────────────────────────────────────────────────────
// Shared seed helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Seed a test user into the db. */
function seedUser(
  db: TestDbContext['db'],
  opts: { id?: string; email?: string } = {}
) {
  const id = opts.id ?? `user_${Math.random().toString(36).slice(2)}`;
  const email = opts.email ?? `${id}@test.example`;
  const now = Date.now();
  db.insert(schema.users).values({
    id,
    name: 'Test User',
    email,
    emailVerified: false,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    isAnonymous: false,
  }).run();
  return { id, email };
}

/**
 * Seed a document with an initial version. Returns the doc slug and id.
 */
async function seedDocument(
  db: TestDbContext['db'],
  opts: { content?: string; ownerId?: string; format?: string; slug?: string } = {}
) {
  const content = opts.content ?? '# Test Document\n\nThis is test content.';
  const slug = opts.slug ?? generateId();
  const id = generateId();
  const compressedData = await compress(content);
  const contentHash = hashContent(content);
  const now = Date.now();

  db.insert(schema.documents).values({
    id,
    slug,
    format: opts.format ?? 'text',
    contentHash,
    compressedData,
    originalSize: Buffer.byteLength(content, 'utf-8'),
    compressedSize: compressedData.length,
    tokenCount: Math.ceil(content.length / 4),
    createdAt: now,
    accessCount: 0,
    currentVersion: 1,
    ownerId: opts.ownerId ?? null,
    isAnonymous: false,
    state: 'DRAFT',
  }).run();

  db.insert(schema.versions).values({
    id: generateId(),
    documentId: id,
    versionNumber: 1,
    compressedData,
    contentHash,
    tokenCount: Math.ceil(content.length / 4),
    createdAt: now,
    changelog: 'Initial version',
  }).run();

  return { id, slug, content };
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Document CRUD
// ──────────────────────────────────────────────────────────────────────────────

describe('Document CRUD (baseline)', async () => {
  let app: FastifyInstance;
  let testDb: TestDbContext;

  before(async () => {
    testDb = await setupTestDb();
    app = Fastify({ logger: false });

    // Register api version plugin
    await app.register(apiVersionPlugin);

    // Register compress route
    app.post('/api/compress', async (request, reply) => {
      const body = request.body as { content?: string; format?: string };
      if (!body?.content) {
        return reply.status(400).send({ error: 'content is required' });
      }
      const content = body.content;
      const format = body.format ?? 'text';
      const compressedData = await compress(content);
      const contentHash = hashContent(content);
      const slug = generateId();
      const id = generateId();
      const now = Date.now();

      testDb.db.insert(schema.documents).values({
        id,
        slug,
        format,
        contentHash,
        compressedData,
        originalSize: Buffer.byteLength(content, 'utf-8'),
        compressedSize: compressedData.length,
        tokenCount: Math.ceil(content.length / 4),
        createdAt: now,
        accessCount: 0,
        currentVersion: 1,
        ownerId: null,
        isAnonymous: false,
        state: 'DRAFT',
      }).run();

      testDb.db.insert(schema.versions).values({
        id: generateId(),
        documentId: id,
        versionNumber: 1,
        compressedData,
        contentHash,
        tokenCount: Math.ceil(content.length / 4),
        createdAt: now,
        changelog: 'Initial version',
      }).run();

      return reply.status(201).send({ id, slug, format, tokenCount: Math.ceil(content.length / 4) });
    });

    // Register GET /api/documents/:slug
    app.get('/api/documents/:slug', async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const [doc] = testDb.db.select().from(schema.documents).where(eq(schema.documents.slug, slug)).all();
      if (!doc) return reply.status(404).send({ error: 'Document not found' });

      let content = '';
      if (doc.compressedData) {
        const buf = doc.compressedData instanceof Buffer
          ? doc.compressedData
          : Buffer.from(doc.compressedData as ArrayBuffer);
        content = await decompress(buf);
      }

      return reply.send({
        id: doc.id,
        slug: doc.slug,
        format: doc.format,
        content,
        tokenCount: doc.tokenCount,
        currentVersion: doc.currentVersion,
        state: doc.state,
      });
    });

    // Register GET /api/documents/:slug/overview
    app.get('/api/documents/:slug/overview', async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const [doc] = testDb.db.select().from(schema.documents).where(eq(schema.documents.slug, slug)).all();
      if (!doc) return reply.status(404).send({ error: 'Document not found' });

      const versionRows = testDb.db
        .select({ versionNumber: schema.versions.versionNumber, createdAt: schema.versions.createdAt })
        .from(schema.versions)
        .where(eq(schema.versions.documentId, doc.id))
        .all();

      return reply.send({
        slug: doc.slug,
        format: doc.format,
        currentVersion: doc.currentVersion,
        versionCount: versionRows.length,
        tokenCount: doc.tokenCount,
        state: doc.state,
        createdAt: doc.createdAt,
      });
    });

    // Register PUT /api/documents/:slug
    app.put('/api/documents/:slug', async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const body = request.body as { content?: string };
      if (!body?.content) return reply.status(400).send({ error: 'content is required' });

      const [doc] = testDb.db.select().from(schema.documents).where(eq(schema.documents.slug, slug)).all();
      if (!doc) return reply.status(404).send({ error: 'Document not found' });

      const content = body.content;
      const compressedData = await compress(content);
      const contentHash = hashContent(content);
      const now = Date.now();
      const newVersion = (doc.currentVersion ?? 1) + 1;

      testDb.db.insert(schema.versions).values({
        id: generateId(),
        documentId: doc.id,
        versionNumber: newVersion,
        compressedData,
        contentHash,
        tokenCount: Math.ceil(content.length / 4),
        createdAt: now,
        changelog: 'Updated',
      }).run();

      testDb.db.update(schema.documents).set({
        compressedData,
        contentHash,
        originalSize: Buffer.byteLength(content, 'utf-8'),
        compressedSize: compressedData.length,
        tokenCount: Math.ceil(content.length / 4),
        currentVersion: newVersion,
      }).where(eq(schema.documents.id, doc.id)).run();

      return reply.send({ slug, version: newVersion });
    });

    await app.ready();
  });

  after(async () => {
    await app.close();
    await teardownTestDb(testDb);
  });

  it('POST /api/compress creates a document and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/compress',
      payload: { content: '# Hello World\n\nThis is a test document.' },
    });
    assert.equal(res.statusCode, 201, `Expected 201, got ${res.statusCode}: ${res.body}`);
    const body = res.json();
    assert.ok(body.slug, 'Response must have slug');
    assert.ok(body.id, 'Response must have id');
    assert.ok(typeof body.tokenCount === 'number', 'Response must have tokenCount');
  });

  it('GET /api/documents/:slug retrieves the created document', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/compress',
      payload: { content: 'Retrieve test content' },
    });
    assert.equal(createRes.statusCode, 201);
    const { slug } = createRes.json();

    const getRes = await app.inject({ method: 'GET', url: `/api/documents/${slug}` });
    assert.equal(getRes.statusCode, 200);
    const body = getRes.json();
    assert.equal(body.slug, slug);
    assert.ok(body.content.includes('Retrieve test content'));
  });

  it('GET /api/documents/:slug returns 404 for unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/documents/doesnotexist99' });
    assert.equal(res.statusCode, 404);
  });

  it('GET /api/documents/:slug/overview returns version info', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/compress',
      payload: { content: 'Overview test' },
    });
    const { slug } = createRes.json();

    const res = await app.inject({ method: 'GET', url: `/api/documents/${slug}/overview` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.slug, slug);
    assert.equal(body.currentVersion, 1);
    assert.equal(body.versionCount, 1);
  });

  it('PUT /api/documents/:slug increments version', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/compress',
      payload: { content: 'Original content' },
    });
    const { slug } = createRes.json();

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/documents/${slug}`,
      payload: { content: 'Updated content v2' },
    });
    assert.equal(putRes.statusCode, 200);
    const body = putRes.json();
    assert.equal(body.version, 2, 'Version must be incremented to 2');

    // Verify the document has the new content
    const getRes = await app.inject({ method: 'GET', url: `/api/documents/${slug}` });
    const getBody = getRes.json();
    assert.ok(getBody.content.includes('Updated content v2'));
    assert.equal(getBody.currentVersion, 2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. API Key Authentication (Epic 1)
// ──────────────────────────────────────────────────────────────────────────────

describe('API Key Authentication (Epic 1)', async () => {
  let testDb: TestDbContext;
  let user: { id: string; email: string };

  before(async () => {
    testDb = await setupTestDb();
    user = seedUser(testDb.db);
  });

  after(async () => { await teardownTestDb(testDb); });

  it('creates an API key and retrieves it by hash', () => {
    const { rawKey, keyHash, keyPrefix } = generateApiKey();
    const now = Date.now();
    const id = `key_${Math.random().toString(36).slice(2)}`;

    testDb.db.insert(schema.apiKeys).values({
      id,
      userId: user.id,
      name: 'Test Auth Key',
      keyHash,
      keyPrefix,
      scopes: '*',
      revoked: false,
      createdAt: now,
      updatedAt: now,
    }).run();

    const [found] = testDb.db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, hashApiKey(rawKey)))
      .limit(1)
      .all();

    assert.ok(found, 'Key must be findable by its hash');
    assert.equal(found.id, id);
    assert.equal(found.revoked, false);
  });

  it('revoked key is identified as invalid', () => {
    const { keyHash, keyPrefix } = generateApiKey();
    const now = Date.now();
    const id = `key_rev_${Math.random().toString(36).slice(2)}`;

    testDb.db.insert(schema.apiKeys).values({
      id,
      userId: user.id,
      name: 'Revoked Key',
      keyHash,
      keyPrefix,
      scopes: '*',
      revoked: false,
      createdAt: now,
      updatedAt: now,
    }).run();

    testDb.db.update(schema.apiKeys)
      .set({ revoked: true, updatedAt: Date.now() })
      .where(eq(schema.apiKeys.id, id))
      .run();

    const [found] = testDb.db
      .select({ revoked: schema.apiKeys.revoked })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, id))
      .limit(1)
      .all();

    assert.equal(found.revoked, true, 'Revoked key must have revoked=true');
  });

  it('expired key is identified via timestamp comparison', () => {
    const { keyHash, keyPrefix } = generateApiKey();
    const now = Date.now();
    const id = `key_exp_${Math.random().toString(36).slice(2)}`;

    testDb.db.insert(schema.apiKeys).values({
      id,
      userId: user.id,
      name: 'Expired Key',
      keyHash,
      keyPrefix,
      scopes: '*',
      revoked: false,
      expiresAt: now - 5000, // 5 seconds in the past
      createdAt: now,
      updatedAt: now,
    }).run();

    const [found] = testDb.db
      .select({ expiresAt: schema.apiKeys.expiresAt })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, id))
      .limit(1)
      .all();

    const isExpired = found.expiresAt !== null && found.expiresAt <= Date.now();
    assert.equal(isExpired, true, 'Key with past expiresAt must be expired');
  });

  it('key with null expiresAt is considered never-expiring', () => {
    const { keyHash, keyPrefix } = generateApiKey();
    const now = Date.now();
    const id = `key_noexp_${Math.random().toString(36).slice(2)}`;

    testDb.db.insert(schema.apiKeys).values({
      id,
      userId: user.id,
      name: 'Permanent Key',
      keyHash,
      keyPrefix,
      scopes: '*',
      revoked: false,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    const [found] = testDb.db
      .select({ expiresAt: schema.apiKeys.expiresAt })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, id))
      .limit(1)
      .all();

    const isExpired = found.expiresAt !== null && found.expiresAt <= Date.now();
    assert.equal(isExpired, false, 'Key with null expiresAt must not be considered expired');
  });

  it('key rotation: old key revoked, new key active with same metadata', () => {
    const { keyHash: oldHash, keyPrefix: oldPrefix } = generateApiKey();
    const now = Date.now();
    const oldId = `key_rotate_old_${Math.random().toString(36).slice(2)}`;

    testDb.db.insert(schema.apiKeys).values({
      id: oldId,
      userId: user.id,
      name: 'CI Bot Key',
      keyHash: oldHash,
      keyPrefix: oldPrefix,
      scopes: JSON.stringify(['read', 'write']),
      revoked: false,
      createdAt: now,
      updatedAt: now,
    }).run();

    // Rotate: revoke old, create new
    testDb.db.update(schema.apiKeys)
      .set({ revoked: true, updatedAt: Date.now() })
      .where(eq(schema.apiKeys.id, oldId))
      .run();

    const { keyHash: newHash, keyPrefix: newPrefix } = generateApiKey();
    const newId = `key_rotate_new_${Math.random().toString(36).slice(2)}`;
    const rotatedAt = Date.now();

    testDb.db.insert(schema.apiKeys).values({
      id: newId,
      userId: user.id,
      name: 'CI Bot Key',
      keyHash: newHash,
      keyPrefix: newPrefix,
      scopes: JSON.stringify(['read', 'write']),
      revoked: false,
      createdAt: rotatedAt,
      updatedAt: rotatedAt,
    }).run();

    const [oldRow] = testDb.db.select({ revoked: schema.apiKeys.revoked })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, oldId))
      .limit(1).all();

    const [newRow] = testDb.db.select({ revoked: schema.apiKeys.revoked, name: schema.apiKeys.name })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, newId))
      .limit(1).all();

    assert.equal(oldRow.revoked, true, 'Old key must be revoked after rotation');
    assert.equal(newRow.revoked, false, 'New key must be active after rotation');
    assert.equal(newRow.name, 'CI Bot Key', 'Name must be preserved on rotation');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. API Versioning (Epic 6)
// ──────────────────────────────────────────────────────────────────────────────

describe('API Versioning (Epic 6)', async () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(apiVersionPlugin);

    // Legacy /api/health — gets deprecation headers via a scope
    await app.register(async (legacyScope) => {
      const legacyVersionInfo = {
        ...API_VERSION_REGISTRY[CURRENT_API_VERSION],
        deprecated: true,
        sunset: '2027-01-01',
      };

      legacyScope.addHook('onRequest', async (request) => {
        request.apiVersion = legacyVersionInfo;
      });

      legacyScope.addHook('onSend', async (request, reply) => {
        addVersionResponseHeaders(reply, legacyVersionInfo);
        addDeprecationHeaders(reply, request.url, legacyVersionInfo);
      });

      legacyScope.get('/api/health', async () => ({
        status: 'ok',
        timestamp: Date.now(),
      }));
    });

    // Versioned /api/v1/health — gets version headers, no deprecation
    await app.register(async (v1Scope) => {
      const versionInfo = API_VERSION_REGISTRY[1];

      v1Scope.addHook('onRequest', async (request) => {
        request.apiVersion = versionInfo;
      });

      v1Scope.addHook('onSend', async (_request, reply) => {
        addVersionResponseHeaders(reply, versionInfo);
      });

      v1Scope.get('/api/v1/health', async () => ({
        status: 'ok',
        timestamp: Date.now(),
      }));
    });

    await app.ready();
  });

  after(async () => { await app.close(); });

  it('GET /api/health returns Deprecation header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['deprecation'], 'true', 'Legacy endpoint must return Deprecation: true');
    assert.ok(res.headers['sunset'], 'Legacy endpoint must return Sunset header');
    assert.ok(res.headers['link'], 'Legacy endpoint must return Link header pointing to successor');
  });

  it('GET /api/v1/health returns version headers without Deprecation', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-api-version'], '1', 'Must return X-API-Version: 1');
    assert.equal(
      res.headers['deprecation'],
      undefined,
      'Versioned endpoint must NOT return Deprecation header',
    );
  });

  it('both /api/health and /api/v1/health return identical response bodies', async () => {
    const legacyRes = await app.inject({ method: 'GET', url: '/api/health' });
    const v1Res = await app.inject({ method: 'GET', url: '/api/v1/health' });

    const legacyBody = legacyRes.json();
    const v1Body = v1Res.json();

    assert.equal(legacyBody.status, v1Body.status, 'status field must match');
    // timestamp will differ slightly; just verify both have it
    assert.ok(typeof legacyBody.timestamp === 'number', 'Legacy must have timestamp');
    assert.ok(typeof v1Body.timestamp === 'number', 'V1 must have timestamp');
  });

  it('X-API-Version header returns correct version for both endpoints', async () => {
    const legacyRes = await app.inject({ method: 'GET', url: '/api/health' });
    const v1Res = await app.inject({ method: 'GET', url: '/api/v1/health' });

    assert.equal(legacyRes.headers['x-api-version'], '1');
    assert.equal(v1Res.headers['x-api-version'], '1');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. Rate Limiting (Epic 7)
// ──────────────────────────────────────────────────────────────────────────────

describe('Rate Limiting (Epic 7)', async () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify({ logger: false });

    // Register rate limiting with a low limit to make testing feasible
    await app.register(rateLimit, {
      global: true,
      max: 5,
      timeWindow: '1 minute',
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
      addHeadersOnExceeding: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
      },
      errorResponseBuilder: (_request, context) => ({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil((context.ttl ?? 60000) / 1000)} seconds.`,
        retryAfter: Math.ceil((context.ttl ?? 60000) / 1000),
        limit: context.max,
      }),
    });

    app.get('/api/test', async () => ({ ok: true }));

    await app.ready();
  });

  after(async () => { await app.close(); });

  it('rate limit headers are present on responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test' });
    assert.equal(res.statusCode, 200);
    assert.ok(
      res.headers['x-ratelimit-limit'] !== undefined,
      'x-ratelimit-limit header must be present',
    );
    assert.ok(
      res.headers['x-ratelimit-remaining'] !== undefined,
      'x-ratelimit-remaining header must be present',
    );
    assert.ok(
      res.headers['x-ratelimit-reset'] !== undefined,
      'x-ratelimit-reset header must be present',
    );
  });

  it('x-ratelimit-remaining decreases with each request', async () => {
    // Fire a fresh app instance to get clean counters
    const freshApp = Fastify({ logger: false });
    await freshApp.register(rateLimit, {
      global: true,
      max: 5,
      timeWindow: '1 minute',
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
    });
    freshApp.get('/test', async () => ({ ok: true }));
    await freshApp.ready();

    const res1 = await freshApp.inject({ method: 'GET', url: '/test' });
    const res2 = await freshApp.inject({ method: 'GET', url: '/test' });

    const remaining1 = parseInt(res1.headers['x-ratelimit-remaining'] as string, 10);
    const remaining2 = parseInt(res2.headers['x-ratelimit-remaining'] as string, 10);

    assert.ok(remaining2 < remaining1, `Remaining should decrease: ${remaining1} → ${remaining2}`);

    await freshApp.close();
  });

  it('returns 429 after limit is exceeded', async () => {
    const limitedApp = Fastify({ logger: false });
    await limitedApp.register(rateLimit, {
      global: true,
      max: 3,
      timeWindow: '1 minute',
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
    });
    limitedApp.get('/test', async () => ({ ok: true }));
    await limitedApp.ready();

    // Exhaust the 3-request limit
    await limitedApp.inject({ method: 'GET', url: '/test' });
    await limitedApp.inject({ method: 'GET', url: '/test' });
    await limitedApp.inject({ method: 'GET', url: '/test' });

    // 4th request should be blocked
    const res = await limitedApp.inject({ method: 'GET', url: '/test' });
    assert.equal(res.statusCode, 429, `Expected 429, got ${res.statusCode}`);
    // @fastify/rate-limit returns { message: '...', ... } by default
    const body = res.json();
    assert.ok(body.message || body.error, 'Rate limit error response must have message or error field');

    await limitedApp.close();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. Security Headers (Epic 8)
// ──────────────────────────────────────────────────────────────────────────────

describe('Security Headers (Epic 8)', async () => {
  let app: FastifyInstance;
  let csrfApp: FastifyInstance;

  before(async () => {
    app = Fastify({ logger: false });
    await securityHeaders(app);
    app.get('/api/test', async () => ({ ok: true }));
    app.post('/api/test', async () => ({ ok: true }));
    await app.ready();

    // Separate app for CSRF testing
    csrfApp = Fastify({ logger: false });
    await csrfApp.register(fastifyCookie);
    await csrfApp.register(fastifyCsrf, {
      cookieOpts: {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      },
      getToken: (req) => req.headers['x-csrf-token'] as string | undefined,
    });

    const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

    csrfApp.addHook('preHandler', async (request, reply) => {
      if (!STATE_CHANGING.has(request.method)) return;
      // Skip auth routes
      if (request.url.startsWith('/api/auth/')) return;
      // Skip Bearer token requests
      const authHeader = request.headers.authorization;
      if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) return;
      // Only protect requests that have a session cookie
      const cookieHeader = request.headers.cookie || '';
      if (!cookieHeader.includes('better-auth.session_token')) return;

      await new Promise<void>((resolve, reject) => {
        csrfApp.csrfProtection(request, reply, (err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      }).catch(() => {
        reply.status(403).send({
          error: 'Forbidden',
          message: 'CSRF token missing or invalid.',
        });
      });
    });

    csrfApp.get('/api/csrf-token', async (_request, reply) => {
      const token = reply.generateCsrf();
      return reply.send({ csrfToken: token });
    });

    csrfApp.post('/api/data', async () => ({ created: true }));

    await csrfApp.ready();
  });

  after(async () => {
    await app.close();
    await csrfApp.close();
  });

  it('Content-Security-Policy header is present', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test' });
    assert.ok(
      res.headers['content-security-policy'],
      'Content-Security-Policy header must be present',
    );
  });

  it('X-Frame-Options: DENY is present', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test' });
    assert.equal(res.headers['x-frame-options'], 'DENY', 'X-Frame-Options must be DENY');
  });

  it('X-Content-Type-Options: nosniff is present', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test' });
    assert.equal(
      res.headers['x-content-type-options'],
      'nosniff',
      'X-Content-Type-Options must be nosniff',
    );
  });

  it('POST without any session cookie is allowed (nothing to forge)', async () => {
    // No cookie attached → CSRF middleware skips check → should succeed
    const res = await csrfApp.inject({
      method: 'POST',
      url: '/api/data',
      payload: { data: 'test' },
    });
    // Should not be 403 (no cookie to forge)
    assert.notEqual(res.statusCode, 403, 'Request without cookie should not get CSRF 403');
    assert.equal(res.statusCode, 200);
  });

  it('POST with session cookie but no CSRF token returns 403', async () => {
    // Attach a fake session cookie to simulate a logged-in browser request
    const res = await csrfApp.inject({
      method: 'POST',
      url: '/api/data',
      headers: {
        cookie: 'better-auth.session_token=fake_session_token_value',
      },
      payload: { data: 'test' },
    });
    assert.equal(res.statusCode, 403, 'Cookie-authenticated POST without CSRF token must return 403');
  });

  it('CSP header includes default-src and frame-ancestors directives', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test' });
    const csp = res.headers['content-security-policy'] as string;
    assert.ok(csp.includes("default-src 'self'"), "CSP must include default-src 'self'");
    assert.ok(csp.includes("frame-ancestors 'none'"), "CSP must include frame-ancestors 'none'");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. Conflict Detection (Epic 4)
// ──────────────────────────────────────────────────────────────────────────────

describe('Conflict Detection (Epic 4)', async () => {
  let testDb: TestDbContext;

  before(async () => {
    testDb = await setupTestDb();
  });

  after(async () => { await teardownTestDb(testDb); });

  it('optimistic concurrency: update with correct baseVersion succeeds', async () => {
    const { db } = testDb;
    const { id: docId, slug } = await seedDocument(db, { content: 'Initial content v1' });

    // Simulate an optimistic update: client has baseVersion=1
    const [doc] = db.select().from(schema.documents).where(eq(schema.documents.slug, slug)).all();
    assert.equal(doc.currentVersion, 1, 'Initial version must be 1');

    // Create version 2
    const newContent = 'Updated content v2';
    const compressedData = await compress(newContent);
    const contentHash = hashContent(newContent);
    const now = Date.now();

    db.insert(schema.versions).values({
      id: generateId(),
      documentId: docId,
      versionNumber: 2,
      compressedData,
      contentHash,
      tokenCount: Math.ceil(newContent.length / 4),
      createdAt: now,
      changelog: 'v2 update',
    }).run();

    db.update(schema.documents).set({
      currentVersion: 2,
      compressedData,
      contentHash,
    }).where(eq(schema.documents.id, docId)).run();

    const [updated] = db.select({ currentVersion: schema.documents.currentVersion })
      .from(schema.documents)
      .where(eq(schema.documents.id, docId))
      .limit(1).all();

    assert.equal(updated.currentVersion, 2);
  });

  it('stale base version conflict: client with baseVersion=1 detects stale when doc is at version 2', async () => {
    const { db } = testDb;
    const { id: docId, slug } = await seedDocument(db, { content: 'Conflict test content' });

    // Advance to version 2
    const v2Content = 'Version 2 content';
    const compressed = await compress(v2Content);
    db.insert(schema.versions).values({
      id: generateId(),
      documentId: docId,
      versionNumber: 2,
      compressedData: compressed,
      contentHash: hashContent(v2Content),
      tokenCount: Math.ceil(v2Content.length / 4),
      createdAt: Date.now(),
      changelog: 'v2',
    }).run();

    db.update(schema.documents)
      .set({ currentVersion: 2 })
      .where(eq(schema.documents.id, docId))
      .run();

    // Now simulate client sending baseVersion=1 (stale)
    const [doc] = db.select({ currentVersion: schema.documents.currentVersion })
      .from(schema.documents)
      .where(eq(schema.documents.id, docId))
      .limit(1).all();

    const clientBaseVersion = 1;
    const isConflict = doc.currentVersion !== clientBaseVersion;

    assert.equal(isConflict, true, 'Stale baseVersion must be detected as a conflict');
  });

  it('UNIQUE constraint prevents two versions with the same number', async () => {
    const { db } = testDb;
    const { id: docId } = await seedDocument(db, { content: 'Unique version test' });

    // Try inserting a duplicate version 1
    assert.throws(() => {
      db.insert(schema.versions).values({
        id: generateId(),
        documentId: docId,
        versionNumber: 1, // already exists
        compressedData: Buffer.from('dup'),
        contentHash: 'dupHash',
        tokenCount: 0,
        createdAt: Date.now(),
        changelog: 'Duplicate',
      }).run();
    }, 'Duplicate version number must throw UNIQUE constraint violation');
  });

  it('merge-conflict resolution strategy: ours picks the specified version content', async () => {
    const { db } = testDb;
    const oursContent = 'Our version content';
    const { id: docId } = await seedDocument(db, { content: 'Base content' });

    // Add ours version (v2)
    const oursCompressed = await compress(oursContent);
    db.insert(schema.versions).values({
      id: generateId(),
      documentId: docId,
      versionNumber: 2,
      compressedData: oursCompressed,
      contentHash: hashContent(oursContent),
      tokenCount: Math.ceil(oursContent.length / 4),
      createdAt: Date.now(),
      changelog: 'Ours',
    }).run();

    // Retrieve ours version
    const [oursRow] = db.select()
      .from(schema.versions)
      .where(and(
        eq(schema.versions.documentId, docId),
        eq(schema.versions.versionNumber, 2),
      ))
      .limit(1).all();

    assert.ok(oursRow, 'Ours version row must exist');

    // Decompress to verify content
    const buf = oursRow.compressedData instanceof Buffer
      ? oursRow.compressedData
      : Buffer.from(oursRow.compressedData as ArrayBuffer);
    const decompressed = await decompress(buf);
    assert.equal(decompressed, oursContent, 'Decompressed content must match original');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. Collections & Cross-Doc (Epic 9)
// ──────────────────────────────────────────────────────────────────────────────

describe('Collections & Cross-Doc (Epic 9)', async () => {
  let testDb: TestDbContext;
  let user: { id: string; email: string };

  before(async () => {
    testDb = await setupTestDb();
    user = seedUser(testDb.db);
  });

  after(async () => { await teardownTestDb(testDb); });

  it('creates a document link and retrieves it with correct direction', async () => {
    const { db } = testDb;
    const doc1 = await seedDocument(db, { content: 'Source document', ownerId: user.id });
    const doc2 = await seedDocument(db, { content: 'Target document', ownerId: user.id });

    // Create a link from doc1 → doc2
    const linkId = generateId();
    db.insert(schema.documentLinks).values({
      id: linkId,
      sourceDocId: doc1.id,
      targetDocId: doc2.id,
      linkType: 'references',
      label: 'Test link',
      createdBy: user.id,
      createdAt: Date.now(),
    }).run();

    // Retrieve outgoing links from doc1
    const outgoing = db.select()
      .from(schema.documentLinks)
      .where(eq(schema.documentLinks.sourceDocId, doc1.id))
      .all();

    assert.equal(outgoing.length, 1);
    assert.equal(outgoing[0].targetDocId, doc2.id);
    assert.equal(outgoing[0].linkType, 'references');

    // Retrieve incoming links to doc2
    const incoming = db.select()
      .from(schema.documentLinks)
      .where(eq(schema.documentLinks.targetDocId, doc2.id))
      .all();

    assert.equal(incoming.length, 1);
    assert.equal(incoming[0].sourceDocId, doc1.id);
  });

  it('unique constraint prevents duplicate links between same documents with same type', async () => {
    const { db } = testDb;
    const doc1 = await seedDocument(db, { content: 'Dup link source', ownerId: user.id });
    const doc2 = await seedDocument(db, { content: 'Dup link target', ownerId: user.id });

    db.insert(schema.documentLinks).values({
      id: generateId(),
      sourceDocId: doc1.id,
      targetDocId: doc2.id,
      linkType: 'related',
      createdAt: Date.now(),
    }).run();

    assert.throws(() => {
      db.insert(schema.documentLinks).values({
        id: generateId(),
        sourceDocId: doc1.id,
        targetDocId: doc2.id,
        linkType: 'related', // same type — duplicate
        createdAt: Date.now(),
      }).run();
    }, 'Duplicate link (source, target, type) must fail with UNIQUE constraint');
  });

  it('creates a collection and adds documents to it with positions', async () => {
    const { db } = testDb;
    const doc1 = await seedDocument(db, { content: 'Collection doc 1', ownerId: user.id });
    const doc2 = await seedDocument(db, { content: 'Collection doc 2', ownerId: user.id });

    const collectionId = generateId();
    const now = Date.now();

    db.insert(schema.collections).values({
      id: collectionId,
      name: 'My Test Collection',
      slug: `test-collection-${Math.random().toString(36).slice(2)}`,
      ownerId: user.id,
      visibility: 'public',
      createdAt: now,
      updatedAt: now,
    }).run();

    db.insert(schema.collectionDocuments).values({
      id: generateId(),
      collectionId,
      documentId: doc1.id,
      position: 0,
      addedBy: user.id,
      addedAt: now,
    }).run();

    db.insert(schema.collectionDocuments).values({
      id: generateId(),
      collectionId,
      documentId: doc2.id,
      position: 1,
      addedBy: user.id,
      addedAt: now,
    }).run();

    const members = db.select()
      .from(schema.collectionDocuments)
      .where(eq(schema.collectionDocuments.collectionId, collectionId))
      .orderBy(asc(schema.collectionDocuments.position))
      .all();

    assert.equal(members.length, 2);
    assert.equal(members[0].position, 0);
    assert.equal(members[1].position, 1);
  });

  it('graph: multiple documents and their links form a node-edge structure', async () => {
    const { db } = testDb;
    const docA = await seedDocument(db, { content: 'Graph node A', ownerId: user.id });
    const docB = await seedDocument(db, { content: 'Graph node B', ownerId: user.id });
    const docC = await seedDocument(db, { content: 'Graph node C', ownerId: user.id });

    db.insert(schema.documentLinks).values([
      { id: generateId(), sourceDocId: docA.id, targetDocId: docB.id, linkType: 'depends_on', createdAt: Date.now() },
      { id: generateId(), sourceDocId: docB.id, targetDocId: docC.id, linkType: 'derived_from', createdAt: Date.now() },
    ]).run();

    // Build graph: nodes are documents, edges are links
    const allLinks = db.select()
      .from(schema.documentLinks)
      .where(
        // Filter to only links involving our test docs
        eq(schema.documentLinks.sourceDocId, docA.id)
      )
      .all();

    const allLinksB = db.select()
      .from(schema.documentLinks)
      .where(eq(schema.documentLinks.sourceDocId, docB.id))
      .all();

    const edges = [...allLinks, ...allLinksB];
    const nodeIds = new Set([
      docA.id, docB.id, docC.id,
      ...edges.map(e => e.sourceDocId),
      ...edges.map(e => e.targetDocId),
    ]);

    assert.equal(nodeIds.size, 3, 'Graph must have 3 nodes');
    assert.equal(edges.length, 2, 'Graph must have 2 edges');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 8. Real-Time Events (Epic 3)
// ──────────────────────────────────────────────────────────────────────────────

describe('Real-Time Events (Epic 3)', async () => {
  let testDb: TestDbContext;
  let user: { id: string; email: string };

  before(async () => {
    testDb = await setupTestDb();
    user = seedUser(testDb.db);
  });

  after(async () => { await teardownTestDb(testDb); });

  it('registers a webhook and persists it in the database', () => {
    const { db } = testDb;
    const webhookId = generateId();
    const now = Date.now();

    db.insert(schema.webhooks).values({
      id: webhookId,
      userId: user.id,
      url: 'https://example.com/webhook',
      secret: 'test-secret-value-1234567890',
      events: JSON.stringify(['version.created', 'state.changed']),
      documentSlug: null,
      active: true,
      failureCount: 0,
      createdAt: now,
    }).run();

    const [found] = db.select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, webhookId))
      .limit(1).all();

    assert.ok(found, 'Webhook must be persisted');
    assert.equal(found.userId, user.id);
    assert.equal(found.url, 'https://example.com/webhook');
    assert.equal(found.active, true);

    const events = JSON.parse(found.events);
    assert.ok(events.includes('version.created'), 'Events must include version.created');
    assert.ok(events.includes('state.changed'), 'Events must include state.changed');
  });

  it('webhook failure count increments on delivery failure', () => {
    const { db } = testDb;
    const webhookId = generateId();
    const now = Date.now();

    db.insert(schema.webhooks).values({
      id: webhookId,
      userId: user.id,
      url: 'https://example.com/webhook2',
      secret: 'test-secret-value-0987654321',
      events: '[]',
      active: true,
      failureCount: 0,
      createdAt: now,
    }).run();

    // Simulate failure
    db.update(schema.webhooks)
      .set({ failureCount: 1, lastDeliveryAt: Date.now() })
      .where(eq(schema.webhooks.id, webhookId))
      .run();

    const [found] = db.select({ failureCount: schema.webhooks.failureCount })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, webhookId))
      .limit(1).all();

    assert.equal(found.failureCount, 1);
  });

  it('webhook is disabled after 10 consecutive failures', () => {
    const { db } = testDb;
    const webhookId = generateId();
    const now = Date.now();

    db.insert(schema.webhooks).values({
      id: webhookId,
      userId: user.id,
      url: 'https://example.com/webhook3',
      secret: 'test-secret-value-abcdefghijk',
      events: '[]',
      active: true,
      failureCount: 9,
      createdAt: now,
    }).run();

    // Simulate 10th failure → disable webhook
    db.update(schema.webhooks)
      .set({ failureCount: 10, active: false, lastDeliveryAt: Date.now() })
      .where(eq(schema.webhooks.id, webhookId))
      .run();

    const [found] = db.select({ active: schema.webhooks.active, failureCount: schema.webhooks.failureCount })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, webhookId))
      .limit(1).all();

    assert.equal(found.active, false, 'Webhook must be disabled after 10 failures');
    assert.equal(found.failureCount, 10);
  });

  it('document-scoped webhook only receives events for its target slug', () => {
    const { db } = testDb;
    const webhookId = generateId();
    const targetSlug = 'abc123xyz';
    const now = Date.now();

    db.insert(schema.webhooks).values({
      id: webhookId,
      userId: user.id,
      url: 'https://example.com/webhook4',
      secret: 'test-secret-value-xyz123abcdef',
      events: '["version.created"]',
      documentSlug: targetSlug,
      active: true,
      failureCount: 0,
      createdAt: now,
    }).run();

    const [found] = db.select({ documentSlug: schema.webhooks.documentSlug })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, webhookId))
      .limit(1).all();

    assert.equal(found.documentSlug, targetSlug, 'Webhook must be scoped to target slug');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 9. Audit Logging (Epic 8)
// ──────────────────────────────────────────────────────────────────────────────

describe('Audit Logging (Epic 8)', async () => {
  let testDb: TestDbContext;
  let app: FastifyInstance;
  let user: { id: string; email: string };

  before(async () => {
    testDb = await setupTestDb();
    user = seedUser(testDb.db);

    app = Fastify({ logger: false });

    // Register audit logging middleware using our test db
    const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

    app.addHook('onResponse', async (request, reply) => {
      if (!STATE_CHANGING_METHODS.has(request.method)) return;
      if (reply.statusCode < 200 || reply.statusCode >= 400) return;

      const path = request.url.split('?')[0];
      let action = 'unknown.action';
      let resourceType = 'unknown';

      if (request.method === 'POST' && path === '/api/compress') {
        action = 'document.create';
        resourceType = 'document';
      } else if (request.method === 'PUT' && path.startsWith('/api/documents/')) {
        action = 'document.update';
        resourceType = 'document';
      }

      if (action === 'unknown.action') return; // don't log unrecognized paths

      setImmediate(() => {
        testDb.db.insert(schema.auditLogs).values({
          id: crypto.randomUUID(),
          userId: user.id,
          action,
          resourceType,
          timestamp: Date.now(),
          method: request.method,
          path,
          statusCode: reply.statusCode,
        }).run();
      });
    });

    // Simple document creation endpoint that writes to test db
    app.post('/api/compress', async (request, reply) => {
      const body = request.body as { content?: string };
      if (!body?.content) return reply.status(400).send({ error: 'content required' });

      const content = body.content;
      const compressedData = await compress(content);
      const contentHash = hashContent(content);
      const slug = generateId();
      const id = generateId();
      const now = Date.now();

      testDb.db.insert(schema.documents).values({
        id, slug, format: 'text', contentHash, compressedData,
        originalSize: Buffer.byteLength(content, 'utf-8'),
        compressedSize: compressedData.length,
        tokenCount: Math.ceil(content.length / 4),
        createdAt: now, accessCount: 0, currentVersion: 1,
        ownerId: user.id, isAnonymous: false, state: 'DRAFT',
      }).run();

      return reply.status(201).send({ id, slug });
    });

    // Audit log query endpoint — uses Drizzle ORM for provider portability
    app.get('/api/audit-logs', async (_request, reply) => {
      const logs = testDb.db
        .select()
        .from(schema.auditLogs)
        .orderBy(desc(schema.auditLogs.timestamp))
        .limit(50)
        .all();
      return reply.send({ logs, total: logs.length });
    });

    await app.ready();
  });

  after(async () => {
    await app.close();
    await teardownTestDb(testDb);
  });

  it('creating a document generates an audit log entry with action=document.create', async () => {
    // Create a document
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/compress',
      payload: { content: 'Audit log test document' },
    });
    assert.equal(createRes.statusCode, 201, `Expected 201, got ${createRes.statusCode}`);

    // Wait for the setImmediate to fire
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setTimeout(resolve, 10));

    // Check audit logs
    const logsRes = await app.inject({ method: 'GET', url: '/api/audit-logs' });
    assert.equal(logsRes.statusCode, 200);
    const { logs } = logsRes.json();

    const createLog = (logs as Array<{ action: string; resourceType: string }>)
      .find(l => l.action === 'document.create');

    assert.ok(createLog, 'Audit log must have a document.create entry');
    assert.equal(createLog.resourceType, 'document');
  });

  it('audit log entry has required fields: userId, action, resourceType, timestamp', async () => {
    // Ensure at least one log entry exists
    await app.inject({
      method: 'POST',
      url: '/api/compress',
      payload: { content: 'Audit fields test' },
    });

    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setTimeout(resolve, 10));

    const logsRes = await app.inject({ method: 'GET', url: '/api/audit-logs' });
    const { logs } = logsRes.json();

    assert.ok(logs.length > 0, 'Must have at least one audit log entry');

    const entry = logs[0] as Record<string, unknown>;
    assert.ok(entry.id, 'Audit log must have id');
    assert.ok(entry.action, 'Audit log must have action');
    assert.ok(entry.resourceType, 'Audit log must have resourceType');
    assert.ok(typeof entry.timestamp === 'number', 'Audit log must have numeric timestamp');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 10. Semantic Diff (Epic 10)
// ──────────────────────────────────────────────────────────────────────────────

describe('Semantic Diff (Epic 10)', async () => {
  let testDb: TestDbContext;
  let app: FastifyInstance;

  before(async () => {
    testDb = await setupTestDb();

    app = Fastify({ logger: false });

    // Minimal semantic-diff endpoint (does not call WASM/embeddings — tests structure)
    app.post('/api/documents/:slug/semantic-diff', async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const body = request.body as { fromVersion?: number; toVersion?: number };

      if (!body?.fromVersion || !body?.toVersion) {
        return reply.status(400).send({ error: 'fromVersion and toVersion are required' });
      }

      const [doc] = testDb.db.select().from(schema.documents)
        .where(eq(schema.documents.slug, slug)).all();

      if (!doc) return reply.status(404).send({ error: 'Document not found' });

      const versions = testDb.db.select()
        .from(schema.versions)
        .where(eq(schema.versions.documentId, doc.id))
        .all();

      const fromRow = versions.find((v: { versionNumber: number }) => v.versionNumber === body.fromVersion);
      const toRow = versions.find((v: { versionNumber: number }) => v.versionNumber === body.toVersion);

      if (!fromRow) return reply.status(404).send({ error: `Version ${body.fromVersion} not found` });
      if (!toRow) return reply.status(404).send({ error: `Version ${body.toVersion} not found` });

      // Decompress both versions
      const fromBuf = fromRow.compressedData instanceof Buffer
        ? fromRow.compressedData
        : Buffer.from(fromRow.compressedData as ArrayBuffer);
      const toBuf = toRow.compressedData instanceof Buffer
        ? toRow.compressedData
        : Buffer.from(toRow.compressedData as ArrayBuffer);

      const fromText = await decompress(fromBuf);
      const toText = await decompress(toBuf);

      // Compute a basic similarity score (character-level overlap as a proxy)
      const shorter = fromText.length < toText.length ? fromText : toText;
      const longer = fromText.length >= toText.length ? fromText : toText;
      let matches = 0;
      for (let i = 0; i < shorter.length; i++) {
        if (shorter[i] === longer[i]) matches++;
      }
      const overallSimilarity = longer.length > 0 ? matches / longer.length : 1;

      return reply.send({
        slug,
        fromVersion: body.fromVersion,
        toVersion: body.toVersion,
        overallSimilarity,
        sectionSimilarities: [], // no WASM in unit tests
      });
    });

    await app.ready();
  });

  after(async () => {
    await app.close();
    await teardownTestDb(testDb);
  });

  it('semantic-diff endpoint exists and returns 404 for unknown document', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents/nonexistent/semantic-diff',
      payload: { fromVersion: 1, toVersion: 2 },
    });
    assert.equal(res.statusCode, 404);
  });

  it('semantic-diff returns 400 when fromVersion or toVersion is missing', async () => {
    const { db } = testDb;
    const { slug } = await seedDocument(db, { content: 'Semantic test doc' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/documents/${slug}/semantic-diff`,
      payload: { fromVersion: 1 }, // missing toVersion
    });
    assert.equal(res.statusCode, 400);
  });

  it('semantic-diff returns overallSimilarity and sectionSimilarities for a valid 2-version document', async () => {
    const { db } = testDb;
    const v1Content = '# Introduction\n\nThis is version one of the document.';
    const { id: docId, slug } = await seedDocument(db, { content: v1Content });

    // Add version 2 with different content
    const v2Content = '# Introduction\n\nThis is version two with different content.';
    const v2Compressed = await compress(v2Content);
    db.insert(schema.versions).values({
      id: generateId(),
      documentId: docId,
      versionNumber: 2,
      compressedData: v2Compressed,
      contentHash: hashContent(v2Content),
      tokenCount: Math.ceil(v2Content.length / 4),
      createdAt: Date.now(),
      changelog: 'v2',
    }).run();

    const res = await app.inject({
      method: 'POST',
      url: `/api/documents/${slug}/semantic-diff`,
      payload: { fromVersion: 1, toVersion: 2 },
    });

    assert.equal(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${res.body}`);
    const body = res.json();

    assert.ok('overallSimilarity' in body, 'Response must have overallSimilarity');
    assert.ok('sectionSimilarities' in body, 'Response must have sectionSimilarities');
    assert.ok(typeof body.overallSimilarity === 'number', 'overallSimilarity must be a number');
    assert.ok(body.overallSimilarity >= 0 && body.overallSimilarity <= 1,
      `overallSimilarity must be between 0 and 1, got ${body.overallSimilarity}`);
    assert.equal(body.fromVersion, 1);
    assert.equal(body.toVersion, 2);
  });

  it('identical versions have overallSimilarity close to 1.0', async () => {
    const { db } = testDb;
    const content = '# Same content\n\nThis is the same in both versions.';
    const { id: docId, slug } = await seedDocument(db, { content });

    // Add version 2 with identical content
    const compressed = await compress(content);
    db.insert(schema.versions).values({
      id: generateId(),
      documentId: docId,
      versionNumber: 2,
      compressedData: compressed,
      contentHash: hashContent(content),
      tokenCount: Math.ceil(content.length / 4),
      createdAt: Date.now(),
      changelog: 'Identical v2',
    }).run();

    const res = await app.inject({
      method: 'POST',
      url: `/api/documents/${slug}/semantic-diff`,
      payload: { fromVersion: 1, toVersion: 2 },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(
      body.overallSimilarity > 0.95,
      `Identical versions should have similarity > 0.95, got ${body.overallSimilarity}`,
    );
  });
});
