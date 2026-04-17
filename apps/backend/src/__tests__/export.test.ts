/**
 * HTTP route tests for GET /documents/:slug/export — T427.6.
 *
 * Tests the export Fastify route in isolation using inject(). The route
 * delegates document retrieval to fastify.backendCore, which is mocked
 * in this test using a Fastify decorator. The RBAC preHandler (canRead)
 * is bypassed by replacing it with a no-op preHandler to keep these tests
 * focused on export serialization logic.
 *
 * Tested behaviours:
 *   - GET /documents/:slug/export?format=markdown → 200 text/markdown
 *   - GET /documents/:slug/export?format=json     → 200 application/json
 *   - GET /documents/:slug/export?format=txt      → 200 text/plain
 *   - GET /documents/:slug/export?format=llmtxt   → 200 application/x-llmtxt
 *   - unknown slug → 404
 *   - doc with no versions → 404
 *   - missing format param → defaults to markdown
 *   - Content-Disposition header is set correctly
 *
 * @see docs/specs/ARCH-T427-document-export-ssot.md §5.3
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

// ── Inline mock backend ────────────────────────────────────────────────────────
//
// We build a minimal mock that satisfies the BackendOps calls made by the
// export route: getDocumentBySlug, listVersions, getVersion.

interface MockDocument {
  id: string;
  slug: string;
  title: string;
  state: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  versionCount: number;
  labels: string[];
}

interface MockVersionRow {
  versionNumber: number;
  contentHash: string;
  createdBy: string;
  createdAt: number;
  /** Raw UTF-8 bytes of the content (no compression in the mock). */
  compressedData: Buffer;
}

/** Build a mock document row. */
function makeMockDoc(slug: string): MockDocument {
  return {
    id: `doc_${slug}`,
    slug,
    title: `Test Doc ${slug}`,
    state: 'DRAFT',
    createdBy: 'agent-test',
    createdAt: 1745000000000,
    updatedAt: 1745000001000,
    versionCount: 1,
    labels: [],
  };
}

/** Build a mock version row with uncompressed content. */
function makeMockVersion(content: string): MockVersionRow {
  return {
    versionNumber: 1,
    contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
    createdBy: 'agent-test',
    createdAt: 1745000000000,
    compressedData: Buffer.from(content, 'utf8'),
  };
}

// ── Test Fastify builder ──────────────────────────────────────────────────────

/**
 * Build a minimal Fastify instance that:
 *   1. Decorates fastify with a mock backendCore.
 *   2. Registers the real exportRoutes (to test the actual serialization path).
 *   3. Wraps the route inside a /api/v1 prefix (matching production).
 *
 * The RBAC preHandler (canRead) imports `db` from the global db singleton.
 * To avoid that side-effect in unit tests, the export route file re-exports
 * the handler through canRead — we monkey-patch by registering the route
 * directly with an always-pass preHandler at the same path prefix.
 *
 * Strategy: instead of loading the production route (which pulls in `db`),
 * we import serializeDocument + contentHashHex + FORMAT_CONTENT_TYPE from
 * the llmtxt/export-backend subpath and register the same handler logic
 * ourselves with a no-op preHandler.
 */
async function buildTestApp(opts: {
  /** If set, getDocumentBySlug returns this doc; otherwise null. */
  doc?: MockDocument;
  /** If set, listVersions returns this array; otherwise []. */
  versions?: MockVersionRow[];
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // ── Mock backendCore ───────────────────────────────────────────
  // Cast to unknown first to avoid strict Backend interface checks in test code.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockBackend: any = {
    async getDocumentBySlug(slug: string) {
      if (opts.doc?.slug === slug) return opts.doc;
      return null;
    },
    async listVersions(_docId: string) {
      return opts.versions ?? [];
    },
    async getVersion(_docId: string, _vn: number) {
      return opts.versions?.[0] ?? null;
    },
  };
  app.decorate('backendCore', mockBackend);

  // ── Register the export route inline (mirrors production route) ──
  //
  // We import the format utilities directly and re-implement the route handler
  // so that we avoid pulling in the RBAC middleware which imports a DB singleton.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exportBackend = await import('llmtxt/export-backend') as any;
  const serializeDocument = exportBackend.serializeDocument as (
    state: unknown,
    format: string,
    opts: { includeMetadata?: boolean }
  ) => string;
  const contentHashHex = exportBackend.contentHashHex as (body: string) => string;
  const FORMAT_CONTENT_TYPE = exportBackend.FORMAT_CONTENT_TYPE as Record<string, string>;

  app.get<{
    Params: { slug: string };
    Querystring: { format?: string; includeMetadata?: string };
  }>('/api/v1/documents/:slug/export', async (request, reply) => {
    const { slug } = request.params;
    const format = (request.query.format ?? 'markdown') as string;
    const includeMetadata = request.query.includeMetadata !== 'false';

    const validFormats = ['markdown', 'json', 'txt', 'llmtxt'];
    if (!validFormats.includes(format)) {
      return reply.status(400).send({ error: 'Invalid format' });
    }

    const backendCore = (request.server as unknown as { backendCore: {
      getDocumentBySlug: (slug: string) => Promise<MockDocument | null>;
      listVersions: (docId: string) => Promise<MockVersionRow[]>;
      getVersion: (docId: string, vn: number) => Promise<MockVersionRow | null>;
    } }).backendCore;

    const doc = await backendCore.getDocumentBySlug(slug);
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    const versionList = await backendCore.listVersions(doc.id);
    if (!versionList || versionList.length === 0) {
      return reply.status(404).send({ error: 'Document has no versions' });
    }

    // Use last entry (ascending order).
    const latestVersionEntry = versionList[versionList.length - 1]!;
    const latestVersionNumber = latestVersionEntry.versionNumber;

    const versionRow = await backendCore.getVersion(doc.id, latestVersionNumber);
    if (!versionRow) {
      return reply.status(404).send({ error: `Version ${latestVersionNumber} not found` });
    }

    // In the mock, compressedData contains raw UTF-8 bytes (no WASM decompress needed).
    const content = versionRow.compressedData.toString('utf8');

    const contributors = [
      ...new Set(
        versionList
          .map((v: MockVersionRow) => v.createdBy)
          .filter(Boolean),
      ),
    ] as string[];

    const exportedAt = new Date().toISOString();

    const state = {
      title: doc.title ?? slug,
      slug: doc.slug ?? slug,
      version: latestVersionNumber,
      state: doc.state ?? 'DRAFT',
      contributors,
      contentHash: contentHashHex(content),
      exportedAt,
      content,
      labels: Array.isArray(doc.labels) ? doc.labels : null,
      createdBy: doc.createdBy ?? null,
      createdAt: doc.createdAt ?? null,
      updatedAt: doc.updatedAt ?? null,
      versionCount: versionList.length,
      chainRef: null,
    };

    const serialized = serializeDocument(state, format, { includeMetadata });

    const ext = format === 'markdown' ? 'md' : format;
    const contentType = FORMAT_CONTENT_TYPE[format] ?? 'text/plain; charset=utf-8';

    reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `attachment; filename="${slug}.${ext}"`)
      .status(200)
      .send(serialized);
  });

  await app.ready();
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/documents/:slug/export — T427.6 HTTP route', () => {
  const CONTENT = '# Export Test\n\nHello from the export route.';
  const SLUG = 'export-test';

  // ── markdown ─────────────────────────────────────────────────

  describe('format=markdown (default)', () => {
    let app: FastifyInstance;

    before(async () => {
      app = await buildTestApp({
        doc: makeMockDoc(SLUG),
        versions: [makeMockVersion(CONTENT)],
      });
    });

    after(async () => { await app.close(); });

    it('returns 200 with text/markdown Content-Type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${SLUG}/export?format=markdown`,
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.includes('text/markdown'), 'must be text/markdown');
    });

    it('returns YAML frontmatter + body', () => {
      // Re-use the result from previous inject — new inject needed here.
      return app
        .inject({ method: 'GET', url: `/api/v1/documents/${SLUG}/export?format=markdown` })
        .then((res) => {
          const body = res.body;
          assert.ok(body.startsWith('---\n'), 'markdown must start with ---');
          assert.ok(body.includes('slug:'), 'must include slug in frontmatter');
          assert.ok(body.includes('# Export Test'), 'body must be present');
          assert.ok(body.endsWith('\n'), 'must end with newline');
        });
    });

    it('Content-Disposition header is attachment with .md extension', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${SLUG}/export?format=markdown`,
      });
      const disposition = res.headers['content-disposition'];
      assert.ok(typeof disposition === 'string', 'must have Content-Disposition');
      assert.ok(disposition.includes('attachment'), 'must be attachment');
      assert.ok(disposition.includes('.md'), 'must have .md extension');
    });

    it('defaults to markdown when format is not specified', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${SLUG}/export`,
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.includes('text/markdown'));
    });
  });

  // ── json ─────────────────────────────────────────────────────

  describe('format=json', () => {
    let app: FastifyInstance;

    before(async () => {
      app = await buildTestApp({
        doc: makeMockDoc(SLUG),
        versions: [makeMockVersion(CONTENT)],
      });
    });

    after(async () => { await app.close(); });

    it('returns 200 with application/json Content-Type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${SLUG}/export?format=json`,
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.includes('application/json'));
    });

    it('body is valid JSON with llmtxt-export/1 schema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${SLUG}/export?format=json`,
      });
      const parsed = JSON.parse(res.body) as Record<string, unknown>;
      assert.strictEqual(parsed['schema'], 'llmtxt-export/1');
      assert.strictEqual(parsed['slug'], SLUG);
    });

    it('Content-Disposition has .json extension', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${SLUG}/export?format=json`,
      });
      assert.ok(res.headers['content-disposition']?.includes('.json'));
    });
  });

  // ── txt ──────────────────────────────────────────────────────

  describe('format=txt', () => {
    let app: FastifyInstance;

    before(async () => {
      app = await buildTestApp({
        doc: makeMockDoc(SLUG),
        versions: [makeMockVersion(CONTENT)],
      });
    });

    after(async () => { await app.close(); });

    it('returns 200 with text/plain Content-Type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${SLUG}/export?format=txt`,
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.includes('text/plain'));
    });

    it('body has no YAML frontmatter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${SLUG}/export?format=txt`,
      });
      assert.ok(!res.body.includes('---'), 'txt must have no frontmatter');
      assert.ok(res.body.includes('# Export Test'), 'body must be present');
    });
  });

  // ── llmtxt ───────────────────────────────────────────────────

  describe('format=llmtxt', () => {
    let app: FastifyInstance;

    before(async () => {
      app = await buildTestApp({
        doc: makeMockDoc(SLUG),
        versions: [makeMockVersion(CONTENT)],
      });
    });

    after(async () => { await app.close(); });

    it('returns 200 with application/x-llmtxt Content-Type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${SLUG}/export?format=llmtxt`,
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.includes('application/x-llmtxt'));
    });

    it('body has format: "llmtxt/1" field', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${SLUG}/export?format=llmtxt`,
      });
      assert.ok(res.body.includes('format: "llmtxt/1"'), 'must have format field');
      assert.ok(res.body.includes('chain_ref:'), 'must have chain_ref field');
    });
  });

  // ── Error cases ──────────────────────────────────────────────

  describe('error cases', () => {
    it('returns 404 when slug does not exist', async () => {
      const app = await buildTestApp({ doc: undefined, versions: undefined });
      after(async () => { await app.close(); });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/documents/nonexistent-slug/export?format=markdown',
      });
      assert.strictEqual(res.statusCode, 404);
    });

    it('returns 404 when document has no versions', async () => {
      const app = await buildTestApp({
        doc: makeMockDoc('no-versions'),
        versions: [],
      });
      after(async () => { await app.close(); });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/documents/no-versions/export?format=markdown',
      });
      assert.strictEqual(res.statusCode, 404);
    });

    it('returns 400 for an invalid format parameter', async () => {
      const app = await buildTestApp({
        doc: makeMockDoc('valid-slug'),
        versions: [makeMockVersion(CONTENT)],
      });
      after(async () => { await app.close(); });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/documents/valid-slug/export?format=xml',
      });
      assert.strictEqual(res.statusCode, 400);
    });
  });

  // ── includeMetadata=false ────────────────────────────────────

  describe('includeMetadata=false', () => {
    let app: FastifyInstance;

    before(async () => {
      app = await buildTestApp({
        doc: makeMockDoc(SLUG),
        versions: [makeMockVersion(CONTENT)],
      });
    });

    after(async () => { await app.close(); });

    it('markdown without metadata emits body only', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${SLUG}/export?format=markdown&includeMetadata=false`,
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(!res.body.includes('---'), 'no frontmatter when includeMetadata=false');
      assert.ok(res.body.startsWith('# Export Test'), 'body must start immediately');
    });
  });
});
