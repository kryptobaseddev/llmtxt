/**
 * Fastify RLS Plugin — injects Row-Level Security context on every request.
 *
 * Registers an `onRequest` hook that decorates each `FastifyRequest` with:
 *   • `request.rlsContext` — an `RlsContext` resolved from the session user.
 *   • `request.withRls(fn)` — a convenience wrapper that calls
 *     `withRlsContext(db, request.rlsContext, fn)`.
 *
 * Route handlers that perform direct Drizzle queries SHOULD call
 * `request.withRls(async (tx) => { ... })` instead of importing `db`
 * directly.  This ensures the PG session variables are set before any
 * query executes.
 *
 * The plugin is a no-op in SQLite mode (DATABASE_PROVIDER !== 'postgresql')
 * because `withRlsContext` itself is already a no-op in that case.
 *
 * Admin elevation:
 *   The `onRequest` hook always sets `isAdmin = false`.  Routes that have
 *   already run the `requireAdmin` preHandler MUST call `withRlsContext`
 *   explicitly with `{ isAdmin: true }`, or use the `withRlsAdmin(fn)`
 *   request helper.
 *
 * @module plugins/rls-plugin
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../db/index.js';
import { withRlsContext, type RlsContext, type RlsFn } from '../db/rls.js';
import { isAdminEmail } from '../middleware/admin.js';

// ─────────────────────────────────────────────────────────────────────────────
// Type augmentation
// ─────────────────────────────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * RLS context resolved for this request.
     *
     * Available after the `onRequest` hook registered by `registerRlsPlugin`
     * has run.  Routes that execute direct Drizzle queries SHOULD use this
     * context when calling `withRlsContext`.
     */
    rlsContext: RlsContext;

    /**
     * Convenience wrapper: executes `fn` inside a `withRlsContext` transaction
     * using the current request's session context (non-admin).
     *
     * Use `request.withRls(fn)` instead of `withRlsContext(db, ctx, fn)`.
     */
    withRls: <TReturn>(fn: RlsFn<typeof db, TReturn>) => Promise<TReturn>;

    /**
     * Like `withRls` but sets `isAdmin = true`.
     *
     * MUST only be called inside route handlers that have already been
     * protected by the `requireAdmin` preHandler.
     */
    withRlsAdmin: <TReturn>(fn: RlsFn<typeof db, TReturn>) => Promise<TReturn>;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register the RLS plugin with a Fastify instance.
 *
 * Must be registered AFTER auth middleware so that `request.user` is
 * populated before the `onRequest` hook fires.  In practice, registration
 * order in Fastify ensures auth hooks run first when they are registered on
 * the same or outer scope.
 *
 * @param app - The Fastify instance to register on.
 */
export async function registerRlsPlugin(app: FastifyInstance): Promise<void> {
  // Canonical Fastify 5 pattern for hook-populated request properties (see
  // docs/Guides/Migration-Guide-V5.md "Handle Decorator Reference Types"):
  //
  //   1. Call `decorateRequest(name)` with NO default value — this declares
  //      the slot on the Request prototype, which:
  //        • preserves V8 hidden-class monomorphism on the hot path,
  //        • lets other plugins verify the decorator exists via
  //          `app.hasRequestDecorator(name)`,
  //        • avoids the Fastify 5 prohibition on reference-type defaults
  //          (objects/functions/arrays would be shared across all requests →
  //          state leakage / CVE class of bugs).
  //   2. Fill the slot in an `onRequest` hook so every request gets its own
  //      instance. `onRequest` is the first hook in the request lifecycle,
  //      so any handler that runs sees populated values — matching the
  //      non-null `RlsContext` type declared via module augmentation above.
  //
  // References:
  //   https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/#handle-decorator-reference-types-in-fastify
  //   https://fastify.dev/docs/latest/Reference/Decorators/#decoraterequest

  app.decorateRequest('rlsContext');
  app.decorateRequest('withRls');
  app.decorateRequest('withRlsAdmin');

  app.addHook('onRequest', async (request: FastifyRequest) => {
    // Resolve user context from the auth middleware output.
    // `request.user` is set by requireAuth / tryBearerAuth.
    const userId = request.user?.id ?? '';
    const isAdmin = isAdminEmail(request.user?.email);

    const ctx: RlsContext = {
      userId,
      isAdmin: false, // Default: never elevate to admin automatically.
      role: userId ? 'authenticated' : 'anon',
    };

    request.rlsContext = ctx;

    // Bind helpers to the db singleton for this request.
    request.withRls = <TReturn>(fn: RlsFn<typeof db, TReturn>) =>
      withRlsContext(db, ctx, fn);

    request.withRlsAdmin = <TReturn>(fn: RlsFn<typeof db, TReturn>) =>
      withRlsContext(db, { ...ctx, isAdmin: true }, fn);

    // Log admin context in debug mode (never log secrets or userId in prod logs).
    if (isAdmin) {
      request.log.debug({ path: request.url }, '[rls] admin context resolved');
    }
  });

  app.log.info('[rls-plugin] RLS request context hook registered');
}
