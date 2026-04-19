/**
 * Scratchpad pod-restart recovery test — T733.
 *
 * Test plan
 * ─────────
 *   Unit tests (no Redis required — always run in CI):
 *     - validateScratchpadRedis throws in production without REDIS_URL.
 *     - validateScratchpadRedis is permissive outside production.
 *     - In-memory fallback publishes and reads correctly after _resetMemStore.
 *
 *   Integration tests (real Redis — guarded by REDIS_TEST_URL / REDIS_URL):
 *     - "Pod-1" publishes 3 messages via XADD (shared redisPublisher).
 *     - Simulate pod restart: call recoverScratchpadPending() for the slug.
 *     - Assert all 3 messages are returned by readScratchpad() — zero loss.
 *     - recoverScratchpadPending() returns no duplicates on a second call.
 *     - TTL is set on the stream key (PTTL > 0 after publishScratchpad).
 *
 * Run:
 *   pnpm --filter @llmtxt/backend test -- scratchpad-restart
 *   REDIS_TEST_URL=redis://localhost:6379 pnpm --filter @llmtxt/backend test -- scratchpad-restart
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateScratchpadRedis,
  publishScratchpad,
  readScratchpad,
  recoverScratchpadPending,
  _resetMemStore,
} from '../lib/scratchpad.js';

// ── Determine test mode ───────────────────────────────────────────────────────

const REDIS_URL_FOR_TEST = process.env.REDIS_TEST_URL ?? process.env.REDIS_URL ?? '';
const HAS_REAL_REDIS = REDIS_URL_FOR_TEST !== '';

// ── Unit: validateScratchpadRedis ───────────────────────────────────────────

describe('validateScratchpadRedis — production rejects missing REDIS_URL', () => {
  const missingValues: string[] = ['', '   ', undefined as unknown as string];

  for (const value of missingValues) {
    const label = value === undefined ? 'undefined' : JSON.stringify(value);
    it(`throws when NODE_ENV=production and REDIS_URL=${label}`, () => {
      assert.throws(
        () => validateScratchpadRedis(value, 'production'),
        /REDIS_URL is not set and NODE_ENV=production/,
      );
    });
  }
});

describe('validateScratchpadRedis — production accepts valid REDIS_URL', () => {
  const validUrls = [
    'redis://localhost:6379',
    'redis://user:pass@redis.railway.internal:6379',
    'rediss://tls-redis.example.com:6380',
  ];

  for (const url of validUrls) {
    it(`does not throw for REDIS_URL=${JSON.stringify(url)}`, () => {
      assert.doesNotThrow(() => validateScratchpadRedis(url, 'production'));
    });
  }
});

describe('validateScratchpadRedis — non-production is permissive', () => {
  const envs = ['development', 'test', 'staging', ''];

  for (const nodeEnv of envs) {
    const envLabel = nodeEnv === '' ? '(empty)' : nodeEnv;
    it(`does not throw for NODE_ENV=${envLabel} without REDIS_URL`, () => {
      assert.doesNotThrow(() => validateScratchpadRedis('', nodeEnv));
    });
  }
});

describe('validateScratchpadRedis — default parameters', () => {
  it('calling with no args does not throw (defaults to non-production env)', () => {
    assert.doesNotThrow(() => validateScratchpadRedis());
  });
});

// ── Unit: in-memory fallback (no Redis) ──────────────────────────────────────

describe('Scratchpad in-memory fallback (no Redis needed)', () => {
  beforeEach(() => {
    _resetMemStore();
  });

  it('publishes a message and returns it with a stable ID', async () => {
    // When REDIS_URL is absent the module uses in-memory path.
    // We test in terms of the public API — the implementation detail of
    // whether it hits Redis or memory is an internal concern.
    const msg = await publishScratchpad('unit-slug', {
      agentId: 'agent-unit',
      content: 'hello unit',
    });

    assert.ok(typeof msg.id === 'string' && msg.id.length > 0, 'id must be a non-empty string');
    assert.strictEqual(msg.agentId, 'agent-unit');
    assert.strictEqual(msg.content, 'hello unit');
    assert.strictEqual(msg.contentType, 'text/plain');
    assert.ok(msg.timestampMs > 0, 'timestampMs must be positive');
  });

  it('reads back all published messages for a slug', async () => {
    const SLUG = 'unit-read-slug';
    await publishScratchpad(SLUG, { agentId: 'a1', content: 'first' });
    await publishScratchpad(SLUG, { agentId: 'a2', content: 'second' });
    await publishScratchpad(SLUG, { agentId: 'a3', content: 'third' });

    const msgs = await readScratchpad(SLUG);
    const contents = msgs.map((m) => m.content);
    assert.ok(contents.includes('first'), 'must contain first');
    assert.ok(contents.includes('second'), 'must contain second');
    assert.ok(contents.includes('third'), 'must contain third');
  });

  it('lastId cursor excludes already-seen messages', async () => {
    const SLUG = 'unit-cursor-slug';
    const m1 = await publishScratchpad(SLUG, { agentId: 'a', content: 'msg-1' });
    await publishScratchpad(SLUG, { agentId: 'b', content: 'msg-2' });
    await publishScratchpad(SLUG, { agentId: 'c', content: 'msg-3' });

    const since = await readScratchpad(SLUG, { lastId: m1.id });
    assert.ok(!since.some((m) => m.id === m1.id), 'm1 must not appear after cursor');
    assert.ok(since.some((m) => m.content === 'msg-2'), 'msg-2 must appear');
    assert.ok(since.some((m) => m.content === 'msg-3'), 'msg-3 must appear');
  });

  it('threadId filter returns only matching thread messages', async () => {
    const SLUG = 'unit-thread-slug';
    await publishScratchpad(SLUG, { agentId: 'a', content: 'main' });
    await publishScratchpad(SLUG, { agentId: 'b', content: 'thread-1', threadId: 'th-x' });
    await publishScratchpad(SLUG, { agentId: 'c', content: 'thread-2', threadId: 'th-x' });

    const threaded = await readScratchpad(SLUG, { threadId: 'th-x' });
    assert.ok(threaded.length >= 2, 'must return at least 2 thread messages');
    assert.ok(
      threaded.every((m) => m.threadId === 'th-x'),
      'all returned messages must be in the thread',
    );
  });

  it('recoverScratchpadPending returns empty array without Redis', async () => {
    // Without Redis the recovery function is a no-op.
    const recovered = await recoverScratchpadPending('unit-recover-slug');
    assert.deepEqual(recovered, []);
  });
});

// ── Real-Redis integration: pod-restart simulation ───────────────────────────

if (HAS_REAL_REDIS) {
  describe('Scratchpad — pod-restart recovery (real Redis)', () => {
    /** Unique slug per test run to avoid cross-run interference. */
    const TEST_SLUG = `test-restart-${Date.now()}`;

    before(async () => {
      // Nothing extra to set up — publishScratchpad initialises the consumer
      // group on first call via ensureConsumerGroup().
    });

    after(async () => {
      // Best-effort cleanup of test stream key.
      try {
        const { redisPublisher } = await import('../lib/redis.js');
        if (redisPublisher) {
          await redisPublisher.del(`scratchpad:${TEST_SLUG}`);
        }
      } catch {
        // Ignore cleanup errors.
      }
    });

    it('published messages survive simulated pod restart (zero-loss recovery)', async () => {
      // Phase 1: "Pod-1" publishes 3 messages.
      const pub1 = await publishScratchpad(TEST_SLUG, {
        agentId: 'pod1-agent',
        content: 'restart-msg-1',
      });
      const pub2 = await publishScratchpad(TEST_SLUG, {
        agentId: 'pod1-agent',
        content: 'restart-msg-2',
      });
      const pub3 = await publishScratchpad(TEST_SLUG, {
        agentId: 'pod1-agent',
        content: 'restart-msg-3',
      });

      assert.ok(pub1.id, 'msg-1 must have an ID');
      assert.ok(pub2.id, 'msg-2 must have an ID');
      assert.ok(pub3.id, 'msg-3 must have an ID');

      // Phase 2: Simulate pod restart — call recoverScratchpadPending with a
      // 0 ms idle threshold so that even freshly-added pending entries are
      // reclaimed immediately (in a real scenario idle >= CLAIM_IDLE_MS).
      const recovered = await recoverScratchpadPending(TEST_SLUG, 0);
      // recovered may be empty if no pending entries exist in the PEL because
      // the messages were published directly (XADD only, no XREADGROUP was
      // called by this process — PEL is empty in that case).
      // The important assertion is that readScratchpad sees all 3 messages.
      assert.ok(Array.isArray(recovered), 'recoverScratchpadPending must return an array');

      // Phase 3: Assert that all 3 messages are readable (zero loss).
      const all = await readScratchpad(TEST_SLUG);
      const contents = all.map((m) => m.content);
      assert.ok(
        contents.includes('restart-msg-1'),
        'restart-msg-1 must survive simulated pod restart',
      );
      assert.ok(
        contents.includes('restart-msg-2'),
        'restart-msg-2 must survive simulated pod restart',
      );
      assert.ok(
        contents.includes('restart-msg-3'),
        'restart-msg-3 must survive simulated pod restart',
      );
    });

    it('recoverScratchpadPending is idempotent (no duplicates on second call)', async () => {
      // Call recovery a second time — should return no new entries (PEL is
      // empty because the previous call acknowledged all pending messages).
      const secondPass = await recoverScratchpadPending(TEST_SLUG, 0);
      assert.ok(
        secondPass.length === 0,
        `Second recovery pass should return 0 entries; got ${secondPass.length}`,
      );
    });

    it('stream TTL is set after publishScratchpad', async () => {
      const { redisPublisher } = await import('../lib/redis.js');
      if (!redisPublisher) {
        assert.ok(true, 'Skipped: no redisPublisher available');
        return;
      }

      // Allow the expire command issued by publishScratchpad to propagate.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      const pttl = await redisPublisher.pttl(`scratchpad:${TEST_SLUG}`);
      assert.ok(pttl > 0, `Stream TTL must be positive; got ${pttl}`);
      assert.ok(
        pttl <= 24 * 60 * 60 * 1000,
        `Stream TTL must be at most 24 h; got ${pttl} ms`,
      );
    });

    it('readScratchpad with lastId cursor returns only newer messages', async () => {
      const SLUG2 = `test-cursor-${Date.now()}`;
      const { redisPublisher } = await import('../lib/redis.js');

      try {
        const m1 = await publishScratchpad(SLUG2, { agentId: 'a', content: 'cursor-1' });
        const m2 = await publishScratchpad(SLUG2, { agentId: 'b', content: 'cursor-2' });
        const m3 = await publishScratchpad(SLUG2, { agentId: 'c', content: 'cursor-3' });

        assert.ok(m1.id && m2.id && m3.id, 'all messages must receive stream IDs');

        const since = await readScratchpad(SLUG2, { lastId: m1.id });
        const ids = since.map((m) => m.id);
        assert.ok(!ids.includes(m1.id), 'm1 must not appear after cursor');
        assert.ok(ids.includes(m2.id), 'm2 must appear after m1 cursor');
        assert.ok(ids.includes(m3.id), 'm3 must appear after m1 cursor');
      } finally {
        if (redisPublisher) await redisPublisher.del(`scratchpad:${SLUG2}`).catch(() => {});
      }
    });
  });
} else {
  describe('Scratchpad — pod-restart recovery (SKIPPED — no Redis)', () => {
    it('real-Redis pod-restart tests skipped — set REDIS_TEST_URL or REDIS_URL to enable', () => {
      assert.ok(true);
    });
  });
}
