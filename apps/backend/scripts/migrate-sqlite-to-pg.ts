/**
 * Data migration script: SQLite → PostgreSQL
 *
 * Reads all rows from every LLMtxt table in a source SQLite database and
 * inserts them into a target PostgreSQL database. Handles type conversions
 * (boolean integers, unix-ms timestamps, blobs → bytea).
 *
 * Usage:
 *   SQLITE_URL=./data.db DATABASE_URL=postgresql://... npx tsx scripts/migrate-sqlite-to-pg.ts
 *
 * Options (env vars):
 *   SQLITE_URL      Path to the SQLite .db file (default: ./data.db)
 *   DATABASE_URL    PostgreSQL connection string (required)
 *   BATCH_SIZE      Rows per INSERT batch (default: 500)
 *   DRY_RUN         Set to "1" to skip inserts and only verify row counts
 */

import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import * as sqliteSchema from '../src/db/schema.js';
import * as pgSchema from '../src/db/schema-pg.js';

const SQLITE_URL = process.env.SQLITE_URL || './data.db';
const PG_URL = process.env.DATABASE_URL;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '500', 10);
const DRY_RUN = process.env.DRY_RUN === '1';

if (!PG_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

// ─── Open source (SQLite) ───────────────────────────────────────────────────

const sqlite = new Database(SQLITE_URL, { readonly: true });
const srcDb = drizzleSqlite({ client: sqlite, schema: sqliteSchema });

// ─── Open target (PostgreSQL) ───────────────────────────────────────────────

const pool = new Pool({
  connectionString: PG_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
});
const dstDb = drizzlePg(pool, { schema: pgSchema });

// ─── Utilities ──────────────────────────────────────────────────────────────

/** Convert an integer (0/1) boolean from SQLite to a native boolean. */
function toBool(v: number | boolean | null | undefined): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  return v !== 0;
}

/**
 * Convert a unix-ms integer to a Date object for better-auth timestamp columns.
 * Returns null if the value is null/undefined.
 */
function toDate(ms: number | null | undefined): Date | null {
  if (ms === null || ms === undefined) return null;
  return new Date(ms);
}

/** Convert a SQLite blob (Buffer | ArrayBuffer | null) to a Buffer for bytea. */
function toBuffer(v: Buffer | ArrayBuffer | null | undefined): Buffer | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Buffer) return v;
  return Buffer.from(v);
}

/** Insert rows in batches; returns total rows inserted. */
async function insertBatch<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  insertFn: (batch: T[]) => Promise<unknown>
): Promise<number> {
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows — skipping`);
    return 0;
  }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    if (!DRY_RUN) {
      await insertFn(batch);
    }
    inserted += batch.length;
  }
  console.log(`  ${table}: ${inserted} rows ${DRY_RUN ? '(dry run)' : 'migrated'}`);
  return inserted;
}

// ─── Table migration functions ───────────────────────────────────────────────

async function migrateUsers() {
  const rows = await srcDb.select().from(sqliteSchema.users);
  const mapped = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    emailVerified: toBool(r.emailVerified) ?? false,
    image: r.image,
    // better-auth expects Date objects for timestamp columns
    createdAt: toDate(r.createdAt instanceof Date ? r.createdAt.getTime() : r.createdAt as unknown as number) ?? new Date(),
    updatedAt: toDate(r.updatedAt instanceof Date ? r.updatedAt.getTime() : r.updatedAt as unknown as number) ?? new Date(),
    isAnonymous: toBool(r.isAnonymous),
    agentId: r.agentId,
    expiresAt: r.expiresAt as number | null,
  }));
  return insertBatch('users', mapped, (b) => dstDb.insert(pgSchema.users).values(b).onConflictDoNothing());
}

async function migrateSessions() {
  const rows = await srcDb.select().from(sqliteSchema.sessions);
  const mapped = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    token: r.token,
    // expiresAt on the SQLite schema is integer({ mode: 'timestamp' }) → Date
    expiresAt: r.expiresAt instanceof Date ? r.expiresAt : new Date((r.expiresAt as unknown as number)),
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date((r.createdAt as unknown as number)),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt : new Date((r.updatedAt as unknown as number)),
  }));
  return insertBatch('sessions', mapped, (b) => dstDb.insert(pgSchema.sessions).values(b).onConflictDoNothing());
}

async function migrateAccounts() {
  const rows = await srcDb.select().from(sqliteSchema.accounts);
  const mapped = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    accountId: r.accountId,
    providerId: r.providerId,
    accessToken: r.accessToken,
    refreshToken: r.refreshToken,
    accessTokenExpiresAt: r.accessTokenExpiresAt instanceof Date
      ? r.accessTokenExpiresAt
      : r.accessTokenExpiresAt != null ? new Date(r.accessTokenExpiresAt as unknown as number) : null,
    refreshTokenExpiresAt: r.refreshTokenExpiresAt instanceof Date
      ? r.refreshTokenExpiresAt
      : r.refreshTokenExpiresAt != null ? new Date(r.refreshTokenExpiresAt as unknown as number) : null,
    scope: r.scope,
    idToken: r.idToken,
    password: r.password,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as unknown as number),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt as unknown as number),
  }));
  return insertBatch('accounts', mapped, (b) => dstDb.insert(pgSchema.accounts).values(b).onConflictDoNothing());
}

async function migrateVerifications() {
  const rows = await srcDb.select().from(sqliteSchema.verifications);
  const mapped = rows.map((r) => ({
    id: r.id,
    identifier: r.identifier,
    value: r.value,
    expiresAt: r.expiresAt instanceof Date ? r.expiresAt : new Date(r.expiresAt as unknown as number),
    createdAt: r.createdAt instanceof Date
      ? r.createdAt
      : r.createdAt != null ? new Date(r.createdAt as unknown as number) : null,
    updatedAt: r.updatedAt instanceof Date
      ? r.updatedAt
      : r.updatedAt != null ? new Date(r.updatedAt as unknown as number) : null,
  }));
  return insertBatch('verifications', mapped, (b) => dstDb.insert(pgSchema.verifications).values(b).onConflictDoNothing());
}

async function migrateDocuments() {
  const rows = await srcDb.select().from(sqliteSchema.documents);
  const mapped = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    format: r.format,
    contentHash: r.contentHash,
    compressedData: toBuffer(r.compressedData),
    originalSize: r.originalSize,
    compressedSize: r.compressedSize,
    tokenCount: r.tokenCount,
    createdAt: r.createdAt as number,
    expiresAt: r.expiresAt as number | null,
    accessCount: r.accessCount,
    lastAccessedAt: r.lastAccessedAt as number | null,
    state: r.state,
    ownerId: r.ownerId,
    isAnonymous: toBool(r.isAnonymous) ?? false,
    storageType: r.storageType,
    storageKey: r.storageKey,
    currentVersion: r.currentVersion,
    versionCount: r.versionCount,
    sharingMode: r.sharingMode,
    approvalRequiredCount: r.approvalRequiredCount,
    approvalRequireUnanimous: toBool(r.approvalRequireUnanimous) ?? false,
    approvalAllowedReviewers: r.approvalAllowedReviewers,
    approvalTimeoutMs: r.approvalTimeoutMs as number,
  }));
  return insertBatch('documents', mapped, (b) => dstDb.insert(pgSchema.documents).values(b).onConflictDoNothing());
}

async function migrateVersions() {
  const rows = await srcDb.select().from(sqliteSchema.versions);
  const mapped = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    versionNumber: r.versionNumber,
    compressedData: toBuffer(r.compressedData),
    contentHash: r.contentHash,
    tokenCount: r.tokenCount,
    createdAt: r.createdAt as number,
    createdBy: r.createdBy,
    changelog: r.changelog,
    patchText: r.patchText,
    baseVersion: r.baseVersion,
    storageType: r.storageType,
    storageKey: r.storageKey,
  }));
  return insertBatch('versions', mapped, (b) => dstDb.insert(pgSchema.versions).values(b).onConflictDoNothing());
}

async function migrateStateTransitions() {
  const rows = await srcDb.select().from(sqliteSchema.stateTransitions);
  const mapped = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    fromState: r.fromState,
    toState: r.toState,
    changedBy: r.changedBy,
    changedAt: r.changedAt as number,
    reason: r.reason,
    atVersion: r.atVersion,
  }));
  return insertBatch('state_transitions', mapped, (b) => dstDb.insert(pgSchema.stateTransitions).values(b).onConflictDoNothing());
}

async function migrateApprovals() {
  const rows = await srcDb.select().from(sqliteSchema.approvals);
  const mapped = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    reviewerId: r.reviewerId,
    status: r.status,
    timestamp: r.timestamp as number,
    reason: r.reason,
    atVersion: r.atVersion,
  }));
  return insertBatch('approvals', mapped, (b) => dstDb.insert(pgSchema.approvals).values(b).onConflictDoNothing());
}

async function migrateContributors() {
  const rows = await srcDb.select().from(sqliteSchema.contributors);
  const mapped = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    agentId: r.agentId,
    versionsAuthored: r.versionsAuthored,
    totalTokensAdded: r.totalTokensAdded,
    totalTokensRemoved: r.totalTokensRemoved,
    netTokens: r.netTokens,
    firstContribution: r.firstContribution as number,
    lastContribution: r.lastContribution as number,
    sectionsModified: r.sectionsModified,
    displayName: r.displayName,
  }));
  return insertBatch('contributors', mapped, (b) => dstDb.insert(pgSchema.contributors).values(b).onConflictDoNothing());
}

async function migrateSignedUrlTokens() {
  const rows = await srcDb.select().from(sqliteSchema.signedUrlTokens);
  const mapped = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    slug: r.slug,
    agentId: r.agentId,
    conversationId: r.conversationId,
    orgId: r.orgId,
    signature: r.signature,
    signatureLength: r.signatureLength,
    expiresAt: r.expiresAt as number,
    createdAt: r.createdAt as number,
    revoked: toBool(r.revoked) ?? false,
    accessCount: r.accessCount,
    lastAccessedAt: r.lastAccessedAt as number | null,
  }));
  return insertBatch('signed_url_tokens', mapped, (b) => dstDb.insert(pgSchema.signedUrlTokens).values(b).onConflictDoNothing());
}

async function migrateVersionAttributions() {
  const rows = await srcDb.select().from(sqliteSchema.versionAttributions);
  const mapped = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    versionNumber: r.versionNumber,
    authorId: r.authorId,
    addedLines: r.addedLines,
    removedLines: r.removedLines,
    addedTokens: r.addedTokens,
    removedTokens: r.removedTokens,
    sectionsModified: r.sectionsModified,
    changelog: r.changelog,
    createdAt: r.createdAt as number,
  }));
  return insertBatch('version_attributions', mapped, (b) => dstDb.insert(pgSchema.versionAttributions).values(b).onConflictDoNothing());
}

// ─── Verification ────────────────────────────────────────────────────────────

async function verifyRowCounts() {
  const tables = [
    { name: 'users',               sqlite: sqliteSchema.users,               pg: pgSchema.users },
    { name: 'sessions',            sqlite: sqliteSchema.sessions,            pg: pgSchema.sessions },
    { name: 'accounts',            sqlite: sqliteSchema.accounts,            pg: pgSchema.accounts },
    { name: 'verifications',       sqlite: sqliteSchema.verifications,       pg: pgSchema.verifications },
    { name: 'documents',           sqlite: sqliteSchema.documents,           pg: pgSchema.documents },
    { name: 'versions',            sqlite: sqliteSchema.versions,            pg: pgSchema.versions },
    { name: 'state_transitions',   sqlite: sqliteSchema.stateTransitions,   pg: pgSchema.stateTransitions },
    { name: 'approvals',           sqlite: sqliteSchema.approvals,           pg: pgSchema.approvals },
    { name: 'contributors',        sqlite: sqliteSchema.contributors,        pg: pgSchema.contributors },
    { name: 'signed_url_tokens',   sqlite: sqliteSchema.signedUrlTokens,    pg: pgSchema.signedUrlTokens },
    { name: 'version_attributions',sqlite: sqliteSchema.versionAttributions,pg: pgSchema.versionAttributions },
  ] as const;

  console.log('\nVerifying row counts:');
  let allMatch = true;
  for (const t of tables) {
    const srcRows = await srcDb.select().from(t.sqlite as Parameters<typeof srcDb.select>[0]);
    const dstRows = await dstDb.select().from(t.pg as Parameters<typeof dstDb.select>[0]);
    const match = srcRows.length === dstRows.length;
    const icon = match ? 'OK' : 'MISMATCH';
    console.log(`  ${icon}  ${t.name}: sqlite=${srcRows.length} pg=${dstRows.length}`);
    if (!match) allMatch = false;
  }
  return allMatch;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`LLMtxt SQLite → PostgreSQL migration`);
  console.log(`  Source:  ${SQLITE_URL}`);
  console.log(`  Target:  ${PG_URL!.replace(/:\/\/[^@]+@/, '://<credentials>@')}`);
  console.log(`  DryRun:  ${DRY_RUN}`);
  console.log(`  Batch:   ${BATCH_SIZE} rows\n`);

  try {
    // Migrate in dependency order (FK parents before children)
    await migrateUsers();
    await migrateSessions();
    await migrateAccounts();
    await migrateVerifications();
    await migrateDocuments();
    await migrateVersions();
    await migrateStateTransitions();
    await migrateApprovals();
    await migrateContributors();
    await migrateSignedUrlTokens();
    await migrateVersionAttributions();

    const allMatch = await verifyRowCounts();

    if (allMatch) {
      console.log('\nMigration complete. All row counts match.');
    } else {
      console.error('\nWARNING: Row count mismatch detected. Review output above.');
      process.exit(1);
    }
  } finally {
    sqlite.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
