/**
 * Unit tests for redis-config-validator — T726.
 *
 * Exercises the pure validateRedisUrl() function that enforces a
 * fail-fast policy in production when REDIS_URL is unset.
 *
 * Tests run without spawning a process and without a real Redis connection,
 * so they are fast and deterministic regardless of the host environment.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateRedisUrl } from '../lib/redis-config-validator.js';

// ── Production: missing REDIS_URL → MUST throw ──────────────────────────────

describe('validateRedisUrl — production rejects missing REDIS_URL', () => {
  const missingValues = ['', '   ', undefined as unknown as string];

  for (const value of missingValues) {
    const label = value === undefined ? 'undefined' : JSON.stringify(value);
    it(`throws when NODE_ENV=production and REDIS_URL=${label}`, () => {
      assert.throws(
        () => validateRedisUrl(value, 'production'),
        /REDIS_URL is not set and NODE_ENV=production/,
      );
    });
  }
});

// ── Production: REDIS_URL present → MUST NOT throw ──────────────────────────

describe('validateRedisUrl — production accepts valid REDIS_URL', () => {
  const validUrls = [
    'redis://localhost:6379',
    'redis://user:pass@redis.railway.internal:6379',
    'rediss://tls-redis.example.com:6380',
  ];

  for (const url of validUrls) {
    it(`does not throw for REDIS_URL=${JSON.stringify(url)}`, () => {
      assert.doesNotThrow(() => validateRedisUrl(url, 'production'));
    });
  }
});

// ── Non-production: always permissive ───────────────────────────────────────

describe('validateRedisUrl — non-production is permissive', () => {
  const envs = ['development', 'test', 'staging', ''];

  for (const nodeEnv of envs) {
    const envLabel = nodeEnv === '' ? '(empty)' : nodeEnv;
    it(`does not throw for NODE_ENV=${envLabel} without REDIS_URL`, () => {
      assert.doesNotThrow(() => validateRedisUrl('', nodeEnv));
    });
  }
});

// ── Default parameter behaviour ──────────────────────────────────────────────

describe('validateRedisUrl — default parameters', () => {
  it('calling with no args does not throw (defaults to non-production env)', () => {
    // nodeEnv defaults to '' which is not 'production'
    assert.doesNotThrow(() => validateRedisUrl());
  });

  it('calling with only empty redisUrl does not throw outside production', () => {
    assert.doesNotThrow(() => validateRedisUrl(''));
  });
});
