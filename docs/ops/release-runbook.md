# Release Runbook

**Authoritative source**: [`RELEASING.md`](../../RELEASING.md) at the repo root.
This page is a user-facing mirror for the docs site. If they diverge, RELEASING.md wins.

---

## Overview

Every `llmtxt` (npm) and `llmtxt-core` (crates.io) release goes through GitHub Actions.
Local `npm publish` is blocked. Each release is gated by automated checks that prevent
the 2026-04-15 failure modes:

| 2026-04-15 failure | Gate that now prevents it |
|---------------------|--------------------------|
| Manual publish, no provenance | `prepublishOnly` script blocks local publish; CI enforces `--provenance` |
| CHANGELOG at wrong path | `validate-changelog.sh` checks `packages/llmtxt/CHANGELOG.md` |
| 38 commits before push | `pre-release-check.sh` must pass before tagging |
| Duplicate migration DDL | `check-migrations.sh` (static lint) |
| Silent migration failure | `ci-migrate-check.sh` (fresh DB + idempotency) |
| Secret-in-if skips crate publish | OIDC-only auth; no secret guard on publish step |

---

## Gate summary

### Gate 1: CHANGELOG validation (`validate-changelog.sh`)

Checks `packages/llmtxt/CHANGELOG.md` for a heading matching the release version.

```bash
bash scripts/validate-changelog.sh 2026.4.9
# OK: CHANGELOG entry found for version 2026.4.9 in packages/llmtxt/CHANGELOG.md
```

Fails with a clear message showing the last 5 headings in the file and the expected format.

### Gate 2a: Migration lint (`check-migrations.sh`)

Static scan of all `apps/backend/src/db/migrations/*/migration.sql` files. Detects
duplicate `CREATE TABLE` or `CREATE INDEX` names across separate migration files — a
symptom of regenerating migrations from scratch (forbidden by the additive-only rule).

```bash
cd apps/backend && bash scripts/check-migrations.sh
# OK: No duplicate CREATE TABLE or CREATE INDEX names found across N migration files.
```

### Gate 2b: Migration idempotency (`ci-migrate-check.sh`)

Runs all migrations against a fresh temporary SQLite database (first pass), then runs
them again on the same database (second pass). Both must exit 0 with no error strings.

```bash
cd apps/backend && bash scripts/ci-migrate-check.sh
# PASS: Fresh DB run succeeded.
# PASS: Idempotency run succeeded.
# OK: All migration checks passed (fresh run + idempotency run).
```

### Gate 3: Tests + build

The CI workflow runs:
- `cargo test` (Rust crate)
- `pnpm run build:all` (WASM + TypeScript)
- `pnpm run typecheck`
- `pnpm run test` (SDK contract tests with PostgresBackend)

### Gate 4: Idempotency (already-published check)

Before publishing, CI checks if `llmtxt@VERSION` already exists on npm. If yes, the
publish step is skipped with exit 0. The provenance audit step still runs.

### Gate 5: npm publish with provenance

```yaml
run: pnpm publish --provenance --access public --no-git-checks
env:
  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
  PUBLISH_ONLY_IN_CI: '1'
```

`PUBLISH_ONLY_IN_CI=1` is required by the `prepublishOnly` script in `package.json`.
Without it, `npm publish` fails immediately.

### Gate 6: Provenance attestation verification

```bash
npm audit signatures llmtxt@2026.4.9
# 1 package has a verified registry signature
# 1 package has a verified attestation
```

CI runs this after every publish (even idempotent re-runs). Failure here means the
package was published outside of CI without provenance.

---

## Dual-tag convention

Both tags must be pushed for a full release:

| Tag | What it triggers |
|-----|-----------------|
| `core-v2026.4.9` | `publish-npm` job in `release.yml` |
| `llmtxt-core-v2026.4.9` | `publish-crates` job in `release.yml` |

For npm-only patches (no Rust changes), push only `core-v*`.

```bash
git push origin core-v2026.4.9 llmtxt-core-v2026.4.9
```

The crates.io trusted-publisher config is keyed to the workflow filename `release.yml`.
Do not rename it.

---

## Local pre-release check

Before tagging, run all gates locally:

```bash
bash scripts/pre-release-check.sh 2026.4.9
```

This runs CHANGELOG validation, migration lint, and migration idempotency in sequence.
All three must exit 0 before you push the tag.

---

## Workflow idempotency

Re-running the release workflow for the same tag is safe:
- npm publish is skipped if `llmtxt@VERSION` already exists
- crates.io publish is skipped if HTTP 200 from the crates.io API
- GitHub Release creation is skipped if the release already exists

---

## Drizzle migrations: additive-only rule

Migrations in `apps/backend/src/db/migrations/` are additive only:
- Always add new migration files; never modify existing ones
- Never run `drizzle-kit generate` with `drop: true`
- Never delete migration files and regenerate from scratch

Violation is caught by `check-migrations.sh` (duplicate DDL across files).

---

## Workflow files

| File | Purpose |
|------|---------|
| `.github/workflows/release.yml` | npm + crates.io release (both jobs) |
| `.github/workflows/ci.yml` | PR / push CI including migration-check job |
| `.github/workflows/workflow-syntax-check.yml` | actionlint on every workflow change |

---

## Related docs

- [`RELEASING.md`](../../RELEASING.md) — authoritative step-by-step with commands
- [`docs/adr/`](../adr/) — architecture decision records
- [`apps/backend/scripts/check-migrations.sh`](../../apps/backend/scripts/check-migrations.sh)
- [`apps/backend/scripts/ci-migrate-check.sh`](../../apps/backend/scripts/ci-migrate-check.sh)
- [`scripts/validate-changelog.sh`](../../scripts/validate-changelog.sh)
- [`scripts/pre-release-check.sh`](../../scripts/pre-release-check.sh)
