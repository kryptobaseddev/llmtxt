/**
 * One-time data migration script: SQLite → PostgreSQL
 *
 * Reads all rows from every LLMtxt table in the source SQLite database and
 * inserts them into the target PostgreSQL database in FK dependency order.
 * Handles type conversions (boolean integers, timestamp integers, blobs → bytea).
 *
 * Usage:
 *   SQLITE_SOURCE_PATH=./data.db \
 *   POSTGRES_TARGET_URL=postgresql://user:pass@host/db \
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts
 *
 * Environment variables:
 *   SQLITE_SOURCE_PATH   Path to the SQLite .db file (required)
 *                        Alias: SQLITE_DATABASE_URL (also accepted)
 *   POSTGRES_TARGET_URL  PostgreSQL connection string (required)
 *                        Alias: POSTGRES_DATABASE_URL (also accepted)
 *   BATCH_SIZE           Rows per INSERT batch (default: 1000)
 *   DRY_RUN              Set to "1" to skip inserts and only report counts
 *
 * Re-runnable: uses ON CONFLICT DO NOTHING on all inserts so re-running
 * against a partially-migrated target is safe (idempotent).
 *
 * Exit codes:
 *   0  All tables migrated and row counts verified
 *   1  Any error or count mismatch
 */

import Database from 'better-sqlite3';
import postgres from 'postgres';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import * as sqliteSchema from '../src/db/schema.js';
import * as pgSchema from '../src/db/schema-pg.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const SQLITE_PATH =
  process.env.SQLITE_SOURCE_PATH ??
  process.env.SQLITE_DATABASE_URL ??
  '';

const PG_URL =
  process.env.POSTGRES_TARGET_URL ??
  process.env.POSTGRES_DATABASE_URL ??
  '';

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '1000', 10);
const DRY_RUN = process.env.DRY_RUN === '1';

if (!SQLITE_PATH) {
  console.error(
    'ERROR: SQLITE_SOURCE_PATH (or SQLITE_DATABASE_URL) environment variable is required'
  );
  process.exit(1);
}

if (!PG_URL) {
  console.error(
    'ERROR: POSTGRES_TARGET_URL (or POSTGRES_DATABASE_URL) environment variable is required'
  );
  process.exit(1);
}

// ─── Open source (SQLite, read-only) ─────────────────────────────────────────

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const srcDb = drizzleSqlite({ client: sqlite, schema: sqliteSchema });

// ─── Open target (PostgreSQL) ─────────────────────────────────────────────────

const pgClient = postgres(PG_URL, {
  max: 5,
  connect_timeout: 10,
  idle_timeout: 30,
});
const dstDb = drizzlePg(pgClient, { schema: pgSchema });

// ─── Type conversion helpers ──────────────────────────────────────────────────

/**
 * Convert an integer (0/1) or native boolean from SQLite to a JS boolean.
 * Returns null if the input is null or undefined.
 */
function toBool(v: number | boolean | null | undefined): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  return v !== 0;
}

/**
 * Convert a value that may already be a Date or a unix-ms integer to a Date.
 * Returns null if the input is null or undefined.
 */
function toDate(v: Date | number | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  return new Date(v as number);
}

/**
 * Ensure a SQLite blob (Buffer | ArrayBuffer | null | undefined) becomes a
 * Node.js Buffer for PostgreSQL bytea columns.
 */
function toBuffer(v: Buffer | ArrayBuffer | Uint8Array | null | undefined): Buffer | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Buffer) return v;
  return Buffer.from(v as ArrayBuffer);
}

// ─── Batch insert helper ──────────────────────────────────────────────────────

interface TableResult {
  table: string;
  read: number;
  written: number;
  durationMs: number;
}

/**
 * Insert rows in batches of BATCH_SIZE using ON CONFLICT DO NOTHING.
 * Returns the number of rows passed to the insert function (pre-conflict).
 */
async function insertBatches<T extends Record<string, unknown>>(
  tableName: string,
  rows: T[],
  insertFn: (batch: T[]) => Promise<unknown>
): Promise<TableResult> {
  const start = Date.now();
  const read = rows.length;

  if (rows.length === 0) {
    const result: TableResult = { table: tableName, read: 0, written: 0, durationMs: 0 };
    console.log(JSON.stringify(result));
    return result;
  }

  let written = 0;
  if (!DRY_RUN) {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await insertFn(batch);
      written += batch.length;
    }
  }

  const result: TableResult = {
    table: tableName,
    read,
    written: DRY_RUN ? 0 : written,
    durationMs: Date.now() - start,
  };
  console.log(JSON.stringify(result));
  return result;
}

// ─── Table migration functions (FK dependency order) ─────────────────────────

/** 1. users — no FK dependencies */
async function migrateUsers(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.users);
  const mapped = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    emailVerified: toBool(r.emailVerified) ?? false,
    image: r.image ?? null,
    // SQLite stores these as integer({mode:'timestamp'}) → Drizzle returns Date objects
    createdAt: toDate(r.createdAt) ?? new Date(),
    updatedAt: toDate(r.updatedAt) ?? new Date(),
    isAnonymous: toBool(r.isAnonymous),
    agentId: r.agentId ?? null,
    expiresAt: r.expiresAt as number | null,
  }));
  return insertBatches('users', mapped, (b) =>
    dstDb.insert(pgSchema.users).values(b).onConflictDoNothing()
  );
}

/** 2. sessions — depends on users */
async function migrateSessions(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.sessions);
  const mapped = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    token: r.token,
    expiresAt: toDate(r.expiresAt) ?? new Date(),
    ipAddress: r.ipAddress ?? null,
    userAgent: r.userAgent ?? null,
    createdAt: toDate(r.createdAt) ?? new Date(),
    updatedAt: toDate(r.updatedAt) ?? new Date(),
  }));
  return insertBatches('sessions', mapped, (b) =>
    dstDb.insert(pgSchema.sessions).values(b).onConflictDoNothing()
  );
}

/** 3. accounts — depends on users */
async function migrateAccounts(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.accounts);
  const mapped = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    accountId: r.accountId,
    providerId: r.providerId,
    accessToken: r.accessToken ?? null,
    refreshToken: r.refreshToken ?? null,
    accessTokenExpiresAt: toDate(r.accessTokenExpiresAt),
    refreshTokenExpiresAt: toDate(r.refreshTokenExpiresAt),
    scope: r.scope ?? null,
    idToken: r.idToken ?? null,
    password: r.password ?? null,
    createdAt: toDate(r.createdAt) ?? new Date(),
    updatedAt: toDate(r.updatedAt) ?? new Date(),
  }));
  return insertBatches('accounts', mapped, (b) =>
    dstDb.insert(pgSchema.accounts).values(b).onConflictDoNothing()
  );
}

/** 4. verifications — no FK dependencies */
async function migrateVerifications(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.verifications);
  const mapped = rows.map((r) => ({
    id: r.id,
    identifier: r.identifier,
    value: r.value,
    expiresAt: toDate(r.expiresAt) ?? new Date(),
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  }));
  return insertBatches('verifications', mapped, (b) =>
    dstDb.insert(pgSchema.verifications).values(b).onConflictDoNothing()
  );
}

/** 5. documents — depends on users (ownerId) */
async function migrateDocuments(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.documents);
  const mapped = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    format: r.format,
    contentHash: r.contentHash,
    compressedData: toBuffer(r.compressedData),
    originalSize: r.originalSize,
    compressedSize: r.compressedSize,
    tokenCount: r.tokenCount ?? null,
    createdAt: r.createdAt as number,
    expiresAt: (r.expiresAt as number | null) ?? null,
    accessCount: r.accessCount,
    lastAccessedAt: (r.lastAccessedAt as number | null) ?? null,
    state: r.state,
    ownerId: r.ownerId ?? null,
    isAnonymous: toBool(r.isAnonymous) ?? false,
    storageType: r.storageType,
    storageKey: r.storageKey ?? null,
    currentVersion: r.currentVersion,
    versionCount: r.versionCount,
    sharingMode: r.sharingMode,
    approvalRequiredCount: r.approvalRequiredCount,
    approvalRequireUnanimous: toBool(r.approvalRequireUnanimous) ?? false,
    approvalAllowedReviewers: r.approvalAllowedReviewers,
    approvalTimeoutMs: r.approvalTimeoutMs as number,
    visibility: r.visibility,
  }));
  return insertBatches('documents', mapped, (b) =>
    dstDb.insert(pgSchema.documents).values(b).onConflictDoNothing()
  );
}

/** 6. versions — depends on documents */
async function migrateVersions(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.versions);
  const mapped = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    versionNumber: r.versionNumber,
    compressedData: toBuffer(r.compressedData),
    contentHash: r.contentHash,
    tokenCount: r.tokenCount ?? null,
    createdAt: r.createdAt as number,
    createdBy: r.createdBy ?? null,
    changelog: r.changelog ?? null,
    patchText: r.patchText ?? null,
    baseVersion: r.baseVersion ?? null,
    storageType: r.storageType,
    storageKey: r.storageKey ?? null,
  }));
  return insertBatches('versions', mapped, (b) =>
    dstDb.insert(pgSchema.versions).values(b).onConflictDoNothing()
  );
}

/** 7. stateTransitions — depends on documents */
async function migrateStateTransitions(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.stateTransitions);
  const mapped = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    fromState: r.fromState,
    toState: r.toState,
    changedBy: r.changedBy,
    changedAt: r.changedAt as number,
    reason: r.reason ?? null,
    atVersion: r.atVersion,
  }));
  return insertBatches('state_transitions', mapped, (b) =>
    dstDb.insert(pgSchema.stateTransitions).values(b).onConflictDoNothing()
  );
}

/** 8. approvals — depends on documents */
async function migrateApprovals(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.approvals);
  const mapped = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    reviewerId: r.reviewerId,
    status: r.status,
    timestamp: r.timestamp as number,
    reason: r.reason ?? null,
    atVersion: r.atVersion,
  }));
  return insertBatches('approvals', mapped, (b) =>
    dstDb.insert(pgSchema.approvals).values(b).onConflictDoNothing()
  );
}

/** 9. contributors — depends on documents */
async function migrateContributors(): Promise<TableResult> {
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
    displayName: r.displayName ?? null,
  }));
  return insertBatches('contributors', mapped, (b) =>
    dstDb.insert(pgSchema.contributors).values(b).onConflictDoNothing()
  );
}

/** 10. signedUrlTokens — depends on documents */
async function migrateSignedUrlTokens(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.signedUrlTokens);
  const mapped = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    slug: r.slug,
    agentId: r.agentId,
    conversationId: r.conversationId,
    orgId: r.orgId ?? null,
    signature: r.signature,
    signatureLength: r.signatureLength,
    expiresAt: r.expiresAt as number,
    createdAt: r.createdAt as number,
    revoked: toBool(r.revoked) ?? false,
    accessCount: r.accessCount,
    lastAccessedAt: (r.lastAccessedAt as number | null) ?? null,
  }));
  return insertBatches('signed_url_tokens', mapped, (b) =>
    dstDb.insert(pgSchema.signedUrlTokens).values(b).onConflictDoNothing()
  );
}

/** 11. apiKeys — depends on users */
async function migrateApiKeys(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.apiKeys);
  const mapped = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: r.name,
    keyHash: r.keyHash,
    keyPrefix: r.keyPrefix,
    scopes: r.scopes,
    lastUsedAt: (r.lastUsedAt as number | null) ?? null,
    expiresAt: (r.expiresAt as number | null) ?? null,
    revoked: toBool(r.revoked) ?? false,
    createdAt: r.createdAt as number,
    updatedAt: r.updatedAt as number,
  }));
  return insertBatches('api_keys', mapped, (b) =>
    dstDb.insert(pgSchema.apiKeys).values(b).onConflictDoNothing()
  );
}

/** 12. auditLogs — no FK constraints (userId is unconstrained text) */
async function migrateAuditLogs(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.auditLogs);
  const mapped = rows.map((r) => ({
    id: r.id,
    userId: r.userId ?? null,
    agentId: r.agentId ?? null,
    ipAddress: r.ipAddress ?? null,
    userAgent: r.userAgent ?? null,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId ?? null,
    details: r.details ?? null,
    timestamp: r.timestamp as number,
    requestId: r.requestId ?? null,
    method: r.method ?? null,
    path: r.path ?? null,
    statusCode: r.statusCode ?? null,
  }));
  return insertBatches('audit_logs', mapped, (b) =>
    dstDb.insert(pgSchema.auditLogs).values(b).onConflictDoNothing()
  );
}

/** 13. documentRoles — depends on documents, users */
async function migrateDocumentRoles(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.documentRoles);
  const mapped = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    userId: r.userId,
    role: r.role,
    grantedBy: r.grantedBy,
    grantedAt: r.grantedAt as number,
  }));
  return insertBatches('document_roles', mapped, (b) =>
    dstDb.insert(pgSchema.documentRoles).values(b).onConflictDoNothing()
  );
}

/** 14. organizations — depends on users (createdBy) */
async function migrateOrganizations(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.organizations);
  const mapped = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    createdBy: r.createdBy,
    createdAt: r.createdAt as number,
    updatedAt: r.updatedAt as number,
  }));
  return insertBatches('organizations', mapped, (b) =>
    dstDb.insert(pgSchema.organizations).values(b).onConflictDoNothing()
  );
}

/** 15. orgMembers — depends on organizations, users */
async function migrateOrgMembers(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.orgMembers);
  const mapped = rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    userId: r.userId,
    role: r.role,
    joinedAt: r.joinedAt as number,
  }));
  return insertBatches('org_members', mapped, (b) =>
    dstDb.insert(pgSchema.orgMembers).values(b).onConflictDoNothing()
  );
}

/** 16. documentOrgs — depends on documents, organizations */
async function migrateDocumentOrgs(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.documentOrgs);
  const mapped = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    orgId: r.orgId,
    addedAt: r.addedAt as number,
  }));
  return insertBatches('document_orgs', mapped, (b) =>
    dstDb.insert(pgSchema.documentOrgs).values(b).onConflictDoNothing()
  );
}

/** 17. pendingInvites — depends on documents */
async function migratePendingInvites(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.pendingInvites);
  const mapped = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    email: r.email,
    role: r.role,
    invitedBy: r.invitedBy,
    createdAt: r.createdAt as number,
    expiresAt: (r.expiresAt as number | null) ?? null,
  }));
  return insertBatches('pending_invites', mapped, (b) =>
    dstDb.insert(pgSchema.pendingInvites).values(b).onConflictDoNothing()
  );
}

/** 18. webhooks — depends on users */
async function migrateWebhooks(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.webhooks);
  const mapped = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    url: r.url,
    secret: r.secret,
    events: r.events,
    documentSlug: r.documentSlug ?? null,
    active: toBool(r.active) ?? true,
    failureCount: r.failureCount,
    lastDeliveryAt: (r.lastDeliveryAt as number | null) ?? null,
    lastSuccessAt: (r.lastSuccessAt as number | null) ?? null,
    createdAt: r.createdAt as number,
  }));
  return insertBatches('webhooks', mapped, (b) =>
    dstDb.insert(pgSchema.webhooks).values(b).onConflictDoNothing()
  );
}

/** 19. versionAttributions — depends on documents */
async function migrateVersionAttributions(): Promise<TableResult> {
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
  return insertBatches('version_attributions', mapped, (b) =>
    dstDb.insert(pgSchema.versionAttributions).values(b).onConflictDoNothing()
  );
}

/** 20. documentLinks — depends on documents (source + target) */
async function migrateDocumentLinks(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.documentLinks);
  const mapped = rows.map((r) => ({
    id: r.id,
    sourceDocId: r.sourceDocId,
    targetDocId: r.targetDocId,
    linkType: r.linkType,
    label: r.label ?? null,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt as number,
  }));
  return insertBatches('document_links', mapped, (b) =>
    dstDb.insert(pgSchema.documentLinks).values(b).onConflictDoNothing()
  );
}

/** 21. collections — depends on users (ownerId) */
async function migrateCollections(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.collections);
  const mapped = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description ?? null,
    ownerId: r.ownerId,
    visibility: r.visibility,
    createdAt: r.createdAt as number,
    updatedAt: r.updatedAt as number,
  }));
  return insertBatches('collections', mapped, (b) =>
    dstDb.insert(pgSchema.collections).values(b).onConflictDoNothing()
  );
}

/** 22. collectionDocuments — depends on collections, documents */
async function migrateCollectionDocuments(): Promise<TableResult> {
  const rows = await srcDb.select().from(sqliteSchema.collectionDocuments);
  const mapped = rows.map((r) => ({
    id: r.id,
    collectionId: r.collectionId,
    documentId: r.documentId,
    position: r.position,
    addedBy: r.addedBy ?? null,
    addedAt: r.addedAt as number,
  }));
  return insertBatches('collection_documents', mapped, (b) =>
    dstDb.insert(pgSchema.collectionDocuments).values(b).onConflictDoNothing()
  );
}

// ─── Row count verification ───────────────────────────────────────────────────

interface VerifyEntry {
  table: string;
  sqliteCount: number;
  pgCount: number;
  match: boolean;
}

async function verifyRowCounts(): Promise<{ allMatch: boolean; results: VerifyEntry[] }> {
  const { sql } = await import('drizzle-orm');

  const tableMap = [
    { name: 'users',               sqlite: sqliteSchema.users,               pg: pgSchema.users },
    { name: 'sessions',            sqlite: sqliteSchema.sessions,            pg: pgSchema.sessions },
    { name: 'accounts',            sqlite: sqliteSchema.accounts,            pg: pgSchema.accounts },
    { name: 'verifications',       sqlite: sqliteSchema.verifications,       pg: pgSchema.verifications },
    { name: 'documents',           sqlite: sqliteSchema.documents,           pg: pgSchema.documents },
    { name: 'versions',            sqlite: sqliteSchema.versions,            pg: pgSchema.versions },
    { name: 'state_transitions',   sqlite: sqliteSchema.stateTransitions,    pg: pgSchema.stateTransitions },
    { name: 'approvals',           sqlite: sqliteSchema.approvals,           pg: pgSchema.approvals },
    { name: 'contributors',        sqlite: sqliteSchema.contributors,        pg: pgSchema.contributors },
    { name: 'signed_url_tokens',   sqlite: sqliteSchema.signedUrlTokens,     pg: pgSchema.signedUrlTokens },
    { name: 'api_keys',            sqlite: sqliteSchema.apiKeys,             pg: pgSchema.apiKeys },
    { name: 'audit_logs',          sqlite: sqliteSchema.auditLogs,           pg: pgSchema.auditLogs },
    { name: 'document_roles',      sqlite: sqliteSchema.documentRoles,       pg: pgSchema.documentRoles },
    { name: 'organizations',       sqlite: sqliteSchema.organizations,       pg: pgSchema.organizations },
    { name: 'org_members',         sqlite: sqliteSchema.orgMembers,          pg: pgSchema.orgMembers },
    { name: 'document_orgs',       sqlite: sqliteSchema.documentOrgs,        pg: pgSchema.documentOrgs },
    { name: 'pending_invites',     sqlite: sqliteSchema.pendingInvites,      pg: pgSchema.pendingInvites },
    { name: 'webhooks',            sqlite: sqliteSchema.webhooks,            pg: pgSchema.webhooks },
    { name: 'version_attributions',sqlite: sqliteSchema.versionAttributions, pg: pgSchema.versionAttributions },
    { name: 'document_links',      sqlite: sqliteSchema.documentLinks,       pg: pgSchema.documentLinks },
    { name: 'collections',         sqlite: sqliteSchema.collections,         pg: pgSchema.collections },
    { name: 'collection_documents',sqlite: sqliteSchema.collectionDocuments, pg: pgSchema.collectionDocuments },
  ] as const;

  const results: VerifyEntry[] = [];
  let allMatch = true;

  for (const t of tableMap) {
    // SQLite: use Drizzle count query
    const sqliteResult = sqlite
      .prepare(`SELECT COUNT(*) as count FROM "${t.name}"`)
      .get() as { count: number };
    const sqliteCount = sqliteResult.count;

    // PG: use raw count via drizzle
    const pgResult = await dstDb
      .select({ count: sql<number>`COUNT(*)` })
      .from(t.pg as Parameters<typeof dstDb.select>[0]);
    const pgCount = Number(pgResult[0]?.count ?? 0);

    const match = pgCount >= sqliteCount; // >= because ON CONFLICT DO NOTHING may skip pre-existing rows
    if (!match) allMatch = false;

    results.push({ table: t.name, sqliteCount, pgCount, match });
    console.log(
      JSON.stringify({
        verify: t.name,
        sqliteCount,
        pgCount,
        status: match ? 'OK' : 'MISMATCH',
      })
    );
  }

  return { allMatch, results };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    JSON.stringify({
      event: 'migration_start',
      source: SQLITE_PATH,
      target: PG_URL.replace(/:\/\/[^@]+@/, '://<redacted>@'),
      dryRun: DRY_RUN,
      batchSize: BATCH_SIZE,
    })
  );

  const results: TableResult[] = [];

  try {
    // Migrate in FK dependency order: parents first, then children.
    // ─ Tier 0: no FK dependencies
    results.push(await migrateUsers());
    results.push(await migrateVerifications());
    // ─ Tier 1: depends on users only
    results.push(await migrateSessions());
    results.push(await migrateAccounts());
    results.push(await migrateApiKeys());
    results.push(await migrateOrganizations());
    results.push(await migrateCollections());
    // ─ Tier 2: depends on users + documents
    results.push(await migrateDocuments());
    // ─ Tier 3: depends on documents (and sometimes users)
    results.push(await migrateVersions());
    results.push(await migrateStateTransitions());
    results.push(await migrateApprovals());
    results.push(await migrateContributors());
    results.push(await migrateSignedUrlTokens());
    results.push(await migrateAuditLogs());
    results.push(await migrateDocumentRoles());
    results.push(await migratePendingInvites());
    results.push(await migrateWebhooks());
    results.push(await migrateVersionAttributions());
    results.push(await migrateDocumentLinks());
    // ─ Tier 4: depends on organizations + users
    results.push(await migrateOrgMembers());
    // ─ Tier 5: depends on documents + organizations
    results.push(await migrateDocumentOrgs());
    // ─ Tier 6: depends on collections + documents
    results.push(await migrateCollectionDocuments());

    if (DRY_RUN) {
      console.log(JSON.stringify({ event: 'dry_run_complete', tables: results.length }));
      return;
    }

    // Verify counts
    console.log(JSON.stringify({ event: 'verification_start' }));
    const { allMatch, results: verifyResults } = await verifyRowCounts();

    const summary = {
      event: 'migration_complete',
      tablesProcessed: results.length,
      totalRead: results.reduce((sum, r) => sum + r.read, 0),
      totalWritten: results.reduce((sum, r) => sum + r.written, 0),
      allCountsMatch: allMatch,
      mismatches: verifyResults.filter((v) => !v.match).map((v) => v.table),
    };
    console.log(JSON.stringify(summary));

    if (!allMatch) {
      console.error(
        'ERROR: Row count mismatch detected. See verification output above.'
      );
      process.exit(1);
    }
  } finally {
    sqlite.close();
    await pgClient.end();
  }
}

main().catch((err: unknown) => {
  console.error(
    JSON.stringify({
      event: 'migration_error',
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
  );
  process.exit(1);
});
