#!/usr/bin/env bash
# =============================================================================
# [AgentSentry] Secret Scanner - PreToolUse Hook for Write|Edit
# =============================================================================
# Scans file content for hardcoded secrets, API keys, tokens, connection
# strings, and credentials before allowing file writes or edits.
#
# Protocol:  Reads JSON from stdin per the Claude Code hook contract.
# Exit 0:    Content is clean — allow the tool to proceed.
# Exit 2:    Secret detected — BLOCK the tool use.
#
# This is a standalone, generic framework. It works with any project.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Dependency checks — fail loudly, not silently
# ---------------------------------------------------------------------------
if ! command -v jq &>/dev/null; then
    echo "[AgentSentry] CRITICAL: 'jq' is required but not found. Install with: brew install jq (macOS) or apt install jq (Linux)" >&2
    exit 0
fi

PREFIX="[AgentSentry]"

# ---------------------------------------------------------------------------
# 1. Read hook input from stdin (Claude Code hook protocol)
# ---------------------------------------------------------------------------
INPUT="$(cat)"

# ---------------------------------------------------------------------------
# 2. Extract file_path and content from tool_input JSON
#    - Write tool uses "content" + "file_path"
#    - Edit tool uses "new_string" + "file_path"
#    - Fall back gracefully if fields are missing
# ---------------------------------------------------------------------------
FILE_PATH="$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
CONTENT="$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty' 2>/dev/null || true)"

# ---------------------------------------------------------------------------
# 2b. Load suppressions and exclude paths from config
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../agent-sentry.config.json"

SUPPRESSIONS=""
EXCLUDE_PATHS=""
if command -v jq &>/dev/null && [[ -f "$CONFIG_FILE" ]]; then
    SUPPRESSIONS=$(jq -r '.security.suppressions // [] | .[]' "$CONFIG_FILE" 2>/dev/null || true)
    EXCLUDE_PATHS=$(jq -r '.security.exclude_paths // [] | .[]' "$CONFIG_FILE" 2>/dev/null || true)
fi

# Check if file path matches any exclude pattern
if [[ -n "$FILE_PATH" && -n "$EXCLUDE_PATHS" ]]; then
    while IFS= read -r pattern; do
        [[ -z "$pattern" ]] && continue
        if node --eval "$(cat <<'NODESCRIPT'
const p = process.argv[1], g = process.argv[2];
const re = new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.+/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '$');
process.exit(re.test(p) ? 0 : 1);
NODESCRIPT
)" "$FILE_PATH" "$pattern" 2>/dev/null; then
            # File is excluded from scanning
            exit 0
        fi
    done <<< "$EXCLUDE_PATHS"
fi

# ---------------------------------------------------------------------------
# 3. If there is no content to scan, allow silently
# ---------------------------------------------------------------------------
if [[ -z "$CONTENT" ]]; then
    exit 0
fi

# ---------------------------------------------------------------------------
# 4. Pattern scanning
#    Each check appends a human-readable (redacted) label to VIOLATIONS.
# ---------------------------------------------------------------------------
VIOLATIONS=()

# --- Platform API key prefixes ---

# Stripe secret / restricted keys: sk_live_*, sk_test_*
if echo "$CONTENT" | grep -qE 'sk_(live|test)_[0-9a-zA-Z]{10,}'; then
    VIOLATIONS+=("Stripe Secret Key (sk_live_*/sk_test_*)")
fi

# AWS access key IDs: AKIA*
if echo "$CONTENT" | grep -qE 'AKIA[0-9A-Z]{16}'; then
    VIOLATIONS+=("AWS Access Key ID (AKIA...)")
fi

# GitHub personal access tokens: ghp_*
if echo "$CONTENT" | grep -qE 'ghp_[0-9a-zA-Z]{36}'; then
    VIOLATIONS+=("GitHub Personal Access Token (ghp_*)")
fi

# GitLab personal access tokens: glpat-*
if echo "$CONTENT" | grep -qE 'glpat-[0-9a-zA-Z\-]{20,}'; then
    VIOLATIONS+=("GitLab Personal Access Token (glpat-*)")
fi

# --- JWT tokens: eyJ* (three dot-separated base64 segments) ---
if echo "$CONTENT" | grep -qE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'; then
    VIOLATIONS+=("JWT Token (eyJ...)")
fi

# --- Private keys in PEM format ---
if echo "$CONTENT" | grep -qE '\-\-\-\-\-BEGIN[[:space:]]+(RSA |EC |DSA |OPENSSH |ED25519 |ENCRYPTED )?PRIVATE KEY\-\-\-\-\-'; then
    VIOLATIONS+=("Private Key (PEM format)")
fi

# --- Connection strings with embedded credentials ---

# PostgreSQL
if echo "$CONTENT" | grep -qE 'postgresql://[^[:space:]/]+:[^[:space:]@]+@'; then
    VIOLATIONS+=("PostgreSQL connection string with credentials")
fi

# MongoDB (including +srv)
if echo "$CONTENT" | grep -qE 'mongodb(\+srv)?://[^[:space:]/]+:[^[:space:]@]+@'; then
    VIOLATIONS+=("MongoDB connection string with credentials")
fi

# Redis
if echo "$CONTENT" | grep -qE 'redis://[^[:space:]/]*:[^[:space:]@]+@'; then
    VIOLATIONS+=("Redis connection string with credentials")
fi

# SQLite with absolute path (sqlite:///path) — less of a secret, but flag it
# to catch things like sqlite:////secrets/prod.db
if echo "$CONTENT" | grep -qE 'sqlite:///'; then
    VIOLATIONS+=("SQLite connection string (sqlite:///)")
fi

# --- Generic labeled secrets ---
# Catches assignments like: api_key = "value", SECRET="value", token: "value"
# Requires a value of 8+ chars to reduce false positives on short placeholders.
if echo "$CONTENT" | grep -qiE '(api[_-]?key|secret|token|password|credential)[[:space:]]*[=:][[:space:]]*["\x27][A-Za-z0-9_\-/+=]{8,}["\x27]'; then
    VIOLATIONS+=("Generic secret/token/password assignment")
fi

# --- Common provider environment variable patterns ---
# Catches hardcoded assignments like ANTHROPIC_API_KEY="sk-ant-..."
PROVIDER_VARS=(
    "ANTHROPIC_API_KEY"
    "OPENAI_API_KEY"
    "GOOGLE_API_KEY"
    "AWS_SECRET_ACCESS_KEY"
    "STRIPE_SECRET_KEY"
    "GITHUB_TOKEN"
    "GITLAB_TOKEN"
    "BITBUCKET_TOKEN"
    "DATABASE_URL"
    "MONGODB_URI"
    "REDIS_URL"
)

for VAR in "${PROVIDER_VARS[@]}"; do
    if echo "$CONTENT" | grep -qE "${VAR}[[:space:]]*[=:][[:space:]]*[\"'\`][A-Za-z0-9_\-/+=:.@]{8,}[\"'\`]"; then
        VIOLATIONS+=("Hardcoded ${VAR} assignment")
    fi
done

# --- Anthropic API key prefix (sk-ant-*) ---
if echo "$CONTENT" | grep -qE 'sk-ant-[a-zA-Z0-9_\-]{20,}'; then
    VIOLATIONS+=("Anthropic API Key (sk-ant-*)")
fi

# --- OpenAI API key pattern ---
if echo "$CONTENT" | grep -qE 'sk-[a-zA-Z0-9]{20,}T3BlbkFJ[a-zA-Z0-9]{20,}'; then
    VIOLATIONS+=("OpenAI API Key")
fi

# ---------------------------------------------------------------------------
# 4b. Filter out suppressed violations
# ---------------------------------------------------------------------------
if [[ -n "$SUPPRESSIONS" && ${#VIOLATIONS[@]} -gt 0 ]]; then
    FILTERED=()
    for v in "${VIOLATIONS[@]}"; do
        suppressed=false
        while IFS= read -r suppression; do
            [[ -z "$suppression" ]] && continue
            if echo "$v" | grep -qi "$suppression" 2>/dev/null; then
                suppressed=true
                break
            fi
        done <<< "$SUPPRESSIONS"
        if [[ "$suppressed" != "true" ]]; then
            FILTERED+=("$v")
        fi
    done
    VIOLATIONS=("${FILTERED[@]+"${FILTERED[@]}"}")
fi

# ---------------------------------------------------------------------------
# 5. Report results
# ---------------------------------------------------------------------------

if [[ ${#VIOLATIONS[@]} -gt 0 ]]; then
    echo "$PREFIX SECRET DETECTED -- blocking file write." >&2
    echo "" >&2
    echo "$PREFIX Potential secret patterns found:" >&2
    for v in "${VIOLATIONS[@]}"; do
        echo "$PREFIX   - $v [REDACTED]" >&2
    done
    echo "" >&2
    if [[ -n "$FILE_PATH" ]]; then
        echo "$PREFIX File: $FILE_PATH" >&2
    fi
    echo "" >&2
    echo "$PREFIX Recommendation: Use environment variables or a .env file instead" >&2
    echo "$PREFIX of hardcoding secrets. Reference values via \$ENV_VAR_NAME or" >&2
    echo "$PREFIX os.environ / process.env in your application code." >&2
    exit 2
fi

# Content is clean — allow silently
exit 0
