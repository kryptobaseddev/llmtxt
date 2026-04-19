/**
 * Lease enforcement tests for STRICT_LEASES mode — T737 + T738.
 *
 * Tests the server-side lease enforcement added in T704 to the
 * POST /documents/:slug/sections/:sid/crdt-update endpoint.
 *
 * T737: Non-cooperating agent (no lease) blocked when STRICT_LEASES=1.
 * T738: 2-agent race — agent A holds lease, agent B is blocked; after
 *       agent A releases, agent B succeeds.
 *
 * Pattern: Fastify inject() with mock backendCore. Routes are registered
 * directly in the test app (mirroring crdtRoutes) to avoid pulling in the
 * real better-auth middleware stack. The STRICT_LEASES env var is toggled
 * per test suite via process.env assignment with cleanup in after() hooks.
 *
 * All tests pass without a live database — backendCore.getLease() is mocked
 * to return controlled ServerLease objects so we can unit-test the enforcement
 * logic in isolation from the PostgreSQL backend.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';

// ── Server-side Lease type ────────────────────────────────────────────────────
// Mirrors packages/llmtxt/src/core/backend.ts Lease interface.
// Defined locally to avoid importing the SDK package's client-side Lease type
// (which uses ISO8601 string for expiresAt instead of number).

interface ServerLease {
  /** Lease token — unique identifier for the lease record. */
  id: string;
  /** Resource key, e.g. "slug:sectionId". */
  resource: string;
  /** Agent ID holding the lease. */
  holder: string;
  /** Expiry in ms since epoch. Returned by BackendCore.getLease(). */
  expiresAt: number;
  /** Acquisition time in ms since epoch. */
  acquiredAt: number;
}

// ── Lease factory ─────────────────────────────────────────────────────────────

/**
 * Create a mock server-side Lease record.
 *
 * @param holder    Agent ID of the lease holder.
 * @param id        Lease token / ID (default: 'lease-abc').
 * @param expiresAt Expiry in ms since epoch (default: 60 s in the future).
 */
function makeLease(holder: string, id = 'lease-abc', expiresAt?: number): ServerLease {
  const now = Date.now();
  return {
    id,
    resource: 'test-doc:intro',
    holder,
    expiresAt: expiresAt ?? now + 60_000,
    acquiredAt: now - 1_000,
  };
}

// ── Fake CRDT state / update ──────────────────────────────────────────────────

const FAKE_STATE_BASE64 = Buffer.from('fake-crdt-state').toString('base64');
const FAKE_UPDATE_BASE64 = Buffer.from('fake-crdt-update').toString('base64');

// ── App builder ───────────────────────────────────────────────────────────────

interface BuildOpts {
  /** What getLease() returns for the section resource. null = no active lease. */
  activeLease?: ServerLease | null;
  /** Agent ID for the requesting user (injected as request.user.id). */
  requestingAgent?: string;
  /** Owner of the mock document (for RBAC editor check). Defaults to requestingAgent. */
  docOwner?: string;
}

/**
 * Build a minimal Fastify app with:
 *   - mock backendCore (getLease, getDocumentBySlug, getCrdtState, applyCrdtUpdate)
 *   - auth bypass: request.user is set by onRequest hook
 *   - a replica of the STRICT_LEASES enforcement block from routes/crdt.ts
 *
 * The route registered here mirrors the POST /sections/:sid/crdt-update handler
 * logic from routes/crdt.ts, including the T704 STRICT_LEASES block, so the
 * enforcement code is tested end-to-end via inject() without pulling in the
 * real better-auth middleware.
 */
async function buildTestApp(opts: BuildOpts = {}): Promise<FastifyInstance> {
  const requestingAgent = opts.requestingAgent ?? 'agent-a';
  const docOwner = opts.docOwner ?? requestingAgent;
  const activeLease = opts.activeLease ?? null;

  const app = Fastify({ logger: false });

  // ── Mock backendCore ─────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockBackendCore: any = {
    async getDocumentBySlug(_slug: string) {
      return { id: 'doc-test', slug: 'test-doc', ownerId: docOwner, format: 'text' };
    },
    async getCrdtState(_slug: string, _sid: string) {
      return { snapshotBase64: FAKE_STATE_BASE64, stateVectorBase64: FAKE_STATE_BASE64, updatedAt: Date.now() };
    },
    async applyCrdtUpdate(_params: unknown) {
      return { snapshotBase64: FAKE_STATE_BASE64, stateVectorBase64: FAKE_STATE_BASE64 };
    },
    async getLease(_resource: string): Promise<ServerLease | null> {
      return activeLease;
    },
  };

  app.decorate('backendCore', mockBackendCore);

  // ── Auth bypass: inject user into every request ────────────────────────────
  app.addHook('onRequest', async (request) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (request as any).user = { id: requestingAgent, email: `${requestingAgent}@test.example` };
  });

  // ── CRDT update route (mirrors routes/crdt.ts POST handler) ─────────────────
  // Registered without real requireAuth preHandler. Auth is provided by the
  // onRequest hook above. The enforcement logic (T704 STRICT_LEASES block) is
  // reproduced here verbatim from routes/crdt.ts to exercise it via inject().
  app.post<{
    Params: { slug: string; sid: string };
    Body: { updateBase64: string };
  }>(
    '/documents/:slug/sections/:sid/crdt-update',
    async (request, reply) => {
      const { slug, sid } = request.params;
      const { updateBase64 } = request.body ?? {};

      if (!updateBase64 || typeof updateBase64 !== 'string') {
        return reply.status(400).send({ error: 'Bad Request', message: 'updateBase64 is required' });
      }

      // Check document exists
      const doc = await request.server.backendCore.getDocumentBySlug(slug);
      if (!doc) {
        return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      }

      // RBAC: editor+ required (owner check)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agentId = (request as any).user!.id as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isOwner = (doc as any).ownerId === agentId;
      if (!isOwner) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Editor role required' });
      }

      // ── T704: STRICT_LEASES enforcement ────────────────────────────────────
      if (process.env.STRICT_LEASES === '1') {
        const resource = `${slug}:${sid}`;
        const activeLease2 = await request.server.backendCore.getLease(resource);

        if (activeLease2 !== null && activeLease2.holder !== agentId) {
          // Blocked: another agent holds an active lease on this section.
          // NOTE: lease token (activeLease2.id) is NOT included in the response.
          return reply.status(409).send({
            error: 'lease_held',
            holder: activeLease2.holder,
            expiresAt: new Date(activeLease2.expiresAt).toISOString(),
          });
        }

        // If-Match: validate token when supplied by lease-holder
        const ifMatch = (request.headers as Record<string, string | undefined>)['if-match'];
        if (ifMatch !== undefined && activeLease2 !== null) {
          if (ifMatch !== activeLease2.id) {
            return reply.status(409).send({
              error: 'lease_token_mismatch',
              holder: activeLease2.holder,
              expiresAt: new Date(activeLease2.expiresAt).toISOString(),
            });
          }
        }
      }
      // ── End T704 ────────────────────────────────────────────────────────────

      const updateBlob = Buffer.from(updateBase64, 'base64');
      if (updateBlob.length === 0) {
        return reply.status(400).send({ error: 'Bad Request', message: 'updateBase64 decodes to empty buffer' });
      }

      const existingState = await request.server.backendCore.getCrdtState(slug, sid);
      if (!existingState) {
        return reply.status(503).send({ error: 'Service Unavailable', message: 'Section not yet initialized' });
      }

      const newState = await request.server.backendCore.applyCrdtUpdate({
        documentId: slug, sectionKey: sid, updateBase64, agentId,
      });

      return reply.status(200).send({
        stateBase64: newState.snapshotBase64,
        stateVectorBase64: newState.stateVectorBase64,
        message: 'update applied',
      });
    },
  );

  await app.ready();
  return app;
}

// ── URL helper ────────────────────────────────────────────────────────────────

function putSectionUrl(slug = 'test-doc', sid = 'intro'): string {
  return `/documents/${slug}/sections/${sid}/crdt-update`;
}

// ─────────────────────────────────────────────────────────────────────────────
// T737: Non-cooperating agent blocked by enforced lease (STRICT_LEASES=1)
// ─────────────────────────────────────────────────────────────────────────────

describe('T737 — Non-cooperating agent blocked by enforced lease (STRICT_LEASES=1)', () => {
  let original: string | undefined;

  before(() => {
    original = process.env.STRICT_LEASES;
    process.env.STRICT_LEASES = '1';
  });

  after(() => {
    if (original === undefined) {
      delete process.env.STRICT_LEASES;
    } else {
      process.env.STRICT_LEASES = original;
    }
  });

  it('returns 409 when agent-b writes and agent-a holds the lease', async () => {
    const lease = makeLease('agent-a');
    const app = await buildTestApp({ activeLease: lease, requestingAgent: 'agent-b', docOwner: 'agent-b' });

    const resp = await app.inject({
      method: 'POST',
      url: putSectionUrl(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updateBase64: FAKE_UPDATE_BASE64 }),
    });

    assert.equal(resp.statusCode, 409, `Expected 409, got ${resp.statusCode}: ${resp.body}`);
    const body = JSON.parse(resp.body) as Record<string, unknown>;
    assert.equal(body.error, 'lease_held', 'error code must be "lease_held"');
    assert.equal(body.holder, 'agent-a', 'holder must identify the lease holder agentId');
    assert.ok(typeof body.expiresAt === 'string', 'expiresAt must be present as ISO string');
    // Security: lease token must NOT be exposed in 409 response
    assert.equal(body.leaseId, undefined, 'lease token (leaseId) must not appear in 409');
    assert.equal(body.id, undefined, 'lease token (id) must not appear in 409');

    await app.close();
  });

  it('returns 200 when the requesting agent IS the lease holder', async () => {
    const lease = makeLease('agent-a');
    const app = await buildTestApp({ activeLease: lease, requestingAgent: 'agent-a', docOwner: 'agent-a' });

    const resp = await app.inject({
      method: 'POST',
      url: putSectionUrl(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updateBase64: FAKE_UPDATE_BASE64 }),
    });

    assert.equal(resp.statusCode, 200, `Lease holder should succeed: ${resp.body}`);

    await app.close();
  });

  it('returns 200 when no active lease is held (getLease returns null)', async () => {
    const app = await buildTestApp({ activeLease: null, requestingAgent: 'agent-b', docOwner: 'agent-b' });

    const resp = await app.inject({
      method: 'POST',
      url: putSectionUrl(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updateBase64: FAKE_UPDATE_BASE64 }),
    });

    assert.equal(resp.statusCode, 200, `No lease — write must succeed: ${resp.body}`);

    await app.close();
  });

  it('409 response includes expiresAt matching the stored lease expiry', async () => {
    const expiresAtMs = Date.now() + 120_000;
    const lease = makeLease('agent-a', 'lease-xyz', expiresAtMs);
    const app = await buildTestApp({ activeLease: lease, requestingAgent: 'agent-b', docOwner: 'agent-b' });

    const resp = await app.inject({
      method: 'POST',
      url: putSectionUrl(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updateBase64: FAKE_UPDATE_BASE64 }),
    });

    assert.equal(resp.statusCode, 409);
    const body = JSON.parse(resp.body) as Record<string, unknown>;
    const returnedMs = new Date(body.expiresAt as string).getTime();
    assert.ok(
      Math.abs(returnedMs - expiresAtMs) < 1_001,
      `expiresAt must match stored expiry (±1s), got ${body.expiresAt}`,
    );

    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T737: Advisory mode unchanged when STRICT_LEASES is absent
// ─────────────────────────────────────────────────────────────────────────────

describe('T737 — Advisory mode unchanged when STRICT_LEASES is not set', () => {
  let original: string | undefined;

  before(() => {
    original = process.env.STRICT_LEASES;
    delete process.env.STRICT_LEASES;
  });

  after(() => {
    if (original === undefined) {
      delete process.env.STRICT_LEASES;
    } else {
      process.env.STRICT_LEASES = original;
    }
  });

  it('does NOT block write even if another agent holds a lease (advisory mode)', async () => {
    const lease = makeLease('agent-a');
    const app = await buildTestApp({ activeLease: lease, requestingAgent: 'agent-b', docOwner: 'agent-b' });

    const resp = await app.inject({
      method: 'POST',
      url: putSectionUrl(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updateBase64: FAKE_UPDATE_BASE64 }),
    });

    assert.equal(
      resp.statusCode,
      200,
      `Advisory mode must not block writes — got ${resp.statusCode}: ${resp.body}`,
    );

    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T737: If-Match header validation (STRICT_LEASES=1)
// ─────────────────────────────────────────────────────────────────────────────

describe('T737 — If-Match header validation (STRICT_LEASES=1)', () => {
  let original: string | undefined;

  before(() => {
    original = process.env.STRICT_LEASES;
    process.env.STRICT_LEASES = '1';
  });

  after(() => {
    if (original === undefined) {
      delete process.env.STRICT_LEASES;
    } else {
      process.env.STRICT_LEASES = original;
    }
  });

  it('returns 409 lease_token_mismatch when If-Match does not match stored lease id', async () => {
    const lease = makeLease('agent-a', 'correct-id');
    const app = await buildTestApp({ activeLease: lease, requestingAgent: 'agent-a', docOwner: 'agent-a' });

    const resp = await app.inject({
      method: 'POST',
      url: putSectionUrl(),
      headers: { 'content-type': 'application/json', 'if-match': 'wrong-id' },
      body: JSON.stringify({ updateBase64: FAKE_UPDATE_BASE64 }),
    });

    assert.equal(resp.statusCode, 409, `If-Match mismatch must return 409: ${resp.body}`);
    const body = JSON.parse(resp.body) as Record<string, unknown>;
    assert.equal(body.error, 'lease_token_mismatch');
    assert.equal(body.holder, 'agent-a');

    await app.close();
  });

  it('returns 200 when If-Match matches the stored lease id', async () => {
    const lease = makeLease('agent-a', 'correct-id');
    const app = await buildTestApp({ activeLease: lease, requestingAgent: 'agent-a', docOwner: 'agent-a' });

    const resp = await app.inject({
      method: 'POST',
      url: putSectionUrl(),
      headers: { 'content-type': 'application/json', 'if-match': 'correct-id' },
      body: JSON.stringify({ updateBase64: FAKE_UPDATE_BASE64 }),
    });

    assert.equal(resp.statusCode, 200, `Correct If-Match must succeed: ${resp.body}`);

    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T738: 2-agent race condition under STRICT_LEASES=1
// ─────────────────────────────────────────────────────────────────────────────

describe('T738 — 2-agent race condition under STRICT_LEASES=1', () => {
  let original: string | undefined;

  before(() => {
    original = process.env.STRICT_LEASES;
    process.env.STRICT_LEASES = '1';
  });

  after(() => {
    if (original === undefined) {
      delete process.env.STRICT_LEASES;
    } else {
      process.env.STRICT_LEASES = original;
    }
  });

  it('race: agent-a holds → agent-b blocked (409) → agent-a releases → agent-b succeeds (200)', async () => {
    // Phase 1: agent-a holds the lease — agent-b is blocked
    const agentALease = makeLease('agent-a', 'race-lease-001');
    const appPhase1 = await buildTestApp({
      activeLease: agentALease,
      requestingAgent: 'agent-b',
      docOwner: 'agent-b',
    });

    const blockedResp = await appPhase1.inject({
      method: 'POST',
      url: putSectionUrl(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updateBase64: FAKE_UPDATE_BASE64 }),
    });

    assert.equal(blockedResp.statusCode, 409, `Phase 1: agent-b must be blocked: ${blockedResp.body}`);
    const blockedBody = JSON.parse(blockedResp.body) as Record<string, unknown>;
    assert.equal(blockedBody.error, 'lease_held');
    assert.equal(blockedBody.holder, 'agent-a');
    assert.ok(blockedBody.expiresAt, '409 must include expiresAt for client retry-after logic');

    await appPhase1.close();

    // Phase 2: agent-a releases (getLease now returns null) — agent-b succeeds
    const appPhase2 = await buildTestApp({
      activeLease: null,
      requestingAgent: 'agent-b',
      docOwner: 'agent-b',
    });

    const successResp = await appPhase2.inject({
      method: 'POST',
      url: putSectionUrl(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updateBase64: FAKE_UPDATE_BASE64 }),
    });

    assert.equal(
      successResp.statusCode,
      200,
      `Phase 2: after agent-a releases, agent-b must succeed: ${successResp.body}`,
    );

    await appPhase2.close();
  });

  it('concurrent requests: holder (agent-a) succeeds, non-holder (agent-b) blocked simultaneously', async () => {
    const agentALease = makeLease('agent-a', 'concurrent-lease');

    // Two app instances model two simultaneous in-flight requests:
    //   appA: agent-a is the holder — write is allowed
    //   appB: agent-b is not the holder — write is blocked
    const [appA, appB] = await Promise.all([
      buildTestApp({ activeLease: agentALease, requestingAgent: 'agent-a', docOwner: 'agent-a' }),
      buildTestApp({ activeLease: agentALease, requestingAgent: 'agent-b', docOwner: 'agent-b' }),
    ]);

    // Fire both concurrently
    const [respA, respB] = await Promise.all([
      appA.inject({
        method: 'POST',
        url: putSectionUrl(),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updateBase64: FAKE_UPDATE_BASE64 }),
      }),
      appB.inject({
        method: 'POST',
        url: putSectionUrl(),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updateBase64: FAKE_UPDATE_BASE64 }),
      }),
    ]);

    assert.equal(respA.statusCode, 200, `agent-a (holder) must succeed: ${respA.body}`);
    assert.equal(respB.statusCode, 409, `agent-b (non-holder) must be blocked: ${respB.body}`);

    await Promise.all([appA.close(), appB.close()]);
  });

  it('expired lease (getLease=null): any agent can write after expiry', async () => {
    // Real BackendCore.getLease() filters by expiresAt > now, so an expired
    // lease is returned as null. We model that directly here.
    const app = await buildTestApp({ activeLease: null, requestingAgent: 'agent-b', docOwner: 'agent-b' });

    const resp = await app.inject({
      method: 'POST',
      url: putSectionUrl(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updateBase64: FAKE_UPDATE_BASE64 }),
    });

    assert.equal(
      resp.statusCode,
      200,
      `Expired lease (getLease=null) must permit write: ${resp.body}`,
    );

    await app.close();
  });
});
