#!/usr/bin/env bash
# [AgentOps] Session End Checkpoint — Stop hook (§2.2.4)
# Runs when a session ends: auto-commits uncommitted changes,
# resets tracking state files, and logs a session-end event.
# Exit 0 always (advisory only, never blocks).

set -euo pipefail

# ---------------------------------------------------------------------------
# Dependency checks — fail loudly, not silently
# ---------------------------------------------------------------------------
if ! command -v jq &>/dev/null; then
    echo "[AgentOps] CRITICAL: 'jq' is required but not found. Install with: brew install jq (macOS) or apt install jq (Linux)" >&2
    exit 0
fi
if ! command -v git &>/dev/null; then
    echo "[AgentOps] CRITICAL: 'git' is required but not found." >&2
    exit 0
fi

PREFIX="[AgentOps]"
TMPBASE="${TMPDIR:-/tmp}/agentops"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DATA="$SCRIPT_DIR/../dashboard/data"
SESSION_LOG="$DASHBOARD_DATA/session-log.json"
CONFIG_FILE="$SCRIPT_DIR/../agentops.config.json"
AUTO_COMMIT_ENABLED=$(jq -r '.save_points.auto_commit_enabled // true' "$CONFIG_FILE" 2>/dev/null || echo "true")

# Ensure dashboard data directory exists
mkdir -p "$DASHBOARD_DATA"

# --- Helper: log NDJSON event ---
log_event() {
    local msg="$1"
    local severity="${2:-info}"
    local timestamp
    timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    printf '{"timestamp":"%s","type":"session-end","message":"%s","severity":"%s"}\n' \
        "$timestamp" "$msg" "$severity" >> "$SESSION_LOG"
}

# --- Step 1: Auto-commit uncommitted changes ---
commit_msg=""
if git rev-parse --is-inside-work-tree &>/dev/null; then
    changed_files=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

    if [[ "$changed_files" -gt 0 ]]; then
        summary="${changed_files} file(s) changed"
        commit_msg="[agentops] session-end checkpoint — ${summary}"

        if [[ "$AUTO_COMMIT_ENABLED" != "true" ]]; then
            echo "$PREFIX Uncommitted changes detected (${summary}). Auto-commit disabled — skipping."
        else
            echo "$PREFIX Uncommitted changes detected (${summary}). Auto-committing..."
            git add -A &>/dev/null || true
            git commit -m "$commit_msg" --no-verify &>/dev/null || true
            echo "$PREFIX Committed: $commit_msg"
        fi
    else
        echo "$PREFIX No uncommitted changes."
    fi
else
    echo "$PREFIX Not inside a git repository — skipping auto-commit."
fi

# --- Step 2: Reset tracking state files ---
echo "$PREFIX Resetting session state files..."

# Blast radius tracking
if [[ -f "$TMPBASE/blast-radius-files" ]]; then
    rm -f "$TMPBASE/blast-radius-files"
    echo "$PREFIX  Cleared blast-radius-files"
fi

# Context state
if [[ -f "$TMPBASE/context-state" ]]; then
    rm -f "$TMPBASE/context-state"
    echo "$PREFIX  Cleared context-state"
fi

# Git hygiene session state (glob pattern)
cleared_hygiene=0
for f in "$TMPBASE"/git-hygiene-session-*; do
    [[ -e "$f" ]] || break
    rm -f "$f"
    cleared_hygiene=$((cleared_hygiene + 1))
done
if [[ "$cleared_hygiene" -gt 0 ]]; then
    echo "$PREFIX  Cleared $cleared_hygiene git-hygiene-session file(s)"
fi

# --- Step 3: Log session-end event ---
if [[ -n "$commit_msg" ]]; then
    log_event "Session ended with auto-commit: ${commit_msg}" "info"
else
    log_event "Session ended cleanly — no uncommitted changes" "info"
fi

echo "$PREFIX Session end checkpoint complete."

# Never block
exit 0
