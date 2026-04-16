# T246 — W1 Schema Consolidator: CRDT + Events + Identity

**Date**: 2026-04-16  
**Agent**: claude-sonnet-4-6 (T246 subagent)  
**Status**: complete

---

## 1. Migration File Paths

### Drizzle-Generated Migration
- `apps/backend/src/db/migrations-pg/20260415235846_square_sentinel/migration.sql`
- `apps/backend/src/db/migrations-pg/20260415235846_square_sentinel/snapshot.json`

Generated via: `pnpm run db:generate:pg` (drizzle-kit generate --config=drizzle-pg.config.ts)

### Raw-SQL Follow-Up Migration
- `apps/backend/src/db/migrations-pg/20260416000001_w1_constraints/migration.sql`

Contains:
1. `CREATE UNIQUE INDEX document_events_doc_idem_unique ON document_events (document_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
2. `ALTER TABLE agent_pubkeys ADD CONSTRAINT agent_pubkeys_pubkey_len_chk CHECK (octet_length(pubkey) = 32)`

---

## 2. Table Count and Names

**5 new tables added** (all in one Drizzle migration + raw-SQL follow-up):

| Table | Description |
|-------|-------------|
| `section_crdt_states` | Consolidated Yjs state vector per (document_id, section_id). Composite PK. FK → documents.slug. |
| `section_crdt_updates` | Raw Yjs update messages pending compaction. UUID PK. Indexes on (doc,section,seq) and (doc,section,created_at). |
| `document_events` | Append-only event log with hash chain. UUID PK. UNIQUE(doc,seq). Partial unique index on idempotency_key (via raw SQL). FK → documents.slug. |
| `agent_pubkeys` | Agent Ed25519 pubkeys (32 bytes enforced by CHECK constraint via raw SQL). UUID PK. UNIQUE agent_id. |
| `agent_signature_nonces` | Replay-prevention nonce store. text PK. Index on (agent_id, first_seen). |

---

## 3. T144 Idempotency CI Check

**PASSED.**

- `scripts/check-migrations.sh`: No duplicate CREATE TABLE or CREATE INDEX across migration files. Exit 0.
- `scripts/ci-migrate-check.sh`: SQLite fresh run and idempotency run both passed. Exit 0.
- PG migration runner run twice on live Postgres 16:
  - First run: `applied=3, skipped=0` — exit 0
  - Second run: `applied=0, skipped=3` — exit 0

---

## 4. Local PG Migration Test Result

```
DATABASE_URL=postgres://postgres:pg@localhost:5434/postgres \
  node --import tsx/esm scripts/run-migrations.ts
```

Output:
```json
{"event":"migrations_applied","driver":"postgres","applied":3,"skipped":0,"durationMs":733}
```

Exit code: **0**  
Applied: 3 migrations (baseline + W1 tables + W1 constraints)

---

## 5. TypeScript Compile Status

`pnpm --filter backend run build` (tsc): **0 errors**

Both `schema-pg.ts` and `schema.ts` compile cleanly after adding all 5 tables and their type exports.

---

## 6. Schema Deviations from Spec

**None.** All columns, constraints, and indexes match the spec exactly:

- `section_crdt_states`: document_id, section_id (composite PK), clock, updated_at, yrs_state (bytea)
- `section_crdt_updates`: id (uuid PK), document_id, section_id, update_blob (bytea), client_id, seq (bigint), created_at
- `document_events`: id (uuid PK), document_id, seq (bigint), event_type, actor_id, payload_json (jsonb), idempotency_key (nullable), created_at, prev_hash (bytea nullable). UNIQUE(doc,seq). Partial unique index via raw SQL.
- `agent_pubkeys`: id (uuid PK), agent_id (UNIQUE), pubkey (bytea, 32-byte CHECK via raw SQL), created_at, revoked_at (nullable)
- `agent_signature_nonces`: nonce (text PK), agent_id, first_seen. Index on (agent_id, first_seen).

FK note: `document_events.document_id` and `section_crdt_states.document_id` reference `documents.slug` (per spec), not `documents.id`.

---

## 7. Followup Tasks and Dependency Re-wiring

- **T193** (section_crdt_states + section_crdt_updates schema): marked `done` — subsumed
- **T225** (document_events schema): marked `done` — subsumed
- **T218** (agent_pubkeys schema): NOT marked done — has additional dependency on T217 (Rust identity.rs module) which remains pending. T218's schema requirements are fully satisfied by this task; only the T217 Rust dependency gate blocks completion.
- **Unblocked by T246 completion**: T217, T220, T226, T229 (per CLEO engine output)
- **Unblocked by T193 completion**: (none additional)
- **Unblocked by T225 completion**: T226 (appendDocumentEvent helper)

---

## Files Modified

- `apps/backend/src/db/schema-pg.ts` — 5 new tables + type exports + Zod schemas
- `apps/backend/src/db/schema.ts` — 5 SQLite mirror tables + type exports

## Files Created

- `apps/backend/src/db/migrations-pg/20260415235846_square_sentinel/migration.sql`
- `apps/backend/src/db/migrations-pg/20260415235846_square_sentinel/snapshot.json`
- `apps/backend/src/db/migrations-pg/20260416000001_w1_constraints/migration.sql`
