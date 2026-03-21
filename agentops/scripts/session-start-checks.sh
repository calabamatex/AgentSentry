#!/usr/bin/env bash
# [AgentOps] Session Start Checks — SessionStart hook
# Validates rules files, scaffold docs, and git state at the beginning
# of every session. Exit 0 always (advisory only, never blocks session start).

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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../agentops.config.json"
PREFIX="[AgentOps]"

# Parse config
CLAUDE_MD_MAX_LINES=$(jq -r '.rules_file.claude_md_max_lines // .rules_file.max_lines // 300' "$CONFIG_FILE" 2>/dev/null || echo 300)
AGENTS_MD_MAX_LINES=$(jq -r '.rules_file.agents_md_max_lines // .rules_file.max_lines // 300' "$CONFIG_FILE" 2>/dev/null || echo 300)

# Find repo root
if git rev-parse --is-inside-work-tree &>/dev/null; then
    REPO_ROOT=$(git rev-parse --show-toplevel)
else
    REPO_ROOT="$(pwd)"
fi

CRITICALS=()
WARNINGS=()
ADVISORIES=()

# --- Check 1: Git state ---

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    CRITICALS+=("No git repository. Run 'git init' and commit before proceeding.")
else
    BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
    UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

    if [[ "$UNCOMMITTED" -gt 0 ]]; then
        ADVISORIES+=("$UNCOMMITTED uncommitted changes on branch '$BRANCH'.")
    fi
fi

# --- Check 2: CLAUDE.md ---

CLAUDE_MD="$REPO_ROOT/CLAUDE.md"
if [[ ! -f "$CLAUDE_MD" ]]; then
    WARNINGS+=("CLAUDE.md missing. Create one with project rules and agent configuration for best results.")
else
    CLAUDE_LINES=$(wc -l < "$CLAUDE_MD" | tr -d ' ')

    if [[ "$CLAUDE_LINES" -gt "$CLAUDE_MD_MAX_LINES" ]]; then
        WARNINGS+=("CLAUDE.md is $CLAUDE_LINES lines (recommended: <$CLAUDE_MD_MAX_LINES). Large rules files consume context.")
    fi

    # Check for AgentOps section
    if ! grep -qi "agentops" "$CLAUDE_MD" 2>/dev/null; then
        ADVISORIES+=("CLAUDE.md has no AgentOps rules. Run /agentops scaffold to add them.")
    fi

    # Check required sections
    REQUIRED_SECTIONS=("security" "error handling")
    for section in "${REQUIRED_SECTIONS[@]}"; do
        if ! grep -qi "$section" "$CLAUDE_MD" 2>/dev/null; then
            WARNINGS+=("CLAUDE.md missing '$section' section.")
        fi
    done
fi

# --- Check 3: AGENTS.md ---

AGENTS_MD="$REPO_ROOT/AGENTS.md"
if [[ ! -f "$AGENTS_MD" ]]; then
    WARNINGS+=("No AGENTS.md found. Cross-tool agent rules are not configured.")
else
    AGENTS_LINES=$(wc -l < "$AGENTS_MD" | tr -d ' ')

    if [[ "$AGENTS_LINES" -gt "$AGENTS_MD_MAX_LINES" ]]; then
        WARNINGS+=("AGENTS.md is $AGENTS_LINES lines (recommended: <$AGENTS_MD_MAX_LINES).")
    fi
fi

# --- Check 4: Scaffold documents ---

SCAFFOLD_DOCS=("PLANNING.md" "TASKS.md" "CONTEXT.md" "WORKFLOW.md")
MISSING_SCAFFOLDS=()

for doc in "${SCAFFOLD_DOCS[@]}"; do
    if [[ ! -f "$REPO_ROOT/$doc" ]]; then
        MISSING_SCAFFOLDS+=("$doc")
    fi
done

if [[ ${#MISSING_SCAFFOLDS[@]} -gt 0 ]]; then
    ADVISORIES+=("Missing scaffold docs: ${MISSING_SCAFFOLDS[*]}. Run /agentops scaffold to create them.")
fi

# Check CONTEXT.md freshness
CONTEXT_MD="$REPO_ROOT/CONTEXT.md"
if [[ -f "$CONTEXT_MD" ]]; then
    CONTEXT_MOD_EPOCH=$(stat -f %m "$CONTEXT_MD" 2>/dev/null || stat -c %Y "$CONTEXT_MD" 2>/dev/null || echo 0)
    NOW_EPOCH=$(date +%s)
    DAYS_STALE=$(( (NOW_EPOCH - CONTEXT_MOD_EPOCH) / 86400 ))

    if [[ "$DAYS_STALE" -gt 7 ]]; then
        ADVISORIES+=("CONTEXT.md last updated $DAYS_STALE days ago. Run /agentops scaffold to refresh.")
    fi
fi

# --- Output ---

TOTAL_ISSUES=$(( ${#CRITICALS[@]} + ${#WARNINGS[@]} + ${#ADVISORIES[@]} ))

echo "$PREFIX Session Start Health Check"
echo "───────────────────────────────────────────────"

if [[ ${#CRITICALS[@]} -gt 0 ]]; then
    for c in "${CRITICALS[@]}"; do
        echo "  ✗ CRITICAL: $c"
    done
fi

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    for w in "${WARNINGS[@]}"; do
        echo "  ▲ WARNING: $w"
    done
fi

if [[ ${#ADVISORIES[@]} -gt 0 ]]; then
    for a in "${ADVISORIES[@]}"; do
        echo "  ○ ADVISORY: $a"
    done
fi

if [[ "$TOTAL_ISSUES" -eq 0 ]]; then
    echo "  ✓ All checks passed."
fi

echo "───────────────────────────────────────────────"
echo "$PREFIX ${#CRITICALS[@]} critical, ${#WARNINGS[@]} warnings, ${#ADVISORIES[@]} advisories"

# Session start hooks should never block
exit 0
