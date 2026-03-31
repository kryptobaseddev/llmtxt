#!/bin/bash
# Combine forge-ts generated docs into public/llms.txt and public/llms-full.txt
# Run before `next build` so they're served as static files.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCS_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(cd "$DOCS_DIR/../.." && pwd)"

SDK_LLMS="$ROOT_DIR/packages/llmtxt/docs/generated/llms.txt"
SDK_FULL="$ROOT_DIR/packages/llmtxt/docs/generated/llms-full.txt"
API_LLMS="$ROOT_DIR/apps/backend/docs/generated/llms.txt"
API_FULL="$ROOT_DIR/apps/backend/docs/generated/llms-full.txt"
API_SPEC="$ROOT_DIR/apps/backend/public/llms.txt"

mkdir -p "$DOCS_DIR/public"

# Generate llms.txt (combined index)
{
  echo "# LLMtxt Documentation"
  echo "> SDK and API reference for llmtxt — context sharing for AI agents"
  echo ""
  echo "## Links"
  echo "- Web App: https://www.llmtxt.my"
  echo "- API: https://api.llmtxt.my"
  echo "- Docs: https://docs.llmtxt.my"
  echo "- Full context: https://docs.llmtxt.my/llms-full.txt"
  echo "- GitHub: https://github.com/kryptobaseddev/llmtxt"
  echo ""
  echo "---"
  echo ""
  echo "# API Specification (api.llmtxt.my)"
  echo ""
  [ -f "$API_SPEC" ] && cat "$API_SPEC"
  echo ""
  echo "---"
  echo ""
  echo "# SDK Reference (npm: llmtxt)"
  echo ""
  [ -f "$SDK_LLMS" ] && cat "$SDK_LLMS"
  echo ""
  echo "---"
  echo ""
  echo "# Backend Internals (@llmtxt/backend)"
  echo ""
  [ -f "$API_LLMS" ] && cat "$API_LLMS"
} > "$DOCS_DIR/public/llms.txt"

# Generate llms-full.txt (complete context)
{
  echo "# LLMtxt — Full Context"
  echo "> Complete SDK and API documentation for deep LLM consumption"
  echo ""
  echo "---"
  echo ""
  [ -f "$SDK_FULL" ] && cat "$SDK_FULL"
  echo ""
  echo "---"
  echo ""
  [ -f "$API_FULL" ] && cat "$API_FULL"
} > "$DOCS_DIR/public/llms-full.txt"

echo "Generated public/llms.txt and public/llms-full.txt"
