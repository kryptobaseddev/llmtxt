#!/bin/sh
# check-migrations.sh — Static lint: detect duplicate CREATE TABLE / CREATE INDEX names
# across all migration.sql files.
#
# Usage:
#   ./scripts/check-migrations.sh
#
# Exits 0 if no duplicates are found.
# Exits 1 if any table or index name appears in two or more separate migration files.
# No Node.js, no database connection, no network access required.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/../src/db/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: Migrations directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

# Collect all migration.sql files
MIGRATION_FILES=$(find "$MIGRATIONS_DIR" -name "migration.sql" | sort)

if [ -z "$MIGRATION_FILES" ]; then
  echo "INFO: No migration.sql files found under $MIGRATIONS_DIR — nothing to check."
  exit 0
fi

FAIL=0

# --- Duplicate CREATE TABLE detection ---
# Build a temp file mapping: "table_name<TAB>filepath"
TABLES_TMP=$(mktemp /tmp/check-migrations-tables-XXXX.txt)
# shellcheck disable=SC2064
trap "rm -f '$TABLES_TMP'" EXIT

for f in $MIGRATION_FILES; do
  # Match: CREATE TABLE `name` or CREATE TABLE name or CREATE TABLE IF NOT EXISTS `name`
  grep -oi 'CREATE TABLE[[:space:]]\+\(`[^`]*`\|"[^"]*"\|[A-Za-z_][A-Za-z0-9_]*\)' "$f" 2>/dev/null \
    | sed 's/CREATE TABLE[[:space:]]*//' \
    | tr -d '`"' \
    | tr '[:upper:]' '[:lower:]' \
    | while IFS= read -r tname; do
        printf '%s\t%s\n' "$tname" "$f"
      done >> "$TABLES_TMP"
done

# Find any table name that appears in more than one distinct file
sort "$TABLES_TMP" | awk -F'\t' '
{
  name = $1
  file = $2
  if (seen_name_file[name][file] == "") {
    seen_name_file[name][file] = 1
    file_list[name] = (file_list[name] == "") ? file : (file_list[name] "\n    " file)
    count[name]++
  }
}
END {
  for (name in count) {
    if (count[name] > 1) {
      print "DUPLICATE CREATE TABLE: " name
      print "  Found in:"
      print "    " file_list[name]
    }
  }
}
' | while IFS= read -r line; do
  echo "$line" >&2
  FAIL=1
done

# Re-check FAIL outside the subshell (pipelines run in subshell, so re-count)
DUPE_TABLES=$(sort "$TABLES_TMP" | awk -F'\t' '
{
  name = $1; file = $2
  if (!seen[name,file]++) files[name][file] = 1
}
END {
  for (name in files) {
    n = 0; for (f in files[name]) n++
    if (n > 1) print name
  }
}
')

if [ -n "$DUPE_TABLES" ]; then
  for tname in $DUPE_TABLES; do
    echo "ERROR: Duplicate CREATE TABLE '$tname' found in multiple migration files:" >&2
    grep -l "CREATE TABLE" $MIGRATION_FILES 2>/dev/null \
      | while read -r f; do
          if grep -qi "CREATE TABLE[[:space:]]*['\`\"]\?${tname}['\`\"]\?" "$f" 2>/dev/null; then
            echo "  $f" >&2
          fi
        done
  done
  FAIL=1
fi

# --- Duplicate CREATE INDEX / CREATE UNIQUE INDEX detection ---
INDEXES_TMP=$(mktemp /tmp/check-migrations-indexes-XXXX.txt)
# shellcheck disable=SC2064
trap "rm -f '$TABLES_TMP' '$INDEXES_TMP'" EXIT

for f in $MIGRATION_FILES; do
  # Match: CREATE [UNIQUE] INDEX `name` or "name" or bare name ON ...
  grep -oi 'CREATE[[:space:]]\+\(UNIQUE[[:space:]]\+\)\?INDEX[[:space:]]\+\(`[^`]*`\|"[^"]*"\|[A-Za-z_][A-Za-z0-9_]*\)' "$f" 2>/dev/null \
    | sed 's/CREATE[[:space:]]*UNIQUE[[:space:]]*INDEX[[:space:]]*//' \
    | sed 's/CREATE[[:space:]]*INDEX[[:space:]]*//' \
    | tr -d '`"' \
    | tr '[:upper:]' '[:lower:]' \
    | while IFS= read -r iname; do
        printf '%s\t%s\n' "$iname" "$f"
      done >> "$INDEXES_TMP"
done

DUPE_INDEXES=$(sort "$INDEXES_TMP" | awk -F'\t' '
{
  name = $1; file = $2
  if (!seen[name,file]++) files[name][file] = 1
}
END {
  for (name in files) {
    n = 0; for (f in files[name]) n++
    if (n > 1) print name
  }
}
')

if [ -n "$DUPE_INDEXES" ]; then
  for iname in $DUPE_INDEXES; do
    echo "ERROR: Duplicate CREATE INDEX '$iname' found in multiple migration files:" >&2
    for f in $MIGRATION_FILES; do
      if grep -qi "CREATE[[:space:]]*\(UNIQUE[[:space:]]*\)\?INDEX[[:space:]]*['\`\"]\?${iname}['\`\"]\?" "$f" 2>/dev/null; then
        echo "  $f" >&2
      fi
    done
  done
  FAIL=1
fi

if [ "$FAIL" -eq 1 ]; then
  echo "FAIL: Migration lint failed. Fix duplicate DDL before merging." >&2
  exit 1
fi

echo "OK: No duplicate CREATE TABLE or CREATE INDEX names found across $(echo "$MIGRATION_FILES" | wc -l | tr -d ' ') migration files."
exit 0
