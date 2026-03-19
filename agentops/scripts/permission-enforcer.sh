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

PREFIX="[AgentOps]"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENTS_DIR="$REPO_ROOT/.claude/agents"
LOG_FILE="$REPO_ROOT/agentops/dashboard/data/permission-log.json"

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
PERMISSIONS_JSON="$(python3 << 'PYEOF'
import sys, json, re, os

agent_file = os.environ.get("AGENT_FILE", "")
if not agent_file or not os.path.isfile(agent_file):
    # No agent file — output empty permissions (allow-all)
    print(json.dumps({"_empty": True}))
    sys.exit(0)

with open(agent_file, "r") as f:
    content = f.read()

# Extract YAML frontmatter between --- markers
fm_match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
if not fm_match:
    print(json.dumps({"_empty": True}))
    sys.exit(0)

frontmatter = fm_match.group(1)

# Minimal YAML parser for our known schema (avoids PyYAML dependency)
# Handles the nested permissions structure we define
def parse_permissions(text):
    perms = {}
    current_section = None    # files | tools | bash
    current_key = None        # read | write | deny | allow

    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        # Top-level: permissions:
        if stripped == "permissions:":
            continue

        # Detect indent level
        indent = len(line) - len(line.lstrip())

        # Section level (files:, tools:, bash:) — indent 4 or 2 under permissions
        if indent in (2, 4) and stripped.endswith(":") and stripped[:-1] in ("files", "tools", "bash"):
            current_section = stripped[:-1]
            if current_section not in perms:
                perms[current_section] = {}
            current_key = None
            continue

        # Key level (read:, write:, deny:, allow:)
        if indent in (4, 6, 8) and current_section:
            key_match = re.match(r'^(read|write|deny|allow):\s*(.*)', stripped)
            if key_match:
                current_key = key_match.group(1)
                rest = key_match.group(2).strip()
                if current_section not in perms:
                    perms[current_section] = {}
                if current_key not in perms[current_section]:
                    perms[current_section][current_key] = []

                # Inline list: ["a", "b"]
                if rest.startswith("["):
                    items = re.findall(r'"([^"]*)"', rest)
                    if not items:
                        items = re.findall(r"'([^']*)'", rest)
                    perms[current_section][current_key].extend(items)
                elif rest and rest != "[]":
                    perms[current_section][current_key].append(rest)
                continue

        # List items under current key: - "pattern" or - pattern
        if current_section and current_key and stripped.startswith("- "):
            item = stripped[2:].strip().strip('"').strip("'")
            if current_section not in perms:
                perms[current_section] = {}
            if current_key not in perms[current_section]:
                perms[current_section][current_key] = []
            perms[current_section][current_key].append(item)

    return perms

perms = parse_permissions(frontmatter)
if not perms:
    print(json.dumps({"_empty": True}))
else:
    print(json.dumps(perms))
PYEOF
)" 2>/dev/null || echo '{"_empty":true}'

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

    # Make path relative to repo root for matching
    local rel_path="$path"
    if [[ "$path" == "$REPO_ROOT"/* ]]; then
        rel_path="${path#$REPO_ROOT/}"
    fi

    # Use Python for reliable glob matching (fnmatch with ** support)
    python3 -c "
import fnmatch, sys, os
path = sys.argv[1]
pattern = sys.argv[2]
# Support ** for recursive directory matching
if '**' in pattern:
    import pathlib
    match = pathlib.PurePath(path).match(pattern)
else:
    match = fnmatch.fnmatch(path, pattern)
sys.exit(0 if match else 1)
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
            # Use fnmatch-style matching on the command string
            if python3 -c "
import fnmatch, sys
sys.exit(0 if fnmatch.fnmatch(sys.argv[1], sys.argv[2]) else 1)
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
            if python3 -c "
import fnmatch, sys
sys.exit(0 if fnmatch.fnmatch(sys.argv[1], sys.argv[2]) else 1)
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
    exit 2
fi

# Permission granted
exit 0
