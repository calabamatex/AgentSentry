#!/usr/bin/env bash
set -euo pipefail
# [AgentOps] Session End Checkpoint — thin wrapper around TypeScript implementation.
# Pipes stdin to the compiled TS hook and passes through exit code.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_JS="$SCRIPT_DIR/../dist/src/cli/hooks/session-checkpoint.js"

if [[ -f "$HOOK_JS" ]]; then
    node "$HOOK_JS"
else
    echo "[AgentOps] WARN: Compiled hook not found at $HOOK_JS — run 'npm run build' first." >&2
fi

exit 0
