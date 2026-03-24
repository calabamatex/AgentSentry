#!/usr/bin/env bash
# validate-plugin.sh — Validates an AgentSentry plugin directory.
# Usage: bash scripts/validate-plugin.sh <plugin-path>
#
# Runs 11 validation checks:
#  1. Plugin directory exists
#  2. metadata.json exists
#  3. metadata.json is valid JSON
#  4. Required fields present (name, description, category, author, version, requires, tags)
#  5. Name follows pattern (lowercase, numbers, hyphens only)
#  6. Version follows semver pattern
#  7. Category is valid
#  8. Author has name field
#  9. Requires has agent-sentry field
# 10. src/index.ts exists
# 11. README.md exists

set -euo pipefail

PLUGIN_PATH="${1:-}"
PASS=0
FAIL=0
TOTAL=11

red() { printf '\033[0;31m%s\033[0m\n' "$1"; }
green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$1"; }

check() {
  local num="$1"
  local desc="$2"
  local result="$3"
  if [ "$result" = "pass" ]; then
    green "  [${num}/${TOTAL}] PASS: ${desc}"
    PASS=$((PASS + 1))
  else
    red "  [${num}/${TOTAL}] FAIL: ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

if [ -z "$PLUGIN_PATH" ]; then
  red "Usage: bash scripts/validate-plugin.sh <plugin-path>"
  exit 1
fi

echo "Validating plugin at: ${PLUGIN_PATH}"
echo "---"

# 1. Plugin directory exists
if [ -d "$PLUGIN_PATH" ]; then
  check 1 "Plugin directory exists" "pass"
else
  check 1 "Plugin directory exists" "fail"
  red "Cannot continue without plugin directory."
  exit 1
fi

METADATA="${PLUGIN_PATH}/metadata.json"

# 2. metadata.json exists
if [ -f "$METADATA" ]; then
  check 2 "metadata.json exists" "pass"
else
  check 2 "metadata.json exists" "fail"
  red "Cannot continue without metadata.json."
  exit 1
fi

# 3. metadata.json is valid JSON
if node -e "JSON.parse(require('fs').readFileSync('${METADATA}', 'utf-8'))" 2>/dev/null; then
  check 3 "metadata.json is valid JSON" "pass"
else
  check 3 "metadata.json is valid JSON" "fail"
  red "metadata.json is not valid JSON. Cannot continue."
  exit 1
fi

json_get() {
  node -e "
const data = JSON.parse(require('fs').readFileSync('${METADATA}', 'utf-8'));
const keys = '$1'.split('.');
let val = data;
for (const k of keys) {
  if (val && typeof val === 'object' && k in val) val = val[k];
  else process.exit(1);
}
console.log(typeof val === 'object' ? JSON.stringify(val) : String(val));
" 2>/dev/null
}

json_has() {
  node -e "
const data = JSON.parse(require('fs').readFileSync('${METADATA}', 'utf-8'));
const keys = '$1'.split('.');
let val = data;
for (const k of keys) {
  if (val && typeof val === 'object' && k in val) val = val[k];
  else process.exit(1);
}
" 2>/dev/null
}

# 4. Required fields present
REQUIRED_FIELDS="name description category author version requires tags"
ALL_PRESENT=true
for field in $REQUIRED_FIELDS; do
  if ! json_has "$field"; then
    ALL_PRESENT=false
    break
  fi
done
if [ "$ALL_PRESENT" = true ]; then
  check 4 "All required fields present" "pass"
else
  check 4 "All required fields present" "fail"
fi

# 5. Name follows pattern
NAME=$(json_get "name" 2>/dev/null || echo "")
if echo "$NAME" | grep -qE '^[a-z0-9-]+$'; then
  check 5 "Name follows pattern (lowercase, numbers, hyphens)" "pass"
else
  check 5 "Name follows pattern (lowercase, numbers, hyphens)" "fail"
fi

# 6. Version follows semver
VERSION=$(json_get "version" 2>/dev/null || echo "")
if echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  check 6 "Version follows semver pattern" "pass"
else
  check 6 "Version follows semver pattern" "fail"
fi

# 7. Category is valid
CATEGORY=$(json_get "category" 2>/dev/null || echo "")
case "$CATEGORY" in
  monitor|auditor|dashboard|integration)
    check 7 "Category is valid" "pass"
    ;;
  *)
    check 7 "Category is valid" "fail"
    ;;
esac

# 8. Author has name field
if json_has "author.name"; then
  check 8 "Author has name field" "pass"
else
  check 8 "Author has name field" "fail"
fi

# 9. Requires has agent-sentry field
if json_has "requires.agent-sentry"; then
  check 9 "Requires has agent-sentry field" "pass"
else
  check 9 "Requires has agent-sentry field" "fail"
fi

# 10. src/index.ts exists
if [ -f "${PLUGIN_PATH}/src/index.ts" ]; then
  check 10 "src/index.ts exists" "pass"
else
  check 10 "src/index.ts exists" "fail"
fi

# 11. README.md exists
if [ -f "${PLUGIN_PATH}/README.md" ]; then
  check 11 "README.md exists" "pass"
else
  check 11 "README.md exists" "fail"
fi

echo "---"
echo "Results: ${PASS} passed, ${FAIL} failed out of ${TOTAL} checks"

if [ "$FAIL" -gt 0 ]; then
  red "Plugin validation FAILED"
  exit 1
else
  green "Plugin validation PASSED"
  exit 0
fi
