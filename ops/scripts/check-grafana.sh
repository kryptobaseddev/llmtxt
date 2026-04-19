#!/bin/bash
# ops/scripts/check-grafana.sh
# Probe Grafana and Prometheus to verify SLO alert rules are loaded and active.
# Used by T744 (SLO alerts wired to live Grafana verification).
#
# Usage:
#   ./ops/scripts/check-grafana.sh [--prometheus-url URL] [--grafana-url URL]
#
# Environment:
#   PROMETHEUS_URL     — Prometheus endpoint (default: http://localhost:9090)
#   GRAFANA_URL        — Grafana endpoint (default: https://grafana.llmtxt.my)
#
# Outputs:
#   - Console: human-readable probe results
#   - Exit code 0: all checks passed
#   - Exit code 1: at least one check failed

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
GRAFANA_URL="${GRAFANA_URL:-https://grafana.llmtxt.my}"
TIMEOUT=5

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --prometheus-url)
      PROMETHEUS_URL="$2"
      shift 2
      ;;
    --grafana-url)
      GRAFANA_URL="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# State
CHECKS_PASSED=0
CHECKS_FAILED=0

# Helper function to run a check
check() {
  local name="$1"
  local cmd="$2"

  if eval "$cmd" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} $name"
    ((CHECKS_PASSED++))
  else
    echo -e "${RED}✗${NC} $name"
    ((CHECKS_FAILED++))
  fi
}

echo "=== SLO Alert Rules Verification ==="
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Prometheus: $PROMETHEUS_URL"
echo "Grafana: $GRAFANA_URL"
echo ""

# Test 1: Prometheus connectivity
echo "Prometheus Connectivity:"
check "Prometheus responds to /api/v1/query" \
  "curl -s -f -m $TIMEOUT '$PROMETHEUS_URL/api/v1/query?query=up' > /dev/null"

# Test 2: Prometheus rules loaded
echo ""
echo "Prometheus Rules:"

check "Recording rules loaded (sli.yml)" \
  "curl -s -f -m $TIMEOUT '$PROMETHEUS_URL/api/v1/rules' | grep -q 'job:llmtxt.*p95'"

check "Alert rules loaded (slo.yml)" \
  "curl -s -f -m $TIMEOUT '$PROMETHEUS_URL/api/v1/rules' | grep -q 'SLOBurnRate'"

check "Latency alert rules present" \
  "curl -s -f -m $TIMEOUT '$PROMETHEUS_URL/api/v1/rules' | grep -q 'P95LatencyHigh'"

check "Error rate alert rules present" \
  "curl -s -f -m $TIMEOUT '$PROMETHEUS_URL/api/v1/rules' | grep -q 'AuthenticatedErrorRateHigh'"

# Test 3: Grafana connectivity
echo ""
echo "Grafana Connectivity:"
check "Grafana health endpoint responds" \
  "curl -s -f -m $TIMEOUT '$GRAFANA_URL/api/health' > /dev/null"

# Test 4: Metrics are being scraped
echo ""
echo "Metrics Collection:"
check "Prometheus has http_requests_total metric" \
  "curl -s -f -m $TIMEOUT '$PROMETHEUS_URL/api/v1/query?query=http_requests_total' | grep -q 'http_requests_total'"

check "Prometheus has http_request_duration_seconds metric" \
  "curl -s -f -m $TIMEOUT '$PROMETHEUS_URL/api/v1/query?query=http_request_duration_seconds' | grep -q 'http_request_duration_seconds'"

# Summary
echo ""
echo "=== Summary ==="
echo -e "Passed: ${GREEN}$CHECKS_PASSED${NC}"
echo -e "Failed: ${RED}$CHECKS_FAILED${NC}"

if [ $CHECKS_FAILED -eq 0 ]; then
  echo ""
  echo -e "${GREEN}All checks passed!${NC}"
  echo "SLO alert rules are wired and Prometheus is scraping metrics."
  exit 0
else
  echo ""
  echo -e "${RED}Some checks failed.${NC}"
  echo "Troubleshooting steps:"
  echo "1. Verify Prometheus is running and reachable"
  echo "2. Visit Prometheus UI at $PROMETHEUS_URL/alerts to confirm rules are loaded"
  echo "3. Check Prometheus logs for rule load errors"
  echo "4. Verify OTel Collector is exporting metrics to Prometheus"
  exit 1
fi
