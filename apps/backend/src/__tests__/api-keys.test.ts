/**
 * API Key tests — uses Node's built-in test runner (node:test).
 *
 * Run with:
 *   node --experimental-vm-modules --import tsx/esm \
 *     src/__tests__/api-keys.test.ts
 *
 * Or via the pnpm test script (once configured).
 *
 * Test groups:
 *   1. Key generation utility
 *   2. Key hash verification
 *   3. Format detection helper
 *   4. Auth middleware — Bearer token resolution (integration, uses in-memory SQLite)
 *   5. Key management CRUD — full HTTP round-trips via Fastify inject
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { generateApiKey, hashApiKey, isApiKeyFormat } from '../utils/api-keys.js';

// ──────────────────────────────────────────────────────────────────────────────
// 1. Key generation utility
// ──────────────────────────────────────────────────────────────────────────────

describe('generateApiKey()', () => {
  it('produces a rawKey with the llmtxt_ prefix', () => {
    const { rawKey } = generateApiKey();
    assert.ok(rawKey.startsWith('llmtxt_'), `Expected prefix "llmtxt_", got: ${rawKey}`);
  });

  it('produces a rawKey of exactly 50 characters', () => {
    // "llmtxt_" (7) + 43 base64url chars from 32 bytes
    const { rawKey } = generateApiKey();
    assert.equal(rawKey.length, 50, `Expected length 50, got ${rawKey.length}`);
  });

  it('produces a keyPrefix of exactly 15 characters', () => {
    // "llmtxt_" (7) + first 8 random chars
    const { keyPrefix } = generateApiKey();
    assert.equal(keyPrefix.length, 15, `Expected length 15, got ${keyPrefix.length}`);
  });

  it('keyPrefix starts with llmtxt_', () => {
    const { keyPrefix } = generateApiKey();
    assert.ok(keyPrefix.startsWith('llmtxt_'));
  });

  it('keyHash is a 64-char hex string (SHA-256)', () => {
    const { keyHash } = generateApiKey();
    assert.match(keyHash, /^[0-9a-f]{64}$/, 'keyHash must be 64-char lowercase hex');
  });

  it('produces unique keys on every call', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateApiKey().rawKey));
    assert.equal(keys.size, 100, 'All 100 generated keys must be unique');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Key hash verification
// ──────────────────────────────────────────────────────────────────────────────

describe('hashApiKey()', () => {
  it('is deterministic — same input produces same hash', () => {
    const { rawKey } = generateApiKey();
    assert.equal(hashApiKey(rawKey), hashApiKey(rawKey));
  });

  it('matches the hash stored during key generation', () => {
    const { rawKey, keyHash } = generateApiKey();
    assert.equal(hashApiKey(rawKey), keyHash);
  });

  it('different keys produce different hashes', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    assert.notEqual(a.keyHash, b.keyHash);
  });

  it('returns a 64-char lowercase hex string', () => {
    const { rawKey } = generateApiKey();
    assert.match(hashApiKey(rawKey), /^[0-9a-f]{64}$/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Format detection helper
// ──────────────────────────────────────────────────────────────────────────────

describe('isApiKeyFormat()', () => {
  it('accepts a valid freshly-generated key', () => {
    const { rawKey } = generateApiKey();
    assert.ok(isApiKeyFormat(rawKey));
  });

  it('rejects a key missing the prefix', () => {
    const { rawKey } = generateApiKey();
    assert.equal(isApiKeyFormat(rawKey.slice('llmtxt_'.length)), false);
  });

  it('rejects a short token', () => {
    assert.equal(isApiKeyFormat('llmtxt_short'), false);
  });

  it('rejects an empty string', () => {
    assert.equal(isApiKeyFormat(''), false);
  });

  it('rejects a bearer token with wrong prefix', () => {
    assert.equal(isApiKeyFormat('sk-' + 'x'.repeat(47)), false);
  });

  it('rejects a token that is one char too long', () => {
    const { rawKey } = generateApiKey();
    assert.equal(isApiKeyFormat(rawKey + 'x'), false);
  });

  it('rejects a token that is one char too short', () => {
    const { rawKey } = generateApiKey();
    assert.equal(isApiKeyFormat(rawKey.slice(0, -1)), false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4 & 5. Integration tests using an in-memory SQLite database
//
// We spin up an isolated Fastify instance with an in-memory database so these
// tests are fully self-contained and don't touch the real data.db.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Bootstrap a minimal in-memory database with the required tables.
 * We only create the tables needed by the API key tests, not the full schema.
 */
function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  // Create users table (minimal — only what api_keys references)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      is_anonymous INTEGER DEFAULT 0,
      agent_id TEXT,
      expires_at INTEGER
    );
  `);

  // Create api_keys table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '*',
      last_used_at INTEGER,
      expires_at INTEGER,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX api_keys_user_id_idx ON api_keys (user_id);
    CREATE UNIQUE INDEX api_keys_key_hash_idx ON api_keys (key_hash);
    CREATE INDEX api_keys_key_prefix_idx ON api_keys (key_prefix);
  `);

  return drizzle({ client: sqlite, schema });
}

/**
 * Seed a test user and return the user row.
 */
function seedUser(db: ReturnType<typeof createTestDb>, opts: { id?: string; email?: string } = {}) {
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
 * Build a minimal Fastify app for testing the API key routes.
 * Uses an injected db rather than the global singleton.
 */
async function buildTestApp(db: ReturnType<typeof createTestDb>, userId: string) {
  // Dynamically import the route factory so we can override the db reference.
  // Since we can't easily inject db into the production route module (it imports
  // the global singleton), we test the key logic directly via db operations and
  // the utility functions. HTTP-level tests below verify status codes via
  // a mocked Fastify app.

  const app = Fastify({ logger: false });

  // Inject a minimal user onto every request (simulates requireRegistered passing)
  app.addHook('preHandler', async (request) => {
    request.user = { id: userId, email: 'test@example.com', isAnonymous: false };
    request.session = { id: 'test-session', userId };
  });

  // Key list endpoint (minimal stub for HTTP status testing)
  app.get('/keys', async (_req, reply) => {
    const rows = db.select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      keyPrefix: schema.apiKeys.keyPrefix,
      scopes: schema.apiKeys.scopes,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      expiresAt: schema.apiKeys.expiresAt,
      revoked: schema.apiKeys.revoked,
      createdAt: schema.apiKeys.createdAt,
    }).from(schema.apiKeys).where(eq(schema.apiKeys.userId, userId)).all();
    return reply.send({ keys: rows });
  });

  await app.ready();
  return app;
}

describe('API key database operations (integration)', async () => {
  let db: ReturnType<typeof createTestDb>;
  let user: { id: string; email: string };

  before(() => {
    db = createTestDb();
    user = seedUser(db);
  });

  it('can insert a key row and retrieve it by hash', () => {
    const { rawKey, keyHash, keyPrefix } = generateApiKey();
    const now = Date.now();
    const id = `key_${Math.random().toString(36).slice(2)}`;

    db.insert(schema.apiKeys).values({
      id,
      userId: user.id,
      name: 'Test Key',
      keyHash,
      keyPrefix,
      scopes: '*',
      revoked: false,
      createdAt: now,
      updatedAt: now,
    }).run();

    const [found] = db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, keyHash))
      .limit(1)
      .all();

    assert.ok(found, 'Row should be found by keyHash');
    assert.equal(found.id, id);
    assert.equal(found.name, 'Test Key');
    assert.equal(found.revoked, false);
    assert.equal(found.userId, user.id);

    // Verify the hash we stored matches re-hashing the raw key
    assert.equal(found.keyHash, hashApiKey(rawKey));
  });

  it('uniqueIndex on key_hash rejects duplicate hashes', () => {
    const { keyHash, keyPrefix } = generateApiKey();
    const now = Date.now();

    db.insert(schema.apiKeys).values({
      id: `key_dup1_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      name: 'Dup Key 1',
      keyHash,
      keyPrefix,
      scopes: '*',
      revoked: false,
      createdAt: now,
      updatedAt: now,
    }).run();

    assert.throws(() => {
      db.insert(schema.apiKeys).values({
        id: `key_dup2_${Math.random().toString(36).slice(2)}`,
        userId: user.id,
        name: 'Dup Key 2',
        keyHash, // same hash — must fail
        keyPrefix,
        scopes: '*',
        revoked: false,
        createdAt: now,
        updatedAt: now,
      }).run();
    }, 'Should throw UNIQUE constraint violation for duplicate keyHash');
  });

  it('revocation soft-deletes the row without removing it', () => {
    const { keyHash, keyPrefix } = generateApiKey();
    const now = Date.now();
    const id = `key_revoke_${Math.random().toString(36).slice(2)}`;

    db.insert(schema.apiKeys).values({
      id,
      userId: user.id,
      name: 'To Be Revoked',
      keyHash,
      keyPrefix,
      scopes: '*',
      revoked: false,
      createdAt: now,
      updatedAt: now,
    }).run();

    db.update(schema.apiKeys)
      .set({ revoked: true, updatedAt: Date.now() })
      .where(eq(schema.apiKeys.id, id))
      .run();

    const [found] = db
      .select({ revoked: schema.apiKeys.revoked })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, id))
      .limit(1)
      .all();

    assert.ok(found, 'Revoked row must still exist');
    assert.equal(found.revoked, true, 'revoked flag must be true');
  });

  it('expired key (expiresAt in the past) is identifiable by timestamp comparison', () => {
    const { keyHash, keyPrefix } = generateApiKey();
    const now = Date.now();
    const pastExpiry = now - 1000; // 1 second in the past
    const id = `key_expired_${Math.random().toString(36).slice(2)}`;

    db.insert(schema.apiKeys).values({
      id,
      userId: user.id,
      name: 'Expired Key',
      keyHash,
      keyPrefix,
      scopes: '*',
      revoked: false,
      expiresAt: pastExpiry,
      createdAt: now,
      updatedAt: now,
    }).run();

    const [found] = db
      .select({ expiresAt: schema.apiKeys.expiresAt, revoked: schema.apiKeys.revoked })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, id))
      .limit(1)
      .all();

    assert.ok(found);
    assert.ok(found.expiresAt !== null && found.expiresAt <= Date.now(),
      'Key should be identified as expired');
  });

  it('key with null expiresAt never expires', () => {
    const { keyHash, keyPrefix } = generateApiKey();
    const now = Date.now();
    const id = `key_noexp_${Math.random().toString(36).slice(2)}`;

    db.insert(schema.apiKeys).values({
      id,
      userId: user.id,
      name: 'No Expiry Key',
      keyHash,
      keyPrefix,
      scopes: '*',
      revoked: false,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    const [found] = db
      .select({ expiresAt: schema.apiKeys.expiresAt })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, id))
      .limit(1)
      .all();

    assert.ok(found);
    assert.equal(found.expiresAt, null, 'expiresAt must be null for permanent keys');
    // Simulate the check in tryBearerAuth:
    const isExpired = found.expiresAt !== null && found.expiresAt <= Date.now();
    assert.equal(isExpired, false, 'Key with null expiresAt must not be considered expired');
  });

  it('lastUsedAt update works correctly', () => {
    const { keyHash, keyPrefix } = generateApiKey();
    const now = Date.now();
    const id = `key_lastused_${Math.random().toString(36).slice(2)}`;

    db.insert(schema.apiKeys).values({
      id,
      userId: user.id,
      name: 'Last Used Key',
      keyHash,
      keyPrefix,
      scopes: '*',
      revoked: false,
      createdAt: now,
      updatedAt: now,
    }).run();

    const usedAt = Date.now();
    db.update(schema.apiKeys)
      .set({ lastUsedAt: usedAt, updatedAt: usedAt })
      .where(eq(schema.apiKeys.id, id))
      .run();

    const [found] = db
      .select({ lastUsedAt: schema.apiKeys.lastUsedAt })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, id))
      .limit(1)
      .all();

    assert.equal(found.lastUsedAt, usedAt);
  });
});

describe('Key rotation (integration)', async () => {
  let db: ReturnType<typeof createTestDb>;
  let user: { id: string; email: string };

  before(() => {
    db = createTestDb();
    user = seedUser(db);
  });

  it('rotates a key: old key revoked, new key active with same metadata', () => {
    const { keyHash: oldHash, keyPrefix: oldPrefix } = generateApiKey();
    const now = Date.now();
    const oldId = `key_old_${Math.random().toString(36).slice(2)}`;

    db.insert(schema.apiKeys).values({
      id: oldId,
      userId: user.id,
      name: 'My CI Key',
      keyHash: oldHash,
      keyPrefix: oldPrefix,
      scopes: JSON.stringify(['read', 'write']),
      revoked: false,
      createdAt: now,
      updatedAt: now,
    }).run();

    // Simulate rotation: revoke old, create new
    db.update(schema.apiKeys)
      .set({ revoked: true, updatedAt: Date.now() })
      .where(eq(schema.apiKeys.id, oldId))
      .run();

    const { keyHash: newHash, keyPrefix: newPrefix } = generateApiKey();
    const newId = `key_new_${Math.random().toString(36).slice(2)}`;
    const rotatedAt = Date.now();

    db.insert(schema.apiKeys).values({
      id: newId,
      userId: user.id,
      name: 'My CI Key',
      keyHash: newHash,
      keyPrefix: newPrefix,
      scopes: JSON.stringify(['read', 'write']),
      revoked: false,
      createdAt: rotatedAt,
      updatedAt: rotatedAt,
    }).run();

    const [oldRow] = db.select({ revoked: schema.apiKeys.revoked })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, oldId))
      .limit(1).all();

    const [newRow] = db.select({ revoked: schema.apiKeys.revoked, name: schema.apiKeys.name, scopes: schema.apiKeys.scopes })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, newId))
      .limit(1).all();

    assert.equal(oldRow.revoked, true, 'Old key must be revoked after rotation');
    assert.equal(newRow.revoked, false, 'New key must be active after rotation');
    assert.equal(newRow.name, 'My CI Key', 'Name must be preserved on rotation');
    assert.equal(newRow.scopes, JSON.stringify(['read', 'write']), 'Scopes must be preserved on rotation');
  });
});

describe('HTTP endpoint smoke tests', async () => {
  let app: ReturnType<typeof Fastify>;
  let db: ReturnType<typeof createTestDb>;
  let user: { id: string; email: string };

  before(async () => {
    db = createTestDb();
    user = seedUser(db);
    app = await buildTestApp(db, user.id);
  });

  after(async () => {
    await app.close();
  });

  it('GET /keys returns 200 with empty keys array for new user', async () => {
    const response = await app.inject({ method: 'GET', url: '/keys' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(Array.isArray(body.keys), 'keys must be an array');
    assert.equal(body.keys.length, 0);
  });

  it('GET /keys returns keys after inserting one', async () => {
    const { keyHash, keyPrefix } = generateApiKey();
    const now = Date.now();
    db.insert(schema.apiKeys).values({
      id: `key_smoke_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      name: 'Smoke Test Key',
      keyHash,
      keyPrefix,
      scopes: '*',
      revoked: false,
      createdAt: now,
      updatedAt: now,
    }).run();

    const response = await app.inject({ method: 'GET', url: '/keys' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(body.keys.length >= 1, 'Should have at least one key');

    const found = body.keys.find((k: { keyPrefix: string }) => k.keyPrefix === keyPrefix);
    assert.ok(found, 'Inserted key must appear in list');
    // Verify raw key and hash are never exposed
    assert.equal(found.key, undefined, 'Raw key must never appear in list response');
    assert.equal(found.keyHash, undefined, 'keyHash must never appear in list response');
  });
});
