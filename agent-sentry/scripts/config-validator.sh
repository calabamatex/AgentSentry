#!/usr/bin/env bash
# =============================================================================
# [AgentSentry] Config Validator — Schema Validation for agent-sentry.config.json
# =============================================================================
# Validates the AgentSentry configuration file against the expected schema.
# Checks for:
#   1. Valid JSON
#   2. Required top-level keys
#   3. Type validation on critical fields
#   4. Value range validation on numeric thresholds
#
# Usage: bash agent-sentry/scripts/config-validator.sh [path-to-config]
# Exit 0: Valid. Exit 1: Validation errors found.
# =============================================================================

set -euo pipefail

PREFIX="[AgentSentry]"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${1:-$SCRIPT_DIR/../agent-sentry.config.json}"

ERRORS=()
WARNINGS=()

# ---------------------------------------------------------------------------
# 1. File existence and JSON validity
# ---------------------------------------------------------------------------
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "$PREFIX FAIL: Config file not found: $CONFIG_FILE"
    exit 1
fi

if ! command -v jq &>/dev/null; then
    echo "$PREFIX FAIL: jq is required for config validation but not installed."
    exit 1
fi

if ! jq empty "$CONFIG_FILE" 2>/dev/null; then
    echo "$PREFIX FAIL: $CONFIG_FILE is not valid JSON."
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Required top-level sections
# ---------------------------------------------------------------------------
REQUIRED_SECTIONS=("save_points" "context_health" "rules_file" "task_sizing" "security" "budget" "notifications")

# ---------------------------------------------------------------------------
# 2a. Top-level "enabled" field (optional but must be boolean if present)
# ---------------------------------------------------------------------------
if jq -e 'has("enabled")' "$CONFIG_FILE" &>/dev/null; then
    ENABLED_TYPE=$(jq -r '.enabled | type' "$CONFIG_FILE" 2>/dev/null || echo "null")
    if [[ "$ENABLED_TYPE" != "boolean" ]]; then
        ERRORS+=("Top-level 'enabled' must be a boolean (true/false), got $ENABLED_TYPE")
    fi
fi

for section in "${REQUIRED_SECTIONS[@]}"; do
    if ! jq -e ".$section" "$CONFIG_FILE" &>/dev/null; then
        ERRORS+=("Missing required section: $section")
    fi
done

# ---------------------------------------------------------------------------
# 3. Type and presence checks for critical keys
# ---------------------------------------------------------------------------

# save_points
check_type() {
    local path="$1"
    local expected_type="$2"
    local label="$3"

    local actual
    actual=$(jq -r "$path | type" "$CONFIG_FILE" 2>/dev/null || echo "null")

    if [[ "$actual" == "null" ]]; then
        WARNINGS+=("Missing key: $label")
    elif [[ "$actual" != "$expected_type" ]]; then
        ERRORS+=("Type mismatch: $label expected $expected_type, got $actual")
    fi
}

check_type '.save_points.auto_commit_enabled' 'boolean' 'save_points.auto_commit_enabled'
check_type '.save_points.auto_commit_after_minutes' 'number' 'save_points.auto_commit_after_minutes'
check_type '.save_points.auto_branch_on_risk_score' 'number' 'save_points.auto_branch_on_risk_score'
check_type '.save_points.max_uncommitted_files_warning' 'number' 'save_points.max_uncommitted_files_warning'

check_type '.context_health.message_count_warning' 'number' 'context_health.message_count_warning'
check_type '.context_health.message_count_critical' 'number' 'context_health.message_count_critical'
check_type '.context_health.context_percent_warning' 'number' 'context_health.context_percent_warning'
check_type '.context_health.context_percent_critical' 'number' 'context_health.context_percent_critical'

check_type '.rules_file.max_lines' 'number' 'rules_file.max_lines'
check_type '.rules_file.required_sections' 'array' 'rules_file.required_sections'

check_type '.task_sizing.medium_risk_threshold' 'number' 'task_sizing.medium_risk_threshold'
check_type '.task_sizing.high_risk_threshold' 'number' 'task_sizing.high_risk_threshold'
check_type '.task_sizing.critical_risk_threshold' 'number' 'task_sizing.critical_risk_threshold'

check_type '.security.block_on_secret_detection' 'boolean' 'security.block_on_secret_detection'
check_type '.security.permission_fail_mode' 'string' 'security.permission_fail_mode'

check_type '.budget.session_budget' 'number' 'budget.session_budget'
check_type '.budget.monthly_budget' 'number' 'budget.monthly_budget'

check_type '.auto_checkpoint_mode' 'string' 'auto_checkpoint_mode'

# ---------------------------------------------------------------------------
# 4. Value range validation
# ---------------------------------------------------------------------------
check_range() {
    local path="$1"
    local min="$2"
    local max="$3"
    local label="$4"

    local val
    val=$(jq -r "$path // empty" "$CONFIG_FILE" 2>/dev/null || true)
    if [[ -n "$val" ]]; then
        if (( $(echo "$val < $min" | bc -l 2>/dev/null || echo 0) )); then
            WARNINGS+=("$label = $val is below recommended minimum ($min)")
        fi
        if (( $(echo "$val > $max" | bc -l 2>/dev/null || echo 0) )); then
            WARNINGS+=("$label = $val is above recommended maximum ($max)")
        fi
    fi
}

check_range '.context_health.context_percent_warning' 30 90 'context_percent_warning'
check_range '.context_health.context_percent_critical' 50 95 'context_percent_critical'
check_range '.task_sizing.medium_risk_threshold' 2 8 'medium_risk_threshold'
check_range '.task_sizing.high_risk_threshold' 4 15 'high_risk_threshold'
check_range '.task_sizing.critical_risk_threshold' 8 25 'critical_risk_threshold'
check_range '.budget.warn_threshold' 0.5 0.95 'budget.warn_threshold'

# Threshold ordering
MEDIUM=$(jq -r '.task_sizing.medium_risk_threshold // 0' "$CONFIG_FILE")
HIGH=$(jq -r '.task_sizing.high_risk_threshold // 0' "$CONFIG_FILE")
CRITICAL=$(jq -r '.task_sizing.critical_risk_threshold // 0' "$CONFIG_FILE")

if [[ "$MEDIUM" -ge "$HIGH" ]] 2>/dev/null; then
    ERRORS+=("medium_risk_threshold ($MEDIUM) must be less than high_risk_threshold ($HIGH)")
fi
if [[ "$HIGH" -ge "$CRITICAL" ]] 2>/dev/null; then
    ERRORS+=("high_risk_threshold ($HIGH) must be less than critical_risk_threshold ($CRITICAL)")
fi

# permission_fail_mode must be "block" or "warn"
FAIL_MODE=$(jq -r '.security.permission_fail_mode // "block"' "$CONFIG_FILE" 2>/dev/null || echo "block")
if [[ "$FAIL_MODE" != "block" && "$FAIL_MODE" != "warn" ]]; then
    ERRORS+=("security.permission_fail_mode must be 'block' or 'warn', got '$FAIL_MODE'")
fi

# auto_checkpoint_mode must be "auto", "dry-run", or "confirm"
CHECKPOINT_MODE=$(jq -r '.auto_checkpoint_mode // "auto"' "$CONFIG_FILE" 2>/dev/null || echo "auto")
if [[ "$CHECKPOINT_MODE" != "auto" && "$CHECKPOINT_MODE" != "dry-run" && "$CHECKPOINT_MODE" != "confirm" ]]; then
    ERRORS+=("auto_checkpoint_mode must be 'auto', 'dry-run', or 'confirm', got '$CHECKPOINT_MODE'")
fi

# ---------------------------------------------------------------------------
# 5. Report
# ---------------------------------------------------------------------------
echo "$PREFIX Config Validation Report"
echo "───────────────────────────────────────────────"
echo "  File: $CONFIG_FILE"
echo ""

if [[ ${#ERRORS[@]} -gt 0 ]]; then
    echo "  Errors:"
    for e in "${ERRORS[@]}"; do
        echo "    ✗ $e"
    done
    echo ""
fi

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    echo "  Warnings:"
    for w in "${WARNINGS[@]}"; do
        echo "    ▲ $w"
    done
    echo ""
fi

TOTAL=$(( ${#ERRORS[@]} + ${#WARNINGS[@]} ))

if [[ "$TOTAL" -eq 0 ]]; then
    echo "  ✓ All checks passed."
fi

echo "───────────────────────────────────────────────"
echo "$PREFIX ${#ERRORS[@]} errors, ${#WARNINGS[@]} warnings"

if [[ ${#ERRORS[@]} -gt 0 ]]; then
    exit 1
fi

exit 0
