#!/usr/bin/env bash
# =============================================================================
# [AgentOps] Full Security Audit — §6.3
# =============================================================================
# Standalone script invoked by /agentops audit.
# Runs a comprehensive project security scan across 6 check categories:
#   1. Secrets in Code
#   2. API Key Security
#   3. Input Validation
#   4. Error Handling
#   5. Dependency Audit
#   6. Database Security
#
# Results are grouped by severity (Critical, Warning, Advisory, Pass),
# written to agentops/dashboard/data/audit-results.json as NDJSON,
# and summarised on stdout.
#
# Exit 0 always — this is an advisory tool, not a gate.
# =============================================================================

set -euo pipefail

PREFIX="[AgentOps]"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_ROOT="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SCAN_GIT_HISTORY="${AGENTOPS_AUDIT_SCAN_HISTORY:-false}"
RESULTS_DIR="${PROJECT_ROOT}/agentops/dashboard/data"
RESULTS_FILE="${RESULTS_DIR}/audit-results.json"
SOURCE_EXTENSIONS="ts,js,py,go,java,rb,sh"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# ---------------------------------------------------------------------------
# Counters
# ---------------------------------------------------------------------------
declare -i CRITICAL=0 WARNING=0 ADVISORY=0 PASS=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
mkdir -p "$RESULTS_DIR"
: > "$RESULTS_FILE"

emit() {
    # emit SEVERITY CATEGORY MESSAGE
    local severity="$1" category="$2" message="$3"
    case "$severity" in
        CRITICAL) CRITICAL+=1 ;;
        WARNING)  WARNING+=1 ;;
        ADVISORY) ADVISORY+=1 ;;
        PASS)     PASS+=1 ;;
    esac
    echo "${PREFIX} [${severity}] (${category}) ${message}"
    # NDJSON line
    printf '{"timestamp":"%s","severity":"%s","category":"%s","message":"%s"}\n' \
        "$TIMESTAMP" "$severity" "$category" \
        "$(echo "$message" | sed 's/"/\\"/g')" >> "$RESULTS_FILE"
}

# Build a find-compatible name filter from SOURCE_EXTENSIONS
build_find_names() {
    local first=true
    IFS=',' read -ra exts <<< "$SOURCE_EXTENSIONS"
    for ext in "${exts[@]}"; do
        if $first; then
            printf -- '-name "*.%s"' "$ext"
            first=false
        else
            printf -- ' -o -name "*.%s"' "$ext"
        fi
    done
}

# Collect source files into an array (respects .gitignore via git ls-files when
# inside a repo, falls back to find).
collect_source_files() {
    local -a files=()
    if git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then
        while IFS= read -r f; do
            for ext in ${SOURCE_EXTENSIONS//,/ }; do
                if [[ "$f" == *."$ext" ]]; then
                    files+=("$f")
                    break
                fi
            done
        done < <(git -C "$PROJECT_ROOT" ls-files 2>/dev/null)
    else
        while IFS= read -r f; do
            files+=("$f")
        done < <(eval "find \"$PROJECT_ROOT\" -type f \( $(build_find_names) \) -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/vendor/*' -not -path '*/dist/*' -not -path '*/__pycache__/*'")
    fi
    printf '%s\n' "${files[@]}"
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo ""
echo "${PREFIX} ========================================"
echo "${PREFIX}  Full Security Audit"
echo "${PREFIX}  Project: ${PROJECT_ROOT}"
echo "${PREFIX}  Time:    ${TIMESTAMP}"
echo "${PREFIX} ========================================"
echo ""

# ===========================  1. SECRETS IN CODE  ===========================
echo "${PREFIX} --- 1. Secrets in Code ---"

SECRET_PATTERNS=(
    'sk_(live|test)_[0-9a-zA-Z]{10,}:Stripe Secret Key'
    'AKIA[0-9A-Z]{16}:AWS Access Key ID'
    'ghp_[0-9a-zA-Z]{36}:GitHub Personal Access Token'
    'glpat-[0-9a-zA-Z\-]{20,}:GitLab Personal Access Token'
    'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}:JWT Token'
    '\-\-\-\-\-BEGIN[[:space:]]+(RSA |EC |DSA |OPENSSH |ED25519 |ENCRYPTED )?PRIVATE KEY\-\-\-\-\-:Private Key (PEM)'
    'postgresql://[^[:space:]/]+:[^[:space:]@]+@:PostgreSQL connection string with credentials'
    'mongodb(\+srv)?://[^[:space:]/]+:[^[:space:]@]+@:MongoDB connection string with credentials'
    'redis://[^[:space:]/]*:[^[:space:]@]+@:Redis connection string with credentials'
    'sk-ant-[a-zA-Z0-9_\-]{20,}:Anthropic API Key'
    'sk-[a-zA-Z0-9]{20,}T3BlbkFJ[a-zA-Z0-9]{20,}:OpenAI API Key'
)

PROVIDER_VARS=(
    "ANTHROPIC_API_KEY" "OPENAI_API_KEY" "GOOGLE_API_KEY"
    "AWS_SECRET_ACCESS_KEY" "STRIPE_SECRET_KEY" "GITHUB_TOKEN"
    "GITLAB_TOKEN" "BITBUCKET_TOKEN" "DATABASE_URL" "MONGODB_URI" "REDIS_URL"
)

secrets_found=0

# Scan source files for secret patterns
SOURCE_LIST="$(collect_source_files)"
if [[ -n "$SOURCE_LIST" ]]; then
    while IFS=: read -r pattern label; do
        while IFS= read -r file; do
            [[ -z "$file" ]] && continue
            if grep -qE "$pattern" "$PROJECT_ROOT/$file" 2>/dev/null; then
                emit CRITICAL "Secrets in Code" "Potential ${label} found in ${file}"
                secrets_found=1
            fi
        done <<< "$SOURCE_LIST"
    done < <(printf '%s\n' "${SECRET_PATTERNS[@]}")

    # Generic labelled secrets (api_key = "...", token: "...", etc.)
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -qiE '(api[_-]?key|secret|token|password|credential)[[:space:]]*[=:][[:space:]]*["'"'"'][A-Za-z0-9_\-/+=]{8,}["'"'"']' "$PROJECT_ROOT/$file" 2>/dev/null; then
            emit CRITICAL "Secrets in Code" "Generic secret/token/password assignment in ${file}"
            secrets_found=1
        fi
    done <<< "$SOURCE_LIST"

    # Hardcoded provider var assignments
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        for var in "${PROVIDER_VARS[@]}"; do
            if grep -qE "${var}[[:space:]]*[=:][[:space:]]*[\"'\`][A-Za-z0-9_\-/+=:.@]{8,}[\"'\`]" "$PROJECT_ROOT/$file" 2>/dev/null; then
                emit CRITICAL "Secrets in Code" "Hardcoded ${var} assignment in ${file}"
                secrets_found=1
            fi
        done
    done <<< "$SOURCE_LIST"
fi

# Check .env.example for real values instead of placeholders
if [[ -f "$PROJECT_ROOT/.env.example" ]]; then
    if grep -qvE '(PLACEHOLDER|YOUR_KEY|your_key|your-key|xxx|changeme|CHANGEME|<|>)' "$PROJECT_ROOT/.env.example" 2>/dev/null \
       && grep -qE '=[A-Za-z0-9_\-/+=:.@]{8,}$' "$PROJECT_ROOT/.env.example" 2>/dev/null; then
        emit WARNING "Secrets in Code" ".env.example may contain real values instead of placeholders"
    else
        emit PASS "Secrets in Code" ".env.example uses placeholder patterns"
    fi
else
    emit ADVISORY "Secrets in Code" "No .env.example found"
fi

# Verify .env and .env.local are in .gitignore
if [[ -f "$PROJECT_ROOT/.gitignore" ]]; then
    env_ignored=true
    for envfile in ".env" ".env.local"; do
        if ! grep -qE "^\.env$|^\*\.env$|^${envfile}$" "$PROJECT_ROOT/.gitignore" 2>/dev/null; then
            # Also check broader patterns
            if ! grep -qE '\.env' "$PROJECT_ROOT/.gitignore" 2>/dev/null; then
                emit WARNING "Secrets in Code" "${envfile} is NOT listed in .gitignore"
                env_ignored=false
            fi
        fi
    done
    if $env_ignored; then
        emit PASS "Secrets in Code" ".env files are listed in .gitignore"
    fi
else
    emit WARNING "Secrets in Code" "No .gitignore found — .env files may be tracked"
fi

# Optionally scan git history
if [[ "$SCAN_GIT_HISTORY" == "true" ]] && git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then
    echo "${PREFIX} Scanning git history (this may take a while)..."
    history_secrets=0
    for entry in "${SECRET_PATTERNS[@]}"; do
        pattern="${entry%%:*}"
        label="${entry##*:}"
        if git -C "$PROJECT_ROOT" log -p --all -S "$pattern" --pickaxe-regex -- '*.ts' '*.js' '*.py' '*.go' '*.java' '*.rb' '*.sh' 2>/dev/null | grep -qE "$pattern"; then
            emit CRITICAL "Secrets in Code" "Git history contains potential ${label}"
            history_secrets=1
        fi
    done
    if [[ $history_secrets -eq 0 ]]; then
        emit PASS "Secrets in Code" "No secrets detected in git history"
    fi
fi

if [[ $secrets_found -eq 0 ]]; then
    emit PASS "Secrets in Code" "No hardcoded secrets detected in source files"
fi

echo ""

# ========================  2. API KEY SECURITY  ========================
echo "${PREFIX} --- 2. API Key Security ---"

api_env_usage=0
api_issues=0

if [[ -n "$SOURCE_LIST" ]]; then
    # Check that provider keys use environment variables
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -qE 'process\.env|os\.environ|os\.Getenv|System\.getenv|ENV\[' "$PROJECT_ROOT/$file" 2>/dev/null; then
            api_env_usage=1
        fi
    done <<< "$SOURCE_LIST"

    if [[ $api_env_usage -eq 1 ]]; then
        emit PASS "API Key Security" "Environment variable usage detected for configuration"
    else
        emit WARNING "API Key Security" "No environment variable usage found — keys may be hardcoded"
        api_issues=1
    fi

    # Check error messages don't expose keys
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -qiE '(catch|error|err|except|rescue)' "$PROJECT_ROOT/$file" 2>/dev/null; then
            if grep -qiE '(key|token|secret|password|credential)' "$PROJECT_ROOT/$file" 2>/dev/null; then
                # Check if error blocks reference sensitive terms
                if grep -A5 -iE '(catch|except|rescue|\.on\(.*error)' "$PROJECT_ROOT/$file" 2>/dev/null | grep -qiE '(api.?key|token|secret|password)'; then
                    emit WARNING "API Key Security" "Error handler in ${file} may expose sensitive terms"
                    api_issues=1
                fi
            fi
        fi
    done <<< "$SOURCE_LIST"

    # Verify API calls have timeouts
    timeout_found=false
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -qiE '(timeout|Timeout|TIMEOUT|time_out|timeoutMs|request_timeout|connect_timeout)' "$PROJECT_ROOT/$file" 2>/dev/null; then
            timeout_found=true
            break
        fi
    done <<< "$SOURCE_LIST"

    if $timeout_found; then
        emit PASS "API Key Security" "Timeout configuration found in API calls"
    else
        emit ADVISORY "API Key Security" "No explicit timeout configuration found for API calls"
    fi
fi

if [[ $api_issues -eq 0 && $api_env_usage -eq 1 ]]; then
    emit PASS "API Key Security" "API key handling follows best practices"
fi

echo ""

# ========================  3. INPUT VALIDATION  ========================
echo "${PREFIX} --- 3. Input Validation ---"

if [[ -n "$SOURCE_LIST" ]]; then
    # Check for validation libraries / patterns
    validation_found=false
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -qiE '(validate|sanitize|sanitise|zod|joi|yup|ajv|class-validator|validator\.|escape\(|DOMPurify|bleach|html\.escape)' "$PROJECT_ROOT/$file" 2>/dev/null; then
            validation_found=true
            break
        fi
    done <<< "$SOURCE_LIST"

    if $validation_found; then
        emit PASS "Input Validation" "Input validation/sanitization patterns detected"
    else
        emit WARNING "Input Validation" "No validation or sanitization patterns found in source files"
    fi

    # Check for path traversal prevention
    traversal_handling=false
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -qE '(\.\./|path\.resolve|path\.normalize|realpath|Path\.resolve|os\.path\.abspath|filepath\.Clean|filepath\.Abs|Paths\.get)' "$PROJECT_ROOT/$file" 2>/dev/null; then
            traversal_handling=true
            break
        fi
    done <<< "$SOURCE_LIST"

    if $traversal_handling; then
        emit PASS "Input Validation" "Path traversal prevention patterns detected"
    else
        emit ADVISORY "Input Validation" "No explicit path traversal prevention detected"
    fi

    # Check for SQL injection prevention
    parameterized_found=false
    string_concat_sql=false
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        # Parameterized queries
        if grep -qiE '(\$[0-9]+|%s|\?|:param|@param|named\s+parameters|prepare\(|parameterized|placeholder|bind_param|bindValue|bindParam|execute\(\[)' "$PROJECT_ROOT/$file" 2>/dev/null; then
            parameterized_found=true
        fi
        # String concatenation in SQL
        if grep -qiE "(SELECT|INSERT|UPDATE|DELETE|DROP).*['\"][\s]*\+[\s]*|f['\"].*SELECT|f['\"].*INSERT|\".*SELECT.*\"\s*\+|'.*SELECT.*'\s*\+|`.*SELECT.*`\s*\+" "$PROJECT_ROOT/$file" 2>/dev/null; then
            string_concat_sql=true
            emit CRITICAL "Input Validation" "Possible SQL string concatenation in ${file}"
        fi
    done <<< "$SOURCE_LIST"

    if $parameterized_found; then
        emit PASS "Input Validation" "Parameterized query patterns detected"
    fi

    if ! $parameterized_found && ! $string_concat_sql; then
        emit ADVISORY "Input Validation" "No SQL query patterns detected (may not apply)"
    fi
fi

echo ""

# ========================  4. ERROR HANDLING  ========================
echo "${PREFIX} --- 4. Error Handling ---"

if [[ -n "$SOURCE_LIST" ]]; then
    # Check critical operations have try/catch
    try_catch_found=false
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -qiE '(try\s*\{|try:|begin\s*$|rescue|catch\s*\(|except\s|\.catch\()' "$PROJECT_ROOT/$file" 2>/dev/null; then
            try_catch_found=true
            break
        fi
    done <<< "$SOURCE_LIST"

    if $try_catch_found; then
        emit PASS "Error Handling" "Try/catch error handling patterns detected"
    else
        emit WARNING "Error Handling" "No try/catch patterns found — critical operations may lack error handling"
    fi

    # Verify errors logged without PII
    pii_in_errors=false
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -A3 -iE '(catch|except|rescue|error)' "$PROJECT_ROOT/$file" 2>/dev/null | grep -qiE '(email|phone|ssn|social.?security|credit.?card|address|date.?of.?birth)'; then
            emit WARNING "Error Handling" "Error block in ${file} may log PII"
            pii_in_errors=true
        fi
    done <<< "$SOURCE_LIST"

    if ! $pii_in_errors; then
        emit PASS "Error Handling" "No PII exposure detected in error handlers"
    fi

    # Check fallback states exist
    fallback_found=false
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -qiE '(fallback|default|graceful|retry|backoff|circuit.?breaker|ErrorBoundary|error.?boundary|finally\s*\{|finally:)' "$PROJECT_ROOT/$file" 2>/dev/null; then
            fallback_found=true
            break
        fi
    done <<< "$SOURCE_LIST"

    if $fallback_found; then
        emit PASS "Error Handling" "Fallback/retry patterns detected"
    else
        emit ADVISORY "Error Handling" "No explicit fallback or retry patterns found"
    fi
fi

echo ""

# ========================  5. DEPENDENCY AUDIT  ========================
echo "${PREFIX} --- 5. Dependency Audit ---"

dep_manager_found=false

# npm
if [[ -f "$PROJECT_ROOT/package.json" ]]; then
    dep_manager_found=true
    if command -v npm &>/dev/null; then
        echo "${PREFIX} Running npm audit..."
        npm_audit_output="$(cd "$PROJECT_ROOT" && npm audit --json 2>/dev/null || true)"
        npm_vulns="$(echo "$npm_audit_output" | jq '.metadata.vulnerabilities.critical // 0' 2>/dev/null || echo "0")"
        npm_high="$(echo "$npm_audit_output" | jq '.metadata.vulnerabilities.high // 0' 2>/dev/null || echo "0")"
        npm_moderate="$(echo "$npm_audit_output" | jq '.metadata.vulnerabilities.moderate // 0' 2>/dev/null || echo "0")"

        if [[ "${npm_vulns:-0}" -gt 0 ]]; then
            emit CRITICAL "Dependency Audit" "npm: ${npm_vulns} critical vulnerabilities"
        fi
        if [[ "${npm_high:-0}" -gt 0 ]]; then
            emit WARNING "Dependency Audit" "npm: ${npm_high} high-severity vulnerabilities"
        fi
        if [[ "${npm_moderate:-0}" -gt 0 ]]; then
            emit ADVISORY "Dependency Audit" "npm: ${npm_moderate} moderate vulnerabilities"
        fi
        if [[ "${npm_vulns:-0}" -eq 0 && "${npm_high:-0}" -eq 0 && "${npm_moderate:-0}" -eq 0 ]]; then
            emit PASS "Dependency Audit" "npm audit clean — no known vulnerabilities"
        fi
    else
        emit ADVISORY "Dependency Audit" "npm not available — skipping npm audit"
    fi

    # Check lock file
    if [[ -f "$PROJECT_ROOT/package-lock.json" || -f "$PROJECT_ROOT/yarn.lock" || -f "$PROJECT_ROOT/pnpm-lock.yaml" ]]; then
        emit PASS "Dependency Audit" "npm lock file is present"
    else
        emit WARNING "Dependency Audit" "No npm lock file found (package-lock.json, yarn.lock, or pnpm-lock.yaml)"
    fi

    # Flag outdated packages
    if command -v npm &>/dev/null; then
        outdated_count="$(cd "$PROJECT_ROOT" && npm outdated --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")"
        if [[ "${outdated_count:-0}" -gt 0 ]]; then
            emit ADVISORY "Dependency Audit" "npm: ${outdated_count} outdated packages"
        else
            emit PASS "Dependency Audit" "npm packages are up to date"
        fi
    fi
fi

# pip
if [[ -f "$PROJECT_ROOT/requirements.txt" ]]; then
    dep_manager_found=true
    if command -v pip &>/dev/null && pip show pip-audit &>/dev/null 2>&1; then
        echo "${PREFIX} Running pip audit..."
        pip_audit_output="$(cd "$PROJECT_ROOT" && pip-audit -r requirements.txt --format json 2>/dev/null || true)"
        pip_vulns="$(echo "$pip_audit_output" | jq '[.dependencies[] | select(.vulns | length > 0)] | length' 2>/dev/null || echo "0")"
        if [[ "${pip_vulns:-0}" -gt 0 ]]; then
            emit WARNING "Dependency Audit" "pip-audit: ${pip_vulns} packages with known vulnerabilities"
        else
            emit PASS "Dependency Audit" "pip-audit clean — no known vulnerabilities"
        fi
    elif command -v pip-audit &>/dev/null; then
        echo "${PREFIX} Running pip-audit..."
        pip_audit_output="$(cd "$PROJECT_ROOT" && pip-audit -r requirements.txt --format json 2>/dev/null || true)"
        pip_vulns="$(echo "$pip_audit_output" | jq '[.dependencies[] | select(.vulns | length > 0)] | length' 2>/dev/null || echo "0")"
        if [[ "${pip_vulns:-0}" -gt 0 ]]; then
            emit WARNING "Dependency Audit" "pip-audit: ${pip_vulns} packages with known vulnerabilities"
        else
            emit PASS "Dependency Audit" "pip-audit clean — no known vulnerabilities"
        fi
    else
        emit ADVISORY "Dependency Audit" "pip-audit not available — skipping Python dependency audit"
    fi

    # Check lock file
    if [[ -f "$PROJECT_ROOT/requirements.lock" || -f "$PROJECT_ROOT/Pipfile.lock" || -f "$PROJECT_ROOT/poetry.lock" ]]; then
        emit PASS "Dependency Audit" "Python lock file is present"
    else
        emit ADVISORY "Dependency Audit" "No Python lock file found (Pipfile.lock or poetry.lock)"
    fi
fi

# cargo
if [[ -f "$PROJECT_ROOT/Cargo.toml" ]]; then
    dep_manager_found=true
    if command -v cargo &>/dev/null && cargo audit --version &>/dev/null 2>&1; then
        echo "${PREFIX} Running cargo audit..."
        if cd "$PROJECT_ROOT" && cargo audit --json 2>/dev/null | jq -e '.vulnerabilities.found > 0' &>/dev/null; then
            cargo_vulns="$(cd "$PROJECT_ROOT" && cargo audit --json 2>/dev/null | jq '.vulnerabilities.found' 2>/dev/null || echo "0")"
            emit WARNING "Dependency Audit" "cargo audit: ${cargo_vulns} vulnerabilities found"
        else
            emit PASS "Dependency Audit" "cargo audit clean — no known vulnerabilities"
        fi
    else
        emit ADVISORY "Dependency Audit" "cargo-audit not available — skipping Rust dependency audit"
    fi

    # Check lock file
    if [[ -f "$PROJECT_ROOT/Cargo.lock" ]]; then
        emit PASS "Dependency Audit" "Cargo.lock is present"
    else
        emit WARNING "Dependency Audit" "Cargo.lock not found — should be committed for applications"
    fi
fi

if ! $dep_manager_found; then
    emit ADVISORY "Dependency Audit" "No recognized dependency manifest found (package.json, requirements.txt, Cargo.toml)"
fi

echo ""

# ========================  6. DATABASE SECURITY  ========================
echo "${PREFIX} --- 6. Database Security ---"

db_files_found=false

if [[ -n "$SOURCE_LIST" ]]; then
    # Check connections use environment variables
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -qiE '(createConnection|createPool|connect\(|MongoClient|mongoose\.connect|redis\.createClient|Sequelize|knex|prisma|sqlalchemy|database|pg\.Pool|mysql\.create)' "$PROJECT_ROOT/$file" 2>/dev/null; then
            db_files_found=true
            # Check if env vars are used nearby
            if grep -B2 -A5 -iE '(createConnection|createPool|connect\(|MongoClient|mongoose\.connect|redis\.createClient|Sequelize|knex|prisma|sqlalchemy|pg\.Pool|mysql\.create)' "$PROJECT_ROOT/$file" 2>/dev/null | grep -qiE '(process\.env|os\.environ|os\.Getenv|System\.getenv|ENV\[|getenv)'; then
                emit PASS "Database Security" "Database connection in ${file} uses environment variables"
            else
                emit WARNING "Database Security" "Database connection in ${file} may not use environment variables"
            fi
        fi
    done <<< "$SOURCE_LIST"

    # Verify credentials not hardcoded in DB configs
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -qiE '(host|hostname|server)\s*[:=]' "$PROJECT_ROOT/$file" 2>/dev/null; then
            if grep -B2 -A5 -iE '(host|hostname|server)\s*[:=]' "$PROJECT_ROOT/$file" 2>/dev/null | grep -qiE '(password|passwd|pwd)\s*[:=]\s*["\x27][A-Za-z0-9_\-/+=:.@]{4,}["\x27]'; then
                emit CRITICAL "Database Security" "Hardcoded database password found in ${file}"
            fi
        fi
    done <<< "$SOURCE_LIST"

    # Check for parameterized queries in DB operations
    db_query_found=false
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -qiE '(\.query\(|\.execute\(|\.raw\(|\.exec\()' "$PROJECT_ROOT/$file" 2>/dev/null; then
            db_query_found=true
            if grep -B1 -A3 -iE '(\.query\(|\.execute\(|\.raw\(|\.exec\()' "$PROJECT_ROOT/$file" 2>/dev/null | grep -qE '(\$[0-9]+|\?|%s|:[\w]+|\$\{)'; then
                emit PASS "Database Security" "Parameterized queries detected in ${file}"
            else
                emit ADVISORY "Database Security" "Query in ${file} — verify parameterized queries are used"
            fi
        fi
    done <<< "$SOURCE_LIST"
fi

if ! $db_files_found; then
    emit ADVISORY "Database Security" "No database connection patterns detected in source files"
fi

echo ""

# =============================================================================
# Summary
# =============================================================================
TOTAL=$((CRITICAL + WARNING + ADVISORY + PASS))

echo "${PREFIX} ========================================"
echo "${PREFIX}  Audit Summary"
echo "${PREFIX} ========================================"
echo "${PREFIX}  Critical:  ${CRITICAL}"
echo "${PREFIX}  Warning:   ${WARNING}"
echo "${PREFIX}  Advisory:  ${ADVISORY}"
echo "${PREFIX}  Pass:      ${PASS}"
echo "${PREFIX}  Total:     ${TOTAL}"
echo "${PREFIX} ========================================"
echo ""

if [[ $CRITICAL -gt 0 ]]; then
    echo "${PREFIX} ACTION REQUIRED: ${CRITICAL} critical finding(s) need immediate attention."
elif [[ $WARNING -gt 0 ]]; then
    echo "${PREFIX} Review recommended: ${WARNING} warning(s) found."
else
    echo "${PREFIX} Project looks good. ${PASS} checks passed."
fi

echo ""
echo "${PREFIX} Full results written to: ${RESULTS_FILE}"
echo ""

# Always exit 0 — advisory tool, not a gate
exit 0
