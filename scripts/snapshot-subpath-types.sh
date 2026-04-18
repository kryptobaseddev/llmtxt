#!/usr/bin/env bash
# scripts/snapshot-subpath-types.sh
#
# Generate per-subpath .d.ts snapshots for all stable llmtxt subpaths.
# Snapshots are stored in packages/llmtxt/.dts-snapshots/<subpath>.d.ts
# (slashes in subpath names are replaced with double-underscores).
#
# Usage:
#   ./scripts/snapshot-subpath-types.sh             # regenerate all snapshots
#   ./scripts/snapshot-subpath-types.sh --check     # compare current vs snapshot (CI mode)
#
# CI mode exits 1 if any stable subpath type has changed incompatibly.
# Run this from the repo root.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$REPO_ROOT/packages/llmtxt"
DIST_DIR="$PACKAGE_DIR/dist"
SNAPSHOT_DIR="$PACKAGE_DIR/.dts-snapshots"
CHECK_MODE=0

if [[ "${1:-}" == "--check" ]]; then
  CHECK_MODE=1
fi

# ---------------------------------------------------------------------------
# Stable subpaths — these are the ones the CI guard enforces.
# Keys are the export map path suffixes (without leading "./").
# Values are the dist-relative .d.ts entry for that subpath.
# ---------------------------------------------------------------------------
declare -A STABLE_SUBPATHS=(
  ["root"]="index.d.ts"
  ["sdk"]="sdk/index.d.ts"
  ["crdt"]="crdt.d.ts"
  ["crdt-primitives"]="crdt-primitives.d.ts"
  ["similarity"]="similarity.d.ts"
  ["blob"]="blob/index.d.ts"
  ["events"]="events/index.d.ts"
  ["identity"]="identity/index.d.ts"
  ["transport"]="transport/index.d.ts"
  ["local"]="local/index.d.ts"
  ["remote"]="remote/index.d.ts"
  ["pg"]="pg/index.d.ts"
  ["disclosure"]="disclosure.d.ts"
)

# ---------------------------------------------------------------------------
# Verify the build output is present.
# ---------------------------------------------------------------------------
if [[ ! -d "$DIST_DIR" ]]; then
  echo "ERROR: $DIST_DIR does not exist." >&2
  echo "       Run 'pnpm --filter llmtxt run build' first." >&2
  exit 1
fi

mkdir -p "$SNAPSHOT_DIR"

FAILURES=0

for SUBPATH_KEY in "${!STABLE_SUBPATHS[@]}"; do
  DTS_REL="${STABLE_SUBPATHS[$SUBPATH_KEY]}"
  DTS_FILE="$DIST_DIR/$DTS_REL"
  # Replace "/" with "__" for filesystem-safe snapshot name.
  SNAP_FILE="$SNAPSHOT_DIR/${SUBPATH_KEY/\//__}.d.ts"

  if [[ ! -f "$DTS_FILE" ]]; then
    echo "WARNING: $DTS_FILE not found — skipping $SUBPATH_KEY" >&2
    continue
  fi

  if [[ "$CHECK_MODE" -eq 1 ]]; then
    # ── Check mode: compare current vs snapshot ──────────────────────────
    if [[ ! -f "$SNAP_FILE" ]]; then
      echo "ERROR: No snapshot found for '$SUBPATH_KEY' at $SNAP_FILE" >&2
      echo "       Run './scripts/snapshot-subpath-types.sh' on main to generate it." >&2
      FAILURES=$((FAILURES + 1))
      continue
    fi

    if ! diff --unified=3 "$SNAP_FILE" "$DTS_FILE" > /tmp/subpath-diff-"$SUBPATH_KEY".txt 2>&1; then
      echo "" >&2
      echo "BREAKING CHANGE DETECTED: stable subpath '$SUBPATH_KEY'" >&2
      echo "  Snapshot: $SNAP_FILE" >&2
      echo "  Current:  $DTS_FILE" >&2
      echo "  Diff:" >&2
      cat /tmp/subpath-diff-"$SUBPATH_KEY".txt >&2
      echo "" >&2
      FAILURES=$((FAILURES + 1))
    else
      echo "OK: $SUBPATH_KEY"
    fi
  else
    # ── Snapshot mode: copy current .d.ts to snapshot ────────────────────
    cp "$DTS_FILE" "$SNAP_FILE"
    echo "Snapshotted: $SUBPATH_KEY -> $SNAP_FILE"
  fi
done

if [[ "$CHECK_MODE" -eq 1 ]]; then
  if [[ "$FAILURES" -gt 0 ]]; then
    echo "" >&2
    echo "FAILED: $FAILURES stable subpath(s) have breaking type changes." >&2
    echo "" >&2
    echo "If this change is intentional (requires a CalVer month bump):" >&2
    echo "  1. Update STABILITY.md with the new export list." >&2
    echo "  2. Document the breaking change in CHANGELOG.md." >&2
    echo "  3. Run './scripts/snapshot-subpath-types.sh' and commit the new snapshots." >&2
    echo "  4. Verify you are targeting a new CalVer month (not a PATCH-only bump)." >&2
    exit 1
  else
    echo ""
    echo "All stable subpath types match their snapshots."
  fi
else
  echo ""
  echo "Snapshots regenerated in $SNAPSHOT_DIR"
  echo "Commit the updated snapshot files together with your source changes."
fi
