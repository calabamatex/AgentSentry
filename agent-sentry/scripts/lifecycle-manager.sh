#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# §16 — Agent Lifecycle Manager
# Manages agent state transitions and emits NDJSON lifecycle events.
#
# Usage:
#   lifecycle-manager.sh start    <agent-id>
#   lifecycle-manager.sh pause    <agent-id>
#   lifecycle-manager.sh complete <agent-id>
#   lifecycle-manager.sh fail     <agent-id>
#   lifecycle-manager.sh cancel   <agent-id>
#   lifecycle-manager.sh status   <agent-id>
#   lifecycle-manager.sh list
###############################################################################

PREFIX="[AgentSentry]"
LIFECYCLE_DIR="${TMPDIR:-/tmp}/agent-sentry/lifecycle"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVENT_LOG="${TMPDIR:-/tmp}/agent-sentry/lifecycle.ndjson"

# Valid states
readonly STATE_CREATED="CREATED"
readonly STATE_ACTIVE="ACTIVE"
readonly STATE_AWAITING="AWAITING"
readonly STATE_COMPLETED="COMPLETED"
readonly STATE_FAILED="FAILED"
readonly STATE_CANCELLED="CANCELLED"

###############################################################################
# Helpers
###############################################################################

log() {
  echo "${PREFIX} $*" >&2
}

ensure_dirs() {
  mkdir -p "${LIFECYCLE_DIR}"
  mkdir -p "$(dirname "${EVENT_LOG}")"
}

now_iso() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

state_file() {
  echo "${LIFECYCLE_DIR}/${1}.state"
}

read_state() {
  local file
  file="$(state_file "$1")"
  if [[ -f "${file}" ]]; then
    cat "${file}"
  else
    echo ""
  fi
}

write_state() {
  local agent_id="$1" state="$2"
  echo "${state}" > "$(state_file "${agent_id}")"
}

emit_event() {
  local agent_id="$1" from_state="$2" to_state="$3" ts="$4"
  local json
  json=$(printf '{"agent_id":"%s","from":"%s","to":"%s","timestamp":"%s"}' \
    "${agent_id}" "${from_state}" "${to_state}" "${ts}")
  echo "${json}" >> "${EVENT_LOG}"
}

validate_agent_id() {
  if [[ -z "${1:-}" ]]; then
    log "ERROR: agent-id is required"
    exit 1
  fi
}

###############################################################################
# Subcommands
###############################################################################

cmd_start() {
  local agent_id="$1"
  local ts
  ts="$(now_iso)"
  local current
  current="$(read_state "${agent_id}")"

  if [[ -z "${current}" ]]; then
    # New agent — transition CREATED -> ACTIVE
    write_state "${agent_id}" "${STATE_ACTIVE}"
    emit_event "${agent_id}" "${STATE_CREATED}" "${STATE_ACTIVE}" "${ts}"
    log "Agent ${agent_id} started (CREATED -> ACTIVE) at ${ts}"
  elif [[ "${current}" == "${STATE_AWAITING}" ]]; then
    # Resume from AWAITING -> ACTIVE
    write_state "${agent_id}" "${STATE_ACTIVE}"
    emit_event "${agent_id}" "${STATE_AWAITING}" "${STATE_ACTIVE}" "${ts}"
    log "Agent ${agent_id} resumed (AWAITING -> ACTIVE) at ${ts}"
  else
    log "ERROR: Cannot start agent ${agent_id} in state ${current}"
    exit 1
  fi
}

cmd_pause() {
  local agent_id="$1"
  local ts
  ts="$(now_iso)"
  local current
  current="$(read_state "${agent_id}")"

  if [[ "${current}" != "${STATE_ACTIVE}" ]]; then
    log "ERROR: Cannot pause agent ${agent_id} in state ${current:-UNKNOWN}"
    exit 1
  fi

  write_state "${agent_id}" "${STATE_AWAITING}"
  emit_event "${agent_id}" "${STATE_ACTIVE}" "${STATE_AWAITING}" "${ts}"
  log "Agent ${agent_id} paused (ACTIVE -> AWAITING) at ${ts}"
}

cmd_complete() {
  local agent_id="$1"
  local ts
  ts="$(now_iso)"
  local current
  current="$(read_state "${agent_id}")"

  if [[ "${current}" != "${STATE_ACTIVE}" ]]; then
    log "ERROR: Cannot complete agent ${agent_id} in state ${current:-UNKNOWN}"
    exit 1
  fi

  write_state "${agent_id}" "${STATE_COMPLETED}"
  emit_event "${agent_id}" "${STATE_ACTIVE}" "${STATE_COMPLETED}" "${ts}"
  log "Agent ${agent_id} completed (ACTIVE -> COMPLETED) at ${ts}"
}

cmd_fail() {
  local agent_id="$1"
  local ts
  ts="$(now_iso)"
  local current
  current="$(read_state "${agent_id}")"

  if [[ -z "${current}" || "${current}" == "${STATE_COMPLETED}" || "${current}" == "${STATE_CANCELLED}" ]]; then
    log "ERROR: Cannot fail agent ${agent_id} in state ${current:-UNKNOWN}"
    exit 1
  fi

  write_state "${agent_id}" "${STATE_FAILED}"
  emit_event "${agent_id}" "${current}" "${STATE_FAILED}" "${ts}"
  log "Agent ${agent_id} failed (${current} -> FAILED) at ${ts}"
}

cmd_cancel() {
  local agent_id="$1"
  local ts
  ts="$(now_iso)"
  local current
  current="$(read_state "${agent_id}")"

  if [[ -z "${current}" || "${current}" == "${STATE_COMPLETED}" || "${current}" == "${STATE_FAILED}" ]]; then
    log "ERROR: Cannot cancel agent ${agent_id} in state ${current:-UNKNOWN}"
    exit 1
  fi

  write_state "${agent_id}" "${STATE_CANCELLED}"
  emit_event "${agent_id}" "${current}" "${STATE_CANCELLED}" "${ts}"
  log "Agent ${agent_id} cancelled (${current} -> CANCELLED) at ${ts}"
}

cmd_status() {
  local agent_id="$1"
  local current
  current="$(read_state "${agent_id}")"

  if [[ -z "${current}" ]]; then
    log "Agent ${agent_id} not found"
    exit 1
  fi

  echo "${current}"
}

cmd_list() {
  if [[ ! -d "${LIFECYCLE_DIR}" ]] || [ -z "$(ls -A "${LIFECYCLE_DIR}" 2>/dev/null)" ]; then
    log "No agents found"
    return 0
  fi

  printf "%-30s %s\n" "AGENT-ID" "STATE"
  printf "%-30s %s\n" "--------" "-----"
  for f in "${LIFECYCLE_DIR}"/*.state; do
    [[ -f "${f}" ]] || continue
    local agent_id state
    agent_id="$(basename "${f}" .state)"
    state="$(cat "${f}")"
    printf "%-30s %s\n" "${agent_id}" "${state}"
  done
}

###############################################################################
# Main dispatch
###############################################################################

main() {
  ensure_dirs

  local subcommand="${1:-}"
  shift || true

  case "${subcommand}" in
    start)
      validate_agent_id "${1:-}"
      cmd_start "$1"
      ;;
    pause)
      validate_agent_id "${1:-}"
      cmd_pause "$1"
      ;;
    complete)
      validate_agent_id "${1:-}"
      cmd_complete "$1"
      ;;
    fail)
      validate_agent_id "${1:-}"
      cmd_fail "$1"
      ;;
    cancel)
      validate_agent_id "${1:-}"
      cmd_cancel "$1"
      ;;
    status)
      validate_agent_id "${1:-}"
      cmd_status "$1"
      ;;
    list)
      cmd_list
      ;;
    *)
      log "Usage: $(basename "$0") {start|pause|complete|fail|cancel|status|list} [agent-id]"
      exit 1
      ;;
  esac
}

main "$@"
