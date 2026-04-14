/**
 * Dual-provider database connection for LLMtxt.
 *
 * Set DATABASE_PROVIDER=sqlite (default) or DATABASE_PROVIDER=postgresql
 * to select the active backend. The exported `db` instance is a Drizzle
 * ORM client that works identically for all query operations regardless
 * of provider.
 *
 * SQLite:     DATABASE_URL=./data.db           (default)
 * PostgreSQL: DATABASE_URL=postgresql://user:pass@host:5432/llmtxt
 */
import * as sqliteSchema from './schema.js';
import * as pgSchema from './schema-pg.js';

/** Active database provider. Exported so auth.ts can configure drizzleAdapter. */
export const DATABASE_PROVIDER = (process.env.DATABASE_PROVIDER || 'sqlite') as
  | 'sqlite'
  | 'postgresql';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _schema: any;

if (DATABASE_PROVIDER === 'postgresql') {
  // PostgreSQL path — dynamically require so the sqlite driver is never
  // loaded when running in PostgreSQL mode.
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/llmtxt',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  // drizzle-orm/node-postgres v1 uses config-object form: { client, schema }
  _db = drizzle({ client: pool, schema: pgSchema });
  _schema = pgSchema;
} else {
  // SQLite path (default)
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');

  const dbUrl = process.env.DATABASE_URL || './data.db';
  const sqlite = new Database(dbUrl);

  // Enable WAL mode for better concurrency
  sqlite.pragma('journal_mode = WAL');

  // Enable foreign keys
  sqlite.pragma('foreign_keys = ON');

  _db = drizzle({ client: sqlite, schema: sqliteSchema });
  _schema = sqliteSchema;
}

/** Drizzle ORM instance. Type varies by DATABASE_PROVIDER but API is identical. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: any = _db;

/** Active schema module — use for table references in queries. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const schema: any = _schema;

// Re-export sqliteSchema as the canonical schema for all route files
// that import directly from './schema.js'. Those imports continue to
// work unchanged because TypeScript resolves them statically. The `db`
// instance uses the correct runtime schema regardless of provider.
export { sqliteSchema, pgSchema };
