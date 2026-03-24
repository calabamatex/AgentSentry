#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# plugin-loader.sh — AgentSentry Plugin Architecture (§21.2)
#
# Discovers, validates, and executes plugins located in the community/
# directory. Each plugin lives in its own subdirectory and exposes a
# manifest.json that declares hooks, version, and configuration schema.
#
# Usage:
#   plugin-loader.sh list
#   plugin-loader.sh validate
#   plugin-loader.sh run <plugin-name> <hook-event>
###############################################################################

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/community" && pwd)"
PREFIX="[AgentSentry]"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log()  { echo "$PREFIX $*"; }
warn() { echo "$PREFIX [WARN] $*" >&2; }
err()  { echo "$PREFIX [ERROR] $*" >&2; }
die()  { err "$@"; exit 1; }

# Require jq for JSON handling
command -v jq >/dev/null 2>&1 || die "jq is required but not installed."

# ---------------------------------------------------------------------------
# Manifest helpers
# ---------------------------------------------------------------------------

# Return the path to a plugin's manifest given its directory name.
manifest_path() {
  echo "$PLUGIN_DIR/$1/manifest.json"
}

# Validate that a single manifest has the required top-level fields and
# that the hooks object (if present) contains well-formed entries.
# Returns 0 on success, 1 on failure (with messages to stderr).
validate_manifest() {
  local plugin_name="$1"
  local manifest
  manifest="$(manifest_path "$plugin_name")"

  if [[ ! -f "$manifest" ]]; then
    err "Plugin '$plugin_name': manifest.json not found at $manifest"
    return 1
  fi

  # Must be valid JSON
  if ! jq empty "$manifest" 2>/dev/null; then
    err "Plugin '$plugin_name': manifest.json is not valid JSON"
    return 1
  fi

  # Required top-level keys: name, version
  local name version
  name="$(jq -r '.name // empty' "$manifest")"
  version="$(jq -r '.version // empty' "$manifest")"

  if [[ -z "$name" ]]; then
    err "Plugin '$plugin_name': missing required field 'name'"
    return 1
  fi
  if [[ -z "$version" ]]; then
    err "Plugin '$plugin_name': missing required field 'version'"
    return 1
  fi

  # If hooks are declared, each hook must have a matcher field
  local hook_count
  hook_count="$(jq '.hooks | length // 0' "$manifest" 2>/dev/null || echo 0)"
  if (( hook_count > 0 )); then
    local invalid_hooks
    invalid_hooks="$(jq -r '
      .hooks | to_entries[]
      | select(.value.matcher == null or .value.matcher == "")
      | .key
    ' "$manifest" 2>/dev/null)"

    if [[ -n "$invalid_hooks" ]]; then
      err "Plugin '$plugin_name': hooks missing 'matcher' — $invalid_hooks"
      return 1
    fi
  fi

  return 0
}

# Collect all plugin directory names (one level under community/).
discover_plugins() {
  if [[ ! -d "$PLUGIN_DIR" ]]; then
    return
  fi
  for dir in "$PLUGIN_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    basename "$dir"
  done
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

cmd_list() {
  local plugins
  plugins="$(discover_plugins)"

  if [[ -z "$plugins" ]]; then
    log "No plugins found in $PLUGIN_DIR"
    return 0
  fi

  log "Installed plugins:"
  log "-----------------------------------------------------------"
  printf "%-25s %-10s %s\n" "NAME" "VERSION" "HOOKS"
  log "-----------------------------------------------------------"

  while IFS= read -r plugin; do
    local manifest
    manifest="$(manifest_path "$plugin")"
    if [[ ! -f "$manifest" ]]; then
      printf "%-25s %-10s %s\n" "$plugin" "???" "(no manifest)"
      continue
    fi

    local name version hooks
    name="$(jq -r '.name // "unknown"' "$manifest")"
    version="$(jq -r '.version // "0.0.0"' "$manifest")"
    hooks="$(jq -r '[.hooks // {} | keys[]] | join(", ")' "$manifest")"
    [[ -z "$hooks" ]] && hooks="(none)"

    printf "%-25s %-10s %s\n" "$name" "$version" "$hooks"
  done <<< "$plugins"
}

cmd_validate() {
  local plugins
  plugins="$(discover_plugins)"

  if [[ -z "$plugins" ]]; then
    log "No plugins to validate."
    return 0
  fi

  local failures=0
  while IFS= read -r plugin; do
    if validate_manifest "$plugin"; then
      log "Plugin '$plugin': OK"
    else
      (( failures++ )) || true
    fi
  done <<< "$plugins"

  log "-----------------------------------------------------------"
  if (( failures > 0 )); then
    die "Validation complete — $failures plugin(s) failed."
  else
    log "All plugins validated successfully."
  fi
}

cmd_run() {
  local plugin_name="${1:-}"
  local hook_event="${2:-}"

  [[ -z "$plugin_name" ]] && die "Usage: plugin-loader.sh run <plugin-name> <hook-event>"
  [[ -z "$hook_event" ]] && die "Usage: plugin-loader.sh run <plugin-name> <hook-event>"

  local manifest
  manifest="$(manifest_path "$plugin_name")"

  [[ -f "$manifest" ]] || die "Plugin '$plugin_name' not found."

  # Validate first
  validate_manifest "$plugin_name" || die "Plugin '$plugin_name' has an invalid manifest."

  # Check if the hook is declared
  local hook_exists
  hook_exists="$(jq -r --arg h "$hook_event" '.hooks[$h] // empty' "$manifest")"

  if [[ -z "$hook_exists" ]]; then
    die "Plugin '$plugin_name' does not declare hook '$hook_event'."
  fi

  # Determine the handler script. Convention:
  #   community/<plugin>/hooks/<hook-event>.sh
  local handler="$PLUGIN_DIR/$plugin_name/hooks/${hook_event}.sh"

  if [[ ! -f "$handler" ]]; then
    die "Handler script not found: $handler"
  fi

  if [[ ! -x "$handler" ]]; then
    warn "Handler '$handler' is not executable — attempting chmod."
    chmod +x "$handler"
  fi

  log "Running hook '$hook_event' for plugin '$plugin_name'..."
  "$handler"
  log "Hook '$hook_event' completed for plugin '$plugin_name'."
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

main() {
  local subcommand="${1:-}"
  shift || true

  case "$subcommand" in
    list)     cmd_list ;;
    validate) cmd_validate ;;
    run)      cmd_run "$@" ;;
    ""|help|-h|--help)
      log "Usage: plugin-loader.sh <list|validate|run> [args...]"
      log ""
      log "Subcommands:"
      log "  list                          List all installed plugins"
      log "  validate                      Validate all plugin manifests"
      log "  run <plugin-name> <hook-event> Execute a plugin hook handler"
      ;;
    *)
      die "Unknown subcommand: $subcommand (try 'list', 'validate', or 'run')"
      ;;
  esac
}

main "$@"
