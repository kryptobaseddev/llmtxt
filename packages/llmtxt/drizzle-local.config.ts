/**
 * Drizzle Kit configuration for LocalBackend SQLite schema.
 *
 * Usage:
 *   pnpm --filter llmtxt exec drizzle-kit generate --config drizzle-local.config.ts
 *
 * Output migrations go to src/local/migrations/.
 *
 * NEVER edit migration files by hand. Always use drizzle-kit generate.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/local/schema-local.ts',
  out: './src/local/migrations',
  dbCredentials: {
    url: process.env.LOCAL_BACKEND_DB ?? ':memory:',
  },
});
