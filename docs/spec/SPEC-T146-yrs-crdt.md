# SPEC-T146: Yrs CRDT Real-Time WebSocket Sync

> RFC 2119 keywords: MUST, MUST NOT, SHOULD, SHOULD NOT, MAY

| Field | Value |
|-------|-------|
| **Spec ID** | SPEC-T146 |
| **Epic** | T146 |
| **Status** | DRAFT |
| **Date** | 2026-04-15 |
| **Author** | Team Lead (RCASD) |
| **Conforms to** | ADR-T146, docs/SSOT.md, docs/ARCHITECTURE-PRINCIPLES.md |

---

## 1. Protocol Identity

1.1. The server MUST negotiate the WebSocket subprotocol `yjs-sync-v1` on the path  
`/api/v1/documents/:slug/sections/:sid/collab`.

1.2. The server MUST reject upgrade requests that do not include `yjs-sync-v1` in the  
`Sec-WebSocket-Protocol` header with HTTP 400 before the WS handshake completes.

1.3. The server MAY additionally advertise `yjs-readonly-v1` for read-only subscribers  
(viewers who may not write updates).

---

## 2. Authentication and Authorization

2.1. The server MUST authenticate every WS connection before accepting any data frames.  
Authentication uses the `?token=<bearer>` query parameter (session token or API key).  
Cookie sessions are also accepted. A missing or invalid credential MUST result in  
WS close with code `4401` and reason `"Unauthorized"`.

2.2. The server MUST verify the resolved user has at least `viewer` role on the document  
(via `documentRoles`) before completing the upgrade. A role check failure MUST result  
in WS close with code `4403` and reason `"Forbidden"`.

2.3. Connections using `yjs-sync-v1` (read-write) MUST require `editor` or `owner` role.  
Agents with only `viewer` role MUST be downgraded to `yjs-readonly-v1` or rejected with  
close code `4403` if read-write is the only advertised subprotocol.

2.4. After authentication succeeds, the server MUST NOT re-check credentials on each  
incoming update message. Session validity is checked once at connect time.

---

## 3. Sync Protocol (Yjs Sync v1)

3.1. On successful WS upgrade, the server MUST initiate sync by sending a  
**sync step 1** message containing the server's current StateVector for the  
(document_id, section_id) pair, using the Yjs binary message framing from  
`y-protocols/sync`.

3.2. The client MUST respond with a **sync step 2** message containing an update  
encoding all content the server is missing (encoded against the server's StateVector).  
The server MUST apply this update to its in-memory Yrs state.

3.3. Simultaneously, the server MUST send a **sync step 2** message to the client  
containing an update encoding all content the client is missing (encoded against the  
client's StateVector received in the client's sync step 1, if the client sends one  
before the server's initial sync step 1 arrives).

3.4. After the initial sync exchange, both peers MUST exchange **update** messages  
(message type `2`) for every subsequent edit. Update messages are binary; the server  
MUST NOT modify, re-encode, or re-compress update bytes before broadcasting them.

3.5. The server MUST echo received update messages to ALL other connected clients on  
the same (document_id, section_id) session EXCEPT the originating sender.

---

## 4. Update Identity and Client ID

4.1. Every update MUST carry a `client_id` field. This field is the agent's verified  
identity from T147 (when available) or a server-assigned anonymous UUID scoped to  
the WS session (when T147 is not yet shipped).

4.2. The server MUST assign and persist the `client_id` at WS connect time. The  
`client_id` is stored in `section_crdt_updates.client_id` for every persisted update.

4.3. The server MUST use `client_id` to suppress echo of updates back to their origin  
across Redis pub/sub (multi-instance coordination).

4.4. A `client_id` MUST NOT be reused across WS sessions. Each connection receives a  
fresh session-scoped UUID unless T147 verified identity is present, in which case  
the agent's verified identity string is used.

---

## 5. Persistence (Crash Safety)

5.1. The server MUST persist every incoming update to `section_crdt_updates` BEFORE  
broadcasting it to other subscribers via Redis or local echo.

5.2. Persistence MUST be a synchronous database write within the update handler. The  
server MUST NOT broadcast an update if the database write fails; instead it MUST  
close the WS connection with close code `4500` and reason `"Persistence failure"`.

5.3. Each persisted update MUST receive a monotonically increasing `seq` number scoped  
to (document_id, section_id). The server MUST use `SELECT MAX(seq)` with a  
transaction to assign the next seq number atomically.

5.4. The server MUST persist the initial consolidated state to `section_crdt_states`  
when a section's CRDT Doc is initialized for the first time (clock = 0).

---

## 6. Compaction (Garbage Collection)

6.1. The server SHOULD compact accumulated updates into a new consolidated state when  
EITHER of the following conditions is met:  
  a. The `clock` counter for (document_id, section_id) reaches `CRDT_COMPACT_THRESHOLD`  
     (configurable via environment variable; default: `100`).  
  b. No update has been received for `CRDT_COMPACT_IDLE_MS` milliseconds after the  
     last WS connection for that section closed (configurable; default: `30000`).

6.2. Compaction MUST call `yrs_compact([base_state, ...pending_updates])` via the  
WASM binding to merge all pending updates into a single state blob.

6.3. After successful compaction, the server MUST:  
  a. Write the new consolidated state to `section_crdt_states` (upsert).  
  b. Delete all `section_crdt_updates` rows with `seq <= compacted_clock` for the  
     (document_id, section_id) pair.  
  c. Reset `section_crdt_states.clock` to `0`.

6.4. Compaction MUST be performed within a database transaction. If the transaction  
fails, the server MUST NOT delete any update rows.

6.5. The server MUST NOT perform compaction while any WS session is active for the  
(document_id, section_id) pair, to avoid race conditions on the in-memory state.

---

## 7. Redis Pub/Sub (Multi-Instance)

7.1. When `REDIS_URL` is set, the server MUST publish each validated+persisted update  
to the channel `crdt:doc:{document_id}:section:{section_id}`.

7.2. On receiving a Redis message, the server MUST apply the update to its local  
in-memory Yrs state and echo to all local WS subscribers EXCEPT the originating  
`client_id` (matched from the message envelope).

7.3. When `REDIS_URL` is NOT set, the server MUST fall back to broadcasting via the  
existing in-process `eventBus` with the same semantics. No behavior difference SHOULD  
be observable to clients in single-instance mode.

7.4. The server MUST NOT rely on Redis for crash recovery. Redis pub/sub is delivery  
only; Postgres is the durable store.

---

## 8. HTTP Fallback Endpoints

8.1. The server MUST expose `GET /api/v1/documents/:slug/sections/:sid/crdt-state`  
returning a JSON body:  
```json
{
  "stateBase64": "<base64-encoded Yrs consolidated state>",
  "stateVectorBase64": "<base64-encoded StateVector>",
  "clock": 42,
  "updatedAt": "2026-04-15T18:00:00Z"
}
```
This endpoint MUST require `viewer` or higher role. It enables HTTP-only agents to  
bootstrap a local Yrs Doc without opening a WS session.

8.2. The server MUST expose `POST /api/v1/documents/:slug/sections/:sid/crdt-update`  
accepting a body `{ "updateBase64": "<base64-encoded Yrs update>" }`.  
The server MUST apply, persist, and broadcast the update identically to a WS-delivered  
update. This MUST require `editor` or `owner` role.

8.3. HTTP fallback endpoints MUST return `503 Service Unavailable` if the in-memory  
Yrs state for the section is not initialized (i.e., no WS session has ever been opened  
and no state exists in `section_crdt_states`). The error body MUST include  
`"error": "section not yet initialized"`.

---

## 9. Reconnect and Offline Edit

9.1. The server MUST support reconnect without data loss. On reconnect, the server  
MUST perform the full sync step 1/2 exchange to deliver any updates the client missed.

9.2. A client MAY buffer edits locally (via a local Yrs Doc) while disconnected and  
submit them as a single update on reconnect. The server MUST accept and apply such  
updates provided the update is not older than `CRDT_OFFLINE_EXPIRY_MS` (default  
`3600000` ms = 1 hour) from the client's last known-good sync time.

9.3. If a reconnect update is rejected due to expiry, the server MUST close the WS  
connection with close code `4409` and reason `"Offline edit expired"`. The client  
SHOULD fetch the current state via the HTTP fallback endpoint and prompt the agent  
to re-apply its changes against the latest state.

---

## 10. Text Materialization and REST Consistency

10.1. After any CRDT update is applied to the in-memory Yrs state, the server  
SHOULD update the corresponding section's plain-text representation in the  
`versions` table by calling `yrs_get_text(state, sectionId)` and writing the  
result. This keeps existing REST `GET /api/v1/documents/:slug/sections/:name`  
consumers consistent without requiring them to speak the CRDT protocol.

10.2. This materialization MUST be asynchronous (after WS response) and MUST NOT  
block the update echo path.

---

## 11. SDK Contract (packages/llmtxt)

11.1. The SDK MUST export a `subscribeSection(slug: string, sectionId: string, callback: (delta: SectionDelta) => void): Unsubscribe` function.

11.2. `SectionDelta` MUST include at minimum:
```typescript
interface SectionDelta {
  sectionId: string;
  clientId: string;
  updateBytes: Uint8Array;  // raw Yrs update for local application
  timestamp: number;         // server receive time (ms)
}
```

11.3. The SDK `subscribeSection` implementation MUST open a WS connection using  
`y-websocket` with the `yjs-sync-v1` subprotocol and MUST manage reconnect  
transparently.

11.4. The SDK MUST expose `getSectionText(slug: string, sectionId: string): Promise<string>` using the HTTP fallback endpoint for agents that do not require live updates.

---

## 12. Load and Performance Bounds

12.1. A single backend instance SHOULD sustain 50 concurrent WS connections editing  
the same document without memory leak or connection drop, verified by a k6 load test  
running for 60 seconds.

12.2. Delta delivery latency from sender to receiver SHOULD be under 200 ms in a  
single-region deployment under normal load.

12.3. In-memory Yrs state per active (document, section) SHOULD NOT exceed 10 MB.  
If a section's state exceeds 10 MB, the server SHOULD reject new WS connections to  
that section with `503` and a `"section state too large"` message until compaction  
reduces the state.

---

## 13. Non-Regression Constraint

13.1. The three-way merge path (`three_way_merge.rs`, `POST .../sections/:name` with  
content body) MUST continue to function unchanged as a batch/offline merge fallback  
for agents that do not use the CRDT WS protocol.

13.2. No existing test in `crates/llmtxt-core` or `apps/backend` MUST be broken by  
T146 changes.
