# Release Runbook

This document is the authoritative step-by-step guide for releasing `llmtxt` (npm)
and `llmtxt-core` (crates.io). Follow every step in order. Do not skip gates.

> **Failure mode this runbook prevents**: On 2026-04-15, a manual `npm publish`
> fired without provenance attestation. CHANGELOG.md lived at the repo root instead
> of `packages/llmtxt/CHANGELOG.md`. 38 commits piled up before the tags were
> pushed. Each gate below directly addresses one of those failure modes.

---

## Prerequisites

- You have push access to the `kryptobaseddev/llmtxt` repository.
- `NPM_TOKEN` secret is set in GitHub repository secrets.
- crates.io OIDC trusted publisher is configured for `release.yml` (this file name
  is load-bearing — do not rename the workflow).
- `actionlint` passes locally: `./actionlint .github/workflows/*.yml`

---

## CalVer convention

This project uses **CalVer**: `YYYY.M.PATCH` (no leading zeros).

| Component | Example |
|-----------|---------|
| Year      | `2026`  |
| Month     | `4`     |
| Patch     | `9`     |
| Full      | `2026.4.9` |

The patch number increments within the same calendar month. It does NOT reset
to 0 on a new month; it continues from the previous patch.

---

## CHANGELOG-of-record

**Location**: `packages/llmtxt/CHANGELOG.md`

This is the single authoritative CHANGELOG for the npm package. The file at
the repo root (`CHANGELOG.md`) is for ecosystem-wide notes and is NOT read by
the release workflow.

### Required heading format

The release workflow looks for one of these patterns:

```
## [2026.4.9] — 2026-04-18
## [2026.4.9]
## 2026.4.9 — 2026-04-18
## 2026.4.9
```

Missing entry → CI fails with: `ERROR: No CHANGELOG entry found for version X.Y.Z`

For `llmtxt-core` (crates.io), the CHANGELOG is at `crates/llmtxt-core/CHANGELOG.md`.
The crate publish does not currently have an enforced gate (crates.io releases are
rare), but keeping it in sync is expected.

---

## Step-by-step release process

### Step 1: Determine the new version

```bash
# Check the current version
cat packages/llmtxt/package.json | grep '"version"'
# → "version": "2026.4.8"

# New version for an npm-only patch in April 2026:
NEW_VERSION=2026.4.9
```

### Step 2: Update version in source files

For an **npm-only** release (no Rust changes):

```bash
# Update packages/llmtxt/package.json
jq --arg v "$NEW_VERSION" '.version = $v' packages/llmtxt/package.json > /tmp/pkg.json
mv /tmp/pkg.json packages/llmtxt/package.json
```

For a **full release** (npm + crates.io, both tags needed):

```bash
# Also update crates/llmtxt-core/Cargo.toml
sed -i "s/^version = \".*\"/version = \"${NEW_VERSION}\"/" crates/llmtxt-core/Cargo.toml

# Regenerate Cargo.lock
cargo update --workspace --precise "$NEW_VERSION" 2>/dev/null || true
```

### Step 3: Write the CHANGELOG entry

Open `packages/llmtxt/CHANGELOG.md` and add an entry **at the top** (below
the `## [Unreleased]` section if present):

```markdown
## [2026.4.9] — 2026-04-18

### Fixed
- Brief description of what changed.

### Added
- ...
```

For crate-level changes also update `crates/llmtxt-core/CHANGELOG.md`.

### Step 4: Run pre-release gates locally

```bash
bash scripts/pre-release-check.sh "$NEW_VERSION"
```

This runs (in order):
1. `scripts/validate-changelog.sh` — verifies CHANGELOG entry exists
2. `apps/backend/scripts/check-migrations.sh` — no duplicate DDL
3. `apps/backend/scripts/ci-migrate-check.sh` — fresh DB + idempotency run

All three must exit 0 before tagging.

### Step 5: Commit

```bash
git add packages/llmtxt/package.json packages/llmtxt/CHANGELOG.md
# If Rust version bumped:
git add crates/llmtxt-core/Cargo.toml Cargo.lock crates/llmtxt-core/CHANGELOG.md

git commit -m "release(v${NEW_VERSION}): bump version and update CHANGELOG"
```

### Step 6: Push the commit to main first

```bash
git push origin main
```

Wait for CI (`.github/workflows/ci.yml`) to go green before tagging.

### Step 7: Tag — dual-tag convention

Both tags are required for the full release. Push them together:

```bash
# npm tag (triggers publish-npm job)
git tag "core-v${NEW_VERSION}"

# crates.io tag (triggers publish-crates job) — npm-only releases skip this
git tag "llmtxt-core-v${NEW_VERSION}"

# Push both tags at once
git push origin "core-v${NEW_VERSION}" "llmtxt-core-v${NEW_VERSION}"
```

For an **npm-only** patch release (no Rust changes), push only the npm tag:

```bash
git tag "core-v${NEW_VERSION}"
git push origin "core-v${NEW_VERSION}"
```

### Step 8: Monitor the CI workflow

1. Go to: `https://github.com/kryptobaseddev/llmtxt/actions/workflows/release.yml`
2. Watch the `publish-npm` job (and `publish-crates` if applicable).
3. Gate order in `publish-npm`:
   - CHANGELOG validation
   - Migration lint (check-migrations.sh)
   - Migration idempotency (ci-migrate-check.sh)
   - Rust tests + WASM build + TypeScript build + SDK tests
   - npm publish (skipped if already published — idempotent)
   - Provenance verification (npm audit signatures)
   - GitHub Release creation (skipped if already exists — idempotent)

### Step 9: Verify provenance attestation

After the workflow succeeds, verify locally:

```bash
npm audit signatures llmtxt@${NEW_VERSION}
```

Expected output:
```
audited 1 package in Xs
1 package has a verified registry signature
1 package has a verified attestation
```

If this fails: the package was published without `--provenance`. File an incident
and do not promote the release until attestation is confirmed.

---

## Migration gates

### drizzle-kit additive-only rule

Migrations in `apps/backend/src/db/migrations/` MUST be additive only.

**Never** run `drizzle-kit generate` with `drop: true` or delete existing migration
files. New columns/tables are always added as `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
or a new migration file.

**Never** regenerate migrations from scratch. Drizzle v1 beta detects state via the
`_journal.json` and will attempt to re-apply migrations it thinks are new. This
silently breaks deploys.

### check-migrations.sh

Runs static analysis across all `migration.sql` files. Detects duplicate
`CREATE TABLE` or `CREATE INDEX` names across separate migration files — a
symptom of the regeneration footgun.

```bash
# Run from apps/backend/
bash scripts/check-migrations.sh
```

### ci-migrate-check.sh

Spins up a temporary SQLite database, applies all migrations (first pass), then
applies again (second pass). Both passes must exit 0 with no error strings.

```bash
# Run from apps/backend/
bash scripts/ci-migrate-check.sh
```

---

## Local publish is blocked

`packages/llmtxt/package.json` has a `prepublishOnly` script that exits 1 unless
`PUBLISH_ONLY_IN_CI=1` is set. This prevents contributors from running `npm publish`
or `pnpm publish` locally, which would skip provenance, CHANGELOG, and migration gates.

```
ERROR: Direct npm publish is not allowed.
Publishing llmtxt must go through GitHub Actions to ensure:
  - OIDC provenance attestation (--provenance flag)
  - CHANGELOG validation gate
  - Migration safety gates
  - Full test suite
```

---

## Workflow idempotency

The release workflow is safe to re-run:

- **npm**: If `llmtxt@VERSION` already exists on npm, the publish step is skipped
  (`already_published=true`). The provenance audit step still runs.
- **crates.io**: If `llmtxt-core@VERSION` returns HTTP 200 from crates.io API, the
  publish step is skipped. Tests still run.
- **GitHub Release**: If the release tag already has a GitHub Release, the creation
  step is skipped.

---

## Secret-in-if anti-pattern (crates.io OIDC)

The `publish-crates` job uses `rust-lang/crates-io-auth-action@v1` for OIDC. There
is no `if: secrets.CARGO_REGISTRY_TOKEN != ''` guard. That pattern is explicitly
avoided because a missing secret would silently skip the publish step with exit 0.

OIDC authentication fails loudly if the trusted publisher is misconfigured — the
`crates-io-auth-action` step will exit non-zero, blocking the publish.

---

## Tag naming is load-bearing

| Tag pattern         | Triggers          |
|---------------------|-------------------|
| `core-v*`           | `publish-npm` job |
| `llmtxt-core-v*`    | `publish-crates` job |

The crates.io trusted-publisher configuration is keyed to the workflow filename
`release.yml`. Do not rename it.

---

## Emergency rollback

npm does not allow deleting published versions. If a bad version slips through:

1. `npm deprecate llmtxt@BAD_VERSION "Do not use — see BAD_VERSION+1"`
2. Publish a patch release with the fix.
3. File a post-mortem in `docs/adr/`.

crates.io does not allow yanking programmatically via CLI — use the web UI at
`https://crates.io/crates/llmtxt-core/BAD_VERSION/settings` → "Yank version".
