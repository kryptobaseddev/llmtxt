/**
 * Unit / integration tests for withRlsContext (T533).
 *
 * These tests run against a real PostgreSQL instance when DATABASE_URL_PG is
 * set.  They are skipped in SQLite mode because SET LOCAL is a PG-only
 * construct.
 *
 * Run (PG mode):
 *   DATABASE_URL_PG=postgres://test:test@localhost:5432/llmtxt_test \
 *     node --import tsx/esm --test src/__tests__/rls-context.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { withRlsContext } from '../db/rls.js';
import { setupTestDb, teardownTestDb, type TestDbContext } from './helpers/test-db.js';

describe('withRlsContext (PG only)', { skip: !process.env.DATABASE_URL_PG }, () => {
  let ctx: TestDbContext;

  before(async () => {
    ctx = await setupTestDb();
  });

  after(async () => {
    await teardownTestDb(ctx);
  });

  it('sets app.current_user_id to the passed userId', async () => {
    const userId = 'a1b2c3d4-0000-0000-0000-000000000001';

    const result = await withRlsContext(ctx.db, { userId }, async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (tx as any).execute(
        sql`SELECT current_setting('app.current_user_id', true) AS val`,
      );
      return rows[0]?.val ?? rows.rows?.[0]?.val;
    });

    assert.equal(result, userId);
  });

  it('sets app.is_admin to false by default', async () => {
    const result = await withRlsContext(ctx.db, { userId: 'any-user' }, async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (tx as any).execute(
        sql`SELECT current_setting('app.is_admin', true) AS val`,
      );
      return rows[0]?.val ?? rows.rows?.[0]?.val;
    });

    assert.equal(result, 'false');
  });

  it('sets app.is_admin to true when isAdmin=true is passed', async () => {
    const result = await withRlsContext(
      ctx.db,
      { userId: 'admin-user', isAdmin: true },
      async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await (tx as any).execute(
          sql`SELECT current_setting('app.is_admin', true) AS val`,
        );
        return rows[0]?.val ?? rows.rows?.[0]?.val;
      },
    );

    assert.equal(result, 'true');
  });

  it('uses anon role when userId is empty', async () => {
    const result = await withRlsContext(ctx.db, { userId: '' }, async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (tx as any).execute(
        sql`SELECT current_setting('app.current_role', true) AS val`,
      );
      return rows[0]?.val ?? rows.rows?.[0]?.val;
    });

    assert.equal(result, 'anon');
  });

  it('uses authenticated role when userId is non-empty', async () => {
    const result = await withRlsContext(
      ctx.db,
      { userId: 'some-user-uuid' },
      async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await (tx as any).execute(
          sql`SELECT current_setting('app.current_role', true) AS val`,
        );
        return rows[0]?.val ?? rows.rows?.[0]?.val;
      },
    );

    assert.equal(result, 'authenticated');
  });

  it('SET LOCAL is scoped to the transaction — variable is cleared after commit', async () => {
    const userId = 'scoped-user-uuid';

    // Run the context to commit the transaction
    await withRlsContext(ctx.db, { userId }, async () => {
      // just let it commit naturally
    });

    // Outside the transaction, current_setting should return '' (missing setting)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (ctx.db as any).execute(
      sql`SELECT current_setting('app.current_user_id', true) AS val`,
    );
    const val = rows[0]?.val ?? rows.rows?.[0]?.val ?? '';
    // After commit, the SET LOCAL is gone; value will be '' or the previous
    // session-level value (which we never set).  It must NOT equal the userId
    // we injected inside the transaction.
    assert.notEqual(val, userId);
  });

  it('infers return type from fn — returns the fn result', async () => {
    const payload = { ok: true, num: 42 };

    const result = await withRlsContext(
      ctx.db,
      { userId: 'typed-user' },
      async () => payload,
    );

    assert.deepEqual(result, payload);
  });
});
