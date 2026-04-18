#!/bin/sh
# validate-changelog.sh — Assert CHANGELOG-of-record has an entry for this release.
#
# Usage:
#   bash scripts/validate-changelog.sh <VERSION>
#
# Example:
#   bash scripts/validate-changelog.sh 2026.4.9
#
# The CHANGELOG-of-record is: packages/llmtxt/CHANGELOG.md
# An entry is valid if the file contains a heading that matches either:
#   ## [<VERSION>]    (Keep-a-Changelog bracket format)
#   ## <VERSION>      (plain heading without brackets)
#
# Exit codes:
#   0 — CHANGELOG exists and has a matching entry for VERSION
#   1 — CHANGELOG missing or no matching entry found (blocks publish)
#
# Why this exists:
#   On 2026-04-15, 38 commits piled up before a push-to-tags publish.
#   The CHANGELOG at the time was at the repo root (not packages/llmtxt/).
#   This script enforces the canonical location and blocks publish when the
#   release engineer forgot to add the CHANGELOG entry before tagging.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "ERROR: Missing VERSION argument." >&2
  echo "Usage: bash scripts/validate-changelog.sh <VERSION>" >&2
  exit 1
fi

VERSION="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANGELOG="${REPO_ROOT}/packages/llmtxt/CHANGELOG.md"

# ── Gate 1: file must exist ────────────────────────────────────────────────
if [ ! -f "$CHANGELOG" ]; then
  echo "ERROR: CHANGELOG-of-record not found at:" >&2
  echo "  ${CHANGELOG}" >&2
  echo "" >&2
  echo "Create packages/llmtxt/CHANGELOG.md and add a '## [${VERSION}]' entry" >&2
  echo "before tagging and pushing." >&2
  exit 1
fi

# ── Gate 2: file must contain an entry for this version ───────────────────
# Accept either: ## [2026.4.9] or ## 2026.4.9  (with optional trailing date)
if grep -Eq "^## \[?${VERSION}\]?" "$CHANGELOG"; then
  echo "OK: CHANGELOG entry found for version ${VERSION} in ${CHANGELOG}"
  exit 0
fi

# Entry not found — show context to help the engineer fix it quickly
echo "ERROR: No CHANGELOG entry found for version ${VERSION}." >&2
echo "" >&2
echo "Expected one of these heading formats in ${CHANGELOG}:" >&2
echo "  ## [${VERSION}] — YYYY-MM-DD" >&2
echo "  ## [${VERSION}]" >&2
echo "  ## ${VERSION} — YYYY-MM-DD" >&2
echo "" >&2
echo "Last 5 headings found in that file:" >&2
grep "^## " "$CHANGELOG" | head -5 | sed 's/^/  /' >&2
echo "" >&2
echo "Add the entry to packages/llmtxt/CHANGELOG.md, commit, then re-tag." >&2
exit 1
