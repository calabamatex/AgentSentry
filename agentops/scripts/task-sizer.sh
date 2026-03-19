#!/usr/bin/env bash
# [AgentOps] Task Sizer — UserPromptSubmit hook
# Implements §5.2 Risk Scoring Model and §5.3.1 Task Sizing Gate.
# Scans user prompt text for risk keywords, computes a risk score,
# and emits notifications / auto-commits based on thresholds.
# Exit 0 always (advisory only, never blocks).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../agentops.config.json"
PREFIX="[AgentOps]"

# ---------------------------------------------------------------------------
# Read thresholds from config
# ---------------------------------------------------------------------------
MEDIUM_THRESHOLD=$(jq -r '.task_sizing.medium_risk_threshold // 4' "$CONFIG_FILE" 2>/dev/null || echo 4)
HIGH_THRESHOLD=$(jq -r '.task_sizing.high_risk_threshold // 8' "$CONFIG_FILE" 2>/dev/null || echo 8)
CRITICAL_THRESHOLD=$(jq -r '.task_sizing.critical_risk_threshold // 13' "$CONFIG_FILE" 2>/dev/null || echo 13)

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

# Helper: auto-commit if there are uncommitted changes
auto_commit() {
    if git rev-parse --is-inside-work-tree &>/dev/null; then
        local uncommitted
        uncommitted=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
        if [[ "$uncommitted" -gt 0 ]]; then
            git add -A &>/dev/null || true
            git commit -m "[AgentOps] Auto-checkpoint before risk-score $risk_score task" --no-verify &>/dev/null || true
            echo "$PREFIX Auto-committed $uncommitted file(s) as safety checkpoint."
        fi
    fi
}

if [[ "$risk_score" -ge "$CRITICAL_THRESHOLD" ]]; then
    # CRITICAL (13+)
    echo "$PREFIX WARN: Critical-risk task (score: $risk_score)."
    echo "$PREFIX Recommendation: Create a dedicated branch and decompose into smaller tasks."
    auto_commit
    if git rev-parse --is-inside-work-tree &>/dev/null; then
        BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
        echo "$PREFIX Current branch: $BRANCH. Consider: git checkout -b task/<name>"
    fi

elif [[ "$risk_score" -ge "$HIGH_THRESHOLD" ]]; then
    # HIGH (8-12)
    echo "$PREFIX WARN: High-risk task (score: $risk_score). Decompose before starting."
    auto_commit

elif [[ "$risk_score" -ge "$MEDIUM_THRESHOLD" ]]; then
    # MEDIUM (4-7)
    echo "$PREFIX NOTIFY: Medium-risk task. Committing checkpoint first."
    auto_commit

# else: LOW (0-3) — silent, no output
fi

exit 0
