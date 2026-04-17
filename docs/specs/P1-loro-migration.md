# Spec P1: Yrs → Loro CRDT Migration

**Version**: 1.2.0
**Status**: DRAFT — planning only, no implementation
**RFC 2119 Key words**: MUST, MUST NOT, SHOULD, MAY
**Validated**: 2026-04-17 against `crdt.rs`, `Cargo.toml`, `ws-crdt.ts`, and Loro 1.10.x docs.rs

---

## 1. Background and Motivation

LLMtxt currently uses `yrs` (the Rust port of Y.js) for section-level CRDT in
`crates/llmtxt-core/src/crdt.rs`. The six exported functions implement the core
Yjs binary sync protocol (state vector / diff update exchange).

**Why migrate to Loro?**

| Property | Yrs 0.25 | Loro 1.0 |
|---|---|---|
| Rust-native | Yes | Yes (+ WASM, Swift) |
| Rich text | `Y.Text` only | `LoroText`, `LoroRichText` |
| Movable list | No | Yes (`MovableList`) |
| Map CRDT | `Y.Map` | `LoroMap` |
| Tree CRDT | No | `LoroTree` (unique differentiator) |
| Counter CRDT | No | `LoroCounter` |
| Snapshot encoding | lib0 v1/v2 | Loro binary (incompatible) |
| Snapshot size | Baseline | ~30% smaller (measured) |
| Import perf | Baseline | 4-10x faster on large docs |
| Active maintenance | Slow (0.25 last major, 2024) | Active (1.0 GA Feb 2026) |
| License | MIT | MIT |

Loro's richer type set unlocks structured section content (tables, comment
threads, outline trees) without re-architecting the CRDT layer.

---

## 2. Scope

This spec covers **Phase 1 only**: swapping the CRDT library inside
`crates/llmtxt-core` and updating downstream consumers. It does NOT cover
cr-sqlite or P2P mesh (Phases 2 and 3).

**In scope:**
- `crates/llmtxt-core/src/crdt.rs` rewrite
- `packages/llmtxt/src/crdt-primitives.ts` and `crdt.ts` updates
- `apps/backend/src/routes/ws-crdt.ts` sync protocol update
- CRDT table reset on deploy (see section 4)
- Test suite updates

**Out of scope:**
- Any Phase 2 / Phase 3 work
- New Loro CRDT types (maps, trees) — future epics
- UI changes

---

## 3. API Mapping: Yrs → Loro

### 3.1 Core Six Functions

Validated 2026-04-17: all six functions confirmed present in `crates/llmtxt-core/src/crdt.rs`.
Loro Rust API confirmed against docs.rs/loro 1.10.x:
- `ExportMode` enum variants: `Snapshot`, `Updates { from: Cow<'a, VersionVector> }`, `UpdatesInRange`, `ShallowSnapshot`, `StateOnly`, `SnapshotAt`
- `LoroDoc::import(&self, bytes: &[u8])` is an instance method (NOT a static constructor)
- `LoroDoc::oplog_vv(&self) -> VersionVector` confirmed
- `VersionVector::encode(&self) -> Vec<u8>` and `VersionVector::decode(bytes) -> VersionVector` confirmed

The table below uses pseudocode notation. `doc.import(&state)` always means: first call
`let doc = LoroDoc::new(); doc.import(&state).unwrap()`. Exact error handling is
left to the implementation task (P1.3).

| Yrs function | Current Yrs behavior | Loro equivalent | Notes |
|---|---|---|---|
| `crdt_new_doc()` | Returns `state_vector().encode_v1()` (empty state vector bytes) | `LoroDoc::new(); doc.export(ExportMode::Snapshot)` | **Semantic change**: Loro returns a full snapshot for a new doc, not a state vector. Caller MUST treat the return value as an opaque state blob. |
| `crdt_encode_state_as_update(state)` | Decodes Yrs state, returns full update blob | `let doc = LoroDoc::new(); doc.import(&state); doc.export(ExportMode::Snapshot)` | Full snapshot export. In Loro, snapshot = update for bootstrap purposes. |
| `crdt_apply_update(state, update)` | Applies lib0 update to state, returns new state | `let doc = LoroDoc::new(); doc.import(&state); doc.import(&update); doc.export(ExportMode::Snapshot)` | Loro `import` is idempotent — applying same update twice yields same result. |
| `crdt_merge_updates(updates)` | Merges multiple update blobs via `yrs::merge_updates_v1` | `let doc = LoroDoc::new(); for u in updates { doc.import(u) }; doc.export(ExportMode::Snapshot)` | Convergence guaranteed by CRDT invariants. |
| `crdt_state_vector(state)` | Returns lib0 v1-encoded Y.js state vector | `let doc = LoroDoc::new(); doc.import(&state); doc.oplog_vv().encode()` | Loro uses `VersionVector` (not Y.js state vector). The `encode()` output is **bitwise incompatible** with lib0 state vector bytes. Remote peers MUST use `VersionVector::decode()` to parse. |
| `crdt_diff_update(state, remote_sv)` | Returns lib0 diff from server state to client sv | `let doc = LoroDoc::new(); doc.import(&state); let vv = VersionVector::decode(&remote_sv); doc.export(ExportMode::Updates { from: Cow::Owned(vv) })` | `from` MUST be a decoded Loro `VersionVector`, not a raw Y.js state vector. |

### 3.2 Sync Protocol Impact

Validated 2026-04-17: `apps/backend/src/routes/ws-crdt.ts` confirmed using y-sync framing
(`SYNC_STEP_1=0x00`, `SYNC_STEP_2=0x01`, `MSG_UPDATE=0x02`, `MSG_AWARENESS_RELAY=0x03`).
Loro does NOT implement the Yjs wire protocol.

**Current Yrs framing** (in `ws-crdt.ts`, to be replaced):
- `0x00` = SyncStep1 (client → server: Y.js state vector)
- `0x01` = SyncStep2 (server → client: Y.js diff update)
- `0x02` = Update (bidirectional: Y.js incremental update)
- `0x03` = AwarenessRelay (relay only, unchanged)

**Proposed Loro framing** (post-migration, to be implemented in P1.6):

The framing MUST use a 1-byte message type prefix. Byte values are
intentionally shifted from the Yrs values to prevent accidental cross-protocol
acceptance by legacy clients:
- `0x01` = SyncStep1 (client → server: Loro `VersionVector` encoded bytes)
- `0x02` = SyncStep2 (server → client: Loro `ExportMode::Updates` blob)
- `0x03` = Update (client → server: incremental Loro update blob)
- `0x04` = AwarenessRelay (raw relay, unchanged from current; byte value updated)

**Rationale for not using `0x00`**: Avoids ambiguity with Yjs SyncStep1 byte.
Any stray Yjs client connecting after migration would send `0x00` (Yjs SyncStep1)
which MUST be rejected by the Loro handler rather than misinterpreted.

**Decision record DR-P1-01**: Custom framing chosen over y-protocol wrapper to
avoid a hard dependency on the y-sync message format after removing yrs. This
means existing Yjs clients (browser, any third-party) MUST be updated to use
the Loro-based client SDK. Mixed-client environments are NOT supported.

### 3.3 Encoding Incompatibility

Yrs uses `lib0 v1` binary encoding. Loro uses its own binary format (Loro binary
with a 4-byte magic header + 16-byte checksum + 2-byte mode prefix). They are
**bitwise incompatible**. A Loro `doc.import()` call given raw Yrs bytes WILL
return an error (`LoroError`). A Yrs `Update::decode_v1()` call given Loro bytes
WILL fail. There is NO automatic detection or conversion path.

The `VersionVector` encoding is also incompatible:
- **Yrs**: lib0 v1-encoded state vector (variable-length integer pairs)
- **Loro**: `VersionVector::encode()` output (Loro's own binary VV format)

The Loro framing protocol (`0x01` SyncStep1) carries Loro `VersionVector` bytes.
Peers MUST call `VersionVector::decode()` on received SyncStep1 payloads — they
MUST NOT pass them directly to Yrs or any lib0 decoder.

---

## 4. Clean Break: No Migration, Drop and Rebuild

### 4.1 Design Decision: Greenfield Loro

We have zero production Yrs CRDT state worth preserving. The move to Loro is a
**clean break**:

- `DROP` all rows from `section_crdt_states` and `section_crdt_updates` on deploy.
- Loro format is the only format from this point forward.
- No dual-format detection is implemented.
- No migration script converting Yrs blobs → Loro blobs is needed or written.

**Decision record DR-P1-02**: Clean break selected over incremental migration.
The deploy MUST:
1. Truncate `section_crdt_states`.
2. Truncate `section_crdt_updates`.
3. Rename the `yrs_state` column to `crdt_state`.

This is implemented as a standard Drizzle schema migration. No pre-migration
binary is required.

### 4.2 Column Rename

`section_crdt_states.yrs_state` (bytea) MUST be renamed to
`section_crdt_states.crdt_state` to remove library coupling. This is a pure
column rename included in P1.7.

---

## 5. Production Constraints

| Constraint | Detail |
|---|---|
| Loro sync protocol differs from y-sync | Custom framing (DR-P1-01); update SDK + WS handler together — this is a hard requirement, not a risk |
| Binary format incompatibility | Greenfield approach (DR-P1-02) eliminates this entirely; no Yrs bytes exist post-deploy |
| Loro 1.0 Rust WASM target | Pin `loro = "1.0"` exactly; integration tests on WASM target |
| WASM binary size increase | `wasm-opt` pass; measure before/after; production constraint: +50KB max |
| y-sync clients | No external Yjs clients exist; this is confirmed via SDK audit |
| `crdt_merge_updates` convergence | Byte-identity test suite (P1.8) covers all convergence invariants — this is a required gate, not optional |
| Loro `VersionVector` encoding | New framing means no cross-library interpretation needed |

---

## 6. Dependency DAG (Phase 1)

```
P1.1 (API research + decision memo)
  └─→ P1.2 (Cargo.toml: loro in, yrs out)
        └─→ P1.3 (crdt.rs rewrite — 6 functions + get_text)
              ├─→ P1.4 (WASM rebuild + JS binding check)
              │     └─→ P1.5 (crdt-primitives.ts update)
              │           └─→ P1.11 (subscribeSection / getSectionText)
              ├─→ P1.6 (ws-crdt.ts sync protocol update)     ─────┐
              ├─→ P1.7 (DB reset: truncate CRDT tables; rename column) ─┐│
              └─→ P1.8 (crdt_byte_identity tests — native)          ││
                                                                    ││
P1.9 (backend crdt.test.ts — 2-agent convergence) ◄────────────────┘│
P1.10 (contract tests — CRDT section) ◄─────────────────────────────┘
P1.12 (docs refresh) ◄── all above
```

---

## 7. Acceptance Criteria (Epic)

1. `cargo test --features crdt` passes with zero Yrs imports; `yrs` MUST NOT
   appear in the compiled binary (verified via `cargo nm` or `nm`).
2. All six WASM export function names are unchanged.
3. A 2-agent convergence test (Rust native) confirms final state is identical
   regardless of update application order.
4. `section_crdt_states` and `section_crdt_updates` tables are empty after
   deploy; the column is renamed from `yrs_state` to `crdt_state`; no Yrs
   magic header bytes exist in any row.
5. `crdt.test.ts` 9 tests pass against the new Loro backend.
6. `ws-crdt.ts` sends and receives Loro-framed messages; no y-sync protocol
   bytes in the wire capture.
7. WASM binary size delta is within +50 KB of the pre-migration baseline.
8. All features ship production-ready. No known-broken functionality in the
   release.
