/**
 * Test database harness — supports both SQLite (default) and PostgreSQL.
 *
 * Selection logic:
 *   - DATABASE_URL_PG env var is set → open a postgres-js connection to a
 *     unique per-suite schema (test_<random>), run PG migrations, return a
 *     Drizzle PG client + cleanup callback.
 *   - Otherwise → create an in-memory better-sqlite3 database, bootstrap DDL
 *     from the inline CREATE TABLE statements, return a Drizzle SQLite client.
 *
 * Usage:
 *   import { setupTestDb, teardownTestDb } from './helpers/test-db.js';
 *
 *   let ctx: Awaited<ReturnType<typeof setupTestDb>>;
 *   before(async () => { ctx = await setupTestDb(); });
 *   after(async () => { await teardownTestDb(ctx); });
 *
 *   // ctx.db   — Drizzle client (sync .run()/.all() for SQLite; async for PG)
 *   // ctx.sqlite — raw better-sqlite3 instance (SQLite only, null for PG)
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Migration SQL paths — applied in chronological order
const MIGRATION_SQL_PATHS = [
  path.resolve(__dirname, '../../db/migrations-pg/20260415210842_swift_roland_deschain/migration.sql'),
  path.resolve(__dirname, '../../db/migrations-pg/20260415235846_square_sentinel/migration.sql'),
  path.resolve(__dirname, '../../db/migrations-pg/20260416000001_w1_constraints/migration.sql'),
  path.resolve(__dirname, '../../db/migrations-pg/20260416000002_event_seq_counter/migration.sql'),
];

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface TestDbContext {
  /** Drizzle ORM instance. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  /**
   * Raw better-sqlite3 Database instance.
   * Only populated in SQLite mode; null in PostgreSQL mode.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sqlite: any | null;
  /** Provider in use for this context. */
  provider: 'sqlite' | 'postgresql';
  /** Cleanup — drops the test schema (PG) or closes the connection (SQLite). */
  cleanup: () => Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// SQLite path
// ────────────────────────────────────────────────────────────────────────────

async function createSQLiteTestDb(): Promise<TestDbContext> {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../../db/schema.js');

  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

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

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      access_token_expires_at INTEGER,
      refresh_token_expires_at INTEGER,
      scope TEXT,
      id_token TEXT,
      password TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verifications (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      format TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      compressed_data BLOB,
      original_size INTEGER NOT NULL,
      compressed_size INTEGER NOT NULL,
      token_count INTEGER,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER,
      state TEXT NOT NULL DEFAULT 'DRAFT',
      owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      storage_type TEXT NOT NULL DEFAULT 'inline',
      storage_key TEXT,
      current_version INTEGER NOT NULL DEFAULT 0,
      version_count INTEGER NOT NULL DEFAULT 0,
      sharing_mode TEXT NOT NULL DEFAULT 'signed_url',
      approval_required_count INTEGER NOT NULL DEFAULT 1,
      approval_require_unanimous INTEGER NOT NULL DEFAULT 0,
      approval_allowed_reviewers TEXT NOT NULL DEFAULT '',
      approval_timeout_ms INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'public'
    );

    CREATE INDEX IF NOT EXISTS documents_slug_idx ON documents(slug);
    CREATE INDEX IF NOT EXISTS documents_owner_id_idx ON documents(owner_id);

    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      compressed_data BLOB,
      content_hash TEXT NOT NULL,
      token_count INTEGER,
      created_at INTEGER NOT NULL,
      created_by TEXT,
      changelog TEXT,
      patch_text TEXT,
      base_version INTEGER,
      storage_type TEXT NOT NULL DEFAULT 'inline',
      storage_key TEXT,
      UNIQUE(document_id, version_number)
    );

    CREATE INDEX IF NOT EXISTS versions_document_id_idx ON versions(document_id);

    CREATE TABLE IF NOT EXISTS state_transitions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      changed_at INTEGER NOT NULL,
      reason TEXT,
      at_version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL,
      status TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      reason TEXT,
      at_version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contributors (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      versions_authored INTEGER NOT NULL DEFAULT 0,
      total_tokens_added INTEGER NOT NULL DEFAULT 0,
      total_tokens_removed INTEGER NOT NULL DEFAULT 0,
      net_tokens INTEGER NOT NULL DEFAULT 0,
      first_contribution INTEGER NOT NULL,
      last_contribution INTEGER NOT NULL,
      sections_modified TEXT NOT NULL DEFAULT '[]',
      display_name TEXT,
      UNIQUE(document_id, agent_id)
    );

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

    CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys(key_hash);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      agent_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      details TEXT,
      timestamp INTEGER NOT NULL,
      request_id TEXT,
      method TEXT,
      path TEXT,
      status_code INTEGER
    );

    CREATE TABLE IF NOT EXISTS document_roles (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      UNIQUE(document_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS document_links (
      id TEXT PRIMARY KEY,
      source_doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      target_doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL,
      label TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(source_doc_id, target_doc_id, link_type)
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      owner_id TEXT NOT NULL REFERENCES users(id),
      visibility TEXT NOT NULL DEFAULT 'public',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collection_documents (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      added_by TEXT,
      added_at INTEGER NOT NULL,
      UNIQUE(collection_id, document_id)
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]',
      document_slug TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_delivery_at INTEGER,
      last_success_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signed_url_tokens (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      org_id TEXT,
      signature TEXT NOT NULL,
      signature_length INTEGER NOT NULL DEFAULT 16,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      UNIQUE(org_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS document_orgs (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      UNIQUE(document_id, org_id)
    );

    CREATE TABLE IF NOT EXISTS pending_invites (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      UNIQUE(document_id, email)
    );

    CREATE TABLE IF NOT EXISTS version_attributions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      author_id TEXT NOT NULL,
      added_lines INTEGER NOT NULL DEFAULT 0,
      removed_lines INTEGER NOT NULL DEFAULT 0,
      added_tokens INTEGER NOT NULL DEFAULT 0,
      removed_tokens INTEGER NOT NULL DEFAULT 0,
      sections_modified TEXT NOT NULL DEFAULT '[]',
      changelog TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      UNIQUE(document_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS agent_pubkeys (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL UNIQUE,
      pubkey BLOB NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      revoked_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS agent_signature_nonces (
      nonce TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      first_seen INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS agent_signature_nonces_agent_first_seen_idx
      ON agent_signature_nonces(agent_id, first_seen);
  `);

  const db = drizzle({ client: sqlite, schema });

  return {
    db,
    sqlite,
    provider: 'sqlite',
    cleanup: async () => {
      sqlite.close();
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// PostgreSQL path
// ────────────────────────────────────────────────────────────────────────────

async function createPgTestDb(): Promise<TestDbContext> {
  const postgres = (await import('postgres')).default;
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const pgSchema = await import('../../db/schema-pg.js');

  const pgUrl = process.env.DATABASE_URL_PG!;

  // Unique schema name per suite invocation — prevents cross-suite interference
  // when suites run in parallel.
  const schemaName = `test_${Math.random().toString(36).slice(2, 10)}`;

  // Admin connection to create/drop schema
  const adminSql = postgres(pgUrl, { max: 1, prepare: false });

  // Create an isolated schema for this test suite
  await adminSql`CREATE SCHEMA IF NOT EXISTS ${adminSql(schemaName)}`;

  // Set search_path for the suite connection so all DDL and DML target the
  // test schema rather than the default public schema.
  const suiteSql = postgres(pgUrl, {
    max: 5,
    prepare: false,
    connection: {
      search_path: schemaName,
    },
  });

  // Read and execute PG migration SQL files in order.
  // Each file is split on the Drizzle statement-break marker
  // (`--> statement-breakpoint`) and executed statement-by-statement.
  for (const migPath of MIGRATION_SQL_PATHS) {
    const migrationSql = await readFile(migPath, 'utf-8');
    const statements = migrationSql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await suiteSql.unsafe(stmt);
    }
  }

  const db = drizzle({ client: suiteSql, schema: pgSchema });

  return {
    db,
    sqlite: null,
    provider: 'postgresql',
    cleanup: async () => {
      await suiteSql.end();
      // Drop the isolated schema to prevent leaks across test runs
      await adminSql`DROP SCHEMA IF EXISTS ${adminSql(schemaName)} CASCADE`;
      await adminSql.end();
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Set up a test database.
 *
 * When `DATABASE_URL_PG` is set, a Postgres connection is opened against a
 * fresh, randomly-named schema.  Otherwise an in-memory SQLite database is
 * created and bootstrapped with the full DDL.
 *
 * Always call `teardownTestDb(ctx)` in `after()` to release connections and
 * clean up schema.
 */
export async function setupTestDb(): Promise<TestDbContext> {
  if (process.env.DATABASE_URL_PG) {
    return createPgTestDb();
  }
  return createSQLiteTestDb();
}

/**
 * Tear down a test database context returned by `setupTestDb()`.
 *
 * - SQLite: closes the database file handle.
 * - PostgreSQL: drops the isolated test schema and ends all connections.
 */
export async function teardownTestDb(ctx: TestDbContext): Promise<void> {
  await ctx.cleanup();
}
