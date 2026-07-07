#!/usr/bin/env bash
set -euo pipefail
# [AgentSentry] PostToolUse hook — thin wrapper around TypeScript implementation.
# Pipes stdin to the compiled TS hook and passes through exit code.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Global kill switch
_AS_CFG="$SCRIPT_DIR/../agent-sentry.config.json"
if [[ -f "$_AS_CFG" ]] && command -v jq &>/dev/null && [[ "$(jq -r '.enabled // true' "$_AS_CFG" 2>/dev/null)" == "false" ]]; then
    exit 0
fi

HOOK_JS="$SCRIPT_DIR/../dist/src/cli/hooks/post-write.js"

if [[ -f "$HOOK_JS" ]]; then
    node "$HOOK_JS"
else
    echo "[AgentSentry] WARN: Compiled hook not found at $HOOK_JS — run 'npm run build' first." >&2
fi

exit 0
