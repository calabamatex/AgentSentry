#!/usr/bin/env bash
# [AgentOps] Multi-Provider Health Monitor (§17 Multi-Provider Orchestration Awareness)
# Tracks per-provider metrics, logs failover events, and aggregates stats.
# Standalone script invoked by hooks or commands.
# Exit 0 always (advisory only, never blocks).

set -euo pipefail

PREFIX="[AgentOps]"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DATA="$SCRIPT_DIR/../dashboard/data"
COST_LOG="$DASHBOARD_DATA/cost-log.json"
HEALTH_LOG="$DASHBOARD_DATA/provider-health.json"
TMPBASE="${TMPDIR:-/tmp}/agentops"
PROVIDER_STATE="$TMPBASE/provider-state"

mkdir -p "$TMPBASE" "$DASHBOARD_DATA" "$PROVIDER_STATE"

# --- Helper: extract JSON value (jq with grep/sed fallback) ---
json_val() {
    local json="$1" key="$2"
    if command -v jq &>/dev/null; then
        echo "$json" | jq -r ".$key // empty" 2>/dev/null || echo ""
    else
        echo "$json" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*[^,}]*" \
            | head -1 | sed 's/.*:[[:space:]]*//' | tr -d '"' || echo ""
    fi
}

# --- Helper: current ISO-8601 timestamp ---
now_iso() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# --- Helper: safe numeric with default ---
safe_num() {
    local val="$1" default="${2:-0}"
    if [[ "$val" =~ ^[0-9]+\.?[0-9]*$ ]]; then
        echo "$val"
    else
        echo "$default"
    fi
}

# --- Record a provider call metric ---
# Appends latency + status to per-provider state files for rolling stats.
record_call() {
    local provider="$1" latency_ms="$2" status="${3:-ok}" cost="${4:-0}"
    local ts
    ts="$(now_iso)"
    local state_file="$PROVIDER_STATE/${provider}.ndjson"
    echo "{\"ts\":\"$ts\",\"latency_ms\":$latency_ms,\"status\":\"$status\",\"cost\":$cost}" \
        >> "$state_file"
}

# --- Compute percentile from sorted numeric list ---
# Usage: percentile <file_with_numbers> <p> (e.g. 50, 95, 99)
percentile() {
    local file="$1" p="$2"
    local count
    count="$(wc -l < "$file" | tr -d ' ')"
    if [[ "$count" -eq 0 ]]; then
        echo "0"
        return
    fi
    local idx
    idx="$(awk "BEGIN { printf \"%d\", ($p / 100.0) * $count + 0.5 }")"
    [[ "$idx" -lt 1 ]] && idx=1
    [[ "$idx" -gt "$count" ]] && idx="$count"
    sed -n "${idx}p" "$file"
}

# =============================================================================
# Subcommand: status — print health summary for all providers
# =============================================================================
cmd_status() {
    echo "$PREFIX Provider Health Status"
    echo "$PREFIX $(printf '=%.0s' {1..50})"

    local found=false
    for state_file in "$PROVIDER_STATE"/*.ndjson; do
        [[ -f "$state_file" ]] || continue
        found=true
        local provider
        provider="$(basename "$state_file" .ndjson)"
        local total ok_count err_count
        total="$(wc -l < "$state_file" | tr -d ' ')"
        ok_count="$(grep -c '"status":"ok"' "$state_file" 2>/dev/null || echo 0)"
        err_count="$((total - ok_count))"

        # Availability %
        local avail="0.0"
        if [[ "$total" -gt 0 ]]; then
            avail="$(awk "BEGIN { printf \"%.1f\", ($ok_count / $total) * 100 }")"
        fi

        # Error rate
        local err_rate="0.0"
        if [[ "$total" -gt 0 ]]; then
            err_rate="$(awk "BEGIN { printf \"%.2f\", ($err_count / $total) * 100 }")"
        fi

        # Latency percentiles — extract latency_ms, sort numerically
        local lat_tmp="$TMPBASE/.lat_sort_$$"
        if command -v jq &>/dev/null; then
            jq -r '.latency_ms' "$state_file" 2>/dev/null | sort -n > "$lat_tmp"
        else
            grep -o '"latency_ms":[0-9.]*' "$state_file" \
                | sed 's/"latency_ms"://' | sort -n > "$lat_tmp"
        fi
        local p50 p95 p99
        p50="$(percentile "$lat_tmp" 50)"
        p95="$(percentile "$lat_tmp" 95)"
        p99="$(percentile "$lat_tmp" 99)"
        rm -f "$lat_tmp"

        # Cost per 1K tokens (aggregate from cost log if available)
        local cost_per_1k="n/a"
        if [[ -f "$COST_LOG" ]] && command -v jq &>/dev/null; then
            local total_cost total_tokens
            total_cost="$(grep "\"provider\":\"$provider\"" "$COST_LOG" 2>/dev/null \
                | jq -s '[.[].estimated_cost // 0] | add // 0' 2>/dev/null || echo 0)"
            total_tokens="$(grep "\"provider\":\"$provider\"" "$COST_LOG" 2>/dev/null \
                | jq -s '[.[].total_tokens // 0] | add // 0' 2>/dev/null || echo 0)"
            total_cost="$(safe_num "$total_cost" 0)"
            total_tokens="$(safe_num "$total_tokens" 0)"
            if awk "BEGIN { exit ($total_tokens > 0) ? 0 : 1 }" 2>/dev/null; then
                cost_per_1k="$(awk "BEGIN { printf \"%.4f\", ($total_cost / $total_tokens) * 1000 }")"
            fi
        fi

        # Rate limit headroom — read from cached state if present
        local headroom="unknown"
        local rl_file="$PROVIDER_STATE/${provider}.ratelimit"
        if [[ -f "$rl_file" ]]; then
            headroom="$(cat "$rl_file")"
        fi

        # Error breakdown by type
        local err_types=""
        if [[ "$err_count" -gt 0 ]]; then
            if command -v jq &>/dev/null; then
                err_types="$(jq -r 'select(.status != "ok") | .status' "$state_file" 2>/dev/null \
                    | sort | uniq -c | sort -rn | head -3 \
                    | awk '{printf "%s(%s) ", $2, $1}' || echo "")"
            else
                err_types="$(grep -v '"status":"ok"' "$state_file" \
                    | grep -o '"status":"[^"]*"' | sed 's/"status":"//;s/"//' \
                    | sort | uniq -c | sort -rn | head -3 \
                    | awk '{printf "%s(%s) ", $2, $1}' || echo "")"
            fi
        fi

        echo "$PREFIX"
        echo "$PREFIX  Provider: $provider"
        echo "$PREFIX    Availability:   ${avail}% ($ok_count/$total calls)"
        echo "$PREFIX    Latency p50:    ${p50}ms"
        echo "$PREFIX    Latency p95:    ${p95}ms"
        echo "$PREFIX    Latency p99:    ${p99}ms"
        echo "$PREFIX    Error rate:     ${err_rate}%${err_types:+ [$err_types]}"
        echo "$PREFIX    Cost/1K tokens: \$${cost_per_1k}"
        echo "$PREFIX    Rate headroom:  ${headroom}"
    done

    if [[ "$found" == "false" ]]; then
        echo "$PREFIX  No provider metrics recorded yet."
        echo "$PREFIX  Metrics are populated as provider calls are tracked."
    fi

    # Show recent failovers if any
    if [[ -f "$HEALTH_LOG" ]] && [[ -s "$HEALTH_LOG" ]]; then
        local recent_count
        recent_count="$(wc -l < "$HEALTH_LOG" | tr -d ' ')"
        echo "$PREFIX"
        echo "$PREFIX  Recent failovers ($recent_count total):"
        tail -5 "$HEALTH_LOG" | while IFS= read -r line; do
            local orig fallback reason ts_line
            orig="$(json_val "$line" "original_provider")"
            fallback="$(json_val "$line" "fallback_used")"
            reason="$(json_val "$line" "failover_reason")"
            ts_line="$(json_val "$line" "timestamp")"
            echo "$PREFIX    $ts_line: $orig -> $fallback ($reason)"
        done
    fi

    echo "$PREFIX $(printf '=%.0s' {1..50})"
}

# =============================================================================
# Subcommand: log-failover — record a provider failover event
# Usage: log-failover <original_provider> <fallback_provider> <reason>
# =============================================================================
cmd_log_failover() {
    local original="${1:-}"
    local fallback="${2:-}"
    local reason="${3:-unknown}"

    if [[ -z "$original" ]] || [[ -z "$fallback" ]]; then
        echo "$PREFIX Error: log-failover requires <original> <fallback> <reason>" >&2
        echo "$PREFIX Usage: provider-health.sh log-failover anthropic openai rate_limit" >&2
        exit 0
    fi

    local ts agent_id latency_increase cost_diff
    ts="$(now_iso)"
    agent_id="${AGENT_ID:-${CLAUDE_SESSION_ID:-unknown}}"

    # Estimate latency increase from provider state files
    latency_increase="0"
    local orig_p50="0" fb_p50="0"
    local lat_tmp="$TMPBASE/.lat_fo_$$"
    if [[ -f "$PROVIDER_STATE/${original}.ndjson" ]] && command -v jq &>/dev/null; then
        jq -r '.latency_ms' "$PROVIDER_STATE/${original}.ndjson" 2>/dev/null \
            | sort -n > "$lat_tmp"
        orig_p50="$(percentile "$lat_tmp" 50)"
    fi
    if [[ -f "$PROVIDER_STATE/${fallback}.ndjson" ]] && command -v jq &>/dev/null; then
        jq -r '.latency_ms' "$PROVIDER_STATE/${fallback}.ndjson" 2>/dev/null \
            | sort -n > "$lat_tmp"
        fb_p50="$(percentile "$lat_tmp" 50)"
    fi
    rm -f "$lat_tmp"
    orig_p50="$(safe_num "$orig_p50" 0)"
    fb_p50="$(safe_num "$fb_p50" 0)"
    latency_increase="$(awk "BEGIN { printf \"%.0f\", $fb_p50 - $orig_p50 }")"

    # Estimate cost difference from cost-log
    cost_diff="0.0000"
    if [[ -f "$COST_LOG" ]] && command -v jq &>/dev/null; then
        local orig_avg fb_avg
        orig_avg="$(grep "\"provider\":\"$original\"" "$COST_LOG" 2>/dev/null \
            | jq -s 'if length > 0 then ([.[].estimated_cost // 0] | add) / length else 0 end' \
            2>/dev/null || echo 0)"
        fb_avg="$(grep "\"provider\":\"$fallback\"" "$COST_LOG" 2>/dev/null \
            | jq -s 'if length > 0 then ([.[].estimated_cost // 0] | add) / length else 0 end' \
            2>/dev/null || echo 0)"
        orig_avg="$(safe_num "$orig_avg" 0)"
        fb_avg="$(safe_num "$fb_avg" 0)"
        cost_diff="$(awk "BEGIN { printf \"%.4f\", $fb_avg - $orig_avg }")"
    fi

    # Append NDJSON failover event
    local event
    event="{\"agentId\":\"$agent_id\",\"provider\":\"$fallback\",\"fallback_used\":\"$fallback\",\"original_provider\":\"$original\",\"failover_reason\":\"$reason\",\"latency_increase_ms\":$latency_increase,\"cost_difference_usd\":$cost_diff,\"timestamp\":\"$ts\"}"

    echo "$event" >> "$HEALTH_LOG"
    echo "$PREFIX Failover logged: $original -> $fallback (reason: $reason)"
    echo "$PREFIX   Estimated latency delta: ${latency_increase}ms, cost delta: \$${cost_diff}"

    # Also record a call metric for the fallback provider
    record_call "$fallback" "$(safe_num "$fb_p50" 0)" "failover" "0"
}

# =============================================================================
# Subcommand: summary — aggregate stats from cost-log.json grouped by provider
# =============================================================================
cmd_summary() {
    echo "$PREFIX Provider Cost Summary"
    echo "$PREFIX $(printf '=%.0s' {1..50})"

    if [[ ! -f "$COST_LOG" ]] || [[ ! -s "$COST_LOG" ]]; then
        echo "$PREFIX  No cost log data found at $COST_LOG"
        echo "$PREFIX $(printf '=%.0s' {1..50})"
        exit 0
    fi

    if ! command -v jq &>/dev/null; then
        # Fallback: basic grep aggregation
        echo "$PREFIX  (Install jq for detailed provider breakdown)"
        local providers
        providers="$(grep -o '"provider":"[^"]*"' "$COST_LOG" 2>/dev/null \
            | sed 's/"provider":"//;s/"//' | sort -u)"
        if [[ -z "$providers" ]]; then
            echo "$PREFIX  No provider data found in cost log."
        else
            for p in $providers; do
                local count
                count="$(grep -c "\"provider\":\"$p\"" "$COST_LOG" 2>/dev/null || echo 0)"
                echo "$PREFIX  $p: $count calls"
            done
        fi
        echo "$PREFIX $(printf '=%.0s' {1..50})"
        exit 0
    fi

    # jq-powered aggregation
    local providers
    providers="$(jq -r '.provider // "unknown"' "$COST_LOG" 2>/dev/null | sort -u)"

    for provider in $providers; do
        [[ -z "$provider" ]] && continue
        local subset
        subset="$(grep "\"provider\":\"$provider\"" "$COST_LOG" 2>/dev/null || true)"
        [[ -z "$subset" ]] && continue

        local call_count total_cost total_tokens avg_cost models
        call_count="$(echo "$subset" | wc -l | tr -d ' ')"
        total_cost="$(echo "$subset" | jq -s '[.[].estimated_cost // 0] | add // 0' 2>/dev/null || echo 0)"
        total_tokens="$(echo "$subset" | jq -s '[.[].total_tokens // 0] | add // 0' 2>/dev/null || echo 0)"
        avg_cost="$(echo "$subset" | jq -s '([.[].estimated_cost // 0] | add // 0) / (length | if . == 0 then 1 else . end)' 2>/dev/null || echo 0)"
        models="$(echo "$subset" | jq -r '.model // "unknown"' 2>/dev/null | sort | uniq -c | sort -rn | head -5 \
            | awk '{printf "%s(%s) ", $2, $1}')"

        local cost_per_1k="n/a"
        total_cost="$(safe_num "$total_cost" 0)"
        total_tokens="$(safe_num "$total_tokens" 0)"
        if awk "BEGIN { exit ($total_tokens > 0) ? 0 : 1 }" 2>/dev/null; then
            cost_per_1k="$(awk "BEGIN { printf \"%.4f\", ($total_cost / $total_tokens) * 1000 }")"
        fi

        echo "$PREFIX"
        echo "$PREFIX  Provider: $provider"
        echo "$PREFIX    Total calls:    $call_count"
        echo "$PREFIX    Total cost:     \$$(printf '%.4f' "$total_cost")"
        echo "$PREFIX    Total tokens:   $total_tokens"
        echo "$PREFIX    Avg cost/call:  \$$(printf '%.6f' "$avg_cost")"
        echo "$PREFIX    Cost/1K tokens: \$${cost_per_1k}"
        echo "$PREFIX    Models:         $models"
    done

    # Failover summary
    if [[ -f "$HEALTH_LOG" ]] && [[ -s "$HEALTH_LOG" ]]; then
        local fo_count
        fo_count="$(wc -l < "$HEALTH_LOG" | tr -d ' ')"
        echo "$PREFIX"
        echo "$PREFIX  Failover Events: $fo_count total"
        if command -v jq &>/dev/null; then
            jq -r '.failover_reason // "unknown"' "$HEALTH_LOG" 2>/dev/null \
                | sort | uniq -c | sort -rn | while read -r cnt rsn; do
                echo "$PREFIX    $rsn: $cnt"
            done
        fi
    fi

    echo "$PREFIX $(printf '=%.0s' {1..50})"
}

# =============================================================================
# Subcommand: record — record a provider call (used by hooks)
# Usage: record <provider> <latency_ms> [status] [cost]
# =============================================================================
cmd_record() {
    local provider="${1:-}"
    local latency="${2:-0}"
    local status="${3:-ok}"
    local cost="${4:-0}"

    if [[ -z "$provider" ]]; then
        echo "$PREFIX Error: record requires <provider> <latency_ms> [status] [cost]" >&2
        exit 0
    fi

    record_call "$provider" "$latency" "$status" "$cost"
    echo "$PREFIX Recorded: $provider ${latency}ms status=$status"
}

# =============================================================================
# Subcommand: set-ratelimit — cache rate limit headroom for a provider
# Usage: set-ratelimit <provider> <remaining>/<limit>
# =============================================================================
cmd_set_ratelimit() {
    local provider="${1:-}"
    local headroom="${2:-}"

    if [[ -z "$provider" ]] || [[ -z "$headroom" ]]; then
        echo "$PREFIX Error: set-ratelimit requires <provider> <remaining/limit>" >&2
        exit 0
    fi

    echo "$headroom" > "$PROVIDER_STATE/${provider}.ratelimit"
    echo "$PREFIX Rate limit headroom for $provider: $headroom"
}

# =============================================================================
# Main dispatcher
# =============================================================================
cmd="${1:-status}"
shift 2>/dev/null || true

case "$cmd" in
    status)
        cmd_status
        ;;
    log-failover)
        cmd_log_failover "$@"
        ;;
    summary)
        cmd_summary
        ;;
    record)
        cmd_record "$@"
        ;;
    set-ratelimit)
        cmd_set_ratelimit "$@"
        ;;
    help|--help|-h)
        echo "$PREFIX Multi-Provider Health Monitor (§17)"
        echo ""
        echo "Usage: $(basename "$0") <subcommand> [args]"
        echo ""
        echo "Subcommands:"
        echo "  status                                   Health summary for all providers"
        echo "  log-failover <original> <fallback> <reason>  Record a failover event"
        echo "  summary                                  Aggregate stats from cost-log.json"
        echo "  record <provider> <latency_ms> [status] [cost]  Record a provider call"
        echo "  set-ratelimit <provider> <remaining/limit>   Cache rate limit headroom"
        echo "  help                                     Show this help"
        ;;
    *)
        echo "$PREFIX Unknown subcommand: $cmd (try 'help')" >&2
        ;;
esac

exit 0
