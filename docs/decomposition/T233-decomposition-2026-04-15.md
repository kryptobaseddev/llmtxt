# T233 Decomposition: PostgreSQL Migration (2026-04-15)

**Epic**: T233 — Ops: SQLite → Postgres migration
**Status**: Decomposition complete
**Date**: 2026-04-15T20:58:00Z
**Decomposition Stages**: RCASD Research (Lead), Decomposition (Hariku 4.5)

---

## Summary

The RCASD Lead completed the Research stage with design docs (SPEC-T233, ADR-T233). This decomposition atomizes the epic into 12 testable task cards across three execution phases:

1. **Foundational Setup** (T234-T236): Driver swap, schema drift fix, migration generation
2. **Application & Test Porting** (T237-T239): Code modernization, test refactoring, CI integration
3. **Data Migration & Cutover** (T240-T245): Data script, runbook, preview/production execution, and 30-day cleanup

---

## Task Cards Created

| ID | Title | Phase | Size | Priority | Status |
|----|-------|-------|------|----------|--------|
| T234 | Add postgres-js driver + swap adapter | Setup | small | medium | Ready |
| T235 | Fix schema-pg.ts versionCount drift | Setup | small | medium | Ready |
| T236 | Generate PG migration series | Setup | small | critical | Blocked (needs T234, T235) |
| T237 | Port conflicts.ts to async tx | Code | small | critical | Blocked (needs T234) |
| T238 | Port test harness to PG | Test | medium | critical | Blocked (needs T234, T235, T236) |
| T239 | Add CI Postgres ephemeral service | CI | small | critical | Blocked (needs T238) |
| T240 | Write SQLite→PG data migration script | Migration | medium | critical | Blocked (needs T236) |
| T241 | Write postgres-cutover runbook | Docs | small | high | Blocked (needs T240) |
| T242 | Blue/green preview deploy & smoke test | Deployment | small | high | Blocked (needs T234, T236, T237, T240) |
| T243 | Execute production cutover | Deployment | small | critical | Blocked (needs T241, T242) |
| T244 | Document 30-day retention reminder | Ops | small | high | Blocked (needs T242) |
| T245 | Remove better-sqlite3 deps (post-30d) | Cleanup | small | high | Blocked (needs T244) |

---

## Dependency Graph

```
                    ┌─────────────────────┐
                    │  T234: Driver       │ ← READY
                    │  T235: Schema drift │ ← READY
                    └─────────────────────┘
                           │          │
                    ┌──────┴──┬───────┴──┐
                    │         │          │
                    v         v          v
            ┌──────────────┐ ┌─────────┐ ┌──────────┐
            │ T236: PG     │ │T237:    │ │T238: Test│
            │ migrations   │ │conflicts│ │harness   │
            └──────────────┘ └─────────┘ └──────────┘
                    │             │          │
                    └─────────────┼──────────┘
                                  │
                                  v
                    ┌──────────────────────┐
                    │ T240: Data migration │
                    └──────────────────────┘
                           │
                    ┌──────┴──────────┐
                    │                 │
                    v                 v
            ┌──────────────┐  ┌───────────────┐
            │ T241: Runbook│  │ T239: CI      │
            └──────────────┘  └───────────────┘
                    │                 │
                    └────────┬────────┘
                             │
                             v
                    ┌──────────────────────┐
                    │ T242: Preview deploy │
                    │      + smoke test    │
                    └──────────────────────┘
                             │
                             v
                    ┌──────────────────────┐
                    │ T243: Prod cutover   │
                    └──────────────────────┘
                             │
                             v
                    ┌──────────────────────┐
                    │ T244: 30-day reminder│
                    └──────────────────────┘
                             │
                             v
                    ┌──────────────────────┐
                    │ T245: Cleanup deps   │
                    └──────────────────────┘
```

---

## Execution Waves (Parallelizable Groups)

### Wave 1 (Day 0 — Parallel): 2 tasks
- **T234** (postgres-js driver swap) — small, ~2-3 hours
- **T235** (schema drift fix) — small, ~30-60 min

### Wave 2 (After T234, T235): 3 tasks (mostly parallel)
- **T236** (PG migrations) — small, ~30-60 min (depends T234, T235)
- **T237** (conflicts.ts async tx) — small, ~1-2 hours (depends T234)
- **T238** (test harness port) — medium, ~3-4 hours (depends T234, T235, T236)

### Wave 3 (After T236, T237, T238): 2 tasks (mostly parallel)
- **T239** (CI Postgres service) — small, ~1 hour (depends T238)
- **T240** (data migration script) — medium, ~3-4 hours (depends T236)

### Wave 4 (After T240): 1 task
- **T241** (cutover runbook) — small, ~1-2 hours (depends T240)

### Wave 5 (Integration): 1 task
- **T242** (preview deploy & smoke) — small, ~2-3 hours (depends T234, T236, T237, T240)

### Wave 6 (Production): 1 task
- **T243** (production cutover) — small, ~30-60 min (depends T241, T242)

### Wave 7 (Post-Production): 2 tasks
- **T244** (30-day retention reminder) — small, ~30 min (depends T242)
- **T245** (cleanup deps) — small, ~1 hour (depends T244)

**Total estimated effort**: ~20–25 hours of development + ops execution
**Critical path**: T234 → T236 → T240 → T241 → T243 (≈10–12 hours)

---

## Task Dependencies & Rationale

### Independent Tasks (Ready to Start)
- **T234** and **T235** have no dependencies and can start immediately in parallel
- Both must complete before T236 (PG migration generation requires driver and corrected schema)

### Critical Path
1. **T234** → driver available
2. **T235** → schema corrected
3. **T236** → migrations generated (blocks data script)
4. **T240** → data migration script ready
5. **T241** → runbook written (blocks production execution)
6. **T243** → production cutover (final gate)

### Optional Parallelization
- **T237** (conflicts.ts) can run in parallel with T236 (only needs T234)
- **T238** (test harness) can start as soon as T236 completes, in parallel with T239
- **T239** (CI) can start once T238 passes

---

## Acceptance Criteria Mapping

Each task includes 3–5 acceptance criteria derived from SPEC-T233 and ADR-T233:

| Requirement | Task Coverage |
|-------------|--------|
| postgres-js driver installed | T234 |
| Schema drift (versionCount) fixed | T235 |
| Fresh PG migrations generated | T236 |
| All 20 tables present | T235, T236 verification |
| conflicts.ts async transaction | T237 |
| Test harness refactored | T238 |
| CI Postgres service added | T239 |
| Data migration script | T240 |
| Boolean/BLOB conversion verified | T240 |
| Cutover runbook | T241 |
| Row count verification post-migration | T240, T243 |
| 30-day volume retention documented | T244 |
| Rollback capability verified | T241, T242 |
| Production health checks passing | T243 |
| Zero data loss | T240, T243 |

---

## Non-Requirements & Out of Scope

Per SPEC-T233 section 10:
- Row-Level Security (tracked separately in T166)
- Multi-region replication (tracked in T078)
- Drizzle ORM version upgrade
- API behavior or response shape changes
- New application features

---

## Coordination with Downstream Epics

**T146 (CRDT Yrs integration)** and **T148 (event log)** both have Postgres as a hard dependency. T233's baseline migration will NOT pre-create `section_crdt_states`, `section_crdt_updates`, or `document_events` tables. Those are added as incremental migrations AFTER T233 lands.

Interface contract:
- **T233 delivers**: 20-table baseline PG schema + all tests passing
- **T146 adds**: `section_crdt_states`, `section_crdt_updates` tables in incremental migration
- **T148 adds**: `document_events` table in incremental migration

---

## Verification Checklist

Before marking T233 complete:

- [ ] T234–T235: Ready (no blockers)
- [ ] T236–T239: Depend on predecessors correctly
- [ ] T240: Covers all 20 tables in correct FK order
- [ ] T241: Runbook step-by-step matches SPEC section 8.2
- [ ] T242: Smoke tests cover document CRUD, concurrent writes
- [ ] T243: Production cutover under 10 minutes
- [ ] T244: 30-day calendar reminder set
- [ ] T245: Cleanup task scheduled for day 31

---

## References

- **SPEC**: `docs/spec/SPEC-T233-postgres-migration.md`
- **ADR**: `docs/adr/ADR-T233-postgres-migration.md`
- **Epic**: `cleo show T233`
- **Execution Waves**: `cleo orchestrate status --epic T233`
