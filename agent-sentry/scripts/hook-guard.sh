#!/usr/bin/env bash
# hook-guard.sh — Circuit breaker, debounce, and depth guard for AgentSentry hooks
#
# Source this at the top of every hook script:
#   HOOK_NAME="my-hook"
#   DEBOUNCE_SECONDS=5
#   source "$(dirname "${BASH_SOURCE[0]}")/hook-guard.sh" || exit 0
#
# If the guard trips (reentrance, debounce, or depth exceeded), the hook exits 0 silently.

GUARD_DIR="${TMPDIR:-/tmp}/agent-sentry/guard"
mkdir -p "$GUARD_DIR" 2>/dev/null

# --- 1. Depth guard: prevent hook chains (A triggers B triggers A) ---
export AGENT_SENTRY_HOOK_DEPTH=$(( ${AGENT_SENTRY_HOOK_DEPTH:-0} + 1 ))
if [[ "$AGENT_SENTRY_HOOK_DEPTH" -gt 1 ]]; then
  exit 0
fi

# --- 2. Reentrance detection: global lockfile with TTL ---
LOCKFILE="$GUARD_DIR/global.lock"
if [[ -f "$LOCKFILE" ]]; then
  lock_age=$(( $(date +%s) - $(stat -c %Y "$LOCKFILE" 2>/dev/null || echo 0) ))
  if [[ "$lock_age" -lt 2 ]]; then
    exit 0
  fi
fi
touch "$LOCKFILE" 2>/dev/null

# --- 3. Per-hook debounce ---
: "${HOOK_NAME:=unknown}"
: "${DEBOUNCE_SECONDS:=5}"
DEBOUNCE_FILE="$GUARD_DIR/debounce-${HOOK_NAME}"
if [[ -f "$DEBOUNCE_FILE" ]]; then
  debounce_age=$(( $(date +%s) - $(stat -c %Y "$DEBOUNCE_FILE" 2>/dev/null || echo 0) ))
  if [[ "$debounce_age" -lt "$DEBOUNCE_SECONDS" ]]; then
    exit 0
  fi
fi
touch "$DEBOUNCE_FILE" 2>/dev/null

# Guard passed — hook may proceed
