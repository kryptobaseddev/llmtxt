/**
 * T164: CI audit chain verification script.
 *
 * Seeds a freshly migrated test database with 10 audit log rows (including
 * payload_hash and chain_hash), then calls the in-process verify logic to
 * assert the chain is intact. If the chain is broken, exits with code 1
 * (failing the CI job).
 *
 * Does NOT start the HTTP server — runs the verification logic directly.
 *
 * Usage:
 *   DATABASE_URL_PG=postgres://test:test@localhost:5432/llmtxt_test \
 *     node --import tsx/esm scripts/ci-audit-chain-verify.ts
 */

import crypto from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, isNotNull } from 'drizzle-orm';
import * as schema from '../src/db/schema-pg.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../src/db/migrations-pg');

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function canonicalEventStr(
  id: string,
  eventType: string,
  actorId: string | null,
  resourceId: string | null,
  timestampMs: number,
): string {
  return [id, eventType, actorId ?? '', resourceId ?? '', String(timestampMs)].join('|');
}

function computeChainHash(prevHex: string, payloadHex: string): string {
  return crypto
    .createHash('sha256')
    .update(Buffer.from(prevHex, 'hex'))
    .update(Buffer.from(payloadHex, 'hex'))
    .digest('hex');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dbUrl = process.env.DATABASE_URL_PG;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL_PG env var is required');
    process.exit(1);
  }

  const client = postgres(dbUrl, { max: 1 });
  const db = drizzle(client, { schema });

  console.log('[ci-audit-chain] Applying migrations...');
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  // ── Seed 10 audit log rows with correct chain ────────────────────────────
  console.log('[ci-audit-chain] Seeding 10 audit events...');

  const GENESIS = '0'.repeat(64);
  let prevChainHash = GENESIS;

  const events = [
    { eventType: 'auth.login', actorId: 'user-1', resourceId: null },
    { eventType: 'document.create', actorId: 'agent-1', resourceId: 'doc-abc' },
    { eventType: 'lifecycle.transition', actorId: 'agent-1', resourceId: 'doc-abc' },
    { eventType: 'approval.submit', actorId: 'agent-2', resourceId: 'doc-abc' },
    { eventType: 'approval.submit', actorId: 'agent-3', resourceId: 'doc-abc' },
    { eventType: 'approval.reject', actorId: 'agent-4', resourceId: 'doc-abc' },
    { eventType: 'api_key.create', actorId: 'user-1', resourceId: null },
    { eventType: 'document.delete', actorId: 'user-1', resourceId: 'doc-xyz' },
    { eventType: 'auth.logout', actorId: 'user-1', resourceId: null },
    { eventType: 'document.create', actorId: 'agent-5', resourceId: 'doc-new' },
  ];

  const insertedIds: string[] = [];
  const now = Date.now();

  for (let i = 0; i < events.length; i++) {
    const { eventType, actorId, resourceId } = events[i];
    const id = crypto.randomUUID();
    const timestamp = now + i * 1000;

    const payloadHash = sha256hex(canonicalEventStr(id, eventType, actorId, resourceId, timestamp));
    const chainHash = computeChainHash(prevChainHash, payloadHash);
    prevChainHash = chainHash;
    insertedIds.push(id);

    await db.insert(schema.auditLogs).values({
      id,
      userId: null,
      agentId: actorId,
      ipAddress: '127.0.0.1',
      userAgent: 'ci-audit-verify/1.0',
      action: eventType,
      eventType,
      actorId,
      resourceType: eventType.split('.')[0],
      resourceId,
      details: null,
      timestamp,
      requestId: `req-${i}`,
      method: 'POST',
      path: '/api/ci-test',
      statusCode: 200,
      payloadHash,
      chainHash,
    });
  }

  console.log(`[ci-audit-chain] Inserted ${insertedIds.length} events`);

  // ── Verify chain ─────────────────────────────────────────────────────────
  console.log('[ci-audit-chain] Verifying chain...');

  const rows = await db
    .select({
      id: schema.auditLogs.id,
      eventType: schema.auditLogs.eventType,
      actorId: schema.auditLogs.actorId,
      resourceId: schema.auditLogs.resourceId,
      timestamp: schema.auditLogs.timestamp,
      payloadHash: schema.auditLogs.payloadHash,
      chainHash: schema.auditLogs.chainHash,
    })
    .from(schema.auditLogs)
    .where(isNotNull(schema.auditLogs.chainHash))
    .orderBy(asc(schema.auditLogs.timestamp));

  let verifyPrev = GENESIS;
  let firstInvalidAt: string | null = null;
  let chainLength = 0;

  for (const row of rows) {
    chainLength++;
    const expectedPayloadHash = sha256hex(
      canonicalEventStr(row.id, row.eventType ?? '', row.actorId, row.resourceId, row.timestamp),
    );
    const expectedChainHash = computeChainHash(verifyPrev, expectedPayloadHash);

    if (row.payloadHash !== expectedPayloadHash || row.chainHash !== expectedChainHash) {
      firstInvalidAt = row.id;
      break;
    }
    verifyPrev = row.chainHash as string;
  }

  await client.end();

  if (firstInvalidAt !== null) {
    console.error(`[ci-audit-chain] FAIL: chain broken at row ${firstInvalidAt}`);
    process.exit(1);
  }

  console.log(`[ci-audit-chain] PASS: chain intact (${chainLength} events verified)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[ci-audit-chain] Unexpected error:', err);
  process.exit(1);
});
