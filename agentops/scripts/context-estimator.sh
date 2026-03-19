#!/usr/bin/env bash
# [AgentOps] Context Usage Estimator — UserPromptSubmit hook
# Estimates context window usage and message count, warns when thresholds
# are approached or exceeded. See AgentOps-Product-Spec.md §3.2.1.
# Exit 0 always (advisory only, never blocks prompt submission).

set -euo pipefail

# Consume stdin (hook input) so the pipe doesn't break
cat > /dev/null 2>&1 || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../agentops.config.json"
PREFIX="[AgentOps]"

# ── Config ────────────────────────────────────────────────────────────
# Read thresholds from agentops.config.json with sane defaults
CTX_WARN=$(jq -r '.context_health.context_percent_warning // 60' "$CONFIG_FILE" 2>/dev/null || echo 60)
CTX_CRIT=$(jq -r '.context_health.context_percent_critical // 80' "$CONFIG_FILE" 2>/dev/null || echo 80)
MSG_WARN=$(jq -r '.context_health.message_count_warning // 20' "$CONFIG_FILE" 2>/dev/null || echo 20)
MSG_CRIT=$(jq -r '.context_health.message_count_critical // 30' "$CONFIG_FILE" 2>/dev/null || echo 30)

# Assumed context window size in tokens (Claude default)
MAX_TOKENS=${AGENTOPS_MAX_TOKENS:-200000}

# ── Session State ─────────────────────────────────────────────────────
STATE_DIR="${TMPDIR:-/tmp}/agentops"
STATE_FILE="$STATE_DIR/context-state"

mkdir -p "$STATE_DIR"

# Initialise state file if missing
if [[ ! -f "$STATE_FILE" ]]; then
    echo "message_count=0" > "$STATE_FILE"
    echo "session_id=$(date +%s)" >> "$STATE_FILE"
fi

# Read current message count
MSG_COUNT=$(grep -oP '(?<=message_count=)\d+' "$STATE_FILE" 2>/dev/null || echo 0)

# Increment message count
MSG_COUNT=$((MSG_COUNT + 1))

# Write updated count back (portable sed in-place)
if grep -q "message_count=" "$STATE_FILE" 2>/dev/null; then
    # macOS and GNU sed compatible in-place edit
    if sed --version 2>/dev/null | grep -q GNU; then
        sed -i "s/message_count=.*/message_count=$MSG_COUNT/" "$STATE_FILE"
    else
        sed -i '' "s/message_count=.*/message_count=$MSG_COUNT/" "$STATE_FILE"
    fi
else
    echo "message_count=$MSG_COUNT" >> "$STATE_FILE"
fi

# ── Token Estimation ──────────────────────────────────────────────────
# Estimate tokens consumed by counting characters in recently-read
# git-tracked files, then dividing by 4 (rough char-to-token ratio).

TOTAL_CHARS=0

if git rev-parse --is-inside-work-tree &>/dev/null; then
    # Recently modified tracked files (last 50 by mtime) as a proxy for
    # files likely read into context during this session.
    while IFS= read -r file; do
        if [[ -f "$file" ]]; then
            CHARS=$(wc -c < "$file" 2>/dev/null | tr -d ' ')
            TOTAL_CHARS=$((TOTAL_CHARS + CHARS))
        fi
    done < <(git ls-files -z 2>/dev/null \
        | xargs -0 ls -1t 2>/dev/null \
        | head -50)
fi

# Add an estimate for conversation overhead: ~500 tokens per message
CONVERSATION_TOKENS=$((MSG_COUNT * 500))

# File-based token estimate (chars / 4)
FILE_TOKENS=$((TOTAL_CHARS / 4))

ESTIMATED_TOKENS=$((FILE_TOKENS + CONVERSATION_TOKENS))
if [[ "$MAX_TOKENS" -gt 0 ]]; then
    CTX_PERCENT=$((ESTIMATED_TOKENS * 100 / MAX_TOKENS))
else
    CTX_PERCENT=0
fi

# Cap at 100 for display
if [[ "$CTX_PERCENT" -gt 100 ]]; then
    CTX_PERCENT=100
fi

# ── Notifications ─────────────────────────────────────────────────────

NOTIFICATIONS=()

# Context percentage checks
if [[ "$CTX_PERCENT" -ge "$CTX_CRIT" ]]; then
    NOTIFICATIONS+=("$PREFIX WARN: Context critically full (~${CTX_PERCENT}%). Early instructions being lost.")
    NOTIFICATIONS+=("$PREFIX RECOMMEND: Start fresh session using handoff message.")
elif [[ "$CTX_PERCENT" -ge "$CTX_WARN" ]]; then
    NOTIFICATIONS+=("$PREFIX NOTIFY: Context at ~${CTX_PERCENT}%. Consider wrapping up current task.")
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
        echo "$note"
    done
fi

# Hook must never block
exit 0
