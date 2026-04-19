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
  // Decorate request with placeholder factories.  Fastify 5 rejects a raw
  // reference-type default (object/function) because every request would share
  // the same instance; the { getter } form produces a fresh value per request.
  // The onRequest hook below overwrites these placeholders before any handler
  // sees them, so the getter return values are never actually consumed.
  app.decorateRequest('rlsContext', {
    getter() {
      return { userId: '', role: 'anon' as const } as RlsContext;
    },
  });
  app.decorateRequest('withRls', {
    getter() {
      return (() => Promise.resolve(undefined)) as FastifyRequest['withRls'];
    },
  });
  app.decorateRequest('withRlsAdmin', {
    getter() {
      return (() => Promise.resolve(undefined)) as FastifyRequest['withRlsAdmin'];
    },
  });

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
