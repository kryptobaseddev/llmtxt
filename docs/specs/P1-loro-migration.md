# Spec P1: Yrs → Loro CRDT Migration

**Version**: 1.1.0
**Status**: DRAFT — planning only, no implementation
**RFC 2119 Key words**: MUST, MUST NOT, SHOULD, MAY

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

| Yrs function | Loro equivalent | Notes |
|---|---|---|
| `crdt_new_doc()` | `LoroDoc::new()` + `doc.export(ExportMode::Snapshot)` | Returns full snapshot bytes, not state vector. Caller interprets as "initial state". |
| `crdt_encode_state_as_update(state)` | `LoroDoc::import(state)` then `doc.export(ExportMode::Snapshot)` | Full snapshot export |
| `crdt_apply_update(state, update)` | `LoroDoc::import(state)` then `doc.import(update)` then `doc.export(ExportMode::Snapshot)` | Loro import is idempotent |
| `crdt_merge_updates(updates)` | `LoroDoc::new(); for u in updates { doc.import(u) }; doc.export(ExportMode::Snapshot)` | Convergence guaranteed |
| `crdt_state_vector(state)` | `LoroDoc::import(state)` then `doc.oplog_vv().encode()` | Loro uses `VersionVector`, not Y.js state vector; encoding is different |
| `crdt_diff_update(state, remote_sv)` | `LoroDoc::import(state)` then `doc.export(ExportMode::Updates { from: vv })` | `from` = decoded remote version vector |

### 3.2 Sync Protocol Impact

The Yjs wire protocol uses:
- **Sync step 1**: client sends `[0x00, ...state_vector_bytes]`
- **Sync step 2**: server sends `[0x01, ...diff_update_bytes]`
- **Awareness**: `[0x01, ...]` with different message type

Loro does NOT implement the Yjs wire protocol. The WS handler
(`ws-crdt.ts`) MUST be updated to use a custom framing:
- **Loro sync step 1**: client sends Loro `VersionVector` bytes (framed)
- **Loro sync step 2**: server sends Loro `Updates` export (framed)

The framing SHOULD use a 1-byte message type prefix:
- `0x01` = SyncStep1 (version vector)
- `0x02` = SyncStep2 (update blob)
- `0x03` = Update (incremental, client → server)

**Decision record DR-P1-01**: Custom framing chosen over y-protocol wrapper to
avoid a hard dependency on the y-sync message format after removing yrs. This
means existing Yjs clients (browser, any third-party) MUST be updated to use
the Loro-based client SDK. Mixed-client environments are NOT supported.

### 3.3 Encoding Incompatibility

Yrs uses `lib0 v1` binary encoding. Loro uses its own binary format. They are
**bitwise incompatible**. A Loro `import()` call given raw Yrs bytes WILL
return an error.

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
