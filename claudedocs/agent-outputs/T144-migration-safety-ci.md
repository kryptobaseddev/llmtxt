# T144 Migration Safety in CI — Implementation Summary

**Date**: 2026-04-15
**Commit**: 9a62596
**CI Run**: https://github.com/kryptobaseddev/llmtxt/actions/runs/24473592102
**Status**: complete — all 5 tasks done, commit pushed, CI queued

---

## Tasks Completed

| Task | Title | Status |
|------|-------|--------|
| T190 | check-migrations.sh static lint | done |
| T192 | ci-migrate-check.sh fresh-DB integration | done |
| T194 | migration-check job in ci.yml | done |
| T196 | run-migrations.ts strict deploy wrapper | done |
| T198 | apps/backend/drizzle/MIGRATIONS.md authoring contract | done |

---

## Files Created / Modified

### New files
- `apps/backend/scripts/check-migrations.sh` — pure POSIX shell lint; grep/awk duplicate CREATE TABLE and CREATE INDEX detection across all migration.sql files; no Node runtime required; exits 1 with file names on conflict
- `apps/backend/scripts/ci-migrate-check.sh` — mktemp SQLite, pnpm db:migrate twice (fresh + idempotency), grep for error markers even when drizzle-kit exits 0
- `apps/backend/scripts/run-migrations.ts` — Drizzle programmatic migrate API; process.exit(1) on failure; logs `{ event: "migrations_applied", durationMs }` on success and `{ event: "migration_failed", stage, error }` on failure
- `apps/backend/drizzle/MIGRATIONS.md` — authoring contract: one change per file, no IF NOT EXISTS, generate with drizzle-kit only, run check-migrations.sh before PR

### Modified files
- `.github/workflows/ci.yml` — added `migration-check` job (pnpm + Node 24, no Rust); runs lint then integration check
- `Dockerfile` — CMD updated from `npx drizzle-kit migrate` to `node --import tsx/esm scripts/run-migrations.ts && node ...`
- `apps/backend/package.json` — added `start:migrate` script

---

## Validation Results

### check-migrations.sh
- Clean 6-migration set: exits 0
- Simulated duplicate (api_keys in two files): exits 1, prints table name and both file paths

### ci-migrate-check.sh
- Fresh DB run: all 6 migrations applied, exits 0
- Idempotency (second run): exits 0
- Duplicate injected into migration.sql: drizzle-kit exits 1, ci-migrate-check.sh exits 1

### run-migrations.ts
- Fresh DB: `{"event":"migrations_applied","durationMs":15}`, exits 0
- Second run same DB: exits 0 (tracked via __drizzle_migrations)
- Error scenario: `{"event":"migration_failed","stage":"migrate","error":"..."}`, exits 1

### Regression guards
- Backend tests: 67/67 pass
- pnpm lint: 0 warnings
- cargo fmt --check: clean
- cargo test --features wasm: 2/2 pass

---

## HITL Required (out of scope for CI commit)

Branch protection on `main` must have `migration-check` added as a required status check. This is a GitHub repository settings change that requires owner access. See T194 acceptance criterion 5.
