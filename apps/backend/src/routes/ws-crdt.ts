/**
 * WebSocket CRDT collaboration route.
 *
 * Route: GET /api/v1/documents/:slug/sections/:sid/collab
 * Subprotocol: yjs-sync-v1
 *
 * Implements T195 (WS handler + Yjs sync protocol) and T197 (WS auth + RBAC).
 *
 * Auth (T197):
 *   - Accepts Bearer token via `?token=<key>` query param (same pattern as ws.ts).
 *   - Also accepts session cookie (passed through upgrade headers).
 *   - Viewers (read-only) who request the write subprotocol are rejected 4403.
 *   - Unauthenticated connections: close 4401.
 *   - Authorized with editor+ role (document owner counts as editor):
 *     - Currently: any authenticated user can edit (RBAC future work).
 *     - Owner is determined by document.ownerId === user.id.
 *
 * Yjs sync protocol (T195):
 *   - Message types are binary (raw lib0 v1) framed by a 1-byte message type prefix:
 *       0x00 = SyncStep1 (state vector from client)
 *       0x01 = SyncStep2 (update from server → client)
 *       0x02 = Update    (incremental update from client → server)
 *
 *   On connect:
 *     1. Load consolidated state from section_crdt_states.
 *     2. Apply any pending updates from section_crdt_updates.
 *     3. Send SyncStep1: [0x00 | serverStateVector].
 *
 *   On receive SyncStep1 from client (type 0x00):
 *     - Compute diff from client's state vector.
 *     - Send SyncStep2: [0x01 | diffUpdate].
 *
 *   On receive Update from client (type 0x02):
 *     - Persist update (write-before-broadcast, T203 AC).
 *     - Apply to in-memory state.
 *     - Publish via pub/sub (T199).
 *     - Broadcast to all other local subscribers.
 *
 * Compaction trigger (T204 hook):
 *   - On WS close, if clock >= CRDT_COMPACT_THRESHOLD, triggers compaction.
 */

import type { FastifyInstance } from 'fastify';
import { auth } from '../auth.js';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  crdt_state_vector,
  crdt_diff_update,
  crdt_apply_update,
  crdt_encode_state_as_update,
} from '../crdt/primitives.js';
import { persistCrdtUpdate, loadSectionState, loadPendingUpdates } from '../crdt/persistence.js';
import { publishCrdtUpdate, subscribeCrdtUpdates } from '../realtime/redis-pubsub.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SYNC_STEP_1 = 0x00; // client → server: state vector
const SYNC_STEP_2 = 0x01; // server → client: diff update
const MSG_UPDATE   = 0x02; // bidirectional: incremental update

const SUBPROTOCOL = 'yjs-sync-v1';

// ── In-process session registry ───────────────────────────────────────────────

/**
 * Tracks per-section active WS sessions so that on-update broadcasts are
 * efficient (O(n) subscribers per section, not global fanout).
 */
interface SessionEntry {
  socket: { send(data: Buffer): void; close(code?: number, reason?: string): void };
  clientId: string;
}

const activeSessions = new Map<string, Set<SessionEntry>>();

function sessionKey(documentId: string, sectionId: string): string {
  return `${documentId}:${sectionId}`;
}

function addSession(documentId: string, sectionId: string, entry: SessionEntry): () => void {
  const key = sessionKey(documentId, sectionId);
  let set = activeSessions.get(key);
  if (!set) {
    set = new Set();
    activeSessions.set(key, set);
  }
  set.add(entry);
  return () => {
    const s = activeSessions.get(key);
    if (s) {
      s.delete(entry);
      if (s.size === 0) activeSessions.delete(key);
    }
  };
}

function broadcastLocal(
  documentId: string,
  sectionId: string,
  update: Buffer,
  excludeClientId: string,
): void {
  const key = sessionKey(documentId, sectionId);
  const set = activeSessions.get(key);
  if (!set) return;
  const frame = framed(MSG_UPDATE, update);
  for (const entry of set) {
    if (entry.clientId === excludeClientId) continue;
    try {
      entry.socket.send(frame);
    } catch {
      // Socket may have closed between the check and send
    }
  }
}

/**
 * Check whether any WS session is active for a given section.
 * Used by the compaction job to avoid compacting while clients are connected.
 */
export function hasSectionSessions(documentId: string, sectionId: string): boolean {
  const key = sessionKey(documentId, sectionId);
  const set = activeSessions.get(key);
  return set !== undefined && set.size > 0;
}

// ── Frame helpers ─────────────────────────────────────────────────────────────

/** Prepend a 1-byte message type prefix to a payload buffer. */
function framed(msgType: number, payload: Buffer): Buffer {
  const frame = Buffer.allocUnsafe(1 + payload.length);
  frame[0] = msgType;
  payload.copy(frame, 1);
  return frame;
}

// ── Auth helper ───────────────────────────────────────────────────────────────

/**
 * Resolve user from a WS upgrade request. Reuses same logic as ws.ts
 * (Bearer via ?token= or session cookie). Returns user or null.
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

export async function wsCrdtRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/documents/:slug/sections/:sid/collab
   *
   * WebSocket endpoint for CRDT collaborative editing of a single section.
   * Subprotocol: yjs-sync-v1
   */
  app.get<{
    Params: { slug: string; sid: string };
    Querystring: Record<string, string>;
  }>(
    '/documents/:slug/sections/:sid/collab',
    { websocket: true },
    async (socket, request) => {
      const { slug, sid } = request.params;

      // ── Auth: resolve user before processing any messages ─────────────────
      const user = await resolveWsUser({
        headers: request.headers as Record<string, string | string[] | undefined>,
        query: request.query as Record<string, string | string[] | undefined>,
      });

      if (!user) {
        socket.send(
          Buffer.from(
            JSON.stringify({ type: 'error', code: 4401, message: 'Authentication required' }),
          ),
        );
        socket.close(4401, 'Unauthorized');
        return;
      }

      // ── RBAC: check document access ────────────────────────────────────────
      // Check subprotocol — write subprotocol requires editor+ role
      const requestedSubprotocol =
        (request.headers['sec-websocket-protocol'] as string | undefined) ?? '';
      const wantsWrite = requestedSubprotocol.includes(SUBPROTOCOL);

      // Fetch document to verify it exists and determine ownership
      const docRows = await db
        .select({ ownerId: documents.ownerId, slug: documents.slug })
        .from(documents)
        .where(eq(documents.slug, slug))
        .limit(1);

      if (docRows.length === 0) {
        socket.send(
          Buffer.from(JSON.stringify({ type: 'error', code: 4404, message: 'Document not found' })),
        );
        socket.close(4404, 'Document not found');
        return;
      }

      const doc = docRows[0];
      const isOwner = doc.ownerId === user.id;

      // For now: owner = editor, others = viewer (RBAC roles T076 will refine this)
      const canWrite = isOwner;

      if (wantsWrite && !canWrite) {
        socket.send(
          Buffer.from(
            JSON.stringify({ type: 'error', code: 4403, message: 'Editor role required for CRDT write access' }),
          ),
        );
        socket.close(4403, 'Forbidden');
        return;
      }

      // ── Load section state ─────────────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let serverState: Buffer = Buffer.alloc(0) as any;

      const stateRow = await loadSectionState(slug, sid);
      if (stateRow) {
        serverState = Buffer.from(stateRow.yrsState);
      }

      // Apply any pending updates (section_crdt_updates not yet compacted)
      const pendingUpdates = await loadPendingUpdates(slug, sid);
      for (const upd of pendingUpdates) {
        serverState = crdt_apply_update(serverState, Buffer.from(upd));
      }

      // ── Register session ───────────────────────────────────────────────────
      const sessionEntry: SessionEntry = {
        socket: socket as unknown as { send(data: Buffer): void; close(code?: number, reason?: string): void },
        clientId: user.id,
      };
      const removeSession = addSession(slug, sid, sessionEntry);

      // ── Subscribe to Redis/EventEmitter pub/sub ────────────────────────────
      const unsubscribePubSub = subscribeCrdtUpdates(
        slug,
        sid,
        (_docId: string, _secId: string, update: Buffer) => {
          // Received from another instance — broadcast to local socket
          try {
            socket.send(framed(MSG_UPDATE, update));
          } catch {
            // Socket closed
          }
        },
      );

      // ── Send sync step 1: server's state vector ────────────────────────────
      const serverSv = crdt_state_vector(serverState);
      socket.send(framed(SYNC_STEP_1, serverSv));

      // ── Message handler ────────────────────────────────────────────────────
      (socket as unknown as { on(event: string, handler: (raw: Buffer | string) => void): void }).on(
        'message',
        async (raw: Buffer | string) => {
          const buf: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string, 'binary');
          if (buf.length === 0) return;

          const msgType = buf[0];
          const payload = buf.subarray(1);

          if (msgType === SYNC_STEP_1) {
            // Client sent its state vector → compute and send diff
            const diff = crdt_diff_update(serverState, payload);
            socket.send(framed(SYNC_STEP_2, diff));
          } else if (msgType === MSG_UPDATE) {
            if (!canWrite) {
              // Viewer sent an update — silently drop or close
              socket.send(
                Buffer.from(
                  JSON.stringify({ type: 'error', code: 4403, message: 'Read-only connection' }),
                ),
              );
              return;
            }

            // Persist BEFORE broadcast (T203 AC #1)
            let persistResult;
            try {
              persistResult = await persistCrdtUpdate(slug, sid, payload, user.id);
            } catch (err) {
              // DB write failed — close connection with 4500 (T203 AC #3)
              app.log.error({ err }, '[ws-crdt] DB write failed — closing WS 4500');
              try {
                socket.send(
                  Buffer.from(
                    JSON.stringify({ type: 'error', code: 4500, message: 'Persistence failure' }),
                  ),
                );
              } catch {
                // Ignore send errors during close
              }
              socket.close(4500, 'Persistence failure');
              return;
            }

            // Update in-memory state
            serverState = Buffer.from(persistResult.newState);

            // Broadcast to other local sessions
            broadcastLocal(slug, sid, payload, user.id);

            // Publish to Redis/EventEmitter for cross-instance delivery (T199)
            await publishCrdtUpdate(slug, sid, payload).catch((err: unknown) => {
              app.log.error({ err }, '[ws-crdt] pubsub publish failed (non-fatal)');
            });
          } else if (msgType === SYNC_STEP_2) {
            // Server never expects SyncStep2 from client in this simplified protocol
            // (full sync bidirectional is future work). Ignore.
          }
        },
      );

      // ── Close handler ──────────────────────────────────────────────────────
      (socket as unknown as { on(event: string, handler: () => void): void }).on('close', () => {
        removeSession();
        unsubscribePubSub();

        // Trigger compaction check (deferred — don't block close)
        setTimeout(() => {
          void triggerCompactionIfNeeded(slug, sid);
        }, 100);
      });
    },
  );
}

// ── Compaction trigger ────────────────────────────────────────────────────────

const CRDT_COMPACT_THRESHOLD = 100;

async function triggerCompactionIfNeeded(
  documentId: string,
  sectionId: string,
): Promise<void> {
  // Don't compact while other sessions are active
  if (hasSectionSessions(documentId, sectionId)) return;

  try {
    const stateRow = await loadSectionState(documentId, sectionId);
    if (!stateRow) return;

    if (stateRow.clock < CRDT_COMPACT_THRESHOLD) return;

    // Trigger compaction for this specific section
    const { compactSection } = await import('../crdt/compaction.js');
    await compactSection(documentId, sectionId);
  } catch (err) {
    console.error('[ws-crdt] compaction trigger failed:', err);
  }
}
