#!/usr/bin/env bash
# Run llmtxt build pipeline
set -euo pipefail
npx llmtxt build "$@"
