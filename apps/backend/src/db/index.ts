/**
 * Dual-provider database connection for LLMtxt.
 *
 * Routing is governed by DATABASE_PROVIDER (explicit) or by inspecting the
 * DATABASE_URL scheme (implicit fallback):
 *
 *   DATABASE_PROVIDER=sqlite      → better-sqlite3 + drizzle-orm/better-sqlite3
 *   DATABASE_PROVIDER=postgresql  → postgres-js    + drizzle-orm/postgres-js
 *
 * Implicit scheme detection (when DATABASE_PROVIDER is unset):
 *   postgres:// or postgresql://  → postgres-js path
 *   anything else                 → SQLite path (file path or :memory:)
 *
 * SQLite:     DATABASE_URL=./data.db                              (default)
 * PostgreSQL: DATABASE_URL=postgresql://user:pass@host:5432/llmtxt
 *
 * Dual-client design rationale: rollback safety during cutover.  Flip
 * DATABASE_URL back to the SQLite file path + DATABASE_PROVIDER=sqlite and
 * redeploy — zero code change needed.
 *
 * TODO(T235): Once schema-pg drift fix lands, switch pgSchema import to
 * './schema-pg.js' for the canonical PG schema (currently already imported
 * below but kept alongside sqliteSchema for the SQLite fallback path).
 * TODO(T236): After T235, retire sqliteSchema re-export once all consumers
 * migrate to pgSchema.
 */
import * as sqliteSchema from './schema.js';
import * as pgSchema from './schema-pg.js';

const _dbUrl = process.env.DATABASE_URL ?? '';
const _urlIsPg =
  _dbUrl.startsWith('postgres://') || _dbUrl.startsWith('postgresql://');

/** Active database provider. Exported so auth.ts can configure drizzleAdapter. */
export const DATABASE_PROVIDER = (
  process.env.DATABASE_PROVIDER
    ? process.env.DATABASE_PROVIDER
    : _urlIsPg
      ? 'postgresql'
      : 'sqlite'
) as 'sqlite' | 'postgresql';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _schema: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sqlite: any = null;

if (DATABASE_PROVIDER === 'postgresql') {
  // PostgreSQL path — postgres-js driver + drizzle-orm/postgres-js adapter.
  // Dynamically imported so the SQLite driver is never loaded in PG mode.
  const postgres = (await import('postgres')).default;
  const { drizzle } = await import('drizzle-orm/postgres-js');

  const url = _dbUrl || 'postgresql://localhost:5432/llmtxt';
  // prepare:false required for Drizzle ORM usage (avoids named-portal conflicts)
  const sql = postgres(url, { max: 10, prepare: false });

  // TODO(T235): switch schema to pgSchema once schema-pg drift is fixed
  _db = drizzle({ client: sql, schema: pgSchema });
  _schema = pgSchema;

  console.log('[db] driver=postgres-js');
} else {
  // SQLite path (default)
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');

  const dbUrl = _dbUrl || './data.db';
  const sqliteInstance = new Database(dbUrl);

  // Enable WAL mode for better concurrency
  sqliteInstance.pragma('journal_mode = WAL');

  // Enable foreign keys
  sqliteInstance.pragma('foreign_keys = ON');

  _db = drizzle({ client: sqliteInstance, schema: sqliteSchema });
  _schema = sqliteSchema;
  _sqlite = sqliteInstance;

  console.log('[db] driver=better-sqlite3');
}

/** Drizzle ORM instance. Type varies by DATABASE_PROVIDER but API is identical. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: any = _db;

/** Active schema module — use for table references in queries. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const schema: any = _schema;

/**
 * Raw better-sqlite3 instance. Only available when DATABASE_PROVIDER=sqlite.
 * Use for raw prepared statements where Drizzle ORM is not suitable.
 * Will be null in PostgreSQL mode.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sqlite: any = _sqlite;

/**
 * Which driver is active — useful for code paths where transaction syntax
 * differs between SQLite (synchronous .run()/.all()) and PG (async-only).
 */
export const dbDriver: 'postgres' | 'sqlite' =
  DATABASE_PROVIDER === 'postgresql' ? 'postgres' : 'sqlite';

// Re-export sqliteSchema as the canonical schema for all route files
// that import directly from './schema.js'. Those imports continue to
// work unchanged because TypeScript resolves them statically. The `db`
// instance uses the correct runtime schema regardless of provider.
export { sqliteSchema, pgSchema };
