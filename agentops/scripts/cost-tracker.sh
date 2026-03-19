#!/usr/bin/env bash
# [AgentOps] Cost Tracker — PostToolUse hook (§15 Cost Management & Token Budgeting)
# Runs after every tool use: estimates cost, tracks cumulative session spend,
# warns at budget thresholds, and logs cost events as NDJSON.
# Exit 0 always (advisory only, never blocks).

set -euo pipefail

PREFIX="[AgentOps]"
TMPBASE="${TMPDIR:-/tmp}/agentops"
COST_STATE="$TMPBASE/cost-state"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../agentops.config.json"
DASHBOARD_DATA="$SCRIPT_DIR/../dashboard/data"
COST_LOG="$DASHBOARD_DATA/cost-log.json"

# Ensure directories exist
mkdir -p "$TMPBASE" "$DASHBOARD_DATA"

# --- Read hook input from stdin (non-blocking) ---
hook_input=""
if ! [ -t 0 ]; then
    hook_input="$(cat)" || true
fi

# --- Helper: extract JSON value (simple jq-free fallback) ---
json_val() {
    local json="$1" key="$2"
    # Try jq first, fall back to grep/sed
    if command -v jq &>/dev/null; then
        echo "$json" | jq -r ".$key // empty" 2>/dev/null || echo ""
    else
        echo "$json" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*[^,}]*" \
            | head -1 | sed 's/.*:[[:space:]]*//' | tr -d '"' || echo ""
    fi
}

# --- Load budget config ---
SESSION_BUDGET="10"
MONTHLY_BUDGET="500"
WARN_THRESHOLD="0.80"

if [[ -f "$CONFIG_FILE" ]]; then
    cfg_session="$(json_val "$(cat "$CONFIG_FILE")" "session_budget" 2>/dev/null)" || true
    cfg_monthly="$(json_val "$(cat "$CONFIG_FILE")" "monthly_budget" 2>/dev/null)" || true
    cfg_warn="$(json_val "$(cat "$CONFIG_FILE")" "warn_threshold" 2>/dev/null)" || true

    # Try nested budget object
    if [[ -z "$cfg_session" ]] && command -v jq &>/dev/null; then
        cfg_session="$(jq -r '.budget.session_budget // empty' "$CONFIG_FILE" 2>/dev/null)" || true
        cfg_monthly="$(jq -r '.budget.monthly_budget // empty' "$CONFIG_FILE" 2>/dev/null)" || true
        cfg_warn="$(jq -r '.budget.warn_threshold // empty' "$CONFIG_FILE" 2>/dev/null)" || true
    fi

    [[ -n "$cfg_session" ]] && SESSION_BUDGET="$cfg_session"
    [[ -n "$cfg_monthly" ]] && MONTHLY_BUDGET="$cfg_monthly"
    [[ -n "$cfg_warn" ]] && WARN_THRESHOLD="$cfg_warn"
fi

# --- Detect model tier and estimate cost per call ---
# Cost estimates (input+output per typical tool call):
#   haiku  ~$0.0002
#   sonnet ~$0.003
#   opus   ~$0.015
detect_model_tier() {
    local model_hint=""

    # Try to extract model from hook input
    if [[ -n "$hook_input" ]]; then
        model_hint="$(json_val "$hook_input" "model" 2>/dev/null)" || true
    fi

    # Check environment variables for model info
    if [[ -z "$model_hint" ]]; then
        model_hint="${CLAUDE_MODEL:-${ANTHROPIC_MODEL:-}}"
    fi

    model_hint="$(echo "$model_hint" | tr '[:upper:]' '[:lower:]')"

    case "$model_hint" in
        *haiku*)  echo "haiku"  ;;
        *sonnet*) echo "sonnet" ;;
        *opus*)   echo "opus"   ;;
        *)        echo "sonnet" ;;  # default to sonnet as middle ground
    esac
}

cost_for_tier() {
    case "$1" in
        haiku)  echo "0.0002" ;;
        sonnet) echo "0.003"  ;;
        opus)   echo "0.015"  ;;
        *)      echo "0.003"  ;;
    esac
}

# --- Extract token counts from hook input if available ---
input_tokens="0"
output_tokens="0"
if [[ -n "$hook_input" ]]; then
    it="$(json_val "$hook_input" "input_tokens" 2>/dev/null)" || true
    ot="$(json_val "$hook_input" "output_tokens" 2>/dev/null)" || true
    [[ -n "$it" && "$it" != "null" ]] && input_tokens="$it"
    [[ -n "$ot" && "$ot" != "null" ]] && output_tokens="$ot"
fi

# --- Determine cost for this call ---
MODEL_TIER="$(detect_model_tier)"
CALL_COST="$(cost_for_tier "$MODEL_TIER")"

# If we have actual token counts, compute a more precise cost
# Pricing per 1K tokens (approximate): haiku=$0.00025/$0.00125, sonnet=$0.003/$0.015, opus=$0.015/$0.075
if [[ "$input_tokens" != "0" || "$output_tokens" != "0" ]]; then
    case "$MODEL_TIER" in
        haiku)
            in_rate="0.00000025"
            out_rate="0.00000125"
            ;;
        sonnet)
            in_rate="0.000003"
            out_rate="0.000015"
            ;;
        opus)
            in_rate="0.000015"
            out_rate="0.000075"
            ;;
        *)
            in_rate="0.000003"
            out_rate="0.000015"
            ;;
    esac
    CALL_COST="$(awk "BEGIN { printf \"%.6f\", ($input_tokens * $in_rate) + ($output_tokens * $out_rate) }")"
fi

# --- Load or initialize cumulative session state ---
session_total="0"
session_calls="0"
session_start=""

if [[ -f "$COST_STATE" ]]; then
    session_total="$(json_val "$(cat "$COST_STATE")" "session_total" 2>/dev/null)" || true
    session_calls="$(json_val "$(cat "$COST_STATE")" "session_calls" 2>/dev/null)" || true
    session_start="$(json_val "$(cat "$COST_STATE")" "session_start" 2>/dev/null)" || true
fi

[[ -z "$session_total" || "$session_total" == "null" ]] && session_total="0"
[[ -z "$session_calls" || "$session_calls" == "null" ]] && session_calls="0"
[[ -z "$session_start" || "$session_start" == "null" ]] && session_start="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# --- Update cumulative totals ---
new_total="$(awk "BEGIN { printf \"%.6f\", $session_total + $CALL_COST }")"
new_calls="$((session_calls + 1))"
timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# Write updated state
cat > "$COST_STATE" <<STATEEOF
{"session_total":"$new_total","session_calls":"$new_calls","session_start":"$session_start","last_model":"$MODEL_TIER","last_update":"$timestamp"}
STATEEOF

# --- Budget threshold checks ---
budget_status="ok"
budget_pct="$(awk "BEGIN { printf \"%.1f\", ($new_total / $SESSION_BUDGET) * 100 }")"

at_warn="$(awk "BEGIN { print ($new_total >= $SESSION_BUDGET * $WARN_THRESHOLD) ? 1 : 0 }")"
at_limit="$(awk "BEGIN { print ($new_total >= $SESSION_BUDGET) ? 1 : 0 }")"

if [[ "$at_limit" == "1" ]]; then
    budget_status="exceeded"
    echo "$PREFIX WARN: Session budget EXCEEDED (\$$new_total / \$$SESSION_BUDGET). Budget exceeded. Only critical operations allowed."
elif [[ "$at_warn" == "1" ]]; then
    budget_status="warning"
    echo "$PREFIX WARN: Approaching session budget — \$$new_total / \$$SESSION_BUDGET (${budget_pct}% used)."
fi

# --- Monthly budget tracking (lightweight — file-based) ---
month_key="$(date +"%Y-%m")"
monthly_file="$TMPBASE/cost-monthly-$month_key"
monthly_total="0"

if [[ -f "$monthly_file" ]]; then
    monthly_total="$(cat "$monthly_file" 2>/dev/null)" || true
    [[ -z "$monthly_total" ]] && monthly_total="0"
fi

new_monthly="$(awk "BEGIN { printf \"%.6f\", $monthly_total + $CALL_COST }")"
echo "$new_monthly" > "$monthly_file"

monthly_pct="$(awk "BEGIN { printf \"%.1f\", ($new_monthly / $MONTHLY_BUDGET) * 100 }")"
monthly_at_warn="$(awk "BEGIN { print ($new_monthly >= $MONTHLY_BUDGET * $WARN_THRESHOLD) ? 1 : 0 }")"
monthly_at_limit="$(awk "BEGIN { print ($new_monthly >= $MONTHLY_BUDGET) ? 1 : 0 }")"

if [[ "$monthly_at_limit" == "1" ]]; then
    echo "$PREFIX WARN: Monthly budget EXCEEDED (\$$new_monthly / \$$MONTHLY_BUDGET). Only critical operations allowed."
elif [[ "$monthly_at_warn" == "1" ]]; then
    echo "$PREFIX WARN: Approaching monthly budget — \$$new_monthly / \$$MONTHLY_BUDGET (${monthly_pct}% used)."
fi

# --- Append cost event as NDJSON ---
printf '{"timestamp":"%s","type":"cost","model_tier":"%s","call_cost":"%s","session_total":"%s","session_calls":%d,"budget_status":"%s","budget_pct":"%s","input_tokens":%s,"output_tokens":%s,"monthly_total":"%s"}\n' \
    "$timestamp" \
    "$MODEL_TIER" \
    "$CALL_COST" \
    "$new_total" \
    "$new_calls" \
    "$budget_status" \
    "$budget_pct" \
    "$input_tokens" \
    "$output_tokens" \
    "$new_monthly" \
    >> "$COST_LOG"

# Never block
exit 0
