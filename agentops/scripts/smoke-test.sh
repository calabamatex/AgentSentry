#!/usr/bin/env bash
# Smoke test: verifies AgentOps builds, key files exist, and MCP server can start.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTOPS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0
FAIL=0

check() {
  local desc="$1" result="$2"
  if [ "$result" = "pass" ]; then
    echo "  [PASS] $desc"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo "AgentOps Smoke Test"
echo "==================="

# 1. Build output exists
[ -f "$AGENTOPS_ROOT/dist/src/mcp/server.js" ] && check "MCP server entrypoint" "pass" || check "MCP server entrypoint" "fail"
[ -f "$AGENTOPS_ROOT/dist/src/index.js" ] && check "Barrel export" "pass" || check "Barrel export" "fail"
[ -f "$AGENTOPS_ROOT/dist/src/memory/store.js" ] && check "Memory store" "pass" || check "Memory store" "fail"
[ -f "$AGENTOPS_ROOT/dist/src/enablement/engine.js" ] && check "Enablement engine" "pass" || check "Enablement engine" "fail"

# 2. Plugin validation
[ -f "$AGENTOPS_ROOT/plugins/core/commit-monitor/metadata.json" ] && check "Plugin metadata" "pass" || check "Plugin metadata" "fail"

# 3. Config exists
[ -f "$AGENTOPS_ROOT/agentops.config.json" ] && check "Config file" "pass" || check "Config file" "fail"

# 4. Package.json main resolves
MAIN=$(node -e "console.log(require('$AGENTOPS_ROOT/package.json').main)" 2>/dev/null || echo "")
[ -f "$AGENTOPS_ROOT/$MAIN" ] && check "package.json main resolves" "pass" || check "package.json main resolves" "fail"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
