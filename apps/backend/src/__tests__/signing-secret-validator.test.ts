/**
 * Unit tests for signing-secret-validator — T108.6 / T472.
 *
 * Validates the pure validateSigningSecret() function that enforces a
 * fail-fast policy in production when SIGNING_SECRET is unset or equals a
 * well-known insecure default.
 *
 * These tests exercise the function directly without spawning a process so
 * that they run fast and remain deterministic regardless of the host
 * environment's NODE_ENV or SIGNING_SECRET values.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSigningSecret,
  KNOWN_INSECURE_SIGNING_SECRETS,
} from '../lib/signing-secret-validator.js';

// ── Production / insecure-secret scenarios (MUST throw) ────────────────────────

describe('validateSigningSecret — production rejects insecure secrets', () => {
  for (const insecure of KNOWN_INSECURE_SIGNING_SECRETS) {
    const label = insecure === '' ? '(empty string)' : JSON.stringify(insecure);
    it(`throws when NODE_ENV=production and secret=${label}`, () => {
      assert.throws(
        () => validateSigningSecret(insecure, 'production'),
        /SIGNING_SECRET is missing or set to an insecure default value/,
      );
    });
  }
});

// ── Production / strong-secret scenarios (MUST NOT throw) ──────────────────────

describe('validateSigningSecret — production accepts strong secrets', () => {
  const strongSecrets = [
    'a'.repeat(32),                         // 32-char hex-like string
    'ab12ef34cd56gh78ij90kl12mn34op56qr',   // 34 mixed chars
    'super-secret-value-that-is-not-default',
  ];

  for (const secret of strongSecrets) {
    it(`does not throw for secret=${JSON.stringify(secret).slice(0, 30)}...`, () => {
      assert.doesNotThrow(() => validateSigningSecret(secret, 'production'));
    });
  }
});

// ── Non-production environments (MUST NOT throw for any secret) ─────────────────

describe('validateSigningSecret — non-production is always permissive', () => {
  const envs = ['development', 'test', 'staging', ''];

  for (const nodeEnv of envs) {
    for (const insecure of KNOWN_INSECURE_SIGNING_SECRETS) {
      const envLabel = nodeEnv === '' ? '(empty)' : nodeEnv;
      const secretLabel = insecure === '' ? '(empty)' : JSON.stringify(insecure);
      it(`does not throw for NODE_ENV=${envLabel} secret=${secretLabel}`, () => {
        assert.doesNotThrow(() => validateSigningSecret(insecure, nodeEnv));
      });
    }
  }
});

// ── Default parameter behaviour ─────────────────────────────────────────────────

describe('validateSigningSecret — default parameters', () => {
  it('calling with no args does not throw (defaults to non-production)', () => {
    // nodeEnv defaults to '' which is not 'production'
    assert.doesNotThrow(() => validateSigningSecret());
  });

  it('calling with only empty secret does not throw outside production', () => {
    assert.doesNotThrow(() => validateSigningSecret(''));
  });
});
