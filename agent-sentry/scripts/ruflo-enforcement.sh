#!/usr/bin/env bash
# =============================================================================
# [AgentSentry] RuFlo Enforcement Hook
# =============================================================================
# Pre-task hook that warns when multi-agent work is detected without
# RuFlo swarm initialization. Runs on every UserPromptSubmit.
#
# Detection: Checks if the user prompt contains multi-agent keywords
# (spawn, agent, swarm, parallel, milestone, phase) and verifies
# that a RuFlo swarm session exists for the current session.
#
# Exit codes:
#   0 — always (advisory only, never blocks)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Global kill switch
if command -v jq &>/dev/null; then
    _ENABLED=$(jq -r '.enabled // true' "$SCRIPT_DIR/../agent-sentry.config.json" 2>/dev/null || echo "true")
    if [[ "$_ENABLED" == "false" ]]; then exit 0; fi
fi
PREFIX="[RuFlo]"
STATE_DIR="${SCRIPT_DIR}/../.ruflo-state"
SESSION_FILE="${STATE_DIR}/swarm-session"

# Read stdin (hook payload) if available
INPUT=""
if [ ! -t 0 ]; then
  INPUT=$(cat 2>/dev/null || true)
fi

# Extract user prompt from hook payload
PROMPT=""
if command -v node &>/dev/null && [ -n "$INPUT" ]; then
  PROMPT=$(node -e "
    try {
      const d = JSON.parse(process.argv[1] || '{}');
      console.log((d.prompt || d.content || '').toLowerCase());
    } catch { console.log(''); }
  " "$INPUT" 2>/dev/null || true)
fi

# Multi-agent keywords that suggest RuFlo coordination is needed
MULTI_AGENT_PATTERN="(spawn|swarm|parallel|milestone|phase|proceed with m[0-9]|ruflo|orchestrat|multi.?agent|launch.*agent)"

if echo "$PROMPT" | grep -qiE "$MULTI_AGENT_PATTERN"; then
  # Check if a swarm session exists
  if [ -f "$SESSION_FILE" ]; then
    SESSION_AGE=$(( $(date +%s) - $(stat -f %m "$SESSION_FILE" 2>/dev/null || stat -c %Y "$SESSION_FILE" 2>/dev/null || echo 0) ))
    if [ "$SESSION_AGE" -lt 3600 ]; then
      # Active session exists (less than 1 hour old)
      echo "$PREFIX Swarm session active. Coordination layer ready."
      exit 0
    fi
  fi

  # No active session — warn
  echo "$PREFIX WARN: Multi-agent task detected but no active RuFlo swarm session."
  echo "$PREFIX Required before spawning agents:"
  echo "$PREFIX   1. mcp__claude-flow__swarm_init (hierarchical topology)"
  echo "$PREFIX   2. mcp__claude-flow__memory_store (task context)"
  echo "$PREFIX   3. mcp__claude-flow__task_orchestrate (decomposition)"
  echo "$PREFIX See CLAUDE.md 'RuFlo Orchestration (MANDATORY)' section."
fi

exit 0
