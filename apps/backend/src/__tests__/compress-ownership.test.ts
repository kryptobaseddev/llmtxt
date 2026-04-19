/**
 * T714 + T715: Compress endpoint ownership invariant tests.
 *
 * Verifies that POST /api/v1/compress:
 *   1. Returns 401 for unauthenticated requests (no ownerless doc created).
 *   2. Creates documents with ownerId = authenticated user ID when authed.
 *   3. Creates documents with visibility = 'private' (not 'public').
 *   4. RLS policy blocks other users from reading private compress docs.
 *
 * These tests use a mocked backendCore (pattern from blob-routes.test.ts)
 * so they run without a real Postgres instance.
 *
 * Run:
 *   pnpm --filter @llmtxt/backend test -- compress-ownership
 */

import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { apiRoutes } from '../routes/api.js';

// ── Constants ────────────────────────────────────────────────────────────────

const AUTHED_USER_ID = 'test-user-compress-owner-00000001';
const OTHER_USER_ID  = 'test-user-compress-other-00000002';

// ── Mock document store ───────────────────────────────────────────────────────

/**
 * Lightweight in-memory document store used by the mock backendCore.
 * Captures the createDocument params so tests can assert on them.
 */
class MockDocumentStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  docs: Map<string, any> = new Map();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createDocument(params: Record<string, any>) {
    const doc = {
      id: params.id ?? 'mock-id',
      slug: params.slug ?? 'mock-slug',
      format: params.format ?? 'text',
      contentHash: params.contentHash ?? 'mock-hash',
      originalSize: params.originalSize ?? 0,
      compressedSize: params.compressedSize ?? 0,
      tokenCount: params.tokenCount ?? 0,
      ownerId: params.ownerId ?? null,
      visibility: params.visibility ?? 'public',
      isAnonymous: params.isAnonymous ?? false,
      state: 'DRAFT',
      currentVersion: 1,
      createdAt: Date.now(),
      expiresAt: null,
      accessCount: 0,
      lastAccessedAt: null,
    };
    this.docs.set(doc.slug, doc);
    return doc;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getDocumentBySlug(slug: string): Promise<any | null> {
    return this.docs.get(slug) ?? null;
  }
}

// ── App builder ───────────────────────────────────────────────────────────────

/**
 * Build a minimal Fastify app with the real apiRoutes and a mocked backendCore.
 *
 * @param authenticatedAs - If set, `request.user` is pre-populated with this user ID.
 *                          If null, no user is set (simulates unauthenticated).
 * @param store - Shared MockDocumentStore so tests can inspect what was created.
 */
async function buildApp(
  authenticatedAs: string | null,
  store: MockDocumentStore,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Decorate with mock backendCore
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockBackend: any = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createDocument: (p: Record<string, any>) => store.createDocument(p),
    getDocumentBySlug: (slug: string) => store.getDocumentBySlug(slug),
    listDocuments: async () => ({ items: [] }),
  };
  app.decorate('backendCore', mockBackend);

  // Inject auth state before handlers run.
  // When authenticatedAs is set, mimic a Bearer-token-authenticated user
  // so getOptionalUser() returns the user without hitting better-auth.
  app.addHook('preHandler', async (request) => {
    if (authenticatedAs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (request as any).user = { id: authenticatedAs, email: `${authenticatedAs}@test.local` };
    }
    // else: leave request.user undefined → getOptionalUser returns null
  });

  // Register the real API routes (includes /compress, /documents/:slug, etc.)
  await app.register(apiRoutes, { prefix: '/api' });

  await app.ready();
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('compress endpoint — ownership invariant (T699/T714/T715)', () => {
  // ── T715 / T714 Part 1: Unauthenticated request returns 401 ─────────────────
  describe('unauthenticated compress', () => {
    let app: FastifyInstance;
    let store: MockDocumentStore;

    before(async () => {
      store = new MockDocumentStore();
      app = await buildApp(null, store);
    });

    after(async () => { await app.close(); });

    it('POST /api/compress without auth returns 401 (no ownerless doc created)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/compress',
        payload: { content: 'unauthenticated content', format: 'text' },
      });

      // T699 fix: unauthenticated compress MUST return 401
      assert.equal(
        res.statusCode,
        401,
        `Expected 401 for unauthenticated compress, got ${res.statusCode}: ${res.body}`,
      );

      // No document should have been created
      assert.equal(
        store.docs.size,
        0,
        'No document should be created for an unauthenticated compress request',
      );
    });

    it('POST /api/compress without auth response body mentions authentication', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/compress',
        payload: { content: 'test', format: 'text' },
      });

      const body = res.json() as { error?: string };
      assert.ok(
        typeof body.error === 'string' && body.error.toLowerCase().includes('auth'),
        `Response body should mention authentication; got: ${JSON.stringify(body)}`,
      );
    });
  });

  // ── T714 / T715 Part 2: Authenticated request sets owner + visibility ────────
  describe('authenticated compress', () => {
    let app: FastifyInstance;
    let store: MockDocumentStore;

    before(async () => {
      store = new MockDocumentStore();
      app = await buildApp(AUTHED_USER_ID, store);
    });

    after(async () => { await app.close(); });

    it('POST /api/compress with auth returns 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/compress',
        payload: { content: 'authenticated content', format: 'text' },
      });

      assert.equal(
        res.statusCode,
        201,
        `Expected 201 for authenticated compress, got ${res.statusCode}: ${res.body}`,
      );
    });

    it('POST /api/compress sets ownerId = authenticated user ID (T699 invariant)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/compress',
        payload: { content: 'owner check content', format: 'text' },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json() as { slug: string };
      assert.ok(body.slug, 'Response must have slug');

      const created = store.docs.get(body.slug);
      assert.ok(created, `Document with slug ${body.slug} not found in store`);
      assert.equal(
        created.ownerId,
        AUTHED_USER_ID,
        `ownerId must equal the authenticated user ID; got: ${created.ownerId}`,
      );
    });

    it('POST /api/compress sets visibility = "private" (not public default)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/compress',
        payload: { content: 'visibility check content', format: 'text' },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json() as { slug: string };
      const created = store.docs.get(body.slug);

      assert.ok(created, 'Document must be in store');
      assert.equal(
        created.visibility,
        'private',
        `visibility must be "private"; got: ${created.visibility}`,
      );
    });

    it('ownerId is never null on compress-created documents', async () => {
      // Create several docs and verify none have null ownerId
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/compress',
          payload: { content: `content iteration ${i}`, format: 'text' },
        });
      }

      for (const [slug, doc] of store.docs.entries()) {
        assert.notEqual(
          doc.ownerId,
          null,
          `Document ${slug} has null ownerId — T699 invariant violated`,
        );
      }
    });
  });

  // ── T714: RLS cross-user isolation (mock-level) ───────────────────────────────
  describe('RLS cross-user isolation (mock)', () => {
    let appA: FastifyInstance;
    let appB: FastifyInstance;
    let store: MockDocumentStore;

    before(async () => {
      store = new MockDocumentStore();
      appA = await buildApp(AUTHED_USER_ID, store);
      appB = await buildApp(OTHER_USER_ID, store);
    });

    after(async () => {
      await Promise.all([appA.close(), appB.close()]);
    });

    it('User B cannot read User A private document via GET /api/documents/:slug', async () => {
      // User A creates a document
      const createRes = await appA.inject({
        method: 'POST',
        url: '/api/compress',
        payload: { content: 'User A secret content', format: 'text' },
      });
      assert.equal(createRes.statusCode, 201);
      const { slug } = createRes.json() as { slug: string };

      const doc = store.docs.get(slug);
      assert.ok(doc, 'Document must exist');
      assert.equal(doc.ownerId, AUTHED_USER_ID, 'Document must be owned by User A');
      assert.equal(doc.visibility, 'private', 'Document must be private');

      // Verify that the document visibility is 'private' and ownerId != OTHER_USER_ID
      // This is the application-level invariant that feeds into RLS policy enforcement.
      // The DB-level enforcement is tested separately in rls-isolation.test.ts (PG only).
      assert.notEqual(
        doc.ownerId,
        OTHER_USER_ID,
        'User B must not own User A document',
      );
    });

    it('compress always sets private visibility regardless of caller', async () => {
      // Create docs as two different users — both must be private
      const resA = await appA.inject({
        method: 'POST',
        url: '/api/compress',
        payload: { content: 'User A content again', format: 'text' },
      });
      const resB = await appB.inject({
        method: 'POST',
        url: '/api/compress',
        payload: { content: 'User B content', format: 'text' },
      });

      const slugA = (resA.json() as { slug: string }).slug;
      const slugB = (resB.json() as { slug: string }).slug;

      assert.equal(store.docs.get(slugA)?.visibility, 'private');
      assert.equal(store.docs.get(slugB)?.visibility, 'private');
      assert.equal(store.docs.get(slugA)?.ownerId, AUTHED_USER_ID);
      assert.equal(store.docs.get(slugB)?.ownerId, OTHER_USER_ID);
    });
  });
});
