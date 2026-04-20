#!/usr/bin/env bash
# =============================================================================
# [AgentSentry] Hook Guard + State Manager (unified)
#
# Single shared library for ALL hook scripts. Provides:
#   1. Circuit breaker (depth guard, reentrance detection, debounce)
#   2. Atomic state file management (temp+mv, flock locking)
#   3. Feedback loop detection for stop hooks
#   4. Centralized runtime data paths (never in the repo)
#
# Usage — source at the top of every hook script:
#   HOOK_NAME="cost-tracker"
#   DEBOUNCE_SECONDS=5
#   source "$(dirname "${BASH_SOURCE[0]}")/hook-guard.sh" || exit 0
#
# If the guard trips, the hook exits 0 silently.
# After sourcing, use as_state_get/as_state_set for state, and
# AS_RUNTIME_DATA_DIR for persistent log files.
# =============================================================================

# Guard against double-sourcing
if [[ "${_AGENT_SENTRY_GUARD_LOADED:-}" == "1" ]]; then
    return 0 2>/dev/null || true
fi
_AGENT_SENTRY_GUARD_LOADED=1

# =============================================================================
# PART 1: DIRECTORIES
# =============================================================================

readonly AS_STATE_DIR="${TMPDIR:-/tmp}/agent-sentry"
readonly AS_GUARD_DIR="$AS_STATE_DIR/guard"
readonly AS_STATE_FILE="$AS_STATE_DIR/context-state"
readonly AS_LOCK_FILE="$AS_STATE_DIR/.state.lock"
readonly AS_STOP_HOOK_MARKER="$AS_STATE_DIR/.last-stop-hook-ts"

# Persistent runtime data — survives sessions, stays out of the repo
readonly AS_RUNTIME_DATA_DIR="${HOME}/.agent-sentry/data"

mkdir -p "$AS_STATE_DIR" "$AS_GUARD_DIR" "$AS_RUNTIME_DATA_DIR" 2>/dev/null

# =============================================================================
# PART 1b: GLOBAL KILL SWITCH
# =============================================================================
# If top-level "enabled" is false in the config, exit immediately (no-op).

_AS_CONFIG_FILE="$(dirname "${BASH_SOURCE[0]}")/../agent-sentry.config.json"
if [[ -f "$_AS_CONFIG_FILE" ]] && command -v jq &>/dev/null; then
    _AS_ENABLED=$(jq -r '.enabled // true' "$_AS_CONFIG_FILE" 2>/dev/null || echo "true")
    if [[ "$_AS_ENABLED" == "false" ]]; then
        exit 0
    fi
fi

# =============================================================================
# PART 2: CIRCUIT BREAKER (depth, reentrance, debounce)
# =============================================================================

# --- Depth guard: prevent hook chains (A triggers B triggers A) ---
export AGENT_SENTRY_HOOK_DEPTH=$(( ${AGENT_SENTRY_HOOK_DEPTH:-0} + 1 ))
if [[ "$AGENT_SENTRY_HOOK_DEPTH" -gt 1 ]]; then
    exit 0
fi

# --- Reentrance detection: global lockfile with 2s TTL ---
_AS_GLOBAL_LOCK="$AS_GUARD_DIR/global.lock"
if [[ -f "$_AS_GLOBAL_LOCK" ]]; then
    _lock_age=$(( $(date +%s) - $(stat -c %Y "$_AS_GLOBAL_LOCK" 2>/dev/null || echo 0) ))
    if [[ "$_lock_age" -lt 2 ]]; then
        exit 0
    fi
fi
touch "$_AS_GLOBAL_LOCK" 2>/dev/null

# --- Per-hook debounce ---
: "${HOOK_NAME:=unknown}"
: "${DEBOUNCE_SECONDS:=5}"
_AS_DEBOUNCE_FILE="$AS_GUARD_DIR/debounce-${HOOK_NAME}"
if [[ -f "$_AS_DEBOUNCE_FILE" ]]; then
    _debounce_age=$(( $(date +%s) - $(stat -c %Y "$_AS_DEBOUNCE_FILE" 2>/dev/null || echo 0) ))
    if [[ "$_debounce_age" -lt "$DEBOUNCE_SECONDS" ]]; then
        exit 0
    fi
fi
touch "$_AS_DEBOUNCE_FILE" 2>/dev/null

# =============================================================================
# PART 3: ATOMIC STATE MANAGEMENT
# =============================================================================

# Atomic file write via temp-file + mv (no partial reads)
as_atomic_write() {
    local file="$1" content="$2"
    local tmp="${file}.tmp.$$"
    printf '%s\n' "$content" > "$tmp"
    mv -f "$tmp" "$file"
}

# flock-based locking with fallback
as_lock() {
    if command -v flock &>/dev/null; then
        exec 9>"$AS_LOCK_FILE"
        flock -w 2 9 || true
    fi
}

as_unlock() {
    if command -v flock &>/dev/null; then
        flock -u 9 2>/dev/null || true
        exec 9>&- 2>/dev/null || true
    fi
}

# Read a key from the state file. Usage: as_state_get <key> [default]
as_state_get() {
    local key="$1" default="${2:-}"
    if [[ -f "$AS_STATE_FILE" ]]; then
        local val
        val=$(grep -oP "(?<=${key}=).+" "$AS_STATE_FILE" 2>/dev/null | head -1) || true
        if [[ -n "$val" ]]; then
            echo "$val"
            return 0
        fi
    fi
    echo "$default"
}

# Set a key in the state file atomically. Usage: as_state_set <key> <value>
as_state_set() {
    local key="$1" value="$2"
    as_lock

    if [[ ! -f "$AS_STATE_FILE" ]]; then
        as_atomic_write "$AS_STATE_FILE" "${key}=${value}"
        as_unlock
        return 0
    fi

    local content
    content=$(cat "$AS_STATE_FILE" 2>/dev/null) || content=""

    if echo "$content" | grep -q "^${key}=" 2>/dev/null; then
        content=$(echo "$content" | sed "s/^${key}=.*/${key}=${value}/")
    else
        content="${content}
${key}=${value}"
    fi

    as_atomic_write "$AS_STATE_FILE" "$content"
    as_unlock
}

# Initialize session state (idempotent)
as_init_state() {
    if [[ ! -f "$AS_STATE_FILE" ]]; then
        as_lock
        if [[ ! -f "$AS_STATE_FILE" ]]; then
            as_atomic_write "$AS_STATE_FILE" "message_count=0
session_id=$(date +%s)
stop_hook_count=0"
        fi
        as_unlock
    fi
}

# Increment message_count and return new value
as_increment_messages() {
    as_lock
    local count
    count=$(as_state_get "message_count" "0")
    count=$((count + 1))
    as_state_set "message_count" "$count"
    as_unlock
    echo "$count"
}

# =============================================================================
# PART 4: FEEDBACK LOOP DETECTION (for stop hooks)
# =============================================================================

# Returns 0 (true) if the stop hook fired less than 2 seconds ago
as_is_feedback_loop() {
    if [[ ! -f "$AS_STOP_HOOK_MARKER" ]]; then
        return 1
    fi
    local last_ts now_ts diff
    last_ts=$(cat "$AS_STOP_HOOK_MARKER" 2>/dev/null) || last_ts=0
    now_ts=$(date +%s)
    diff=$((now_ts - last_ts))
    if [[ "$diff" -lt 2 ]]; then
        return 0  # feedback loop detected
    fi
    return 1
}

# Mark that the stop hook just ran (call at start of stop hooks)
as_mark_stop_hook() {
    as_atomic_write "$AS_STOP_HOOK_MARKER" "$(date +%s)"
}

# =============================================================================
# PART 5: TOKEN ESTIMATION
# =============================================================================

# Estimate context usage percentage (0-100)
as_estimate_context_percent() {
    local max_tokens="${1:-200000}"
    local msg_count
    msg_count=$(as_state_get "message_count" "0")

    local estimated_tokens=$((msg_count * 4000))

    local ctx_percent=0
    if [[ "$max_tokens" -gt 0 ]]; then
        ctx_percent=$((estimated_tokens * 100 / max_tokens))
    fi
    if [[ "$ctx_percent" -gt 100 ]]; then
        ctx_percent=100
    fi
    echo "$ctx_percent"
}

# Guard passed, library loaded — hook may proceed
