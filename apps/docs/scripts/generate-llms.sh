#!/bin/bash
# Copy forge-ts generated docs into public/ for static serving.
# Run before `next build`. Skips if source files aren't available
# (RAILPACK isolated build) — uses committed files instead.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCS_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(cd "$DOCS_DIR/../.." && pwd)"

SDK_LLMS="$ROOT_DIR/packages/llmtxt/docs/generated/llms.txt"
SDK_FULL="$ROOT_DIR/packages/llmtxt/docs/generated/llms-full.txt"
API_LLMS="$ROOT_DIR/apps/backend/docs/generated/llms.txt"
API_FULL="$ROOT_DIR/apps/backend/docs/generated/llms-full.txt"
API_SPEC="$ROOT_DIR/apps/backend/public/llms.txt"

# Skip if source files aren't available (isolated build context)
if [ ! -f "$SDK_LLMS" ] && [ ! -f "$API_SPEC" ]; then
  echo "Source files not found (isolated build context). Using committed public/ files."
  exit 0
fi

mkdir -p "$DOCS_DIR/public/api" "$DOCS_DIR/public/sdk"

# API docs (hand-written spec + forge-ts internals)
[ -f "$API_SPEC" ] && cp "$API_SPEC" "$DOCS_DIR/public/api/llms.txt"
[ -f "$API_FULL" ] && cp "$API_FULL" "$DOCS_DIR/public/api/llms-full.txt"

# SDK docs (forge-ts generated from actual code)
[ -f "$SDK_LLMS" ] && cp "$SDK_LLMS" "$DOCS_DIR/public/sdk/llms.txt"
[ -f "$SDK_FULL" ] && cp "$SDK_FULL" "$DOCS_DIR/public/sdk/llms-full.txt"

echo "Generated public/api/ and public/sdk/ llms files"
