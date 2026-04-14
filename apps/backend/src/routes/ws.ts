/**
 * WebSocket subscription routes.
 *
 * Requires @fastify/websocket to be registered on the Fastify instance BEFORE
 * these routes are registered.
 *
 * Routes:
 *   GET /ws/documents/:slug  — Subscribe to events for one document
 *   GET /ws/documents        — Subscribe to events for ALL of the caller's documents
 *
 * Authentication:
 *   Pass an API key via the `?token=llmtxt_...` query parameter.
 *   WebSocket upgrade requests cannot carry an Authorization header, so the
 *   token is sent in the URL. The token is validated against the sessions table
 *   via better-auth. Anonymous connections are rejected with close code 4401.
 *
 * Message protocol (client → server):
 *   { "type": "ping" }                              → { "type": "pong" }
 *   { "type": "filter", "events": ["version.created"] }  → acknowledgement
 *
 * Event messages (server → client):
 *   All DocumentEvent objects serialized as JSON.
 */
import type { FastifyInstance } from 'fastify';
import { auth } from '../auth.js';
import { eventBus, type DocumentEvent } from '../events/bus.js';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { eq } from 'drizzle-orm';

// ── Auth helper ───────────────────────────────────────────────────────────────

/**
 * Resolve user from a WebSocket upgrade request.
 *
 * Accepts:
 * 1. Session cookie (same as HTTP routes)
 * 2. `?token=<bearer>` query parameter (API key / session token)
 *
 * Returns the user object or null.
 */
async function resolveWsUser(request: {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
}): Promise<{ id: string } | null> {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value) headers.append(key, String(value));
    }

    // Inject token from query param as Authorization header so better-auth
    // can validate it alongside cookie sessions.
    const token = request.query['token'];
    if (token && typeof token === 'string') {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const session = await auth.api.getSession({ headers });
    return session?.user ? { id: session.user.id } : null;
  } catch {
    return null;
  }
}

// ── Route registration ────────────────────────────────────────────────────────

/** Register WebSocket subscription routes. The fastify instance must have @fastify/websocket registered. */
export async function wsRoutes(app: FastifyInstance) {
  /**
   * GET /ws/documents/:slug
   *
   * Subscribe to real-time events for a single document.
   * No authentication required — documents are publicly readable.
   * The subscriber receives all DocumentEvent objects whose slug matches.
   *
   * Client messages:
   *   { type: 'ping' }                               — keepalive
   *   { type: 'filter', events: string[] }           — restrict to event types
   */
  app.get<{ Params: { slug: string }; Querystring: Record<string, string> }>(
    '/documents/:slug',
    { websocket: true },
    (socket, request) => {
      const { slug } = request.params;
      // Active event-type filter. Null = no filter (receive all).
      let activeFilter: Set<string> | null = null;

      const listener = (event: DocumentEvent) => {
        if (event.slug !== slug) return;
        if (activeFilter && !activeFilter.has(event.type)) return;
        try {
          socket.send(JSON.stringify(event));
        } catch {
          // Socket may have closed between the listener check and send.
        }
      };

      eventBus.on('document', listener);

      // Send a connection-established message immediately.
      socket.send(JSON.stringify({ type: 'connected', slug, timestamp: Date.now() }));

      socket.on('message', (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as Record<string, unknown>;
          if (msg.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          } else if (msg.type === 'filter' && Array.isArray(msg.events)) {
            activeFilter = msg.events.length > 0 ? new Set(msg.events as string[]) : null;
            socket.send(JSON.stringify({ type: 'filter_ack', events: msg.events, timestamp: Date.now() }));
          }
        } catch {
          // Ignore malformed messages.
        }
      });

      socket.on('close', () => {
        eventBus.off('document', listener);
      });
    },
  );

  /**
   * GET /ws/documents
   *
   * Subscribe to events for ALL documents owned by the authenticated user.
   * Intended for orchestrators that coordinate multiple agents across many
   * documents simultaneously.
   *
   * Requires authentication (cookie session or ?token= query parameter).
   * Close code 4401 is sent for unauthenticated connections.
   *
   * Client messages: same protocol as the per-document route.
   */
  app.get<{ Querystring: Record<string, string> }>(
    '/documents',
    { websocket: true },
    async (socket, request) => {
      // Authenticate synchronously before attaching message handler — the docs
      // for @fastify/websocket warn that message handlers must be attached
      // synchronously. We store the auth promise, attach the handler, then
      // await inside the handler body.
      const userPromise = resolveWsUser({
        headers: request.headers as Record<string, string | string[] | undefined>,
        query: request.query as Record<string, string | string[] | undefined>,
      });

      let activeFilter: Set<string> | null = null;

      // Look up the authenticated user's document slugs lazily so that the
      // auth network call does not block message delivery.
      let userDocumentSlugs: Set<string> | null = null;

      const ensureUserDocs = async (userId: string): Promise<Set<string>> => {
        if (userDocumentSlugs) return userDocumentSlugs;
        const rows = await db
          .select({ slug: documents.slug })
          .from(documents)
          .where(eq(documents.ownerId, userId));
        userDocumentSlugs = new Set(rows.map(r => r.slug));
        return userDocumentSlugs;
      };

      const listener = async (event: DocumentEvent) => {
        const user = await userPromise;
        if (!user) return;
        const slugs = await ensureUserDocs(user.id);
        // If the cache doesn't contain the slug, refresh once — new documents
        // created after the connection opened won't be in the initial set.
        if (!slugs.has(event.slug)) {
          userDocumentSlugs = null;
          const refreshed = await ensureUserDocs(user.id);
          if (!refreshed.has(event.slug)) return;
        }
        if (activeFilter && !activeFilter.has(event.type)) return;
        try {
          socket.send(JSON.stringify(event));
        } catch {
          // Socket may have closed.
        }
      };

      eventBus.on('document', listener);

      // Verify auth and close with 4401 if unauthenticated.
      userPromise.then((user) => {
        if (!user) {
          socket.send(JSON.stringify({ type: 'error', code: 4401, message: 'Authentication required' }));
          socket.close(4401, 'Unauthorized');
          return;
        }
        socket.send(JSON.stringify({ type: 'connected', scope: 'all', timestamp: Date.now() }));
      }).catch(() => {
        socket.close(4401, 'Unauthorized');
      });

      socket.on('message', (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as Record<string, unknown>;
          if (msg.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          } else if (msg.type === 'filter' && Array.isArray(msg.events)) {
            activeFilter = msg.events.length > 0 ? new Set(msg.events as string[]) : null;
            socket.send(JSON.stringify({ type: 'filter_ack', events: msg.events, timestamp: Date.now() }));
          } else if (msg.type === 'refresh_docs') {
            // Allow clients to explicitly invalidate the slug cache.
            userDocumentSlugs = null;
            socket.send(JSON.stringify({ type: 'refresh_ack', timestamp: Date.now() }));
          }
        } catch {
          // Ignore malformed messages.
        }
      });

      socket.on('close', () => {
        eventBus.off('document', listener);
      });
    },
  );
}
