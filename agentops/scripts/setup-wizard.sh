#!/usr/bin/env bash
#
# AgentOps Setup Wizard — Progressive Enablement
#
# Interactive setup to choose an enablement level and write the
# configuration into agentops.config.json.
#
# Usage:
#   ./setup-wizard.sh                  # Interactive mode
#   ./setup-wizard.sh --level 3        # Non-interactive, set level 3
#   ./setup-wizard.sh --level 3 --dry-run  # Show config without writing
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../agentops.config.json"

# Defaults
LEVEL=""
DRY_RUN=false

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --level)
      LEVEL="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      echo "Usage: setup-wizard.sh [--level N] [--dry-run]"
      echo ""
      echo "  --level N    Set enablement level (1-5) non-interactively"
      echo "  --dry-run    Print config that would be written, without modifying files"
      echo "  -h, --help   Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
show_banner() {
  echo ""
  echo "============================================="
  echo "  AgentOps v4.0 — Progressive Enablement"
  echo "  Setup Wizard"
  echo "============================================="
  echo ""
}

# ---------------------------------------------------------------------------
# Level descriptions
# ---------------------------------------------------------------------------
show_levels() {
  echo "Enablement Levels:"
  echo ""
  echo "  1) Safe Ground    (~5 min)   — Save Points only"
  echo "  2) Clear Head     (~7 min)   — + Context Health"
  echo "  3) House Rules    (~9 min)   — + Standing Orders (basic)"
  echo "  4) Right Size     (~12 min)  — + Small Bets, Standing Orders (full)"
  echo "  5) Full Guard     (~15 min)  — All skills at full power"
  echo ""
}

estimate_time() {
  local lvl="$1"
  case "$lvl" in
    1) echo "~5 min" ;;
    2) echo "~7 min" ;;
    3) echo "~9 min" ;;
    4) echo "~12 min" ;;
    5) echo "~15 min" ;;
  esac
}

# ---------------------------------------------------------------------------
# Generate enablement JSON for a level
# ---------------------------------------------------------------------------
generate_enablement_json() {
  local lvl="$1"

  # Defaults: everything off
  local sp_enabled="false" sp_mode="off"
  local ch_enabled="false" ch_mode="off"
  local so_enabled="false" so_mode="off"
  local sb_enabled="false" sb_mode="off"
  local ps_enabled="false" ps_mode="off"

  if [[ "$lvl" -ge 1 ]]; then
    sp_enabled="true"; sp_mode="full"
  fi
  if [[ "$lvl" -ge 2 ]]; then
    ch_enabled="true"; ch_mode="full"
  fi
  if [[ "$lvl" -ge 3 ]]; then
    so_enabled="true"; so_mode="basic"
  fi
  if [[ "$lvl" -ge 4 ]]; then
    so_mode="full"
    sb_enabled="true"; sb_mode="basic"
  fi
  if [[ "$lvl" -ge 5 ]]; then
    sb_mode="full"
    ps_enabled="true"; ps_mode="full"
  fi

  cat <<ENDJSON
{
    "level": ${lvl},
    "skills": {
      "save_points": { "enabled": ${sp_enabled}, "mode": "${sp_mode}" },
      "context_health": { "enabled": ${ch_enabled}, "mode": "${ch_mode}" },
      "standing_orders": { "enabled": ${so_enabled}, "mode": "${so_mode}" },
      "small_bets": { "enabled": ${sb_enabled}, "mode": "${sb_mode}" },
      "proactive_safety": { "enabled": ${ps_enabled}, "mode": "${ps_mode}" }
    }
  }
ENDJSON
}

# ---------------------------------------------------------------------------
# Report active skills
# ---------------------------------------------------------------------------
report_skills() {
  local lvl="$1"
  echo ""
  echo "Active skills at Level ${lvl} ($(estimate_time "$lvl") estimated setup):"
  echo ""

  [[ "$lvl" -ge 1 ]] && echo "  [x] Save Points (full)"
  [[ "$lvl" -lt 1 ]] && echo "  [ ] Save Points"

  [[ "$lvl" -ge 2 ]] && echo "  [x] Context Health (full)"
  [[ "$lvl" -lt 2 ]] && echo "  [ ] Context Health"

  if [[ "$lvl" -ge 4 ]]; then
    echo "  [x] Standing Orders (full)"
  elif [[ "$lvl" -ge 3 ]]; then
    echo "  [x] Standing Orders (basic)"
  else
    echo "  [ ] Standing Orders"
  fi

  if [[ "$lvl" -ge 5 ]]; then
    echo "  [x] Small Bets (full)"
  elif [[ "$lvl" -ge 4 ]]; then
    echo "  [x] Small Bets (basic)"
  else
    echo "  [ ] Small Bets"
  fi

  [[ "$lvl" -ge 5 ]] && echo "  [x] Proactive Safety (full)"
  [[ "$lvl" -lt 5 ]] && echo "  [ ] Proactive Safety"

  echo ""
}

# ---------------------------------------------------------------------------
# Merge enablement into config file
# ---------------------------------------------------------------------------
write_config() {
  local enablement_json="$1"

  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "{ \"enablement\": ${enablement_json} }" > "$CONFIG_FILE"
    return
  fi

  # Check if jq is available for clean merging
  if command -v jq &>/dev/null; then
    local tmp
    tmp=$(mktemp)
    jq --argjson e "$enablement_json" '.enablement = $e' "$CONFIG_FILE" > "$tmp"
    mv "$tmp" "$CONFIG_FILE"
  else
    # Fallback: use node to merge JSON
    if command -v node &>/dev/null; then
      node -e "
        const fs = require('fs');
        const cfg = JSON.parse(fs.readFileSync('${CONFIG_FILE}', 'utf8'));
        cfg.enablement = ${enablement_json};
        fs.writeFileSync('${CONFIG_FILE}', JSON.stringify(cfg, null, 2) + '\n');
      "
    else
      echo "ERROR: Neither jq nor node is available. Cannot merge config." >&2
      exit 1
    fi
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  show_banner

  # Interactive prompt if --level was not provided
  if [[ -z "$LEVEL" ]]; then
    show_levels
    printf "What enablement level? (1-5): "
    read -r LEVEL
  fi

  # Validate
  if ! [[ "$LEVEL" =~ ^[1-5]$ ]]; then
    echo "ERROR: Level must be between 1 and 5, got '${LEVEL}'" >&2
    exit 1
  fi

  local enablement_json
  enablement_json="$(generate_enablement_json "$LEVEL")"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY RUN] Would write the following enablement config:"
    echo ""
    echo "$enablement_json"
    report_skills "$LEVEL"
    echo "(No files were modified)"
  else
    write_config "$enablement_json"
    echo "Enablement config written to: ${CONFIG_FILE}"
    report_skills "$LEVEL"
    echo "Setup complete. Run 'npm test' to verify."
  fi
}

main
