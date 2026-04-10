#!/usr/bin/env bash
# [AgentSentry] Task Sizer — UserPromptSubmit hook
# Implements §5.2 Risk Scoring Model and §5.3.1 Task Sizing Gate.
# Scans user prompt text for risk keywords, computes a risk score,
# and emits notifications / auto-commits based on thresholds.
# Exit 0 always (advisory only, never blocks).

set -euo pipefail

HOOK_NAME="task-sizer"
DEBOUNCE_SECONDS=30
source "$(dirname "${BASH_SOURCE[0]}")/hook-guard.sh" || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../agent-sentry.config.json"
PREFIX="[AgentSentry]"

# ---------------------------------------------------------------------------
# Read thresholds from config
# ---------------------------------------------------------------------------
MEDIUM_THRESHOLD=$(jq -r '.task_sizing.medium_risk_threshold // 4' "$CONFIG_FILE" 2>/dev/null || echo 4)
HIGH_THRESHOLD=$(jq -r '.task_sizing.high_risk_threshold // 8' "$CONFIG_FILE" 2>/dev/null || echo 8)
CRITICAL_THRESHOLD=$(jq -r '.task_sizing.critical_risk_threshold // 13' "$CONFIG_FILE" 2>/dev/null || echo 13)
AUTO_COMMIT_ENABLED=$(jq -r '.save_points.auto_commit_enabled // true' "$CONFIG_FILE" 2>/dev/null || echo "true")

# ---------------------------------------------------------------------------
# Read the user prompt from stdin (JSON or plain text)
# ---------------------------------------------------------------------------
INPUT=$(cat)

# Try to extract .user_prompt from JSON; fall back to first line of raw text
PROMPT=$(echo "$INPUT" | jq -r '.user_prompt // empty' 2>/dev/null || true)
if [[ -z "$PROMPT" ]]; then
    PROMPT=$(echo "$INPUT" | head -n1)
fi

# Nothing to score
if [[ -z "$PROMPT" ]]; then
    exit 0
fi

# Normalise to lowercase for keyword matching
PROMPT_LC=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]')

# ---------------------------------------------------------------------------
# Risk scoring
# ---------------------------------------------------------------------------
risk_score=0

# --- File count signals ---
if echo "$PROMPT_LC" | grep -qE '(few files|scope\s*(<=?\s*3|[123]\b))'; then
    risk_score=$((risk_score + 1))
elif echo "$PROMPT_LC" | grep -qE '(many files|scope\s*(>=?\s*9|[0-9]{2,}))'; then
    risk_score=$((risk_score + 5))
elif echo "$PROMPT_LC" | grep -qE '(several files|scope\s*[4-8])'; then
    risk_score=$((risk_score + 3))
fi

# --- Database signals ---
if echo "$PROMPT_LC" | grep -qE '(database|table|schema|migration)'; then
    if echo "$PROMPT_LC" | grep -qE '(delete|drop|remove|destroy)'; then
        risk_score=$((risk_score + 5))
    elif echo "$PROMPT_LC" | grep -qE '(modify|alter|update|change|edit)'; then
        risk_score=$((risk_score + 4))
    elif echo "$PROMPT_LC" | grep -qE '(new|create|add|insert)'; then
        risk_score=$((risk_score + 2))
    fi
fi

# --- Security signals ---
if echo "$PROMPT_LC" | grep -qE '(auth|security|encryption|validation)'; then
    risk_score=$((risk_score + 4))
fi

# --- Refactoring signals ---
if echo "$PROMPT_LC" | grep -qE '(refactor|redesign|rewrite|migrate)'; then
    risk_score=$((risk_score + 4))
fi

# --- Broad scope signals ---
if echo "$PROMPT_LC" | grep -qE '\b(all|every|entire|whole)\b'; then
    risk_score=$((risk_score + 3))
fi

# ---------------------------------------------------------------------------
# Determine risk level and respond
# ---------------------------------------------------------------------------

# Advisory output only — NO auto-commits (they cause feedback loops)

if [[ "$risk_score" -ge "$CRITICAL_THRESHOLD" ]]; then
    echo "$PREFIX WARN: Critical-risk task (score: $risk_score)." >&2
    echo "$PREFIX Recommendation: Create a dedicated branch and decompose into smaller tasks." >&2
elif [[ "$risk_score" -ge "$HIGH_THRESHOLD" ]]; then
    echo "$PREFIX WARN: High-risk task (score: $risk_score). Decompose before starting." >&2
elif [[ "$risk_score" -ge "$MEDIUM_THRESHOLD" ]]; then
    echo "$PREFIX NOTIFY: Medium-risk task (score: $risk_score)." >&2
# else: LOW (0-3) — silent, no output
fi

exit 0
