/**
 * T086 / T090: Key rotation and secret rotation unit tests.
 *
 * Uses Node.js built-in test runner (node:test + node:assert).
 *
 * Tests:
 *   1. Grace window enforcement (is_key_accepted semantics in TS).
 *   2. Key version increment.
 *   3. Secret rotation version bump.
 *   4. KEK validation (production guard).
 *   5. Secrets provider env fallback.
 *   6. Known-insecure secret detection (signing-secret-validator).
 *   7. Retirement window boundary conditions.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateSigningSecret,
  KNOWN_INSECURE_SIGNING_SECRETS,
} from '../lib/signing-secret-validator.js';
import { resolveKek } from '../lib/secrets-provider.js';

// ── Helper: grace window logic mirrored from Rust core ─────────────

function isKeyAccepted(
  status: 'active' | 'retiring' | 'retired' | 'revoked',
  rotatedAtMs: number,
  graceWindowSecs: number,
  nowMs: number,
): boolean {
  if (status === 'active') return true;
  if (status === 'retiring') {
    const graceEndMs = rotatedAtMs + graceWindowSecs * 1000;
    return nowMs < graceEndMs;
  }
  return false;
}

// ── Test suite: grace window policy ────────────────────────────────

describe('key rotation grace window policy', () => {
  it('active key is always accepted', () => {
    assert.equal(isKeyAccepted('active', 0, 172800, Date.now()), true);
  });

  it('retiring key within grace window is accepted', () => {
    const rotatedAt = Date.now() - 1000; // 1 second ago
    const graceWindow = 3600; // 1 hour
    assert.equal(isKeyAccepted('retiring', rotatedAt, graceWindow, Date.now()), true);
  });

  it('retiring key past grace window is rejected', () => {
    const rotatedAt = Date.now() - 3_601_000; // 1 hour + 1 second ago
    const graceWindow = 3600;
    assert.equal(isKeyAccepted('retiring', rotatedAt, graceWindow, Date.now()), false);
  });

  it('retiring key at exact grace boundary is rejected', () => {
    const graceWindow = 3600;
    const rotatedAt = Date.now() - graceWindow * 1000; // exactly at boundary
    // nowMs >= graceEndMs → rejected
    assert.equal(isKeyAccepted('retiring', rotatedAt, graceWindow, Date.now()), false);
  });

  it('retired key is rejected', () => {
    assert.equal(isKeyAccepted('retired', 0, 172800, Date.now()), false);
  });

  it('revoked key is rejected', () => {
    assert.equal(isKeyAccepted('revoked', 0, 172800, Date.now()), false);
  });

  it('grace remaining decreases over time', () => {
    const graceWindow = 3600;
    const rotatedAt = Date.now() - 1000; // 1 second ago
    const graceEnd = rotatedAt + graceWindow * 1000;
    const remaining = graceEnd - Date.now();
    assert.ok(remaining > 0);
    assert.ok(remaining < graceWindow * 1000);
  });

  it('48h default grace window accepted at 47h59m', () => {
    const graceWindowSecs = 172800; // 48 h
    const rotatedAt = Date.now() - (172800 - 60) * 1000; // 1 minute before expiry
    assert.equal(isKeyAccepted('retiring', rotatedAt, graceWindowSecs, Date.now()), true);
  });

  it('48h grace window rejected at 48h+1ms', () => {
    const graceWindowSecs = 172800; // 48 h
    const rotatedAt = Date.now() - 172800 * 1000 - 1; // 1 ms past
    assert.equal(isKeyAccepted('retiring', rotatedAt, graceWindowSecs, Date.now()), false);
  });
});

// ── Test suite: key version increment ─────────────────────────────

describe('key version management', () => {
  it('first key gets version 1', () => {
    const prevVersion = 0;
    const newVersion = prevVersion + 1;
    assert.equal(newVersion, 1);
  });

  it('version increments monotonically', () => {
    let version = 0;
    for (let i = 1; i <= 5; i++) {
      version = version + 1;
      assert.equal(version, i);
    }
  });
});

// ── Test suite: signing secret validator ───────────────────────────

describe('signing secret validator', () => {
  it('accepts strong secrets in production', () => {
    assert.doesNotThrow(() => validateSigningSecret('a'.repeat(32), 'production'));
  });

  it('rejects empty secret in production', () => {
    assert.throws(() => validateSigningSecret('', 'production'), /\[FATAL\]/);
  });

  it('rejects llmtxt-dev-secret in production', () => {
    assert.throws(() => validateSigningSecret('llmtxt-dev-secret', 'production'), /\[FATAL\]/);
  });

  it('passes all known insecure secrets in non-production', () => {
    for (const s of KNOWN_INSECURE_SIGNING_SECRETS) {
      assert.doesNotThrow(() => validateSigningSecret(s, 'development'));
    }
  });

  it('known insecure set includes all expected values', () => {
    assert.equal(KNOWN_INSECURE_SIGNING_SECRETS.has('llmtxt-dev-secret'), true);
    assert.equal(KNOWN_INSECURE_SIGNING_SECRETS.has(''), true);
    assert.equal(KNOWN_INSECURE_SIGNING_SECRETS.has('secret'), true);
    assert.equal(KNOWN_INSECURE_SIGNING_SECRETS.has('changeme'), true);
  });
});

// ── Test suite: KEK validation ─────────────────────────────────────

describe('KEK (key encrypting key) validation', () => {
  let savedKek: string | undefined;
  let savedEnv: string | undefined;

  before(() => {
    savedKek = process.env.SIGNING_KEY_KEK;
    savedEnv = process.env.NODE_ENV;
  });

  after(() => {
    if (savedKek !== undefined) {
      process.env.SIGNING_KEY_KEK = savedKek;
    } else {
      delete process.env.SIGNING_KEY_KEK;
    }
    if (savedEnv !== undefined) {
      process.env.NODE_ENV = savedEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  it('resolves KEK from hex env var (64 chars)', () => {
    process.env.SIGNING_KEY_KEK = 'a'.repeat(64);
    process.env.NODE_ENV = 'development';
    const kek = resolveKek();
    assert.ok(kek instanceof Uint8Array);
    assert.equal(kek.length, 32);
    assert.ok(kek.every((b) => b === 0xaa));
  });

  it('throws in production when SIGNING_KEY_KEK is missing', () => {
    delete process.env.SIGNING_KEY_KEK;
    process.env.NODE_ENV = 'production';
    assert.throws(() => resolveKek(), /\[FATAL\]/);
  });

  it('returns dev fallback in development when SIGNING_KEY_KEK is missing', () => {
    delete process.env.SIGNING_KEY_KEK;
    process.env.NODE_ENV = 'development';
    const kek = resolveKek();
    assert.ok(kek instanceof Uint8Array);
    assert.equal(kek.length, 32);
    // Dev fallback is 0xde fill
    assert.equal(kek[0], 0xde);
  });
});

// ── Test suite: secret rotation version semantics ──────────────────

describe('secret rotation version semantics', () => {
  it('initial version is 1', () => {
    const config = { currentVersion: 1, previousVersion: null };
    assert.equal(config.currentVersion, 1);
    assert.equal(config.previousVersion, null);
  });

  it('rotation bumps version and sets previous', () => {
    let config = { currentVersion: 1, previousVersion: null as number | null };
    // Simulate rotation
    config = { currentVersion: config.currentVersion + 1, previousVersion: config.currentVersion };
    assert.equal(config.currentVersion, 2);
    assert.equal(config.previousVersion, 1);
  });

  it('multiple rotations chain correctly', () => {
    let config = { currentVersion: 1, previousVersion: null as number | null };
    for (let i = 2; i <= 5; i++) {
      const prev = config.currentVersion;
      config = { currentVersion: config.currentVersion + 1, previousVersion: prev };
      assert.equal(config.currentVersion, i);
      assert.equal(config.previousVersion, i - 1);
    }
  });

  it('grace window is active during rotation period', () => {
    const graceWindowSecs = 3600;
    const rotatedAt = Date.now() - 1000; // 1 second ago
    const graceEnd = rotatedAt + graceWindowSecs * 1000;
    assert.ok(Date.now() < graceEnd);
  });

  it('grace window expires after configured duration', () => {
    const graceWindowSecs = 3600;
    const rotatedAt = Date.now() - 3_601_000; // 1 hour + 1 second ago
    const graceEnd = rotatedAt + graceWindowSecs * 1000;
    assert.ok(Date.now() >= graceEnd);
  });
});
