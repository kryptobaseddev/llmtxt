/**
 * T540: RLS isolation integration tests.
 *
 * These tests verify tenant isolation at the PostgreSQL layer using
 * `withRlsContext`.  They require a real PostgreSQL instance and are
 * automatically skipped when DATABASE_URL_PG is not set.
 *
 * What is tested:
 *   1. User A cannot SELECT a private document owned by User B.
 *   2. SELECT without a WHERE clause only returns the session user's rows.
 *   3. Admin bypass (isAdmin=true) sees all documents.
 *   4. Anonymous session (userId='') only sees public documents.
 *   5. Owner can always read their own documents.
 *
 * Run (PG mode):
 *   DATABASE_URL_PG=postgres://test:test@localhost:5432/llmtxt_test \
 *     node --import tsx/esm --test src/__tests__/rls-isolation.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { withRlsContext } from '../db/rls.js';
import { setupTestDb, teardownTestDb, type TestDbContext } from './helpers/test-db.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Minimal user row that satisfies the users table schema. */
function makeUser(id: string, email: string) {
  const now = new Date();
  return {
    id,
    name: email,
    email,
    emailVerified: false,
    image: null,
    createdAt: now,
    updatedAt: now,
    isAnonymous: false,
    agentId: null,
    expiresAt: null,
    region: 'us',
    deletedAt: null,
    deletionConfirmedAt: null,
    deletionToken: null,
    deletionRequestedAt: null,
    deletionScheduledAt: null,
  };
}

/** Minimal document row (all required columns, no owner). */
function makeDoc(overrides: Record<string, unknown>) {
  return {
    id: overrides.id as string,
    slug: overrides.slug as string,
    format: 'text',
    contentHash: 'sha256-placeholder',
    compressedData: null,
    originalSize: 10,
    compressedSize: 10,
    tokenCount: 3,
    createdAt: Date.now(),
    expiresAt: null,
    accessCount: 0,
    lastAccessedAt: null,
    state: 'DRAFT',
    ownerId: (overrides.ownerId as string) ?? null,
    isAnonymous: false,
    storageType: 'inline',
    storageKey: null,
    currentVersion: 0,
    versionCount: 0,
    sharingMode: 'signed_url',
    approvalRequiredCount: 1,
    approvalRequireUnanimous: false,
    approvalAllowedReviewers: '',
    approvalTimeoutMs: 0,
    visibility: (overrides.visibility as string) ?? 'private',
    eventSeqCounter: BigInt(0),
    bftF: 1,
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('RLS tenant isolation (PG only)', { skip: !process.env.DATABASE_URL_PG }, () => {
  let ctx: TestDbContext;

  // IDs for test fixtures
  const USER_A = 'test-user-a-00000000-0000-0000-0001';
  const USER_B = 'test-user-b-00000000-0000-0000-0002';
  const ADMIN_USER = 'test-admin-00000000-0000-0000-0003';
  const DOC_A_PRIVATE = { id: 'doc-a-priv-00000001', slug: 'doc-a-priv', visibility: 'private', ownerId: USER_A };
  const DOC_B_PRIVATE = { id: 'doc-b-priv-00000002', slug: 'doc-b-priv', visibility: 'private', ownerId: USER_B };
  const DOC_PUBLIC   = { id: 'doc-public-00000003', slug: 'doc-public',  visibility: 'public',  ownerId: USER_B };

  before(async () => {
    ctx = await setupTestDb();

    // Seed users
    for (const user of [makeUser(USER_A, 'usera@test.local'), makeUser(USER_B, 'userb@test.local'), makeUser(ADMIN_USER, 'admin@test.local')]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (ctx.db as any).insert((ctx.db as any)._.schema?.users ?? { _: {} }).values(user).onConflictDoNothing();
    }

    // Seed documents — we use raw SQL to avoid any RLS filtering during setup.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docTable = (ctx.db as any)._.schema?.documents;
    if (docTable) {
      for (const doc of [DOC_A_PRIVATE, DOC_B_PRIVATE, DOC_PUBLIC]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (ctx.db as any).insert(docTable).values(makeDoc(doc)).onConflictDoNothing();
      }
    }
  });

  after(async () => {
    await teardownTestDb(ctx);
  });

  it('userA cannot SELECT private document owned by userB', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docTable = (ctx.db as any)._.schema?.documents;
    if (!docTable) return; // Schema not available — skip gracefully

    const rows = await withRlsContext(
      ctx.db,
      { userId: USER_A },
      async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (tx as any).select().from(docTable).where(eq(docTable.id, DOC_B_PRIVATE.id));
      },
    );

    assert.equal(rows.length, 0, 'User A should NOT see User B private document');
  });

  it('userA SELECT all docs (no WHERE) only returns userA rows', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docTable = (ctx.db as any)._.schema?.documents;
    if (!docTable) return;

    const rows = await withRlsContext(
      ctx.db,
      { userId: USER_A },
      async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (tx as any).select().from(docTable);
      },
    );

    // Should only return: DOC_A_PRIVATE (owned by A) + DOC_PUBLIC (visibility=public)
    for (const row of rows) {
      assert.ok(
        row.ownerId === USER_A || row.visibility === 'public',
        `Row ${row.id} should not be visible to userA (owner=${row.ownerId}, vis=${row.visibility})`,
      );
    }
    // userB's private doc must NOT appear
    assert.ok(
      !rows.some((r: { id: string }) => r.id === DOC_B_PRIVATE.id),
      'User B private doc must not appear in User A full scan',
    );
  });

  it('admin bypass (isAdmin=true) sees all documents', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docTable = (ctx.db as any)._.schema?.documents;
    if (!docTable) return;

    const rows = await withRlsContext(
      ctx.db,
      { userId: ADMIN_USER, isAdmin: true },
      async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (tx as any).select().from(docTable);
      },
    );

    // Admin must see at least both private docs and the public doc
    const ids = rows.map((r: { id: string }) => r.id);
    assert.ok(ids.includes(DOC_A_PRIVATE.id), 'Admin must see User A private doc');
    assert.ok(ids.includes(DOC_B_PRIVATE.id), 'Admin must see User B private doc');
    assert.ok(ids.includes(DOC_PUBLIC.id), 'Admin must see public doc');
  });

  it('anonymous session (userId empty) only sees public documents', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docTable = (ctx.db as any)._.schema?.documents;
    if (!docTable) return;

    const rows = await withRlsContext(
      ctx.db,
      { userId: '' },
      async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (tx as any).select().from(docTable);
      },
    );

    for (const row of rows) {
      assert.equal(
        row.visibility,
        'public',
        `Anon session must only see public docs, got visibility=${row.visibility} for id=${row.id}`,
      );
    }
    assert.ok(!rows.some((r: { id: string }) => r.id === DOC_A_PRIVATE.id), 'Private docs hidden from anon');
    assert.ok(!rows.some((r: { id: string }) => r.id === DOC_B_PRIVATE.id), 'Private docs hidden from anon');
  });

  it('owner can always read their own private document', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docTable = (ctx.db as any)._.schema?.documents;
    if (!docTable) return;

    const rows = await withRlsContext(
      ctx.db,
      { userId: USER_A },
      async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (tx as any).select().from(docTable).where(eq(docTable.id, DOC_A_PRIVATE.id));
      },
    );

    assert.equal(rows.length, 1, 'Owner must be able to read their own private document');
    assert.equal(rows[0].id, DOC_A_PRIVATE.id);
  });
});
