#!/usr/bin/env bash
# =============================================================================
# [AgentSentry] Delegation Validator - PreToolUse Hook (Section 20)
# =============================================================================
# Implements Agent-to-Agent Trust and Delegation (section 20).
#
# When an agent delegates a task to another agent, it issues a delegation
# token (JSON) via the AGENTOPS_DELEGATION_TOKEN environment variable.
# This hook validates the token before every tool use, enforcing:
#   1. Token not expired (expires_at > now)
#   2. Current tool is within scope.tools
#   3. Target file matches scope.files globs
#   4. Cumulative token count has not exceeded scope.max_tokens
#
# Token format (JSON):
#   {
#     "issuer":     "<agent-id that created the token>",
#     "delegate":   "<agent-id receiving delegation>",
#     "task":       "<human-readable task description>",
#     "scope": {
#       "files":        ["src/**", "tests/**"],
#       "tools":        ["Read", "Edit", "Bash"],
#       "max_tokens":   100000,
#       "max_duration": 3600,
#       "can_delegate": false
#     },
#     "issued_at":  "<ISO-8601>",
#     "expires_at": "<ISO-8601>"
#   }
#
# Protocol:  Reads JSON from stdin per the Claude Code hook contract.
# Exit 0:    Delegation valid (or no delegation token — direct user session).
# Exit 2:    Delegation check failed — BLOCK the tool use.
#
# Logs every check to agent-sentry/dashboard/data/delegation-log.json (NDJSON).
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Dependency checks — fail loudly, not silently
# ---------------------------------------------------------------------------
if ! command -v jq &>/dev/null; then
    echo "[AgentSentry] CRITICAL: 'jq' is required but not found. Install with: brew install jq (macOS) or apt install jq (Linux)" >&2
    exit 0
fi
if ! command -v node &>/dev/null; then
    echo "[AgentSentry] CRITICAL: 'node' is required but not found. AgentOps is a Node.js package." >&2
    exit 0
fi

PREFIX="[AgentSentry]"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DASHBOARD_DATA="$REPO_ROOT/agent-sentry/dashboard/data"
LOG_FILE="$DASHBOARD_DATA/delegation-log.json"
TMPBASE="${TMPDIR:-/tmp}/agent-sentry"
COST_STATE="$TMPBASE/cost-state"

# Ensure directories exist
mkdir -p "$DASHBOARD_DATA" "$TMPBASE"

# ---------------------------------------------------------------------------
# 1. Read hook input from stdin (Claude Code hook protocol)
# ---------------------------------------------------------------------------
INPUT="$(cat)"

TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)"
FILE_PATH="$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"

if [[ -z "$TOOL_NAME" ]]; then
    exit 0
fi

# ---------------------------------------------------------------------------
# 2. Check for delegation token
# ---------------------------------------------------------------------------
DELEGATION_TOKEN="${AGENT_SENTRY_DELEGATION_TOKEN:-}"

if [[ -z "$DELEGATION_TOKEN" ]]; then
    # No delegation token — direct user session, allow everything
    exit 0
fi

# ---------------------------------------------------------------------------
# 3. Parse delegation token
# ---------------------------------------------------------------------------
parse_token_field() {
    local field="$1"
    echo "$DELEGATION_TOKEN" | jq -r "$field // empty" 2>/dev/null || true
}

TOKEN_ISSUER="$(parse_token_field '.issuer')"
TOKEN_DELEGATE="$(parse_token_field '.delegate')"
TOKEN_TASK="$(parse_token_field '.task')"
TOKEN_EXPIRES="$(parse_token_field '.expires_at')"
TOKEN_ISSUED="$(parse_token_field '.issued_at')"

# Scope fields
SCOPE_MAX_TOKENS="$(parse_token_field '.scope.max_tokens')"
SCOPE_MAX_DURATION="$(parse_token_field '.scope.max_duration')"
SCOPE_CAN_DELEGATE="$(parse_token_field '.scope.can_delegate')"

# Validate that the token is parseable JSON with required fields
if [[ -z "$TOKEN_ISSUER" || -z "$TOKEN_DELEGATE" || -z "$TOKEN_EXPIRES" ]]; then
    echo "$PREFIX DELEGATION BLOCKED — malformed delegation token (missing issuer, delegate, or expires_at)."
    # Log the malformed token attempt
    TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    printf '{"timestamp":"%s","decision":"BLOCK","reason":"malformed-token","tool":"%s","file":"%s","issuer":"","delegate":"","task":""}\n' \
        "$TIMESTAMP" "$TOOL_NAME" "${FILE_PATH:-}" >> "$LOG_FILE" 2>/dev/null || true
    exit 2
fi

# ---------------------------------------------------------------------------
# 4. Logging helper
# ---------------------------------------------------------------------------
log_delegation() {
    local decision="$1"
    local reason="$2"
    local timestamp
    timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

    printf '{"timestamp":"%s","decision":"%s","reason":"%s","tool":"%s","file":"%s","issuer":"%s","delegate":"%s","task":"%s","scope_max_tokens":%s,"scope_max_duration":%s}\n' \
        "$timestamp" \
        "$decision" \
        "$reason" \
        "$TOOL_NAME" \
        "${FILE_PATH:-}" \
        "$TOKEN_ISSUER" \
        "$TOKEN_DELEGATE" \
        "$TOKEN_TASK" \
        "${SCOPE_MAX_TOKENS:-0}" \
        "${SCOPE_MAX_DURATION:-0}" \
        >> "$LOG_FILE" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# 5. Validation: Token expiry
# ---------------------------------------------------------------------------
# Convert ISO-8601 expiry to epoch seconds and compare to now.
# Supports both GNU date and BSD/macOS date.
# ---------------------------------------------------------------------------
iso_to_epoch() {
    local iso="$1"
    # Try GNU date first
    date -d "$iso" +%s 2>/dev/null && return 0
    # Fall back to BSD/macOS date — strip timezone offset for -jf parsing
    # Handles formats: 2026-03-19T12:00:00Z and 2026-03-19T12:00:00+00:00
    local cleaned
    cleaned="$(echo "$iso" | sed 's/Z$/+0000/' | sed 's/\([+-][0-9][0-9]\):\([0-9][0-9]\)$/\1\2/')"
    date -jf "%Y-%m-%dT%H:%M:%S%z" "$cleaned" +%s 2>/dev/null && return 0
    # Last resort: node
    node -e "
const d = new Date(process.argv[1]);
if (isNaN(d.getTime())) process.exit(1);
process.stdout.write(String(Math.floor(d.getTime() / 1000)));
" "$iso" 2>/dev/null && return 0
    echo "0"
}

NOW_EPOCH="$(date +%s)"
EXPIRES_EPOCH="$(iso_to_epoch "$TOKEN_EXPIRES")"

if [[ "$EXPIRES_EPOCH" -le "$NOW_EPOCH" ]]; then
    log_delegation "BLOCK" "token-expired"
    echo "$PREFIX DELEGATION BLOCKED"
    echo "$PREFIX   Reason:    Token expired"
    echo "$PREFIX   Issuer:    $TOKEN_ISSUER"
    echo "$PREFIX   Delegate:  $TOKEN_DELEGATE"
    echo "$PREFIX   Expired:   $TOKEN_EXPIRES"
    echo "$PREFIX   Task:      $TOKEN_TASK"
    exit 2
fi

# ---------------------------------------------------------------------------
# 6. Validation: Duration check (issued_at + max_duration < now)
# ---------------------------------------------------------------------------
if [[ -n "$SCOPE_MAX_DURATION" && "$SCOPE_MAX_DURATION" != "null" && "$SCOPE_MAX_DURATION" != "0" ]]; then
    if [[ -n "$TOKEN_ISSUED" ]]; then
        ISSUED_EPOCH="$(iso_to_epoch "$TOKEN_ISSUED")"
        DEADLINE_EPOCH="$((ISSUED_EPOCH + SCOPE_MAX_DURATION))"
        if [[ "$NOW_EPOCH" -gt "$DEADLINE_EPOCH" ]]; then
            log_delegation "BLOCK" "max-duration-exceeded"
            echo "$PREFIX DELEGATION BLOCKED"
            echo "$PREFIX   Reason:    Max duration exceeded (${SCOPE_MAX_DURATION}s)"
            echo "$PREFIX   Issuer:    $TOKEN_ISSUER"
            echo "$PREFIX   Delegate:  $TOKEN_DELEGATE"
            echo "$PREFIX   Task:      $TOKEN_TASK"
            exit 2
        fi
    fi
fi

# ---------------------------------------------------------------------------
# 7. Validation: Tool in scope.tools
# ---------------------------------------------------------------------------
SCOPE_TOOLS="$(echo "$DELEGATION_TOKEN" | jq -r '.scope.tools // [] | .[]' 2>/dev/null || true)"

if [[ -n "$SCOPE_TOOLS" ]]; then
    TOOL_ALLOWED=false
    while IFS= read -r allowed_tool; do
        [[ -z "$allowed_tool" ]] && continue
        if [[ "$allowed_tool" == "$TOOL_NAME" ]]; then
            TOOL_ALLOWED=true
            break
        fi
    done <<< "$SCOPE_TOOLS"

    if [[ "$TOOL_ALLOWED" != "true" ]]; then
        log_delegation "BLOCK" "tool-not-in-scope"
        echo "$PREFIX DELEGATION BLOCKED"
        echo "$PREFIX   Reason:    Tool '$TOOL_NAME' not in delegation scope"
        echo "$PREFIX   Allowed:   $(echo "$SCOPE_TOOLS" | tr '\n' ', ' | sed 's/,$//')"
        echo "$PREFIX   Issuer:    $TOKEN_ISSUER"
        echo "$PREFIX   Delegate:  $TOKEN_DELEGATE"
        echo "$PREFIX   Task:      $TOKEN_TASK"
        exit 2
    fi
fi

# ---------------------------------------------------------------------------
# 8. Validation: File matches scope.files globs
# ---------------------------------------------------------------------------
if [[ -n "$FILE_PATH" ]]; then
    SCOPE_FILES="$(echo "$DELEGATION_TOKEN" | jq -r '.scope.files // [] | .[]' 2>/dev/null || true)"

    if [[ -n "$SCOPE_FILES" ]]; then
        FILE_ALLOWED=false

        # Make path relative to repo root for matching
        REL_PATH="$FILE_PATH"
        if [[ "$FILE_PATH" == "$REPO_ROOT"/* ]]; then
            REL_PATH="${FILE_PATH#$REPO_ROOT/}"
        fi

        while IFS= read -r pattern; do
            [[ -z "$pattern" ]] && continue
            if node -e "
const p = process.argv[1], g = process.argv[2];
const re = new RegExp('^' + g.replace(/[.+^${}()|[\]\\\\]/g, '\\\\$&').replace(/\*\*\\//g, '(?:.+/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '$');
process.exit(re.test(p) ? 0 : 1);
" "$REL_PATH" "$pattern" 2>/dev/null; then
                FILE_ALLOWED=true
                break
            fi
        done <<< "$SCOPE_FILES"

        if [[ "$FILE_ALLOWED" != "true" ]]; then
            log_delegation "BLOCK" "file-not-in-scope"
            echo "$PREFIX DELEGATION BLOCKED"
            echo "$PREFIX   Reason:    File '$FILE_PATH' not in delegation scope"
            echo "$PREFIX   Allowed:   $(echo "$SCOPE_FILES" | tr '\n' ', ' | sed 's/,$//')"
            echo "$PREFIX   Issuer:    $TOKEN_ISSUER"
            echo "$PREFIX   Delegate:  $TOKEN_DELEGATE"
            echo "$PREFIX   Task:      $TOKEN_TASK"
            exit 2
        fi
    fi
fi

# ---------------------------------------------------------------------------
# 9. Validation: Token count within scope.max_tokens
# ---------------------------------------------------------------------------
if [[ -n "$SCOPE_MAX_TOKENS" && "$SCOPE_MAX_TOKENS" != "null" && "$SCOPE_MAX_TOKENS" != "0" ]]; then
    CURRENT_TOKENS=0

    if [[ -f "$COST_STATE" ]]; then
        # Read input_tokens and output_tokens from cost state to compute total consumed
        # The cost-state tracks session_calls but not raw token count directly.
        # We read from cost-log for cumulative token usage during this delegation.
        # Simpler approach: read session_calls * estimated tokens, or parse cost-log.
        # Best approach: sum input_tokens + output_tokens from cost-log entries
        # since the delegation was issued.
        if [[ -f "$DASHBOARD_DATA/cost-log.json" && -n "$TOKEN_ISSUED" ]]; then
            CURRENT_TOKENS="$(node -e "
const fs = require('fs');
const issued = process.argv[1];
const logFile = process.argv[2];
try {
  const issuedMs = new Date(issued).getTime();
  let total = 0;
  const lines = fs.readFileSync(logFile, 'utf-8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const entryMs = new Date(entry.timestamp || '').getTime();
      if (entryMs >= issuedMs) {
        total += parseInt(entry.input_tokens || 0, 10);
        total += parseInt(entry.output_tokens || 0, 10);
      }
    } catch {}
  }
  process.stdout.write(String(total));
} catch { process.stdout.write('0'); }
" "$TOKEN_ISSUED" "$DASHBOARD_DATA/cost-log.json" 2>/dev/null)" || true
        fi
    fi

    [[ -z "$CURRENT_TOKENS" ]] && CURRENT_TOKENS=0

    if [[ "$CURRENT_TOKENS" -ge "$SCOPE_MAX_TOKENS" ]]; then
        log_delegation "BLOCK" "max-tokens-exceeded"
        echo "$PREFIX DELEGATION BLOCKED"
        echo "$PREFIX   Reason:    Token budget exceeded ($CURRENT_TOKENS / $SCOPE_MAX_TOKENS)"
        echo "$PREFIX   Issuer:    $TOKEN_ISSUER"
        echo "$PREFIX   Delegate:  $TOKEN_DELEGATE"
        echo "$PREFIX   Task:      $TOKEN_TASK"
        exit 2
    fi
fi

# ---------------------------------------------------------------------------
# 10. All checks passed — allow the tool use
# ---------------------------------------------------------------------------
log_delegation "ALLOW" "all-checks-passed"
exit 0
