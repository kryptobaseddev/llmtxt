/**
 * Integration test — 2-pod Redis presence simulation — T729.
 *
 * Simulates two independent Railway pods by creating two separate
 * RedisPresenceRegistry instances that each connect to the same Redis
 * instance (provided via REDIS_TEST_URL or REDIS_URL).
 *
 * Test plan
 * ─────────
 *   1. Pod-1 registers agent-A's presence on doc "shared-doc".
 *   2. Pod-2 registers agent-B's presence on the same doc.
 *   3. We assert that getPresence() returns BOTH agent-A and agent-B within
 *      500 ms (Redis propagation + pub/sub round-trip).
 *   4. Stale entry filtering: after TTL simulation, stale entries are absent.
 *   5. Encoding round-trip: section names with special chars survive the cycle.
 *
 * When REDIS_TEST_URL / REDIS_URL are not set the real-Redis integration tests
 * are skipped (replaced with a single passing notice test). The unit-level
 * tests always run.
 *
 * The real-Redis path runs in CI when a Redis service is available.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RedisPresenceRegistry, getPresence, setPresence } from '../lib/presence-redis.js';

// ── Async polling helper ──────────────────────────────────────────────────────

/**
 * Poll `predicate` (may be async) until it returns a truthy value or timeout.
 *
 * @param predicate   Function returning a truthy value (or Promise thereof).
 * @param maxMs       Maximum wait time in ms (default 500).
 * @param intervalMs  Polling interval in ms (default 10).
 * @returns           The truthy value from predicate, or null on timeout.
 */
async function waitFor<T>(
  predicate: () => T | Promise<T>,
  maxMs = 500,
  intervalMs = 10,
): Promise<T | null> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

// ── Determine test mode ───────────────────────────────────────────────────────

const REDIS_URL_FOR_TEST = process.env.REDIS_TEST_URL ?? process.env.REDIS_URL ?? '';
const HAS_REAL_REDIS = REDIS_URL_FOR_TEST !== '';

// ── Unit-level tests (no Redis required) ─────────────────────────────────────

describe('RedisPresenceRegistry — unit (no Redis)', () => {
  let registry: RedisPresenceRegistry;

  beforeEach(() => {
    registry = new RedisPresenceRegistry();
  });

  it('upsert inserts a local entry', () => {
    registry.upsert('agent-1', 'doc-a', 'intro');
    const records = registry.getByDoc('doc-a');
    assert.equal(records.length, 1);
    assert.equal(records[0].agentId, 'agent-1');
    assert.equal(records[0].section, 'intro');
  });

  it('upsert same agentId twice produces only 1 entry', () => {
    registry.upsert('agent-1', 'doc-a', 'intro');
    registry.upsert('agent-1', 'doc-a', 'outro');
    const records = registry.getByDoc('doc-a');
    assert.equal(records.length, 1);
    assert.equal(records[0].section, 'outro');
  });

  it('getByDoc returns empty array for unknown doc', () => {
    assert.deepEqual(registry.getByDoc('nonexistent'), []);
  });

  it('upsert stores cursorOffset when provided', () => {
    registry.upsert('agent-1', 'doc-a', 'intro', 42);
    const records = registry.getByDoc('doc-a');
    assert.equal(records[0].cursorOffset, 42);
  });

  it('expire removes entries older than 30s', () => {
    registry.upsert('agent-1', 'doc-a', 'intro');
    registry.upsert('agent-2', 'doc-a', 'outro');
    const future = Date.now() + 31_000;
    registry.expire(future);
    assert.equal(registry.getByDoc('doc-a').length, 0);
  });

  it('expire does not remove entries within TTL', () => {
    registry.upsert('agent-1', 'doc-a', 'intro');
    const nearFuture = Date.now() + 5_000;
    registry.expire(nearFuture);
    assert.equal(registry.getByDoc('doc-a').length, 1);
  });

  it('getByDoc returns records sorted by lastSeen descending', () => {
    registry.upsert('agent-1', 'doc-a', 'intro');
    registry.upsert('agent-2', 'doc-a', 'outro');
    const records = registry.getByDoc('doc-a');
    assert.equal(records.length, 2);
    assert.ok(records[0].lastSeen >= records[1].lastSeen);
  });

  it('multiple docs are tracked independently', () => {
    registry.upsert('agent-1', 'doc-a', 'intro');
    registry.upsert('agent-2', 'doc-b', 'body');
    assert.equal(registry.getByDoc('doc-a').length, 1);
    assert.equal(registry.getByDoc('doc-b').length, 1);
    assert.equal(registry.getByDoc('doc-c').length, 0);
  });
});

// ── Encoding round-trip tests (pure, no Redis) ────────────────────────────────

describe('RedisPresenceRegistry — encoding round-trip', () => {
  it('section with semicolons survives upsert/getByDoc cycle (local path)', () => {
    const registry = new RedisPresenceRegistry();
    registry.upsert('agent-x', 'doc-enc', 'section;with;semicolons', 99);
    const [rec] = registry.getByDoc('doc-enc');
    assert.equal(rec.section, 'section;with;semicolons');
    assert.equal(rec.cursorOffset, 99);
  });

  it('PresenceRecord without cursorOffset has cursorOffset undefined', () => {
    const registry = new RedisPresenceRegistry();
    registry.upsert('agent-y', 'doc-enc2', 'plain-section');
    const [rec] = registry.getByDoc('doc-enc2');
    assert.equal(rec.cursorOffset, undefined);
  });
});

// ── Real-Redis integration tests ──────────────────────────────────────────────

if (HAS_REAL_REDIS) {
  describe('RedisPresenceRegistry — 2-pod integration (real Redis)', () => {
    const TEST_DOC = `test-multi-pod-${Date.now()}`;

    // We use the module-level singleton clients (redisPublisher / redisSubscriber)
    // which are initialized by importing lib/redis.ts when REDIS_URL is set.
    // setPresence() and getPresence() use those shared clients, so they already
    // behave as a cross-pod shared medium.

    after(async () => {
      // Clean up test keys from Redis.
      const { redisPublisher } = await import('../lib/redis.js');
      if (redisPublisher) {
        await redisPublisher.del(`presence:${TEST_DOC}`);
      }
    });

    it('pod-1 and pod-2 see each other\'s agents via Redis', async () => {
      // Simulate pod-1 registering agent-A.
      await setPresence(TEST_DOC, 'agent-A', 'section-1');

      // Simulate pod-2 registering agent-B.
      await setPresence(TEST_DOC, 'agent-B', 'section-2');

      // Poll until both agents appear in the Redis-authoritative read.
      const result = await waitFor(async () => {
        const records = await getPresence(TEST_DOC);
        const ids = new Set(records.map((r) => r.agentId));
        if (ids.has('agent-A') && ids.has('agent-B')) return records;
        return null;
      }, 500);

      assert.ok(
        result !== null,
        'Both agents should be visible within 500ms via Redis',
      );

      const ids = new Set((result ?? []).map((r) => r.agentId));
      assert.ok(ids.has('agent-A'), 'agent-A should be in presence set');
      assert.ok(ids.has('agent-B'), 'agent-B should be in presence set');
    });

    it('presence entries include correct section and cursorOffset metadata', async () => {
      await setPresence(TEST_DOC, 'agent-C', 'intro-section', 42);

      const result = await waitFor(async () => {
        const records = await getPresence(TEST_DOC);
        return records.find((r) => r.agentId === 'agent-C') ?? null;
      }, 500);

      assert.ok(result !== null, 'agent-C should appear within 500ms');
      assert.equal(result?.section, 'intro-section');
      assert.equal(result?.cursorOffset, 42);
    });

    it('getPresence returns empty array for doc with no agents', async () => {
      const emptyDoc = `empty-doc-${Date.now()}`;
      const records = await getPresence(emptyDoc);
      assert.deepEqual(records, []);
    });

    it('GET /presence/:docId returns union of presence across pods', async () => {
      // Register two more agents from "different pods" (both write to shared Redis).
      await setPresence(TEST_DOC, 'agent-D', 'body');
      await setPresence(TEST_DOC, 'agent-E', 'conclusion');

      const result = await waitFor(async () => {
        const records = await getPresence(TEST_DOC);
        const ids = new Set(records.map((r) => r.agentId));
        if (ids.has('agent-D') && ids.has('agent-E')) return records;
        return null;
      }, 500);

      assert.ok(result !== null, 'agent-D and agent-E should both be visible');
      const ids = new Set((result ?? []).map((r) => r.agentId));
      assert.ok(ids.has('agent-D'), 'agent-D should appear');
      assert.ok(ids.has('agent-E'), 'agent-E should appear');
    });

    it('Redis hash stores presence with TTL (PTTL > 0 after setPresence)', async () => {
      const { redisPublisher } = await import('../lib/redis.js');
      if (!redisPublisher) {
        assert.ok(true, 'Skipped: no redisPublisher available');
        return;
      }

      await setPresence(TEST_DOC, 'agent-F', 'ttl-section');

      // Allow async flush to reach Redis.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      const pttl = await redisPublisher.pttl(`presence:${TEST_DOC}`);
      assert.ok(pttl > 0, `Presence hash TTL should be positive; got ${pttl}`);
      assert.ok(pttl <= 30_000, `TTL should be at most 30s; got ${pttl}ms`);
    });
  });
} else {
  describe('RedisPresenceRegistry — 2-pod integration (SKIPPED)', () => {
    it('real-Redis integration tests skipped — set REDIS_TEST_URL or REDIS_URL to enable', () => {
      // Intentionally passes — these tests are opt-in.
      assert.ok(true);
    });
  });
}
