#!/usr/bin/env bash
# [AgentSentry] Git Hygiene Check — PreToolUse hook for Write|Edit|Bash
# Ensures git is initialized, checks for uncommitted work, enforces
# checkpoint discipline, and tracks modified file counts for mid-session
# checkpoint logic.
# Exit 2 = BLOCK (missing git repo only). Exit 0 = ALLOW (all other cases).

set -euo pipefail

HOOK_NAME="git-hygiene"
DEBOUNCE_SECONDS=10
source "$(dirname "${BASH_SOURCE[0]}")/hook-guard.sh" || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../agent-sentry.config.json"
PREFIX="[AgentSentry]"

# State file for tracking files modified in this session
STATE_DIR="${TMPDIR:-/tmp}/agent-sentry"
mkdir -p "$STATE_DIR"
SESSION_STATE="$STATE_DIR/git-hygiene-session-$$"

# If no per-PID state exists yet, try to inherit from the most recent session
# state in the directory; otherwise start fresh.
if [[ ! -f "$SESSION_STATE" ]]; then
    LATEST_STATE=$(ls -t "$STATE_DIR"/git-hygiene-session-* 2>/dev/null | head -1 || true)
    if [[ -n "$LATEST_STATE" && -f "$LATEST_STATE" ]]; then
        cp "$LATEST_STATE" "$SESSION_STATE"
    else
        echo "0" > "$SESSION_STATE"
    fi
fi

# ---------------------------------------------------------------------------
# Parse config (with jq, falling back to defaults)
# ---------------------------------------------------------------------------
if command -v jq &>/dev/null && [[ -f "$CONFIG_FILE" ]]; then
    MAX_UNCOMMITTED=$(jq -r '.save_points.max_uncommitted_files_warning // 5' "$CONFIG_FILE" 2>/dev/null || echo 5)
    AUTO_COMMIT_MINUTES=$(jq -r '.save_points.auto_commit_after_minutes // 30' "$CONFIG_FILE" 2>/dev/null || echo 30)
else
    echo "$PREFIX WARNING — jq not found or config missing; using defaults." >&2
    MAX_UNCOMMITTED=5
    AUTO_COMMIT_MINUTES=30
fi

AUTO_COMMIT_ENABLED=$(jq -r '.save_points.auto_commit_enabled // true' "$CONFIG_FILE" 2>/dev/null || echo "true")

# Auto-checkpoint mode: auto | dry-run | confirm
CHECKPOINT_MODE="auto"
if [[ -f "$CONFIG_FILE" ]] && command -v jq &>/dev/null; then
    CHECKPOINT_MODE=$(jq -r '.auto_checkpoint_mode // "auto"' "$CONFIG_FILE" 2>/dev/null || echo "auto")
fi
# Validate the mode value
case "$CHECKPOINT_MODE" in
    auto|dry-run|confirm) ;;
    *) CHECKPOINT_MODE="auto" ;;
esac

# ---------------------------------------------------------------------------
# Read hook input from stdin (PreToolUse passes tool name + payload)
# ---------------------------------------------------------------------------
HOOK_INPUT=""
if [[ ! -t 0 ]]; then
    HOOK_INPUT=$(cat)
fi

# Extract the tool name from hook input (first line or JSON .tool_name)
TOOL_NAME=""
if [[ -n "$HOOK_INPUT" ]]; then
    if command -v jq &>/dev/null; then
        TOOL_NAME=$(echo "$HOOK_INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)
    fi
    if [[ -z "$TOOL_NAME" ]]; then
        TOOL_NAME=$(echo "$HOOK_INPUT" | head -1)
    fi
fi

# Only run for Write, Edit, or Bash tool invocations
case "$TOOL_NAME" in
    Write|Edit|Bash|write|edit|bash) ;;
    *)
        # If we can identify the tool and it is not one we care about, allow.
        if [[ -n "$TOOL_NAME" ]]; then
            exit 0
        fi
        # If tool name is empty (e.g. direct invocation), continue checks.
        ;;
esac

# =========================================================================
# Check 1: Git repository initialized
# =========================================================================
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    echo "$PREFIX BLOCKED — No git repository detected."
    echo ""
    echo "$PREFIX AgentSentry requires version control for safe operation."
    echo "$PREFIX Run:  git init && git add -A && git commit -m 'Initial commit'"
    exit 2
fi

REPO_ROOT=$(git rev-parse --show-toplevel)

# =========================================================================
# Check 2: Count uncommitted changes
# =========================================================================
UNCOMMITTED_COUNT=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

# =========================================================================
# Check 3: Minutes since last commit
# =========================================================================
LAST_COMMIT_EPOCH=$(git log -1 --format=%ct 2>/dev/null || echo 0)
NOW_EPOCH=$(date +%s)

if [[ "$LAST_COMMIT_EPOCH" -eq 0 ]]; then
    # No commits yet — treat as very stale
    MINUTES_SINCE_COMMIT=999
else
    MINUTES_SINCE_COMMIT=$(( (NOW_EPOCH - LAST_COMMIT_EPOCH) / 60 ))
fi

# =========================================================================
# Current branch detection
# =========================================================================
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")

# =========================================================================
# Session file-modification tracking
# =========================================================================
FILES_MODIFIED_COUNT=$(cat "$SESSION_STATE" 2>/dev/null || echo 0)
# Increment: every Write/Edit/Bash invocation counts as a potential modification
FILES_MODIFIED_COUNT=$((FILES_MODIFIED_COUNT + 1))
echo "$FILES_MODIFIED_COUNT" > "$SESSION_STATE"

# Mid-session checkpoint threshold
MID_SESSION_CHECKPOINT_THRESHOLD=8

# =========================================================================
# Evaluate and act
# =========================================================================
WARNINGS=()
ACTIONS_TAKEN=()

# --- Advisory warnings only (NO auto-commits — they cause feedback loops) ---

if [[ "$UNCOMMITTED_COUNT" -gt "$MAX_UNCOMMITTED" ]]; then
    WARNINGS+=("$UNCOMMITTED_COUNT uncommitted files detected (threshold: $MAX_UNCOMMITTED).")
fi

if [[ "$MINUTES_SINCE_COMMIT" -gt "$AUTO_COMMIT_MINUTES" ]] && [[ "$UNCOMMITTED_COUNT" -gt 0 ]]; then
    WARNINGS+=("Last commit was ${MINUTES_SINCE_COMMIT} minutes ago (threshold: ${AUTO_COMMIT_MINUTES}min).")
fi

# --- Main/master branch warning with > 3 uncommitted changes ---
if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]]; then
    if [[ "$UNCOMMITTED_COUNT" -gt 3 ]]; then
        WARNINGS+=("Working directly on '$CURRENT_BRANCH' with $UNCOMMITTED_COUNT uncommitted changes — consider creating a feature branch.")
    fi
fi

# =========================================================================
# Output (only when there is something to report)
# =========================================================================
if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    echo "$PREFIX Git Hygiene Check" >&2
    for w in "${WARNINGS[@]}"; do
        echo "$PREFIX   - $w" >&2
    done
    echo "$PREFIX Status: branch=$CURRENT_BRANCH | uncommitted=$UNCOMMITTED_COUNT | last_commit=${MINUTES_SINCE_COMMIT}min ago | session_modifications=$FILES_MODIFIED_COUNT" >&2
fi

# Always allow — this hook warns and takes preventive action but never blocks
# (the only blocking case is missing git repo above, exit 2)
exit 0
