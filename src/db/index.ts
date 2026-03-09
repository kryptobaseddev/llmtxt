// Database connection and client setup
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

// Create Drizzle ORM instance
export const db = drizzle(sqlite, { schema });

// Export connection for migrations
export { sqlite };

// Export schema for convenience
export { schema };
