#!/usr/bin/env bash
# [AgentSentry] Context-Critical Stop Hook — blocks agent when context is critically full.
#
# This runs as a Stop hook. When context usage exceeds the critical threshold,
# the script exits non-zero (exit 2) which blocks the agent from continuing
# until the user runs /agent-sentry:handoff to generate a handoff prompt.
#
# Claude Code Stop hooks:
#   exit 0 → allow (agent continues)
#   exit 2 → block with message (agent cannot continue until resolved)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../agent-sentry.config.json"
PREFIX="[AgentSentry]"

# ── Global kill switch ───────────────────────────────────────────────
ENABLED=$(jq -r '.enabled // true' "$CONFIG_FILE" 2>/dev/null || echo "true")
if [[ "$ENABLED" == "false" ]]; then
    exit 0
fi

# ── Config ────────────────────────────────────────────────────────────
CTX_CRIT=$(jq -r '.context_health.context_percent_critical // 80' "$CONFIG_FILE" 2>/dev/null || echo 80)
MSG_CRIT=$(jq -r '.context_health.message_count_critical // 30' "$CONFIG_FILE" 2>/dev/null || echo 30)
MAX_TOKENS=${AGENT_SENTRY_MAX_TOKENS:-200000}

# ── Session State ─────────────────────────────────────────────────────
STATE_DIR="${TMPDIR:-/tmp}/agent-sentry"
STATE_FILE="$STATE_DIR/context-state"

# If no state file yet, context is fresh — allow
if [[ ! -f "$STATE_FILE" ]]; then
    exit 0
fi

MSG_COUNT=$(grep -oP '(?<=message_count=)\d+' "$STATE_FILE" 2>/dev/null || echo 0)

# ── Token Estimation ─────────────────────────────────────────────────
ESTIMATED_TOKENS=$((MSG_COUNT * 500))

if [[ "$MAX_TOKENS" -gt 0 ]]; then
    CTX_PERCENT=$((ESTIMATED_TOKENS * 100 / MAX_TOKENS))
else
    CTX_PERCENT=0
fi

if [[ "$CTX_PERCENT" -gt 100 ]]; then
    CTX_PERCENT=100
fi

# ── Decision ──────────────────────────────────────────────────────────
# Block if context is critically full OR message count exceeds critical threshold
if [[ "$CTX_PERCENT" -ge "$CTX_CRIT" ]] || [[ "$MSG_COUNT" -ge "$MSG_CRIT" ]]; then
    echo "$PREFIX BLOCKED: Context critically full (~${CTX_PERCENT}%, ${MSG_COUNT} messages)."
    echo "$PREFIX ACTION REQUIRED: Run \`/agent-sentry:handoff\` to generate a handoff prompt before continuing."
    echo "$PREFIX This is a blocking directive — the session cannot proceed until a handoff is created."
    exit 2
fi

# Context is healthy — allow
exit 0
