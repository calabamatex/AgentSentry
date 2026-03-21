#!/usr/bin/env bash
# =============================================================================
# [AgentOps] Permission Enforcer - PreToolUse Hook (Section 14)
# =============================================================================
# Implements Agent Identity and Permissions (section 14).
#
# Reads agent permission definitions from YAML frontmatter in .claude/agents/
# files and enforces tool-level, file-level, and bash command-level access
# control per agent identity.
#
# Permission schema (YAML frontmatter in .claude/agents/<agent-id>.md):
#   ---
#   agent_id: builder
#   permissions:
#     files:
#       read:  ["src/**", "docs/**"]
#       write: ["src/**"]
#       deny:  [".env", "secrets/**"]
#     tools:
#       allow: ["Read", "Edit", "Write", "Grep", "Glob"]
#       deny:  ["Bash"]
#     bash:
#       allow: ["npm test", "npm run *"]
#       deny:  ["rm -rf *", "curl *"]
#   ---
#
# Protocol:  Reads JSON from stdin per the Claude Code hook contract.
# Exit 0:    Permission granted — allow the tool to proceed.
# Exit 2:    Permission denied — BLOCK the tool use with diagnostic message.
#
# If no agent identity is found (direct user session): allow everything.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Dependency checks — fail loudly, not silently
# ---------------------------------------------------------------------------
if ! command -v jq &>/dev/null; then
    echo "[AgentOps] CRITICAL: 'jq' is required but not found. Install with: brew install jq (macOS) or apt install jq (Linux)" >&2
    exit 0
fi
if ! command -v node &>/dev/null; then
    echo "[AgentOps] CRITICAL: 'node' is required but not found. AgentOps is a Node.js package." >&2
    exit 0
fi

PREFIX="[AgentOps]"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENTS_DIR="$REPO_ROOT/.claude/agents"
LOG_FILE="$REPO_ROOT/agentops/dashboard/data/permission-log.json"
CONFIG_FILE="$SCRIPT_DIR/../agentops.config.json"
PERMISSION_FAIL_MODE=$(jq -r '.security.permission_fail_mode // "block"' "$CONFIG_FILE" 2>/dev/null || echo "block")

# ---------------------------------------------------------------------------
# 1. Read hook input from stdin (Claude Code hook protocol)
# ---------------------------------------------------------------------------
INPUT="$(cat)"

TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)"
FILE_PATH="$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
COMMAND="$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"

if [[ -z "$TOOL_NAME" ]]; then
    exit 0
fi

# ---------------------------------------------------------------------------
# 2. Detect agent identity
# ---------------------------------------------------------------------------
# Agent identity can be set via:
#   - CLAUDE_AGENT_ID environment variable
#   - CLAUDE_AGENT_FILE environment variable (path to the agent .md file)
# If neither is set, this is a direct user session — allow everything.
# ---------------------------------------------------------------------------
AGENT_ID="${CLAUDE_AGENT_ID:-}"
AGENT_FILE="${CLAUDE_AGENT_FILE:-}"

# Try to resolve agent file from ID
if [[ -z "$AGENT_FILE" && -n "$AGENT_ID" && -d "$AGENTS_DIR" ]]; then
    for candidate in "$AGENTS_DIR"/*.md; do
        [[ -f "$candidate" ]] || continue
        candidate_id="$(sed -n '/^---$/,/^---$/{ /^agent_id:/{ s/^agent_id:[[:space:]]*//; s/[[:space:]]*$//; p; } }' "$candidate" 2>/dev/null || true)"
        if [[ "$candidate_id" == "$AGENT_ID" ]]; then
            AGENT_FILE="$candidate"
            break
        fi
    done
fi

# Try to extract agent_id from the file if we only have the file
if [[ -n "$AGENT_FILE" && -z "$AGENT_ID" && -f "$AGENT_FILE" ]]; then
    AGENT_ID="$(sed -n '/^---$/,/^---$/{ /^agent_id:/{ s/^agent_id:[[:space:]]*//; s/[[:space:]]*$//; p; } }' "$AGENT_FILE" 2>/dev/null || true)"
fi

# ---------------------------------------------------------------------------
# 3. If no agent identity, allow everything (direct user session)
# ---------------------------------------------------------------------------
if [[ -z "$AGENT_ID" && -z "$AGENT_FILE" ]]; then
    exit 0
fi

if [[ -n "$AGENT_FILE" && ! -f "$AGENT_FILE" ]]; then
    echo "$PREFIX Warning: Agent file $AGENT_FILE not found, allowing by default."
    exit 0
fi

# ---------------------------------------------------------------------------
# 4. Extract YAML frontmatter permissions using Python
# ---------------------------------------------------------------------------
# We use Python to parse YAML frontmatter reliably. Falls back to allow-all
# if parsing fails (fail-open for agent definitions without permissions block).
# ---------------------------------------------------------------------------
PERMISSIONS_JSON="$(AGENT_FILE="$AGENT_FILE" node -e '
const fs = require("fs");
const path = require("path");

const agentFile = process.env.AGENT_FILE || "";
if (!agentFile || !fs.existsSync(agentFile)) {
  console.log(JSON.stringify({_empty: true}));
  process.exit(0);
}

const content = fs.readFileSync(agentFile, "utf-8");
const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
if (!fmMatch) {
  console.log(JSON.stringify({_empty: true}));
  process.exit(0);
}

const frontmatter = fmMatch[1];
const perms = {};
let currentSection = null;
let currentKey = null;

for (const line of frontmatter.split("\n")) {
  const stripped = line.trim();
  if (!stripped || stripped.startsWith("#")) continue;
  if (stripped === "permissions:") continue;

  const indent = line.length - line.trimStart().length;

  if ([2,4].includes(indent) && stripped.endsWith(":") && ["files","tools","bash"].includes(stripped.slice(0,-1))) {
    currentSection = stripped.slice(0,-1);
    if (!perms[currentSection]) perms[currentSection] = {};
    currentKey = null;
    continue;
  }

  if ([4,6,8].includes(indent) && currentSection) {
    const km = stripped.match(/^(read|write|deny|allow):\s*(.*)/);
    if (km) {
      currentKey = km[1];
      const rest = km[2].trim();
      if (!perms[currentSection]) perms[currentSection] = {};
      if (!perms[currentSection][currentKey]) perms[currentSection][currentKey] = [];
      if (rest.startsWith("[")) {
        const items = [...rest.matchAll(/"([^"]*)"/g)].map(m => m[1]);
        if (items.length === 0) {
          const sq = [...rest.matchAll(/\x27([^\x27]*)\x27/g)].map(m => m[1]);
          perms[currentSection][currentKey].push(...sq);
        } else {
          perms[currentSection][currentKey].push(...items);
        }
      } else if (rest && rest !== "[]") {
        perms[currentSection][currentKey].push(rest);
      }
      continue;
    }
  }

  if (currentSection && currentKey && stripped.startsWith("- ")) {
    const item = stripped.slice(2).trim().replace(/^["\x27]|["\x27]$/g, "");
    if (!perms[currentSection]) perms[currentSection] = {};
    if (!perms[currentSection][currentKey]) perms[currentSection][currentKey] = [];
    perms[currentSection][currentKey].push(item);
  }
}

console.log(JSON.stringify(Object.keys(perms).length ? perms : {_empty: true}));
' 2>/dev/null)" || echo '{"_empty":true}'

# ---------------------------------------------------------------------------
# 5. Logging helper (defined before first use)
# ---------------------------------------------------------------------------
log_decision() {
    local decision="$1"
    local agent="$2"
    local tool="$3"
    local target="$4"
    local reason="${5:-}"
    local timestamp
    timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

    # Ensure log directory exists
    mkdir -p "$(dirname "$LOG_FILE")"

    # Append NDJSON line
    jq -n -c \
        --arg ts "$timestamp" \
        --arg decision "$decision" \
        --arg agent "$agent" \
        --arg tool "$tool" \
        --arg target "$target" \
        --arg reason "$reason" \
        '{timestamp:$ts, decision:$decision, agent_id:$agent, tool:$tool, target:$target, reason:$reason}' \
        >> "$LOG_FILE" 2>/dev/null || true
}

# Check if permissions are empty (allow-all)
IS_EMPTY="$(echo "$PERMISSIONS_JSON" | jq -r '._empty // false' 2>/dev/null || echo "false")"
if [[ "$IS_EMPTY" == "true" ]]; then
    # Agent defined but no permissions block — allow everything and log
    log_decision "ALLOW" "$AGENT_ID" "$TOOL_NAME" "${FILE_PATH:-$COMMAND}" "no-permissions-defined"
    exit 0
fi

# ---------------------------------------------------------------------------
# 6. Glob pattern matching helper
# ---------------------------------------------------------------------------
# Converts a glob pattern to a bash-compatible extended glob test.
# Supports *, **, and ? wildcards.
# ---------------------------------------------------------------------------
matches_glob() {
    local path="$1"
    local pattern="$2"

    local rel_path="$path"
    if [[ "$path" == "$REPO_ROOT"/* ]]; then
        rel_path="${path#$REPO_ROOT/}"
    fi

    node -e "
const p = process.argv[1], g = process.argv[2];
const re = new RegExp('^' + g.replace(/[.+^${}()|[\]\\\\]/g, '\\\\$&').replace(/\*\*\\//g, '(?:.+/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '$');
process.exit(re.test(p) ? 0 : 1);
" "$rel_path" "$pattern" 2>/dev/null
}

# ---------------------------------------------------------------------------
# 7. Check tool-level permissions
# ---------------------------------------------------------------------------
check_tool_permission() {
    local tool="$1"

    # Check tools.deny first (deny takes precedence)
    local deny_count
    deny_count="$(echo "$PERMISSIONS_JSON" | jq -r '.tools.deny // [] | length' 2>/dev/null || echo "0")"
    if [[ "$deny_count" -gt 0 ]]; then
        local denied
        denied="$(echo "$PERMISSIONS_JSON" | jq -r --arg t "$tool" '.tools.deny // [] | map(select(. == $t)) | length' 2>/dev/null || echo "0")"
        if [[ "$denied" -gt 0 ]]; then
            echo "DENY:tool-denied"
            return
        fi
    fi

    # Check tools.allow (if defined, only listed tools are allowed)
    local allow_count
    allow_count="$(echo "$PERMISSIONS_JSON" | jq -r '.tools.allow // [] | length' 2>/dev/null || echo "0")"
    if [[ "$allow_count" -gt 0 ]]; then
        local allowed
        allowed="$(echo "$PERMISSIONS_JSON" | jq -r --arg t "$tool" '.tools.allow // [] | map(select(. == $t)) | length' 2>/dev/null || echo "0")"
        if [[ "$allowed" -eq 0 ]]; then
            echo "DENY:tool-not-in-allow-list"
            return
        fi
    fi

    echo "ALLOW"
}

# ---------------------------------------------------------------------------
# 8. Check file-level permissions
# ---------------------------------------------------------------------------
check_file_permission() {
    local file="$1"
    local access_type="$2"   # "read" or "write"

    [[ -z "$file" ]] && { echo "ALLOW"; return; }

    # Check files.deny first (always takes precedence)
    local deny_patterns
    deny_patterns="$(echo "$PERMISSIONS_JSON" | jq -r '.files.deny // [] | .[]' 2>/dev/null || true)"
    if [[ -n "$deny_patterns" ]]; then
        while IFS= read -r pattern; do
            [[ -z "$pattern" ]] && continue
            if matches_glob "$file" "$pattern"; then
                echo "DENY:file-denied:$pattern"
                return
            fi
        done <<< "$deny_patterns"
    fi

    # Check access-type specific patterns
    local access_patterns
    access_patterns="$(echo "$PERMISSIONS_JSON" | jq -r --arg at "$access_type" '.files[$at] // [] | .[]' 2>/dev/null || true)"
    if [[ -n "$access_patterns" ]]; then
        local found=false
        while IFS= read -r pattern; do
            [[ -z "$pattern" ]] && continue
            if matches_glob "$file" "$pattern"; then
                found=true
                break
            fi
        done <<< "$access_patterns"
        if [[ "$found" != "true" ]]; then
            echo "DENY:file-not-in-${access_type}-list"
            return
        fi
    fi

    echo "ALLOW"
}

# ---------------------------------------------------------------------------
# 9. Check bash command permissions
# ---------------------------------------------------------------------------
check_bash_permission() {
    local cmd="$1"

    [[ -z "$cmd" ]] && { echo "ALLOW"; return; }

    # Check bash.deny first
    local deny_patterns
    deny_patterns="$(echo "$PERMISSIONS_JSON" | jq -r '.bash.deny // [] | .[]' 2>/dev/null || true)"
    if [[ -n "$deny_patterns" ]]; then
        while IFS= read -r pattern; do
            [[ -z "$pattern" ]] && continue
            if node -e "
const p = process.argv[1], g = process.argv[2];
const re = new RegExp('^' + g.replace(/[.+^${}()|[\]\\\\]/g, '\\\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
process.exit(re.test(p) ? 0 : 1);
" "$cmd" "$pattern" 2>/dev/null; then
                echo "DENY:bash-denied:$pattern"
                return
            fi
        done <<< "$deny_patterns"
    fi

    # Check bash.allow (if defined, only matching commands are allowed)
    local allow_patterns
    allow_patterns="$(echo "$PERMISSIONS_JSON" | jq -r '.bash.allow // [] | .[]' 2>/dev/null || true)"
    if [[ -n "$allow_patterns" ]]; then
        local found=false
        while IFS= read -r pattern; do
            [[ -z "$pattern" ]] && continue
            if node -e "
const p = process.argv[1], g = process.argv[2];
const re = new RegExp('^' + g.replace(/[.+^${}()|[\]\\\\]/g, '\\\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
process.exit(re.test(p) ? 0 : 1);
" "$cmd" "$pattern" 2>/dev/null; then
                found=true
                break
            fi
        done <<< "$allow_patterns"
        if [[ "$found" != "true" ]]; then
            echo "DENY:bash-not-in-allow-list"
            return
        fi
    fi

    echo "ALLOW"
}

# ---------------------------------------------------------------------------
# 10. Determine access type from tool name
# ---------------------------------------------------------------------------
get_access_type() {
    local tool="$1"
    case "$tool" in
        Write|Edit|NotebookEdit)    echo "write" ;;
        Read)                        echo "read" ;;
        Grep|Glob)                   echo "read" ;;
        Bash)                        echo "bash" ;;
        *)                           echo "other" ;;
    esac
}

# ---------------------------------------------------------------------------
# 11. Main enforcement logic
# ---------------------------------------------------------------------------

DECISION="ALLOW"
REASON=""

# Step A: Check tool-level permission
TOOL_CHECK="$(check_tool_permission "$TOOL_NAME")"
if [[ "$TOOL_CHECK" != "ALLOW" ]]; then
    DECISION="DENY"
    REASON="${TOOL_CHECK#DENY:}"
fi

# Step B: Check file-level permission (for file-targeting tools)
if [[ "$DECISION" == "ALLOW" && -n "$FILE_PATH" ]]; then
    ACCESS_TYPE="$(get_access_type "$TOOL_NAME")"
    if [[ "$ACCESS_TYPE" == "read" || "$ACCESS_TYPE" == "write" ]]; then
        FILE_CHECK="$(check_file_permission "$FILE_PATH" "$ACCESS_TYPE")"
        if [[ "$FILE_CHECK" != "ALLOW" ]]; then
            DECISION="DENY"
            REASON="${FILE_CHECK#DENY:}"
        fi
    fi
fi

# Step C: Check bash command permission
if [[ "$DECISION" == "ALLOW" && "$TOOL_NAME" == "Bash" && -n "$COMMAND" ]]; then
    BASH_CHECK="$(check_bash_permission "$COMMAND")"
    if [[ "$BASH_CHECK" != "ALLOW" ]]; then
        DECISION="DENY"
        REASON="${BASH_CHECK#DENY:}"
    fi
fi

# ---------------------------------------------------------------------------
# 12. Log the decision and enforce
# ---------------------------------------------------------------------------
TARGET="${FILE_PATH:-${COMMAND:-N/A}}"
log_decision "$DECISION" "$AGENT_ID" "$TOOL_NAME" "$TARGET" "$REASON"

if [[ "$DECISION" == "DENY" ]]; then
    echo "$PREFIX PERMISSION DENIED"
    echo "$PREFIX   Agent:  $AGENT_ID"
    echo "$PREFIX   Tool:   $TOOL_NAME"
    echo "$PREFIX   Target: $TARGET"
    echo "$PREFIX   Reason: $REASON"
    echo "$PREFIX   Policy: .claude/agents/ permission schema"
    echo "$PREFIX   Mode:   $PERMISSION_FAIL_MODE"
    if [[ "$PERMISSION_FAIL_MODE" == "warn" ]]; then
        echo "$PREFIX   Action: ADVISORY (warn mode) — allowing despite policy violation"
        exit 0
    fi
    exit 2
fi

# Permission granted
exit 0
