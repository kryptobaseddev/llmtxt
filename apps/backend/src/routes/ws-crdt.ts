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
 *     1. Load consolidated state from backendCore.getCrdtState.
 *     2. Apply any pending updates from section_crdt_updates.
 *     3. Send SyncStep1: [0x00 | serverStateVector].
 *
 *   On receive SyncStep1 from client (type 0x00):
 *     - Compute diff from client's state vector.
 *     - Send SyncStep2: [0x01 | diffUpdate].
 *
 *   On receive Update from client (type 0x02):
 *     - Persist update via backendCore.applyCrdtUpdate (write-before-broadcast, T203 AC).
 *     - Apply to in-memory state.
 *     - Publish via pub/sub (T199).
 *     - Broadcast to all other local subscribers.
 *
 * Compaction trigger (T204 hook):
 *   - On WS close, if clock >= CRDT_COMPACT_THRESHOLD, triggers compaction.
 *
 * Wave B (T353.5): CRDT persistence calls now go through fastify.backendCore.
 * WS state machine / auth / upgrade logic is unchanged.
 */

import type { FastifyInstance } from 'fastify';
import { auth } from '../auth.js';
import { resolveApiKeyUserId } from '../middleware/auth.js';
import { presenceRegistry } from '../presence/registry.js';
import {
  crdt_state_vector,
  crdt_diff_update,
  crdt_apply_update,
} from '../crdt/primitives.js';
import { loadPendingUpdates } from '../crdt/persistence.js';
import { publishCrdtUpdate, subscribeCrdtUpdates } from '../realtime/redis-pubsub.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SYNC_STEP_1 = 0x00; // client → server: state vector
const SYNC_STEP_2 = 0x01; // server → client: diff update
const MSG_UPDATE   = 0x02; // bidirectional: incremental update

// y-sync protocol: awareness messages are prefixed with byte 0x01 when using a
// multiplexed framing where 0x00=sync, 0x01=awareness. However, this backend
// uses a simpler framing: messages starting with 0x03 are awareness (chosen to
// avoid collision with SYNC_STEP_1=0x00, SYNC_STEP_2=0x01, MSG_UPDATE=0x02).
const MSG_AWARENESS_RELAY = 0x03; // awareness relay message type

const SUBPROTOCOL = 'yjs-sync-v1';

// Re-export awareness constant for external reference
export { MSG_AWARENESS_RELAY };

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
 * Broadcast awareness update bytes to all other connections in the same room.
 * Does NOT decode the awareness state — raw relay only (T256 AC).
 */
export function broadcastAwareness(
  documentId: string,
  sectionId: string,
  updateBytes: Buffer,
  excludeClientId: string,
): void {
  const key = sessionKey(documentId, sectionId);
  const set = activeSessions.get(key);
  if (!set) return;
  const frame = framed(MSG_AWARENESS_RELAY, updateBytes);
  for (const entry of set) {
    if (entry.clientId === excludeClientId) continue;
    try {
      entry.socket.send(frame);
    } catch {
      // Socket may have closed
    }
  }
}

/**
 * Handle an awareness message from a client. Relay raw bytes to peers
 * and upsert the presence registry entry.
 *
 * The awareness payload is NOT decoded server-side — we relay the raw bytes
 * to all other peers in the same (docId, sectionId) room.
 */
export function handleAwarenessMessage(
  clientId: string,
  documentId: string,
  sectionId: string,
  updateBytes: Buffer,
): void {
  // Update presence registry (best-effort: no section/cursor decode here)
  presenceRegistry.upsert(clientId, documentId, sectionId);

  // Fan out to all other local sessions
  broadcastAwareness(documentId, sectionId, updateBytes, clientId);
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
    // T375: accept both ?token= (canonical) and ?apiKey= (legacy/observer-bot compat)
    const token = request.query['token'] ?? request.query['apiKey'];

    // T379: if a token is provided, try API key lookup first (bypasses session-only getSession).
    // API keys are NOT better-auth sessions; auth.api.getSession won't recognize them.
    if (token && typeof token === 'string') {
      const userId = await resolveApiKeyUserId(token);
      if (userId) return { id: userId };
    }

    // Fallback: session cookie (better-auth). Build headers with optional Bearer token
    // so session-based auth still works for users with cookie sessions.
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value) headers.append(key, String(value));
    }
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

      // Fetch document via backendCore to verify existence and ownership
      const docRecord = await app.backendCore.getDocumentBySlug(slug);

      if (!docRecord) {
        socket.send(
          Buffer.from(JSON.stringify({ type: 'error', code: 4404, message: 'Document not found' })),
        );
        socket.close(4404, 'Document not found');
        return;
      }

      // For now: owner = editor, others = viewer (RBAC roles T076 will refine this)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docRaw = docRecord as Record<string, any>;
      const isOwner = docRaw.ownerId === user.id;
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

      // ── Load section state via backendCore ────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let serverState: Buffer = Buffer.alloc(0) as any;

      const crdtState = await app.backendCore.getCrdtState(slug, sid);
      if (crdtState) {
        serverState = Buffer.from(crdtState.snapshotBase64, 'base64');
      }

      // Apply any pending updates (section_crdt_updates not yet compacted).
      // These represent updates written after the last compaction snapshot.
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

            // Persist BEFORE broadcast via backendCore (T203 AC #1)
            let newCrdtState;
            try {
              newCrdtState = await app.backendCore.applyCrdtUpdate({
                documentId: slug,
                sectionKey: sid,
                updateBase64: payload.toString('base64'),
                agentId: user.id,
              });
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

            // Update in-memory state from the persisted snapshot
            serverState = Buffer.from(newCrdtState.snapshotBase64, 'base64');

            // Broadcast to other local sessions
            broadcastLocal(slug, sid, payload, user.id);

            // Publish to Redis/EventEmitter for cross-instance delivery (T199)
            await publishCrdtUpdate(slug, sid, payload).catch((err: unknown) => {
              app.log.error({ err }, '[ws-crdt] pubsub publish failed (non-fatal)');
            });
          } else if (msgType === SYNC_STEP_2) {
            // Server never expects SyncStep2 from client in this simplified protocol
            // (full sync bidirectional is future work). Ignore.
          } else if (msgType === MSG_AWARENESS_RELAY) {
            // Awareness message: relay raw bytes to all other peers in the same room.
            // Update presence registry (no server-side awareness decode).
            handleAwarenessMessage(user.id, slug, sid, payload);
          }
        },
      );

      // ── Close handler ──────────────────────────────────────────────────────
      (socket as unknown as { on(event: string, handler: () => void): void }).on('close', () => {
        removeSession();
        unsubscribePubSub();

        // Trigger compaction check (deferred — don't block close)
        setTimeout(() => {
          void triggerCompactionIfNeeded(slug, sid, app);
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
  app: FastifyInstance,
): Promise<void> {
  // Don't compact while other sessions are active
  if (hasSectionSessions(documentId, sectionId)) return;

  try {
    const state = await app.backendCore.getCrdtState(documentId, sectionId);
    if (!state) return;

    // Check compaction threshold via raw schema query — backendCore.getCrdtState
    // doesn't expose clock. We load it directly from the persistence helper.
    const { loadSectionState } = await import('../crdt/persistence.js');
    const stateRow = await loadSectionState(documentId, sectionId);
    if (!stateRow || stateRow.clock < CRDT_COMPACT_THRESHOLD) return;

    // Trigger compaction for this specific section
    const { compactSection } = await import('../crdt/compaction.js');
    await compactSection(documentId, sectionId);
  } catch (err) {
    console.error('[ws-crdt] compaction trigger failed:', err);
  }
}
