# Spec P2: cr-sqlite LocalBackend (Database-Level CRDT)

**Version**: 1.1.0
**Status**: DRAFT — planning only, no implementation
**RFC 2119 Key words**: MUST, MUST NOT, SHOULD, MAY

---

## 1. Background and Motivation

LLMtxt's `LocalBackend` currently uses a plain SQLite file
(`packages/llmtxt/src/local/local-backend.ts`) via `better-sqlite3`. Syncing
between two LocalBackend instances requires either REST polling against
api.llmtxt.my or a full snapshot comparison — both are bandwidth-heavy and do
not support offline-first operation.

**cr-sqlite** (from vlcn.io) is a runtime-loadable SQLite extension that makes
each table a Conflict-free Replicated Relation (CRR). Changes are tracked in a
`crsql_changes` virtual table. Two databases can sync by exchanging only the
delta rows since their last sync, achieving guaranteed convergence.

This enables each LLMtxt agent to own a local `.db` file and sync with other
agents or the cloud by exchanging lightweight changesets — no central coordinator
needed for writes.

**Architecture constraint**: LLMtxt uses single-tenant mode — one agent per
`.db` file. This mode is production-validated by the cr-sqlite maintainers.
Multi-tenancy (multiple agents sharing one file) is not part of this
architecture and not relevant to these specs.

---

## 2. Architecture Overview

```
Agent A                       Agent B
┌─────────────────────┐       ┌─────────────────────┐
│ LocalBackend        │       │ LocalBackend        │
│ ┌────────────────┐  │       │ ┌────────────────┐  │
│ │  agent-a.db   │  │       │ │  agent-b.db   │  │
│ │ + cr-sqlite   │  │       │ │ + cr-sqlite   │  │
│ │ + Loro blobs  │  │       │ │ + Loro blobs  │  │
│ └────────────────┘  │       │ └────────────────┘  │
│  getChangesSince()  │──────►│  applyChanges()     │
│  applyChanges()     │◄──────│  getChangesSince()  │
└─────────────────────┘       └─────────────────────┘
        │                             │
        └──────── api.llmtxt.my ──────┘
                  (optional peer,
                   Postgres backend)
```

The server (`api.llmtxt.my` with `PostgresBackend`) MAY participate as a
peer by translating its Postgres rows into/from cr-sqlite changeset format.
This is addressed in Phase 3.

---

## 3. cr-sqlite Integration

### 3.1 Node.js Extension Loading

cr-sqlite is distributed as a native SQLite extension (`.so` / `.dylib` /
`.dll`). The npm package `@vlcn.io/crsqlite` provides prebuilt binaries for
common platforms.

```typescript
// LocalBackend.open() — pseudocode
const db = new Database(storagePath);
if (config.crsqliteExtPath) {
  db.loadExtension(config.crsqliteExtPath);
} else {
  // attempt to locate via @vlcn.io/crsqlite packageDir
  db.loadExtension(require('@vlcn.io/crsqlite'));
}
```

**MUST** support `{ crsqliteExtPath?: string }` in `BackendConfig` to allow
users to supply a custom extension path for air-gapped or bundled environments.

**Decision record DR-P2-01**: `@vlcn.io/crsqlite` is the primary distribution
mechanism. It MUST be declared as an **optional peer dependency** of
`packages/llmtxt` (not a hard dependency) so that consumers not using
LocalBackend are not forced to install a native addon. The build MUST NOT fail
if the package is absent; it MUST throw at runtime only when cr-sqlite is
explicitly enabled.

### 3.2 CRR Table Activation

After schema creation, each table MUST be registered as a CRR:

```sql
SELECT crsql_as_crr('documents');
SELECT crsql_as_crr('versions');
SELECT crsql_as_crr('sections');
SELECT crsql_as_crr('section_crdt_states');
SELECT crsql_as_crr('section_crdt_updates');
SELECT crsql_as_crr('events');
SELECT crsql_as_crr('agents');
SELECT crsql_as_crr('approvals');
SELECT crsql_as_crr('leases');
SELECT crsql_as_crr('rate_limit_buckets');
```

`crsql_as_crr` MUST be called exactly once per table per database (calling
it again is a no-op, but SHOULD be guarded with a schema version flag).

**Decision record DR-P2-02**: Tables are made CRR at database initialization
time, not at migration time, because cr-sqlite's internal metadata is stored
in SQLite application state. The migration that adds cr-sqlite support MUST
include the `crsql_as_crr` calls in an idempotent wrapper.

### 3.3 Changeset Exchange API

Two new methods MUST be added to the `Backend` interface:

```typescript
interface Backend {
  // ... existing methods ...

  /**
   * Returns all changes made to this database since `dbVersion`.
   * `dbVersion = 0` returns the full history.
   * The changeset is an opaque byte buffer (cr-sqlite wire format).
   */
  getChangesSince(dbVersion: bigint): Promise<Uint8Array>;

  /**
   * Applies a changeset received from a peer.
   * MUST be idempotent (applying the same changeset twice is safe).
   * Returns the new local db_version after applying.
   */
  applyChanges(changeset: Uint8Array): Promise<bigint>;
}
```

The underlying SQL:

```sql
-- getChangesSince
SELECT * FROM crsql_changes WHERE db_version > ?;

-- applyChanges (pseudo — cr-sqlite provides crsql_merge_changeset())
INSERT INTO crsql_changes SELECT * FROM crsql_deserialize(?);
SELECT crsql_db_version();
```

**Decision record DR-P2-03**: The changeset wire format is cr-sqlite's native
binary serialization (not JSON). This minimizes size and avoids a
double-serialization layer. Callers that need HTTP transport MUST base64-encode
the binary blob.

---

## 4. CRR Column Type Strategy

cr-sqlite supports three merge semantics per column:

| Semantic | Trigger | Use when |
|---|---|---|
| Last-Write-Wins (LWW) | default | Most scalar fields |
| Counter | `crsql_crr_counter` extension | Monotonically increasing counts |
| OR-set | via separate table pattern | Multi-valued sets (e.g., votes) |

### 4.1 Table-by-Table Strategy

**documents**
- `title`, `content`, `slug`, `status`, `lifecycle_state`, `locked_by`, `locked_at`, `metadata` — LWW (last writer wins per row)
- `version_count` — this is a derived counter; DO NOT use cr-sqlite counter CRR here. Instead treat as LWW and recompute from `versions` table after sync.

**versions**
- All columns — LWW. Version rows are immutable once created; concurrent creation of the same version_number on two peers creates a conflict that LWW resolves by logical timestamp.

**sections**
- `title`, `content`, `order`, `metadata` — LWW
- `crdt_state` (formerly `yrs_state`) — **EXCLUDED FROM CRR MERGE**: this column stores a Loro binary blob. LWW would silently corrupt it if two peers write simultaneously.
- **Design constraint DC-P2-04**: `crdt_state` MUST be excluded from cr-sqlite CRR merge. Application-level `doc.import()` (Loro merge) handles all convergence for this column. This is a correctness requirement, not optional. On changeset receipt, the backend MUST detect a `crdt_state` update and call `loro_merge(local_blob, remote_blob)` instead of applying the changeset value directly via LWW.

**section_crdt_states** / **section_crdt_updates**
- `crdt_state` (blob) — Loro-managed; same treatment as sections.crdt_state above.
- All other columns — LWW.

**events**
- Append-only log — LWW on `(id)` primary key. Events are immutable; if two peers independently generate the same event_id (UUID collision) LWW is acceptable.
- `event_seq` (integer) — local to each agent; MUST NOT be treated as a global sequence after sync. Consumers MUST sort by `created_at` timestamp, not `event_seq`, after cross-agent sync.

**approvals**
- `status` — LWW. If two peers independently approve/reject the same approval slot, the later write wins. This is the intended behavior for async workflows.
- Votes are immutable rows; use LWW on the row PK.

**leases**
- `expires_at`, `holder_agent_id` — LWW. Lease conflicts are expected; last writer wins is correct because the lease holder that writes last has the most recent TTL information.

**agents** / **rate_limit_buckets**
- All columns — LWW.

### 4.2 Loro Blob Merge: Application-Level Correctness Requirement

cr-sqlite LWW MUST NOT be used on `crdt_state` columns. Loro blob columns MUST
be excluded from cr-sqlite CRR merge. Application-level `doc.import()` handles
Loro merge. This is a correctness requirement, not optional.

The merge path in `applyChanges`:

1. On `applyChanges(changeset)`, after cr-sqlite applies the changeset,
   iterate rows where `crdt_state` was updated.
2. For each such row, fetch both local and incoming blob.
3. Call `crdt_merge_updates([local_blob, remote_blob])` (Loro-based after P1).
4. Write the merged result back to `crdt_state`.

This MUST happen inside a SQLite transaction to be atomic.

**Blocker**: P2.11 (Loro blob + cr-sqlite integration test) MUST pass before
the cr-sqlite epic is considered shippable. It is a hard blocker, not a
follow-up task.

---

## 5. Production Constraints

cr-sqlite single-tenant mode (one agent per `.db` file) is production-validated
by the cr-sqlite maintainers. This is the only mode used by LLMtxt.

### 5.1 Existing `llmtxt.db` Files

Existing databases (without cr-sqlite) MUST continue to work. The `LocalBackend`
MUST detect whether cr-sqlite is loaded and whether CRRs are activated:

```typescript
const hasCrSqlite = db.pragma('user_version')[0].user_version >= CRR_SCHEMA_VERSION;
```

If cr-sqlite is NOT loaded, `getChangesSince()` and `applyChanges()` MUST throw
`CrSqliteNotLoadedError`. Basic CRUD operations MUST continue to function
normally. This ensures zero breaking change for existing consumers.

### 5.2 Schema Migration

A new schema migration MUST:
1. Rename `section_crdt_states.yrs_state` → `section_crdt_states.crdt_state`
   (coordinated with P1.7).
2. Call `crsql_as_crr()` for each table.
3. Bump `user_version` to mark CRR activation.

The migration MUST be idempotent: if `crsql_as_crr` has already run, the
migration MUST skip those calls safely.

### 5.3 Performance Budget

cr-sqlite adds ~15% write overhead (measured by vlcn.io). This is acceptable
for the LLMtxt workload (low-frequency document writes, not high-throughput
OLTP). A benchmark SHOULD be added to CI that fails if write overhead exceeds
25% above the non-cr-sqlite baseline.

---

## 6. CLI Integration

The `llmtxt sync` command (T348 scope) MUST be updated to support changeset
exchange:

```
llmtxt sync --from <peer-url-or-path> [--db <path>] [--since <db-version>]
```

- `--from` accepts: HTTP URL (for api.llmtxt.my), file path (for local peer
  database), Unix socket path.
- `--since` defaults to the last known sync version (stored in a local
  `llmtxt_sync_state` table).
- The CLI MUST print: synced, created, updated, conflicts counts.

---

## 7. Implementation Constraints

| Constraint | Detail |
|---|---|
| cr-sqlite native addon platform support | Prebuild binaries required for linux/amd64, darwin/arm64, darwin/amd64, win32/x64; optional dep (DR-P2-01) — this is a ship requirement |
| `better-sqlite3` + cr-sqlite extension SQLite ABI match | Pin both to same SQLite version; integration test on all platforms in CI — required before release |
| Loro blob correctness (DC-P2-04) | Application-level Loro merge on blob columns is MANDATORY; LWW on blob columns is prohibited and tested (P2.11 MUST prove LWW is disabled) |
| `event_seq` after sync | Consumers sort by `created_at`; document the constraint; add a lint |
| Changeset size growth | `getChangesSince` prunes by db_version; document changeset compaction via `VACUUM` |

---

## 8. Dependency DAG (Phase 2)

```
P2.1 (cr-sqlite Node.js integration research)
  └─→ P2.2 (@vlcn.io/crsqlite as optional peer dep)
        ├─→ P2.3 (schema-local.ts + migration: crsql_as_crr per table)
        └─→ P2.4 (CRR column strategy spec — DC-P2-04 detail)
              (P2.3 + P2.4 merge here)
              └─→ P2.5 (LocalBackend.open() loads extension + activates CRRs)
                    ├─→ P2.6 (getChangesSince implementation)
                    └─→ P2.7 (applyChanges implementation + Loro blob merge)
                          ├─→ P2.8 (CLI llmtxt sync — changeset exchange)
                          └─→ P2.9 (Backend interface: getChangesSince + applyChanges)
                                ├─→ P2.10 (multi-agent local test: 3 DBs converge)
                                └─→ P2.11 (Loro blob + cr-sqlite integration test) ← BLOCKER
                                      └─→ P2.12 (contract tests extended)
                                            ├─→ P2.13 (docs: cr-sqlite sync model)
                                            └─→ P2.14 (CLEO integration example)
```

---

## 9. Acceptance Criteria (Epic)

1. `LocalBackend` loads cr-sqlite when `@vlcn.io/crsqlite` is installed; falls
   back gracefully (no crash) when the package is absent.
2. All existing LocalBackend contract tests pass with cr-sqlite enabled.
3. `getChangesSince(0)` returns a non-empty changeset after any write operation.
4. Three `LocalBackend` instances with independent writes converge to identical
   state after pairwise changeset exchange (multi-agent test P2.10).
5. Loro blob columns are merged via Loro's merge protocol, never via LWW; the
   integration test P2.11 verifies this by proving that if cr-sqlite LWW were
   used on the blob column the test MUST fail (confirming LWW is disabled for
   blob columns). Two agents editing the same section via separate `.db` files
   sync changesets and Loro state converges to identical bytes.
6. `llmtxt sync` command exits 0 on successful bidirectional sync; changeset
   size is logged.
7. Write overhead of cr-sqlite is measured and does not exceed 25% above
   baseline on the P2.10 test dataset.
8. All features ship production-ready. No known-broken functionality in the
   release.
