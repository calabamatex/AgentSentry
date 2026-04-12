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

# Source shared hook guard for state management and estimation.
# DEBOUNCE_SECONDS=0 disables per-hook debounce for the stop hook;
# depth guard and reentrance protection in hook-guard still apply.
HOOK_NAME="context-critical-stop"
DEBOUNCE_SECONDS=0
source "$(dirname "${BASH_SOURCE[0]}")/hook-guard.sh" || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../agent-sentry.config.json"
PREFIX="[AgentSentry]"

# ── Config ────────────────────────────────────────────────────────────
CTX_CRIT=$(jq -r '.context_health.context_percent_critical // 80' "$CONFIG_FILE" 2>/dev/null || echo 80)
MSG_CRIT=$(jq -r '.context_health.message_count_critical // 30' "$CONFIG_FILE" 2>/dev/null || echo 30)
MAX_TOKENS=${AGENT_SENTRY_MAX_TOKENS:-200000}

# ── Session State (via shared state manager) ─────────────────────────
MSG_COUNT=$(as_state_get "message_count" "0")

# ── Token Estimation (via shared estimation function) ────────────────
CTX_PERCENT=$(as_estimate_context_percent "$MAX_TOKENS")

# ── Auto-generated git-state handoff ─────────────────────────────────
# Fallback handoff when Claude didn't call generate_handoff proactively.
# Collects git state and formats a paste-ready prompt for the next session.
generate_shell_handoff() {
    local branch last_commit uncommitted recent_commits

    branch=$(git branch --show-current 2>/dev/null || echo "unknown")
    last_commit=$(git log -1 --oneline 2>/dev/null || echo "no commits")
    uncommitted=$(git status --short 2>/dev/null || echo "")
    recent_commits=$(git log --oneline -5 2>/dev/null || echo "")

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$PREFIX AUTO-GENERATED HANDOFF PROMPT"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Copy the block below into a fresh session to continue:"
    echo ""
    echo "---"
    echo "Continue work on this project. Previous session handoff:"
    echo ""
    echo "Branch: $branch"
    echo "Last commit: $last_commit"
    if [[ -n "$uncommitted" ]]; then
        echo ""
        echo "Uncommitted changes:"
        echo "$uncommitted"
    fi
    if [[ -n "$recent_commits" ]]; then
        echo ""
        echo "Recent commits:"
        echo "$recent_commits"
    fi
    echo ""
    echo "Note: Session summary and remaining work not available (context"
    echo "was exhausted before handoff was generated). Review git log and"
    echo "uncommitted changes to determine next steps."
    echo "---"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# ── Decision ──────────────────────────────────────────────────────────
# Block if context is critically full OR message count exceeds critical threshold
if [[ "$CTX_PERCENT" -ge "$CTX_CRIT" ]] || [[ "$MSG_COUNT" -ge "$MSG_CRIT" ]]; then
    generate_shell_handoff
    echo "$PREFIX BLOCKED: Context critically full (~${CTX_PERCENT}%, ${MSG_COUNT} messages)."
    echo "$PREFIX Start a fresh session and paste the handoff prompt above to continue."
    echo "$PREFIX To override and continue in this session anyway: set context_percent_critical"
    echo "$PREFIX to a higher value in agent-sentry.config.json, or run with AGENT_SENTRY_MAX_TOKENS set higher."
    exit 2
fi

# Context is healthy — allow
exit 0
