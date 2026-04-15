/**
 * run-migrations.ts — Strict deploy-time migration runner for LLMtxt backend.
 *
 * This script uses Drizzle ORM's programmatic migration API (not drizzle-kit CLI)
 * so that errors are thrown as JavaScript exceptions and propagated as a non-zero
 * exit code that halts container startup before the HTTP server binds.
 *
 * Usage (Railway / Docker CMD):
 *   node --import tsx/esm scripts/run-migrations.ts && node dist/index.js
 *
 * Or when compiled:
 *   node dist/scripts/run-migrations.js && node dist/index.js
 *
 * Exit codes:
 *   0 — all migrations applied (or already up-to-date)
 *   1 — migration error — container MUST NOT start
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the migrations folder relative to this script's location.
// scripts/ is one level above src/, which contains db/migrations/.
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../src/db/migrations');

const DB_URL = process.env.DATABASE_URL || './data.db';

const startMs = Date.now();

let db: ReturnType<typeof drizzle>;
let sqlite: InstanceType<typeof Database>;

try {
  sqlite = new Database(DB_URL);

  // Enable WAL mode and foreign keys — same settings as production connection.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  db = drizzle({ client: sqlite });
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    JSON.stringify({ event: 'migration_failed', stage: 'db_open', error: message }) + '\n',
  );
  process.exit(1);
}

try {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  const durationMs = Date.now() - startMs;
  process.stdout.write(
    JSON.stringify({ event: 'migrations_applied', durationMs }) + '\n',
  );

  sqlite.close();
  process.exit(0);
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    JSON.stringify({ event: 'migration_failed', stage: 'migrate', error: message }) + '\n',
  );
  // Close the DB handle if it was opened before exiting.
  try {
    sqlite.close();
  } catch {
    // Ignore close errors — we are already failing.
  }
  process.exit(1);
}
