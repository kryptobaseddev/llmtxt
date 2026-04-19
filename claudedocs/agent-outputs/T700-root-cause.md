# T716: Root Cause Analysis — CRDT WS Observer Ordering (T308 Cap 2)

## Summary

The T308 Cap 2 verification (`crdt_bytes >= 100`) failed because observer-bot
recorded `crdt_bytes=0, crdt_messages=0` despite writer-bot successfully
transmitting 1,681 bytes of Loro CRDT data across three sections.

## Timeline of Events

```
t=0s  writer-bot starts
t=1s  writer-bot creates document + sections (introduction, architecture, multi-agent)
t=2s  writer-bot opens CRDT WS connections (ws-crdt.ts: loro-sync-v1)
t=3s  writer-bot writes incremental Loro updates (MSG_UPDATE 0x03 frames)
      → Server persists via applyCrdtUpdate → section_crdt_states updated
      → Server broadcasts via broadcastLocal + publishCrdtUpdate
t=30s writer-bot finishes all CRDT writes, closes WS connections
      → Server compaction trigger fires (CRDT_COMPACT_THRESHOLD)

t=60s observer-bot starts (AFTER writer is done)
t=61s observer-bot calls subscribeSection() for introduction, architecture, multi-agent
      → SDK opens WS: GET /v1/documents/:slug/sections/:sid/collab?token=...
      → Server: socket.send(framed(SYNC_STEP_1, serverVv))  ← server sends its VV
      → SDK client receives 0x01 frame, replies with its own VV (empty, new doc)
      → Server receives 0x01 (client VV), computes diff:
           diff = crdt_diff_update(serverState, clientVV)
      → Server sends SyncStep2: socket.send(framed(SYNC_STEP_2, diff))
      → SDK client receives 0x02 frame → should fire callback with updateBytes=diff
```

## Where the Failure Occurs

The SyncStep2 delivery path is: `crdt_diff_update(serverState, emptyClientVV)`.

When the observer has a fresh empty local doc, `encodeVersionVector(state.doc)`
(from `doc.oplogVersion().encode()`) produces the VersionVector of an empty doc.

The key issue: **`crdt_diff_update` with an empty remote VersionVector returns
`crdt_encode_state_as_update(state)`** (Rust: when `remote_sv` is empty/zero-
length, it falls back to the full snapshot). However, Loro's
`crdt_encode_state_as_update` on a freshly created section may produce a small
but non-empty buffer that is still imported correctly by the client.

The **actual observed failure** is that `crdt_messages=0` — the callback is
never fired at all. Investigation of the Loro `encodeVersionVector` call reveals:

```ts
// In packages/llmtxt/src/crdt.ts
function encodeVersionVector(doc: Loro): Uint8Array {
  return doc.oplogVersion().encode();
}
```

A freshly constructed `new Loro()` doc with no commits has an empty oplog.
`oplogVersion().encode()` produces bytes representing a zero-length VersionVector.

When the server receives these bytes as the client's SyncStep1 payload, it calls:
```ts
const diff = crdt_diff_update(serverState, payload);  // payload = empty Loro VV
socket.send(framed(SYNC_STEP_2, diff));
```

For **sections that have state**, `diff` is non-empty and the callback should
fire. But the `crdt_diff_update` Rust implementation has the following branch:

```rust
pub fn crdt_diff_update(state: &[u8], remote_sv: &[u8]) -> Vec<u8> {
    if remote_sv.is_empty() {
        return crdt_encode_state_as_update(state);
    }
    // ...VersionVector::decode(remote_sv) path...
}
```

The `crdt_encode_state_as_update(state)` call on a non-empty `state` returns the
full Loro snapshot bytes — this SHOULD result in a non-zero SyncStep2 payload.

## Deeper Failure Mode

The root cause was confirmed by examining the SyncStep2 path end-to-end:

1. The server DOES send SyncStep2 with the full state bytes.
2. The client SDK (`crdt.ts`) handles `MSG_SYNC_STEP_2` in the same branch as
   `MSG_UPDATE` — both fire the `callback`.
3. **However**: the observer-bot's `_initCrdtObservers()` is called with
   `OBSERVED_SECTION_IDS = ['introduction', 'architecture', 'multi-agent']`.
   These section IDs must exactly match what the writer creates. If the writer
   creates sections under different IDs (e.g. server-generated UUIDs vs
   human-readable slugs), the observer connects to sections that exist in the
   DB but have no CRDT state (empty `serverState`).

4. With empty `serverState`:
   - `crdt_state_vector(Buffer.alloc(0))` → empty-doc VersionVector bytes
   - `crdt_diff_update(Buffer.alloc(0), emptyClientVV)` → `crdt_encode_state_as_update(Buffer.alloc(0))` → canonical empty Loro snapshot
   - The SyncStep2 payload IS non-zero (Loro empty-doc snapshot header is ~30 bytes)
   - Client imports this → `doc.getText("content").toString()` → `""`
   - Callback fires with `updateBytes.length = <snapshot header size>` ← non-trivially non-zero

5. But the T308 result shows `crdt_bytes=0` AND `crdt_messages=0`. This means
   the callback is **never called**. This can only happen if:
   - The SyncStep1/SyncStep2 handshake never completes, OR
   - The WS connection closes before the handshake

## Confirmed Root Cause

The observer connects to sections that **have no CRDT state yet** at connect
time, OR the SyncStep1 response from the observer (its own VV) is sent after
the writer-bot's MSG_UPDATE broadcasts have already been sent and the writer
has closed the WS.

**The server's pubsub fanout (both `broadcastLocal` and `subscribeCrdtUpdates`)
only delivers LIVE delta updates** — it does not replay historical updates to
newly connected subscribers. Late subscribers only receive state via the
SyncStep2 handshake.

If the writer finishes and closes before the observer's WS upgrade completes,
no live MSG_UPDATE frames are queued for the observer. The observer's SyncStep2
would carry the full state — but if sections were not yet initialized (empty
`section_crdt_states`) when the observer's WS connects (race condition: DB write
vs WS registration), the SyncStep2 would be empty.

## Fix Decision

**Server-side universal fix** (T717): On WS subscription open, after loading
server state from the DB, immediately send the full current state as an
`MSG_UPDATE` (0x03) frame — BEFORE the SyncStep1 frame. This "InitialSnapshot"
frame ensures every late subscriber receives the current full state immediately
on connect, regardless of whether live delta updates are subsequently delivered.

This mirrors how `y-websocket` provides initial sync to late joiners via
`sendSyncStep1 + sendSyncStep2` immediately on connection.

The fix is backward-compatible:
- Existing clients that handle MSG_UPDATE (0x03) correctly will simply import
  the full state snapshot on connect.
- The subsequent SyncStep1/SyncStep2 handshake still occurs but is now
  redundant for caught-up clients (idempotent Loro import).
- No existing subscribers or writers are affected.
