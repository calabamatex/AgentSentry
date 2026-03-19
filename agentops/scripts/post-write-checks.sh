#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# post-write-checks.sh — AgentOps PostToolUse hook for Write|Edit
#
# Implements:
#   §6.2.2  Error Handling Enforcer
#   §6.2.3  PII Logging Scanner
#   §2.2.3  Post-Edit Tracking / blast radius
#
# Reads hook JSON from stdin, extracts .tool_input.file_path.
# All output prefixed with [AgentOps]. Always exits 0.
###############################################################################

PREFIX="[AgentOps]"

# ---------------------------------------------------------------------------
# Parse hook input
# ---------------------------------------------------------------------------
INPUT="$(cat)"
FILE_PATH="$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    # Navigate possible shapes: .tool_input.file_path or .input.file_path
    ti = data.get('tool_input', data.get('input', {}))
    print(ti.get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null || true)"

if [[ -z "$FILE_PATH" || ! -f "$FILE_PATH" ]]; then
    exit 0
fi

# ---------------------------------------------------------------------------
# 1. ERROR HANDLING ENFORCER (§6.2.2)
#
# Scans for external/IO calls and warns when no nearby error handling exists.
# ---------------------------------------------------------------------------
check_error_handling() {
    local file="$1"
    local line_num=0

    # Patterns that represent calls needing error handling
    local -a call_patterns=(
        'fetch\s*('
        'axios\.'
        'http\.get\|http\.post\|http\.put\|http\.delete\|http\.patch'
        '\.query\s*('
        '\.execute\s*('
        'fs\.\(read\|write\|unlink\|mkdir\|rmdir\|rename\|access\)'
        'readFile\|writeFile\|readdir\|appendFile'
        'open\s*('
        'requests\.\(get\|post\|put\|delete\|patch\)'
        'urllib'
        'aiohttp'
        'subprocess\.\(run\|call\|Popen\)'
    )

    local -a call_labels=(
        "fetch()"
        "axios"
        "http request"
        "database query"
        "database execute"
        "fs operation"
        "file system"
        "file open"
        "requests (Python)"
        "urllib"
        "aiohttp"
        "subprocess"
    )

    local i=0
    for pattern in "${call_patterns[@]}"; do
        local label="${call_labels[$i]}"
        # Find matching lines with line numbers
        local matches
        matches="$(grep -n "$pattern" "$file" 2>/dev/null || true)"

        if [[ -n "$matches" ]]; then
            while IFS= read -r match_line; do
                local lnum="${match_line%%:*}"
                # Look for try/catch/.catch/except in a window around the line
                local start=$((lnum - 5))
                [[ $start -lt 1 ]] && start=1
                local end=$((lnum + 5))
                local context
                context="$(sed -n "${start},${end}p" "$file" 2>/dev/null || true)"

                if ! echo "$context" | grep -qiE 'try\s*\{|try:|\.catch\s*\(|catch\s*\(|except\s|except:|ErrorBoundary|on_error|onerror'; then
                    echo "$PREFIX WARN: Unhandled call in ${file}:${lnum}. Type: ${label}"
                    echo "$PREFIX RECOMMEND: Add error handling with graceful fallback."
                fi
            done <<< "$matches"
        fi
        i=$((i + 1))
    done
}

# ---------------------------------------------------------------------------
# 2. PII LOGGING SCANNER (§6.2.3)
#
# Scans logging statements for references to sensitive fields.
# ---------------------------------------------------------------------------
check_pii_logging() {
    local file="$1"

    # Logging call patterns (JS + Python)
    local log_pattern='console\.\(log\|warn\|error\|info\|debug\)\|logging\.\(debug\|info\|warning\|error\|critical\)\|print\s*('

    # Sensitive field names
    local -a pii_fields=(
        "email"
        "password"
        "passwd"
        "card"
        "credit_card"
        "creditCard"
        "cardNumber"
        "card_number"
        "ssn"
        "social_security"
        "socialSecurity"
        "phone"
        "phoneNumber"
        "phone_number"
        "secret"
        "token"
        "api_key"
        "apiKey"
    )

    # Find lines that are logging calls
    local log_lines
    log_lines="$(grep -n "$log_pattern" "$file" 2>/dev/null || true)"

    if [[ -z "$log_lines" ]]; then
        return
    fi

    while IFS= read -r log_line; do
        local lnum="${log_line%%:*}"
        local content="${log_line#*:}"

        for field in "${pii_fields[@]}"; do
            if echo "$content" | grep -qi "$field"; then
                echo "$PREFIX WARN: PII in logging: ${field} in ${file}:${lnum}"
            fi
        done
    done <<< "$log_lines"
}

# ---------------------------------------------------------------------------
# 3. BLAST RADIUS TRACKING (§2.2.3)
#
# Tracks files modified this session. Warns at 8+ without a commit.
# ---------------------------------------------------------------------------
check_blast_radius() {
    local file="$1"
    local tracking_dir="${TMPDIR:-/tmp}/agentops"
    local tracking_file="${tracking_dir}/blast-radius-files"

    mkdir -p "$tracking_dir"
    touch "$tracking_file"

    # Append the modified file (will deduplicate when counting)
    echo "$file" >> "$tracking_file"

    # Count unique files
    local unique_count
    unique_count="$(sort -u "$tracking_file" | wc -l | tr -d ' ')"

    if [[ "$unique_count" -gt 8 ]]; then
        # Check if there has been a commit since session start
        local session_marker="${tracking_dir}/session-start-time"
        local needs_checkpoint=true

        if [[ -f "$session_marker" ]]; then
            local session_start
            session_start="$(cat "$session_marker")"
            # Check for commits after session start
            local recent_commits
            recent_commits="$(git log --after="$session_start" --oneline 2>/dev/null | head -1 || true)"
            if [[ -n "$recent_commits" ]]; then
                needs_checkpoint=false
            fi
        fi

        if $needs_checkpoint; then
            echo "$PREFIX WARN: ${unique_count} files modified without a checkpoint. Auto-saving."
            # Attempt auto-commit of tracked files
            local committed=false
            while IFS= read -r tracked_file; do
                if [[ -f "$tracked_file" ]]; then
                    git add "$tracked_file" 2>/dev/null || true
                    committed=true
                fi
            done < <(sort -u "$tracking_file")

            if $committed; then
                local auto_enabled
                auto_enabled=$(jq -r '.save_points.auto_commit_enabled // true' "$(dirname "${BASH_SOURCE[0]}")/../agentops.config.json" 2>/dev/null || echo "true")
                if [[ "$auto_enabled" != "true" ]]; then
                    git reset HEAD 2>/dev/null || true
                    echo "$PREFIX ADVISORY: Auto-checkpoint would fire (blast radius ${unique_count} files) but auto_commit_enabled=false."
                else
                    git commit -m "chore(agentops): auto-checkpoint — blast radius ${unique_count} files" 2>/dev/null || true
                    echo "$PREFIX Auto-checkpoint commit created."
                fi
            fi
        fi
    fi
}

# ---------------------------------------------------------------------------
# Run all checks (never block)
# ---------------------------------------------------------------------------
{
    check_error_handling "$FILE_PATH"
    check_pii_logging "$FILE_PATH"
    check_blast_radius "$FILE_PATH"
} || true

exit 0
