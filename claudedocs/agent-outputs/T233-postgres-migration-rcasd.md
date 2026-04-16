# T233 RCASD: SQLite → Postgres Migration Planning

**Date**: 2026-04-15
**Task**: T233
**Stage**: Research + Consensus + ADR + SPEC + Decomposition
**Status**: complete

---

## Deliverables

| Stage | File |
|-------|------|
| Research | `docs/research/T233-postgres-migration.md` |
| ADR | `docs/adr/ADR-T233-postgres-migration.md` |
| SPEC | `docs/spec/SPEC-T233-postgres-migration.md` |
| Runbook placeholder | Created as T233.8 task (runbook written during impl) |

---

## Child Tasks Created

| ID | Title | Size | Priority | Depends |
|----|-------|------|----------|---------|
| T234 | T233.1: Add postgres-js driver and swap drizzle adapter | small | critical | — |
| T235 | T233.2: Fix schema-pg.ts drift - versionCount | small | critical | — |
| T236 | T233.3: Generate fresh Postgres migrations | small | critical | T234, T235 |
| T237 | T233.4: Port conflicts.ts to async PG transaction | small | critical | T234 |
| T238 | T233.5: Port test harness to PG | medium | critical | T234, T235, T236 |
| T239 | T233.6: Add PG service to CI | small | critical | T238 |
| T240 | T233.7: Write data migration script | medium | critical | T236 |
| T241 | T233.8: Write postgres-cutover runbook | small | high | T240 |
| T242 | T233.9: Blue/green preview deploy and smoke test | small | high | T234, T236, T237, T240 |
| T243 | T233.10: Execute production cutover | small | critical | T241, T242 |
| T244 | T233.11: 30-day retention policy + reminder | small | medium | T242 |
| T245 | T233.12: Remove better-sqlite3 after stability window | small | low | T244 |

---

## Consensus Answers

**Q1: `json_extract` → PG operator semantics**
No `json_extract` exists anywhere in the codebase. All JSON columns are stored
as serialized text strings. No jsonb operator decision needed now. T146 may
add jsonb columns; that spec should address it independently.

**Q2: Connection pool size**
Use `max: 20`. Matches existing node-postgres Pool config. Appropriate for
a single Railway service instance.

**Q3: Migration during cutover — manual vs automated**
Manual: run `scripts/migrate-sqlite-to-postgres.ts` from a Railway one-off
instance during the maintenance window. Automated on-boot migration is too
risky (silent failure, no retry UX).

**Q4: Concurrent write handling — BEGIN IMMEDIATE equivalent**
Use the existing UNIQUE constraint retry pattern (already in versions.ts and
merge.ts; must be added to conflicts.ts as part of async conversion).
Do NOT use advisory locks or serializable isolation — overkill for this
write volume, and the retry pattern is already proven correct.

**Q5: Rollback plan**
Keep Railway volume for 30 days. Rollback = revert `DATABASE_URL` + `DATABASE_PROVIDER`
env vars + redeploy previous image. T233.11 documents the reminder.

---

## T146/T148 Interface Contract

T233 delivers: clean Postgres with all 20 existing tables, baseline migrations in
`src/db/migrations-pg/`, all 67 tests passing against PG.

T146 (CRDT) adds to `schema-pg.ts` ONLY:
- `section_crdt_states` table
- `section_crdt_updates` table
- Generates incremental migration after T233 baseline.

T148 (event log) adds to `schema-pg.ts` ONLY:
- `document_events` table
- Generates incremental migration after T233 baseline.

Neither T146 nor T148 may modify T233's baseline migration files.

---

## HITL Flags

- **Production cutover (T233.10)** requires owner approval before execution.
  The env var flip is irreversible without the rollback procedure.
- **Volume destruction (T233.11/T233.12)** requires explicit owner confirmation.
  These are permanently destructive.
- All other tasks are fully autonomous.
