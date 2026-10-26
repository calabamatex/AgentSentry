#!/usr/bin/env bash
# [AgentSentry] Context Usage Estimator — UserPromptSubmit hook
# Estimates context window usage and message count, warns when thresholds
# are approached or exceeded. See AgentSentry-Product-Spec.md §3.2.1.
# Exit 0 always (advisory only, never blocks prompt submission).

set -euo pipefail

# Consume stdin (hook input) so the pipe doesn't break
cat > /dev/null 2>&1 || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../agent-sentry.config.json"
PREFIX="[AgentSentry]"

# ── Config ────────────────────────────────────────────────────────────
# Read thresholds from agent-sentry.config.json with sane defaults
CTX_WARN=$(jq -r '.context_health.context_percent_warning // 60' "$CONFIG_FILE" 2>/dev/null || echo 60)
CTX_CRIT=$(jq -r '.context_health.context_percent_critical // 80' "$CONFIG_FILE" 2>/dev/null || echo 80)
MSG_WARN=$(jq -r '.context_health.message_count_warning // 20' "$CONFIG_FILE" 2>/dev/null || echo 20)
MSG_CRIT=$(jq -r '.context_health.message_count_critical // 30' "$CONFIG_FILE" 2>/dev/null || echo 30)

# Assumed context window size in tokens (Claude default)
MAX_TOKENS=${AGENT_SENTRY_MAX_TOKENS:-200000}

# ── Pre-guard severity check ─────────────────────────────────────────
# Read message count BEFORE sourcing hook-guard so we can bypass debounce
# at critical severity. The debounce should only suppress advisory
# notifications when context is healthy. At critical, the warning must
# always fire so the user sees it before the stop hook blocks.
_PRE_STATE_FILE="${TMPDIR:-/tmp}/agent-sentry/context-state"
_PRE_MSG_COUNT=0
if [[ -f "$_PRE_STATE_FILE" ]]; then
    _PRE_MSG_COUNT=$(grep -oP '(?<=message_count=)\d+' "$_PRE_STATE_FILE" 2>/dev/null || echo 0)
fi

_PRE_TOKENS_PER_MSG=4000
if [[ -f "$CONFIG_FILE" ]] && command -v jq &>/dev/null; then
    _cfg_val=$(jq -r '.context_health.tokens_per_message // 4000' "$CONFIG_FILE" 2>/dev/null)
    if [[ "$_cfg_val" =~ ^[0-9]+$ ]]; then
        _PRE_TOKENS_PER_MSG="$_cfg_val"
    fi
fi

_PRE_CTX_PERCENT=0
if [[ "$MAX_TOKENS" -gt 0 ]]; then
    _PRE_CTX_PERCENT=$(( _PRE_MSG_COUNT * _PRE_TOKENS_PER_MSG * 100 / MAX_TOKENS ))
fi

# Bypass debounce at critical severity — always emit the warning
if [[ "$_PRE_CTX_PERCENT" -ge "$CTX_CRIT" ]] || [[ "$_PRE_MSG_COUNT" -ge "$MSG_CRIT" ]]; then
    DEBOUNCE_SECONDS=0
else
    DEBOUNCE_SECONDS=30
fi

HOOK_NAME="context-estimator"
source "$(dirname "${BASH_SOURCE[0]}")/hook-guard.sh" || exit 0

# ── Session State (via shared state manager) ─────────────────────────
as_init_state
MSG_COUNT=$(as_increment_messages)

# ── Token Estimation (via shared estimation function) ────────────────
CTX_PERCENT=$(as_estimate_context_percent "$MAX_TOKENS")

# ── Notifications ─────────────────────────────────────────────────────

NOTIFICATIONS=()

# Context percentage checks
if [[ "$CTX_PERCENT" -ge "$CTX_CRIT" ]]; then
    NOTIFICATIONS+=("$PREFIX WARN: Context critically full (~${CTX_PERCENT}%). Early instructions are being lost.")
    NOTIFICATIONS+=("$PREFIX DIRECTIVE: Call agent_sentry_generate_handoff immediately with session_summary and remaining_work before the next user prompt blocks this session.")
elif [[ "$CTX_PERCENT" -ge "$CTX_WARN" ]]; then
    NOTIFICATIONS+=("$PREFIX NOTIFY: Context at ~${CTX_PERCENT}%. Consider wrapping up current task.")
    NOTIFICATIONS+=("$PREFIX DIRECTIVE: Call agent_sentry_generate_handoff now with your session summary and remaining work items. This creates a complete handoff prompt for the next session.")
fi

# Message count checks
if [[ "$MSG_COUNT" -ge "$MSG_CRIT" ]]; then
    NOTIFICATIONS+=("$PREFIX WARN: Message count ($MSG_COUNT) has reached critical threshold ($MSG_CRIT). Context degradation likely.")
elif [[ "$MSG_COUNT" -ge "$MSG_WARN" ]]; then
    NOTIFICATIONS+=("$PREFIX NOTIFY: Message count ($MSG_COUNT) approaching limit (warning: $MSG_WARN, critical: $MSG_CRIT).")
fi

# Only print if there are notifications (keep hook quiet when healthy)
if [[ ${#NOTIFICATIONS[@]} -gt 0 ]]; then
    for note in "${NOTIFICATIONS[@]}"; do
        echo "$note" >&2
    done
fi

# Hook must never block
exit 0
