/**
 * Row-Level Security (RLS) session injection for postgres-js + Drizzle ORM.
 *
 * Every authenticated route that touches Postgres MUST wrap its database
 * operations in `withRlsContext` so that the RLS policies on each table can
 * read the current user, role, and admin flag from `SET LOCAL` session
 * variables.
 *
 * Implementation notes
 * ────────────────────
 * • `SET LOCAL` scopes the GUC to the transaction lifetime.  When the
 *   transaction commits or rolls back the variable is cleared, preventing
 *   cross-request leakage across connection-pool entries.
 * • `isAdmin` MUST default to `false`.  Only routes that have already
 *   verified admin status (via `requireAdmin` middleware) may pass `true`.
 * • For unauthenticated / anonymous requests, pass `userId = ''`.  The RLS
 *   policies treat an empty string as "no user" and permit only `visibility =
 *   'public'` rows to be returned.
 *
 * @module db/rls
 */

import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Session context injected into every PostgreSQL transaction.
 *
 * @property userId   - UUID of the authenticated user, or `''` for anonymous.
 * @property orgIds   - Comma-separated list of org UUIDs the user belongs to.
 *                      Pass `''` when the user has no org memberships.
 * @property role     - `'authenticated'` or `'anon'`.
 * @property isAdmin  - When `true`, `app.is_admin` is set to `'true'` inside
 *                      the transaction, bypassing all ownership checks.
 *                      MUST only be `true` for routes guarded by `requireAdmin`.
 */
export interface RlsContext {
  userId: string;
  orgIds?: string;
  role?: 'authenticated' | 'anon';
  isAdmin?: boolean;
}

/**
 * Callback that receives the transaction-scoped Drizzle handle and can run
 * arbitrary queries against it.  The return type is inferred from the
 * callback's own return annotation.
 */
export type RlsFn<TDb, TReturn> = (tx: TDb) => Promise<TReturn>;

// ─────────────────────────────────────────────────────────────────────────────
// Core helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap `fn` in a Drizzle transaction and inject RLS session variables before
 * executing `fn`.
 *
 * The four session GUCs set are:
 *   • `app.current_user_id`  — authenticated user UUID (empty string for anon)
 *   • `app.current_org_ids`  — comma-separated org UUIDs (empty string if none)
 *   • `app.current_role`     — `'authenticated'` | `'anon'`
 *   • `app.is_admin`         — `'true'` | `'false'`
 *
 * Example (authenticated, non-admin):
 * ```typescript
 * const doc = await withRlsContext(db, { userId: session.userId }, async (tx) => {
 *   return tx.select().from(documents).where(eq(documents.id, docId));
 * });
 * ```
 *
 * Example (admin route):
 * ```typescript
 * const all = await withRlsContext(db, { userId: adminId, isAdmin: true }, async (tx) => {
 *   return tx.select().from(documents);
 * });
 * ```
 *
 * @param db       - Drizzle ORM instance (must be the PostgreSQL provider).
 * @param ctx      - RLS session context for this request.
 * @param fn       - Async callback that receives the transaction handle.
 * @returns        - The value returned by `fn`.
 *
 * @throws         - Re-throws any error from `fn` after the transaction rolls back.
 */
export async function withRlsContext<
  TDb extends { transaction: (fn: (tx: TDbTx) => Promise<unknown>) => Promise<unknown>; execute: (query: unknown) => Promise<unknown> },
  TDbTx,
  TReturn,
>(
  db: TDb,
  ctx: RlsContext,
  fn: RlsFn<TDbTx, TReturn>,
): Promise<TReturn> {
  const userId = ctx.userId ?? '';
  const orgIds = ctx.orgIds ?? '';
  const role = ctx.role ?? (userId ? 'authenticated' : 'anon');
  const isAdmin = ctx.isAdmin === true;

  return (db as unknown as { transaction: (fn: (tx: TDbTx) => Promise<TReturn>) => Promise<TReturn> }).transaction(
    async (tx) => {
      // Cast tx to any for raw SQL execution — Drizzle's transaction handle
      // does not expose a typed `execute` for arbitrary SQL in all versions,
      // but the runtime always supports it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txAny = tx as any;

      // Inject session GUCs.  `SET LOCAL` is transaction-scoped; when the
      // transaction ends (commit or rollback) the variables are cleared.
      await txAny.execute(sql`SET LOCAL "app.current_user_id" = ${userId}`);
      await txAny.execute(sql`SET LOCAL "app.current_org_ids" = ${orgIds}`);
      await txAny.execute(sql`SET LOCAL "app.current_role" = ${role}`);
      await txAny.execute(
        sql`SET LOCAL "app.is_admin" = ${isAdmin ? 'true' : 'false'}`,
      );

      return fn(tx);
    },
  );
}
