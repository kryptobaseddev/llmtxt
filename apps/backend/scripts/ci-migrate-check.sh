#!/bin/sh
# ci-migrate-check.sh — CI integration test: run all migrations against a fresh SQLite DB
# and verify idempotency (second run must also succeed without errors).
#
# Usage (from apps/backend/):
#   ./scripts/ci-migrate-check.sh
#
# Requirements:
#   - pnpm and Node 24 must be in PATH
#   - Run from the apps/backend/ directory (or any directory; the script resolves its own root)
#
# Exit codes:
#   0 — both fresh run and idempotency run passed with no errors
#   1 — migration failure, non-zero exit code, or error string found in output

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Error strings to detect even when drizzle-kit exits 0
ERROR_PATTERNS="already exists|SQLITE_ERROR|error:"

# Create a temporary SQLite DB that is always cleaned up on exit
DB_FILE=$(mktemp /tmp/ci-migrate-XXXX.db)
trap 'rm -f "$DB_FILE"' EXIT

echo "--- Migration check: fresh DB run ---"
echo "DB: $DB_FILE"

# Run migrations (first pass — fresh DB)
MIGRATE_OUT_1=$(mktemp /tmp/ci-migrate-out1-XXXX.txt)
trap 'rm -f "$DB_FILE" "$MIGRATE_OUT_1"' EXIT

cd "$BACKEND_DIR"

set +e
DATABASE_URL="$DB_FILE" pnpm db:migrate 2>&1 | tee "$MIGRATE_OUT_1"
MIGRATE_EXIT_1=$?
set -e

echo ""

if [ "$MIGRATE_EXIT_1" -ne 0 ]; then
  echo "FAIL: drizzle-kit migrate exited with code $MIGRATE_EXIT_1 on fresh run." >&2
  exit 1
fi

# Check output for error strings even when exit code was 0
if grep -Eiq "$ERROR_PATTERNS" "$MIGRATE_OUT_1"; then
  echo "FAIL: Migration output contains error markers on fresh run:" >&2
  grep -Ei "$ERROR_PATTERNS" "$MIGRATE_OUT_1" >&2
  exit 1
fi

echo "PASS: Fresh DB run succeeded."
echo ""
echo "--- Migration check: idempotency run (second pass on same DB) ---"

# Run migrations again — drizzle should skip already-applied migrations silently
MIGRATE_OUT_2=$(mktemp /tmp/ci-migrate-out2-XXXX.txt)
trap 'rm -f "$DB_FILE" "$MIGRATE_OUT_1" "$MIGRATE_OUT_2"' EXIT

set +e
DATABASE_URL="$DB_FILE" pnpm db:migrate 2>&1 | tee "$MIGRATE_OUT_2"
MIGRATE_EXIT_2=$?
set -e

echo ""

if [ "$MIGRATE_EXIT_2" -ne 0 ]; then
  echo "FAIL: drizzle-kit migrate exited with code $MIGRATE_EXIT_2 on idempotency run." >&2
  exit 1
fi

if grep -Eiq "$ERROR_PATTERNS" "$MIGRATE_OUT_2"; then
  echo "FAIL: Migration output contains error markers on idempotency run:" >&2
  grep -Ei "$ERROR_PATTERNS" "$MIGRATE_OUT_2" >&2
  exit 1
fi

echo "PASS: Idempotency run succeeded."
echo ""
echo "OK: All migration checks passed (fresh run + idempotency run)."
exit 0
