# T397 + T398: SDK subscribeSection/getSectionText Loro + Docs Refresh

**Date**: 2026-04-17
**Tasks**: T397 (P1.11), T398 (P1.12)
**Commit T397**: a14fcb0
**Commit T398**: c52cf8b
**Status**: complete

## T397: SDK Loro Wire Format (packages/llmtxt/src/crdt.ts)

### What Changed

Replaced the y-sync/Y.js protocol in `crdt.ts` with the Loro-framed protocol
as specified in P1 §3.2.

**Before (y-sync legacy):**
- Subprotocol: `yjs-sync-v1`
- 0x00 = SyncStep1 (Y.js state vector), 0x01 = SyncStep2, 0x02 = Update, 0x03 = AwarenessRelay
- Dynamic import of `yjs`; used `Y.Doc`, `Y.encodeStateVector`, `Y.applyUpdate`

**After (Loro-framed):**
- Subprotocol: `loro-sync-v1`
- 0x01 = SyncStep1 (Loro VersionVector), 0x02 = SyncStep2, 0x03 = Update, 0x04 = AwarenessRelay
- Direct import of `loro-crdt`; uses `Loro`, `doc.oplogVersion().encode()`, `doc.import()`

### Key Implementation Details

- `subscribeSection()`: on WS open sends `doc.oplogVersion().encode()` as 0x01 frame
- Stray 0x00 frames (legacy Yjs SyncStep1) are silently dropped
- JSON control frames (0x7b = `{`) dropped as before
- Malformed Loro bytes in `doc.import()` caught and dropped silently
- Added `onAwareness` callback in `SubscribeSectionOptions` for 0x04 relay frames
- `getSectionText()`: decodes base64 stateBase64 → Loro binary → imports into local `Loro` doc → reads `"content"` LoroText
- `CrdtSection` internal type wraps the local `Loro` doc + WS state

### Package Export Added

Added `./crdt` to `packages/llmtxt/package.json` exports:
```json
"./crdt": {
  "types": "./dist/crdt.d.ts",
  "import": "./dist/crdt.js"
}
```

### Tests (crdt-sdk.test.ts) — 22 tests, all pass

- `getSectionText` (6 tests): 503 null, HTTP error throw, Loro snapshot decode, empty snapshot, Authorization header, URL encoding
- `subscribeSection` (16 tests): loro-sync-v1 subprotocol, SyncStep1 0x01, VV payload non-empty, SyncStep2 callback, Update callback, 0x00 drop, JSON drop, AwarenessRelay forward, awareness no delta, unsubscribe, token URL, wss:// scheme, URL encoding, empty frame, malformed bytes, consecutive updates

**Mock technique**: `CapturingMockWebSocket extends MockWebSocket` stores `this` in a module-level slot — avoids `noConstructorReturn` biome rule that prevents returning from constructors.

## T398: Docs Refresh (apps/docs/content/docs/)

### Files Changed

1. **crdt-sections.mdx (new)**: Full CRDT section collaboration doc covering:
   - Migration note (Yrs → Loro binary incompatibility, clean break)
   - Section model (LoroDoc with "content" LoroText root)
   - Wire protocol table (0x01/0x02/0x03/0x04) with sync handshake diagram
   - VersionVector vs Y.js state vector comparison table
   - SDK usage: `subscribeSection()` and `getSectionText()` with TypeScript examples
   - Server-side CRDT function table (6 WASM exports)
   - Convergence guarantee note
   - Awareness relay cross-reference

2. **presence.mdx**: Updated awareness byte from 0x03 to 0x04; removed y-sync reference from frontmatter description; added link to crdt-sections

3. **getting-started.mdx**: Updated CRDT capability row from "Y.js WS FAIL" to "Loro WS IN PROGRESS (T384)"

4. **meta.json**: Added `crdt-sections` to page order

**Docs build**: `pnpm --filter docs build` exits 0, no errors.

## Key Findings

- `doc.oplogVersion().encode()` is the correct API for SyncStep1 VV bytes (matches Rust `oplog_vv().encode()`)
- `Loro` class in `loro-crdt` npm is an alias of `LoroDoc` — all `LoroDoc` methods available
- `VersionVector` class has `.encode()` / `static .decode()` methods
- `crdt-sections.mdx` did not previously exist — created from scratch
- Biome `useArrowFunction` rule can break WebSocket mock classes: prefer `class extends` over factory functions
- T395/T396 (backend tests) were pending but T398 is a docs-only task with no code dependency — completed with owner override per user instruction
