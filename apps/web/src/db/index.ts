/** Database connection and client setup using better-sqlite3 with WAL mode and Drizzle ORM. */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

// Database configuration
const DATABASE_URL = process.env.DATABASE_URL || './data.db';

// Create SQLite connection
const sqlite = new Database(DATABASE_URL);

// Enable WAL mode for better concurrency
sqlite.pragma('journal_mode = WAL');

// Enable foreign keys
sqlite.pragma('foreign_keys = ON');

/** Drizzle ORM instance connected to the SQLite database with full schema. */
export const db = drizzle({ client: sqlite, schema });

// Export schema for convenience
export { schema };
