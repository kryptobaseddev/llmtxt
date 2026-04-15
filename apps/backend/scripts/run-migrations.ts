/**
 * run-migrations.ts — Strict deploy-time migration runner for LLMtxt backend.
 *
 * Scheme-aware: reads DATABASE_URL and routes to the SQLite or Postgres
 * migrator depending on the URL scheme. Uses Drizzle ORM's programmatic
 * migration API (not drizzle-kit CLI) so errors are thrown as JavaScript
 * exceptions and propagated as a non-zero exit code that halts container
 * startup before the HTTP server binds.
 *
 * Usage (Railway / Docker CMD):
 *   node --import tsx/esm scripts/run-migrations.ts && node dist/index.js
 *
 * Exit codes:
 *   0 — all migrations applied (or already up-to-date)
 *   1 — migration error — container MUST NOT start
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_URL = process.env.DATABASE_URL || './data.db';

const isPostgres =
  DB_URL.startsWith('postgres://') || DB_URL.startsWith('postgresql://');

const MIGRATIONS_FOLDER = path.resolve(
  __dirname,
  isPostgres ? '../src/db/migrations-pg' : '../src/db/migrations',
);

const startMs = Date.now();

async function runPostgresMigrations() {
  // NOTE: drizzle-orm@1.0.0-beta.9 migrator fails on postgres-js with an
  // opaque "Failed query: CREATE SCHEMA" error even when the actual query
  // succeeds when run directly. Bypass the migrator and apply migrations
  // via raw SQL, tracking in drizzle.__drizzle_migrations ourselves.
  const fs = await import('fs');
  const cryptoMod = await import('crypto');
  const postgresMod = await import('postgres');
  const postgres = postgresMod.default;

  const sql = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {} });

  try {
    // Discover migration files in the migrations-pg folder (each is a dir
    // containing migration.sql + snapshot.json).
    const entries = fs
      .readdirSync(MIGRATIONS_FOLDER, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    // Ensure tracking schema + table exist.
    await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;

    let applied = 0;
    let skipped = 0;
    const path2 = await import('path');
    for (const dir of entries) {
      const file = path2.join(MIGRATIONS_FOLDER, dir, 'migration.sql');
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      const hash = cryptoMod.createHash('sha256').update(content).digest('hex');

      const existing =
        await sql`SELECT hash FROM drizzle.__drizzle_migrations WHERE hash = ${hash}`;
      if (existing.length > 0) {
        skipped++;
        continue;
      }

      // Split on drizzle's statement-breakpoint marker.
      const stmts = content.split(/-->\s*statement-breakpoint/);
      for (const stmt of stmts) {
        const s = stmt.trim();
        if (!s) continue;
        await sql.unsafe(s);
      }
      await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${Date.now()})`;
      applied++;
    }

    const durationMs = Date.now() - startMs;
    process.stdout.write(
      JSON.stringify({
        event: 'migrations_applied',
        driver: 'postgres',
        applied,
        skipped,
        durationMs,
      }) + '\n',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function runSqliteMigrations() {
  const BetterSqlite3 = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');

  const sqlite = new BetterSqlite3(DB_URL);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  try {
    const db = drizzle({ client: sqlite });
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const durationMs = Date.now() - startMs;
    process.stdout.write(
      JSON.stringify({
        event: 'migrations_applied',
        driver: 'sqlite',
        durationMs,
      }) + '\n',
    );
  } finally {
    try {
      sqlite.close();
    } catch {
      // Ignore close errors — already completing or failing.
    }
  }
}

try {
  if (isPostgres) {
    await runPostgresMigrations();
  } else {
    await runSqliteMigrations();
  }
  process.exit(0);
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  process.stderr.write(
    JSON.stringify({
      event: 'migration_failed',
      stage: 'migrate',
      driver: isPostgres ? 'postgres' : 'sqlite',
      error: message,
      stack,
    }) + '\n',
  );
  process.exit(1);
}
