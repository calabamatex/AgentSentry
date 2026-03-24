#!/usr/bin/env bash
# =============================================================================
# [AgentSentry] Testing & Evaluation Framework (S18)
# =============================================================================
# Runs all golden datasets found in agent-sentry/evals/*/cases.yaml.
# For each test case the target script is executed with a synthetic hook
# payload, and the outcome is compared against the expected result.
#
# Exit 0: all cases passed
# Exit 1: one or more cases failed
# =============================================================================

set -euo pipefail

PREFIX="[AgentSentry]"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTOPS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EVALS_DIR="$AGENTOPS_DIR/evals"

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------
for cmd in jq yq; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "$PREFIX ERROR: '$cmd' is required but not found in PATH." >&2
        exit 1
    fi
done

# ---------------------------------------------------------------------------
# Resolve target script for a given eval suite
# ---------------------------------------------------------------------------
resolve_script() {
    local suite_name="$1"
    local script="$AGENTOPS_DIR/scripts/${suite_name}.sh"
    if [[ -f "$script" ]]; then
        echo "$script"
    else
        echo ""
    fi
}

# ---------------------------------------------------------------------------
# Build a minimal Claude Code hook JSON payload from inline content
# ---------------------------------------------------------------------------
build_payload() {
    local content="$1"
    jq -n --arg c "$content" '{
        tool_name: "Write",
        tool_input: {
            file_path: "/tmp/eval-test-file.txt",
            content: $c
        }
    }'
}

# ---------------------------------------------------------------------------
# Run a single test case
# Returns 0 on pass, 1 on fail. Prints a one-line result.
# ---------------------------------------------------------------------------
run_case() {
    local suite_name="$1"
    local case_index="$2"
    local cases_file="$3"
    local script="$4"

    local name expected_blocked expected_pattern input_content

    name="$(yq -r ".[$case_index].name" "$cases_file")"
    expected_blocked="$(yq -r ".[$case_index].expected.blocked" "$cases_file")"
    expected_pattern="$(yq -r ".[$case_index].expected.pattern" "$cases_file")"
    input_content="$(yq -r ".[$case_index].input" "$cases_file")"

    # Execute the target script with the synthetic payload
    local exit_code=0
    local output=""
    output="$(build_payload "$input_content" | bash "$script" 2>&1)" || exit_code=$?

    # Determine actual blocked state from exit code
    local actual_blocked="false"
    if [[ "$exit_code" -eq 2 ]]; then
        actual_blocked="true"
    elif [[ "$exit_code" -ne 0 ]]; then
        echo "  FAIL  $name"
        echo "        unexpected exit code $exit_code"
        return 1
    fi

    # Compare blocked expectation
    if [[ "$actual_blocked" != "$expected_blocked" ]]; then
        echo "  FAIL  $name"
        echo "        expected blocked=$expected_blocked, got blocked=$actual_blocked"
        return 1
    fi

    # If blocked, verify the expected pattern appears in the output
    if [[ "$expected_blocked" == "true" ]]; then
        if ! echo "$output" | grep -qF "$expected_pattern"; then
            echo "  FAIL  $name"
            echo "        expected pattern '$expected_pattern' not found in output"
            return 1
        fi
    fi

    echo "  PASS  $name"
    return 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo "$PREFIX =========================================="
echo "$PREFIX  Evaluation Framework"
echo "$PREFIX =========================================="
echo ""

TOTAL=0
PASSED=0
FAILED=0
SUITES_RUN=0

if [[ ! -d "$EVALS_DIR" ]]; then
    echo "$PREFIX No evals directory found at $EVALS_DIR"
    exit 0
fi

for cases_file in "$EVALS_DIR"/*/cases.yaml; do
    [[ -f "$cases_file" ]] || continue

    suite_dir="$(dirname "$cases_file")"
    suite_name="$(basename "$suite_dir")"

    script="$(resolve_script "$suite_name")"
    if [[ -z "$script" ]]; then
        echo "$PREFIX WARN: No script found for suite '$suite_name', skipping."
        echo ""
        continue
    fi

    SUITES_RUN=$((SUITES_RUN + 1))
    case_count="$(yq 'length' "$cases_file")"

    echo "$PREFIX Suite: $suite_name ($case_count cases)"
    echo "$PREFIX Script: $script"
    echo "$PREFIX ------------------------------------------"

    for ((i = 0; i < case_count; i++)); do
        TOTAL=$((TOTAL + 1))
        if run_case "$suite_name" "$i" "$cases_file" "$script"; then
            PASSED=$((PASSED + 1))
        else
            FAILED=$((FAILED + 1))
        fi
    done
    echo ""
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "$PREFIX =========================================="
echo "$PREFIX  Results: $PASSED/$TOTAL passed ($SUITES_RUN suites)"
if [[ $FAILED -gt 0 ]]; then
    echo "$PREFIX  FAILED: $FAILED case(s)"
fi
echo "$PREFIX =========================================="

if [[ $FAILED -gt 0 ]]; then
    exit 1
fi

exit 0
