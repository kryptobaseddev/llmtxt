#!/usr/bin/env bash
# Run llmtxt test suite
set -euo pipefail
npx llmtxt test "$@"
