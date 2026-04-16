/**
 * create-api-key.mjs — Generate and insert an API key into the Postgres DB.
 * Uses the hashContent function from the llmtxt WASM SDK.
 *
 * Usage:
 *   DB_URL=postgresql://... node scripts/create-api-key.mjs
 */

import { createHash, randomBytes } from 'node:crypto';

// Generate random API key with llmtxt_ prefix (50 chars total)
const rawKey = randomBytes(22).toString('hex'); // 44 hex chars
const apiKey = `llmtxt_${rawKey}`;
console.error(`[create-api-key] Generated key: ${apiKey}`);

// Hash it SHA-256 like the backend does (hashContent in backend)
const keyHash = createHash('sha256').update(apiKey, 'utf8').digest('hex');
console.error(`[create-api-key] Key hash: ${keyHash}`);

// We need a user to associate with. Check if there's an existing user first.
const DB_URL = process.env.DB_URL;
if (!DB_URL) {
  console.error('[create-api-key] ERROR: DB_URL env var is required');
  process.exit(1);
}

// Use postgres package if available, otherwise manual HTTP to Railway
// Check if pg is available
let pg;
try {
  pg = (await import('postgres')).default;
} catch {
  // Try 'pg' package
  try {
    const { default: Pg } = await import('pg');
    pg = null; // Use different approach
    const client = new Pg.Client(DB_URL);
    await client.connect();

    // Get or create a user_id
    const userRes = await client.query(`SELECT id FROM "user" LIMIT 1;`);
    let userId;
    if (userRes.rows.length === 0) {
      console.error('[create-api-key] No users found in DB — cannot create API key without a user');
      process.exit(1);
    }
    userId = userRes.rows[0].id;
    console.error(`[create-api-key] Using userId: ${userId}`);

    // Check table name
    const tableCheck = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('api_keys','apiKeys');`
    );
    const tableName = tableCheck.rows.length > 0 ? tableCheck.rows[0].tablename : 'api_keys';
    console.error(`[create-api-key] API keys table: ${tableName}`);

    // Insert the key
    const id = randomBytes(8).toString('hex');
    await client.query(
      `INSERT INTO "${tableName}" (id, user_id, key_hash, name, created_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT DO NOTHING;`,
      [id, userId, keyHash, 'T308-run-3-key']
    );

    // Update ownership of demo document if slug is provided
    if (process.env.DEMO_SLUG) {
      await client.query(
        `UPDATE documents SET owner_id=$1, visibility='public' WHERE slug=$2;`,
        [userId, process.env.DEMO_SLUG]
      );
      console.error(`[create-api-key] Updated document ${process.env.DEMO_SLUG} owner to ${userId}`);
    }

    await client.end();
    console.log(`LLMTXT_API_KEY=${apiKey}`);
    console.log(`USER_ID=${userId}`);
    process.exit(0);
  } catch (err2) {
    console.error('[create-api-key] pg package not available either:', err2.message);
    process.exit(1);
  }
}

// Use postgres package
const sql = pg(DB_URL, { ssl: 'require', max: 1 });

try {
  // Get existing user
  const users = await sql`SELECT id FROM "user" LIMIT 1`;
  if (users.length === 0) {
    console.error('[create-api-key] No users found in DB');
    process.exit(1);
  }
  const userId = users[0].id;
  console.error(`[create-api-key] Using userId: ${userId}`);

  // Check table name
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename IN ('api_keys','apiKeys')
  `;
  const tableName = tables.length > 0 ? tables[0].tablename : 'api_keys';
  console.error(`[create-api-key] API keys table: ${tableName}`);

  // Insert
  const id = randomBytes(8).toString('hex');
  await sql.unsafe(
    `INSERT INTO "${tableName}" (id, user_id, key_hash, name, created_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT DO NOTHING`,
    [id, userId, keyHash, 'T308-run-3-key']
  );

  if (process.env.DEMO_SLUG) {
    await sql`UPDATE documents SET owner_id=${userId}, visibility='public' WHERE slug=${process.env.DEMO_SLUG}`;
    console.error(`[create-api-key] Updated document ${process.env.DEMO_SLUG} owner to ${userId}`);
  }

  await sql.end();
  console.log(`LLMTXT_API_KEY=${apiKey}`);
  console.log(`USER_ID=${userId}`);
} catch (err) {
  console.error('[create-api-key] Error:', err.message);
  process.exit(1);
}
