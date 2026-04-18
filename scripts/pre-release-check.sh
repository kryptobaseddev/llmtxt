#!/bin/sh
# pre-release-check.sh — Local pre-release gate runner.
#
# Usage (from repo root):
#   bash scripts/pre-release-check.sh <VERSION>
#
# Example:
#   bash scripts/pre-release-check.sh 2026.4.9
#
# Runs the same gates the CI release workflow enforces, so engineers can
# catch failures locally before pushing a tag.
#
# Gates (in order):
#   1. CHANGELOG validation  — packages/llmtxt/CHANGELOG.md must have entry
#   2. Migration lint        — apps/backend/scripts/check-migrations.sh
#   3. Migration idempotency — apps/backend/scripts/ci-migrate-check.sh
#
# Exit codes:
#   0 — all gates passed
#   1 — one or more gates failed (first failure halts execution)

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "ERROR: Missing VERSION argument." >&2
  echo "Usage: bash scripts/pre-release-check.sh <VERSION>" >&2
  exit 1
fi

VERSION="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "======================================================"
echo " Pre-release gate check for version: ${VERSION}"
echo "======================================================"
echo ""

# ── Gate 1: CHANGELOG ─────────────────────────────────────────────────────
echo "[1/3] Validating CHANGELOG entry..."
bash "${REPO_ROOT}/scripts/validate-changelog.sh" "$VERSION"
echo ""

# ── Gate 2: Migration lint ────────────────────────────────────────────────
echo "[2/3] Running static migration lint..."
( cd "${REPO_ROOT}/apps/backend" && bash scripts/check-migrations.sh )
echo ""

# ── Gate 3: Migration idempotency ────────────────────────────────────────
echo "[3/3] Running migration idempotency check..."
( cd "${REPO_ROOT}/apps/backend" && bash scripts/ci-migrate-check.sh )
echo ""

echo "======================================================"
echo " All pre-release gates PASSED for v${VERSION}."
echo " Safe to tag and push:"
echo "   git tag core-v${VERSION}"
echo "   git tag llmtxt-core-v${VERSION}"
echo "   git push origin core-v${VERSION} llmtxt-core-v${VERSION}"
echo "======================================================"
