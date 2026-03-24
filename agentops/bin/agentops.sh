#!/usr/bin/env bash
# =============================================================================
# [AgentSentry] CLI Wrapper — agentops.sh
# =============================================================================
# Unified CLI entry point for AgentSentry.
#
# Subcommands:
#   check     — Quick session health check (git status, context, rules compliance)
#   audit     — Full project audit (security, rules, config, scaffold)
#   scaffold  — Create or refresh scaffold documents (PLANNING, TASKS, CONTEXT, WORKFLOW)
#   doctor    — Diagnose configuration issues and fix common problems
#   version   — Print AgentSentry version
#   help      — Show this help message
#
# Usage:
#   bash agentops/bin/agentops.sh <subcommand> [options]
#   ./agentops/bin/agentops.sh check
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTOPS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPTS_DIR="$AGENTOPS_ROOT/scripts"
CONFIG_FILE="$AGENTOPS_ROOT/agentops.config.json"
PREFIX="[AgentSentry]"
VERSION="4.0.0"

# Find repo root
if git rev-parse --is-inside-work-tree &>/dev/null; then
    REPO_ROOT=$(git rev-parse --show-toplevel)
else
    REPO_ROOT="$(pwd)"
fi

# ---------------------------------------------------------------------------
# Subcommand: check
# ---------------------------------------------------------------------------
cmd_check() {
    echo "$PREFIX Session Health Check (v$VERSION)"
    echo "═══════════════════════════════════════════════"
    echo ""

    # Git status
    if git rev-parse --is-inside-work-tree &>/dev/null; then
        local branch uncommitted last_commit_min
        branch=$(git branch --show-current 2>/dev/null || echo "detached")
        uncommitted=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
        local last_epoch now_epoch
        last_epoch=$(git log -1 --format=%ct 2>/dev/null || echo 0)
        now_epoch=$(date +%s)
        if [[ "$last_epoch" -eq 0 ]]; then
            last_commit_min="never"
        else
            last_commit_min="$(( (now_epoch - last_epoch) / 60 ))min ago"
        fi

        echo "  Git:"
        echo "    Branch:      $branch"
        echo "    Uncommitted: $uncommitted"
        echo "    Last commit: $last_commit_min"
    else
        echo "  Git: Not a git repository"
    fi
    echo ""

    # Config validation
    echo "  Config:"
    if [[ -f "$CONFIG_FILE" ]]; then
        if command -v jq &>/dev/null && jq empty "$CONFIG_FILE" 2>/dev/null; then
            echo "    agentops.config.json: valid JSON"
        else
            echo "    agentops.config.json: INVALID JSON"
        fi
    else
        echo "    agentops.config.json: MISSING"
    fi
    echo ""

    # Rules files
    echo "  Rules Files:"
    for file in CLAUDE.md AGENTS.md; do
        if [[ -f "$REPO_ROOT/$file" ]]; then
            local lines
            lines=$(wc -l < "$REPO_ROOT/$file" | tr -d ' ')
            echo "    $file: ${lines} lines"
        else
            echo "    $file: MISSING"
        fi
    done
    echo ""

    # Scaffold docs
    echo "  Scaffold Docs:"
    for doc in PLANNING.md TASKS.md CONTEXT.md WORKFLOW.md; do
        if [[ -f "$REPO_ROOT/$doc" ]]; then
            local mod_epoch now_epoch days_old
            mod_epoch=$(stat -f %m "$REPO_ROOT/$doc" 2>/dev/null || stat -c %Y "$REPO_ROOT/$doc" 2>/dev/null || echo 0)
            now_epoch=$(date +%s)
            days_old=$(( (now_epoch - mod_epoch) / 86400 ))
            echo "    $doc: present (${days_old}d old)"
        else
            echo "    $doc: MISSING"
        fi
    done
    echo ""

    # Hooks status
    echo "  Hooks:"
    local settings="$REPO_ROOT/.claude/settings.json"
    if [[ -f "$settings" ]]; then
        local hook_count
        hook_count=$(jq '[.hooks | to_entries[] | .value[] | .hooks[]?] | length' "$settings" 2>/dev/null || echo "?")
        echo "    settings.json: $hook_count hooks configured"
    else
        echo "    settings.json: NOT FOUND"
    fi
    echo ""
    echo "═══════════════════════════════════════════════"
}

# ---------------------------------------------------------------------------
# Subcommand: audit
# ---------------------------------------------------------------------------
cmd_audit() {
    echo "$PREFIX Full Project Audit (v$VERSION)"
    echo "═══════════════════════════════════════════════"
    echo ""

    local criticals=0 warnings=0 advisories=0 passes=0

    # 1. Config validation
    echo "  [1/6] Config Validation"
    if [[ -f "$CONFIG_FILE" ]]; then
        if command -v jq &>/dev/null && jq empty "$CONFIG_FILE" 2>/dev/null; then
            echo "    ✓ agentops.config.json is valid JSON"
            passes=$((passes + 1))
        else
            echo "    ✗ agentops.config.json is INVALID JSON"
            criticals=$((criticals + 1))
        fi

        # Check required keys
        for key in save_points context_health rules_file task_sizing security budget notifications; do
            if jq -e ".$key" "$CONFIG_FILE" &>/dev/null; then
                passes=$((passes + 1))
            else
                echo "    ▲ Missing config section: $key"
                warnings=$((warnings + 1))
            fi
        done
    else
        echo "    ✗ agentops.config.json not found"
        criticals=$((criticals + 1))
    fi
    echo ""

    # 2. Security scan
    echo "  [2/6] Security Scan"
    if [[ -x "$SCRIPTS_DIR/security-audit.sh" ]]; then
        bash "$SCRIPTS_DIR/security-audit.sh" 2>/dev/null | while IFS= read -r line; do
            echo "    $line"
        done || true
    else
        echo "    ○ security-audit.sh not found or not executable"
        advisories=$((advisories + 1))
    fi
    echo ""

    # 3. Rules file lint
    echo "  [3/6] Rules File Lint"
    if [[ -x "$SCRIPTS_DIR/rules-file-linter.sh" ]]; then
        bash "$SCRIPTS_DIR/rules-file-linter.sh" 2>/dev/null | while IFS= read -r line; do
            echo "    $line"
        done || true
    else
        echo "    ○ rules-file-linter.sh not found or not executable"
        advisories=$((advisories + 1))
    fi
    echo ""

    # 4. Git hooks check
    echo "  [4/6] Git Hooks"
    if [[ -d "$REPO_ROOT/.githooks" ]]; then
        for hook in pre-commit post-commit; do
            if [[ -f "$REPO_ROOT/.githooks/$hook" ]]; then
                echo "    ✓ .githooks/$hook present"
                passes=$((passes + 1))
            else
                echo "    ○ .githooks/$hook missing"
                advisories=$((advisories + 1))
            fi
        done
        # Check core.hooksPath
        local hooks_path
        hooks_path=$(git config core.hooksPath 2>/dev/null || echo "")
        if [[ "$hooks_path" == ".githooks" ]]; then
            echo "    ✓ core.hooksPath = .githooks"
            passes=$((passes + 1))
        else
            echo "    ▲ core.hooksPath not set to .githooks (current: '${hooks_path:-unset}')"
            warnings=$((warnings + 1))
        fi
    else
        echo "    ○ .githooks/ directory not found"
        advisories=$((advisories + 1))
    fi
    echo ""

    # 5. Dashboard data
    echo "  [5/6] Dashboard Data"
    local data_dir="$AGENTOPS_ROOT/dashboard/data"
    for file in session-log.json audit-results.json; do
        if [[ -f "$data_dir/$file" ]]; then
            local entries
            entries=$(wc -l < "$data_dir/$file" | tr -d ' ')
            echo "    ✓ $file ($entries entries)"
            passes=$((passes + 1))
        else
            echo "    ○ $file not found"
            advisories=$((advisories + 1))
        fi
    done
    echo ""

    # 6. Script inventory
    echo "  [6/6] Script Inventory"
    local script_count=0
    for script in "$SCRIPTS_DIR"/*.sh; do
        [[ -f "$script" ]] && script_count=$((script_count + 1))
    done
    echo "    ✓ $script_count scripts found in agentops/scripts/"
    passes=$((passes + 1))
    echo ""

    # Summary
    echo "═══════════════════════════════════════════════"
    echo "$PREFIX Audit Summary: $criticals critical, $warnings warnings, $advisories advisories, $passes passed"
}

# ---------------------------------------------------------------------------
# Subcommand: scaffold
# ---------------------------------------------------------------------------
cmd_scaffold() {
    echo "$PREFIX Scaffold Documents (v$VERSION)"
    echo "═══════════════════════════════════════════════"

    local created=0 updated=0

    for doc in PLANNING.md TASKS.md CONTEXT.md WORKFLOW.md; do
        local filepath="$REPO_ROOT/$doc"
        if [[ ! -f "$filepath" ]]; then
            # Create from template
            case "$doc" in
                PLANNING.md)
                    cat > "$filepath" << 'TMPL'
# Planning

## Current Sprint Goals
- [ ] TBD

## Architecture Decisions
- TBD

## Open Questions
- TBD

---
*Generated by AgentSentry scaffold*
TMPL
                    ;;
                TASKS.md)
                    cat > "$filepath" << 'TMPL'
# Tasks

## In Progress
- [ ] TBD

## Backlog
- [ ] TBD

## Done
- [x] Initial scaffold

---
*Generated by AgentSentry scaffold*
TMPL
                    ;;
                CONTEXT.md)
                    cat > "$filepath" << 'TMPL'
# Context

## Project State
- Repository: $(basename "$(pwd)")
- Branch: $(git branch --show-current 2>/dev/null || echo "N/A")

## Key Files
- TBD

## Recent Decisions
- TBD

---
*Generated by AgentSentry scaffold*
TMPL
                    ;;
                WORKFLOW.md)
                    cat > "$filepath" << 'TMPL'
# Workflow

## Development Flow
1. Create feature branch
2. Implement changes
3. Run tests
4. Commit with descriptive message
5. Create PR for review

## Conventions
- Commit messages: type(scope): description
- Branch naming: feature/, bugfix/, hotfix/

---
*Generated by AgentSentry scaffold*
TMPL
                    ;;
            esac
            echo "  ✓ Created $doc"
            created=$((created + 1))
        else
            echo "  ○ $doc already exists (skipped)"
        fi
    done

    echo ""
    echo "$PREFIX Created $created, skipped $((4 - created))"
}

# ---------------------------------------------------------------------------
# Subcommand: doctor
# ---------------------------------------------------------------------------
cmd_doctor() {
    echo "$PREFIX Doctor — Diagnose & Fix (v$VERSION)"
    echo "═══════════════════════════════════════════════"
    echo ""

    local fixed=0 issues=0

    # 1. Config file exists and is valid JSON
    if [[ ! -f "$CONFIG_FILE" ]]; then
        echo "  ✗ agentops.config.json missing — cannot auto-fix. Copy from template."
        issues=$((issues + 1))
    elif ! jq empty "$CONFIG_FILE" 2>/dev/null; then
        echo "  ✗ agentops.config.json is invalid JSON — manual fix required."
        issues=$((issues + 1))
    else
        echo "  ✓ agentops.config.json valid"
    fi

    # 2. Git hooks path
    local hooks_path
    hooks_path=$(git config core.hooksPath 2>/dev/null || echo "")
    if [[ -d "$REPO_ROOT/.githooks" && "$hooks_path" != ".githooks" ]]; then
        git config core.hooksPath .githooks 2>/dev/null || true
        echo "  ✓ Fixed: core.hooksPath set to .githooks"
        fixed=$((fixed + 1))
    elif [[ "$hooks_path" == ".githooks" ]]; then
        echo "  ✓ core.hooksPath already set"
    fi

    # 3. Script permissions
    local perm_fixed=0
    for script in "$SCRIPTS_DIR"/*.sh "$AGENTOPS_ROOT/bin"/*.sh; do
        [[ -f "$script" ]] || continue
        if [[ ! -x "$script" ]]; then
            chmod +x "$script"
            perm_fixed=$((perm_fixed + 1))
        fi
    done
    if [[ "$perm_fixed" -gt 0 ]]; then
        echo "  ✓ Fixed: Set +x on $perm_fixed scripts"
        fixed=$((fixed + 1))
    else
        echo "  ✓ All scripts executable"
    fi

    # 4. Dashboard data directory
    local data_dir="$AGENTOPS_ROOT/dashboard/data"
    if [[ ! -d "$data_dir" ]]; then
        mkdir -p "$data_dir"
        echo "  ✓ Fixed: Created dashboard/data/"
        fixed=$((fixed + 1))
    else
        echo "  ✓ dashboard/data/ exists"
    fi

    # 5. Temp directory
    local tmp_dir="${TMPDIR:-/tmp}/agentops"
    if [[ ! -d "$tmp_dir" ]]; then
        mkdir -p "$tmp_dir"
        echo "  ✓ Fixed: Created temp directory"
        fixed=$((fixed + 1))
    else
        echo "  ✓ Temp directory exists"
    fi

    echo ""
    echo "═══════════════════════════════════════════════"
    echo "$PREFIX Fixed $fixed issue(s), $issues remaining"
}

# ---------------------------------------------------------------------------
# Subcommand: cost
# ---------------------------------------------------------------------------
cmd_cost() {
    local cost_state="${TMPDIR:-/tmp}/agentops/cost-state"
    local cost_log="$AGENTOPS_ROOT/dashboard/data/cost-log.json"

    echo "$PREFIX Cost Summary (v$VERSION)"
    echo "═══════════════════════════════════════════════"

    if [[ -f "$cost_state" ]]; then
        local session_total session_calls last_model last_update
        if command -v jq &>/dev/null; then
            session_total=$(jq -r '.session_total // "0"' "$cost_state" 2>/dev/null)
            session_calls=$(jq -r '.session_calls // "0"' "$cost_state" 2>/dev/null)
            last_model=$(jq -r '.last_model // "unknown"' "$cost_state" 2>/dev/null)
            last_update=$(jq -r '.last_update // "unknown"' "$cost_state" 2>/dev/null)
        else
            session_total=$(grep -o '"session_total":"[^"]*"' "$cost_state" | head -1 | sed 's/.*:"//' | tr -d '"')
            session_calls=$(grep -o '"session_calls":"[^"]*"' "$cost_state" | head -1 | sed 's/.*:"//' | tr -d '"')
            last_model="unknown"
            last_update="unknown"
        fi

        # Load budget from config
        local session_budget="10"
        if command -v jq &>/dev/null && [[ -f "$CONFIG_FILE" ]]; then
            session_budget=$(jq -r '.budget.session_budget // 10' "$CONFIG_FILE" 2>/dev/null)
        fi

        echo "  Session total:  \$$session_total / \$$session_budget"
        echo "  API calls:      $session_calls"
        echo "  Last model:     $last_model"
        echo "  Last updated:   $last_update"
    else
        echo "  No cost data yet — cost tracking starts on first tool use."
    fi

    # Monthly total
    local month_key monthly_file
    month_key="$(date +"%Y-%m")"
    monthly_file="${TMPDIR:-/tmp}/agentops/cost-monthly-$month_key"
    if [[ -f "$monthly_file" ]]; then
        local monthly_budget="500"
        if command -v jq &>/dev/null && [[ -f "$CONFIG_FILE" ]]; then
            monthly_budget=$(jq -r '.budget.monthly_budget // 500' "$CONFIG_FILE" 2>/dev/null)
        fi
        echo "  Monthly total:  \$$(cat "$monthly_file") / \$$monthly_budget ($month_key)"
    fi

    # Log file stats
    if [[ -f "$cost_log" ]]; then
        local log_lines
        log_lines=$(wc -l < "$cost_log" | tr -d ' ')
        echo "  Log entries:    $log_lines (in $cost_log)"
    fi
    echo ""
}

# ---------------------------------------------------------------------------
# Subcommand: lifecycle
# ---------------------------------------------------------------------------
cmd_lifecycle() {
    local action="${1:-list}"
    shift 2>/dev/null || true

    case "$action" in
        list|status|start|pause|complete|fail|cancel)
            bash "$SCRIPTS_DIR/lifecycle-manager.sh" "$action" "$@"
            ;;
        *)
            echo "$PREFIX Usage: agentops.sh lifecycle {list|status|start|pause|complete|fail|cancel} [agent-id]"
            exit 1
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Subcommand: plugin
# ---------------------------------------------------------------------------
cmd_plugin() {
    local action="${1:-list}"
    shift 2>/dev/null || true

    case "$action" in
        list|validate|run)
            bash "$AGENTOPS_ROOT/plugins/plugin-loader.sh" "$action" "$@"
            ;;
        *)
            echo "$PREFIX Usage: agentops.sh plugin {list|validate|run} [args...]"
            exit 1
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Subcommand: version
# ---------------------------------------------------------------------------
cmd_version() {
    echo "AgentSentry v$VERSION"
}

# ---------------------------------------------------------------------------
# Subcommand: help
# ---------------------------------------------------------------------------
cmd_help() {
    echo "AgentSentry CLI v$VERSION"
    echo ""
    echo "Usage: bash agentops/bin/agentops.sh <command>"
    echo ""
    echo "Commands:"
    echo "  check      Quick session health check"
    echo "  audit      Full project audit"
    echo "  scaffold   Create or refresh scaffold documents"
    echo "  doctor     Diagnose and fix configuration issues"
    echo "  cost       Show cost tracking summary"
    echo "  lifecycle  Manage agent lifecycle states"
    echo "  plugin     Manage plugins (list/validate/run)"
    echo "  version    Print version"
    echo "  help       Show this help message"
}

# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------
SUBCOMMAND="${1:-help}"

shift || true

case "$SUBCOMMAND" in
    check)     cmd_check ;;
    audit)     cmd_audit ;;
    scaffold)  cmd_scaffold ;;
    doctor)    cmd_doctor ;;
    cost)      cmd_cost ;;
    lifecycle) cmd_lifecycle "$@" ;;
    plugin)    cmd_plugin "$@" ;;
    version)   cmd_version ;;
    help|--help|-h) cmd_help ;;
    *)
        echo "$PREFIX Unknown command: $SUBCOMMAND"
        echo ""
        cmd_help
        exit 1
        ;;
esac
