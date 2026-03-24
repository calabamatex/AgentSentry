#!/usr/bin/env bash
# [AgentSentry] Rules File Linter — Standalone audit script (§4.4)
# Validates AGENTS.md, CLAUDE.md, and other tool-specific rules files for
# structure, size, contradictions, clarity, and completeness.
# Invoked by: /agent-sentry audit
# Exit 0 always (advisory tool, never blocks).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../agent-sentry.config.json"
PREFIX="[AgentSentry]"

# ---------------------------------------------------------------------------
# Locate project root (walk up to find .git or stop at /)
# ---------------------------------------------------------------------------
find_project_root() {
    local dir="$SCRIPT_DIR"
    while [[ "$dir" != "/" ]]; do
        if [[ -d "$dir/.git" ]]; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    echo "$SCRIPT_DIR/../.."
}

PROJECT_ROOT="$(find_project_root)"

# ---------------------------------------------------------------------------
# Parse config (with jq, falling back to defaults)
# ---------------------------------------------------------------------------
MAX_LINES=300
REQUIRED_SECTIONS=("security" "error handling")

if command -v jq &>/dev/null && [[ -f "$CONFIG_FILE" ]]; then
    MAX_LINES=$(jq -r '.rules_file.max_lines // 300' "$CONFIG_FILE" 2>/dev/null || echo 300)
    # Read required_sections as a bash array
    REQUIRED_SECTIONS=()
    while IFS= read -r line; do
        REQUIRED_SECTIONS+=("$line")
    done < <(jq -r '.rules_file.required_sections[]? // empty' "$CONFIG_FILE" 2>/dev/null || printf 'security\nerror handling\n')
    if [[ ${#REQUIRED_SECTIONS[@]} -eq 0 ]]; then
        REQUIRED_SECTIONS=("security" "error handling")
    fi
else
    echo "$PREFIX WARNING — jq not found or config missing; using defaults." >&2
fi

# ---------------------------------------------------------------------------
# Discover rules files
# ---------------------------------------------------------------------------
RULES_FILES=()
for candidate in "$PROJECT_ROOT/AGENTS.md" "$PROJECT_ROOT/CLAUDE.md"; do
    if [[ -f "$candidate" ]]; then
        RULES_FILES+=("$candidate")
    fi
done

# Also scan for nested rules files (e.g. .claude/AGENTS.md, src/AGENTS.md)
while IFS= read -r -d '' f; do
    # Skip if already in the list
    already=false
    for existing in "${RULES_FILES[@]+"${RULES_FILES[@]}"}"; do
        if [[ "$f" == "$existing" ]]; then
            already=true
            break
        fi
    done
    if [[ "$already" == false ]]; then
        RULES_FILES+=("$f")
    fi
done < <(find "$PROJECT_ROOT" -maxdepth 3 -type f \( -name "AGENTS.md" -o -name "CLAUDE.md" \) -not -path "*/node_modules/*" -not -path "*/.git/*" -print0 2>/dev/null || true)

echo "$PREFIX ─── Rules File Linter ───"
echo ""

if [[ ${#RULES_FILES[@]} -eq 0 ]]; then
    echo "$PREFIX WARN  [DISCOVERY] No rules files found (AGENTS.md / CLAUDE.md)."
    echo "$PREFIX        Recommend creating at least one rules file at the project root."
    echo ""
    exit 0
fi

echo "$PREFIX Found ${#RULES_FILES[@]} rules file(s):"
for f in "${RULES_FILES[@]}"; do
    echo "$PREFIX   - ${f#"$PROJECT_ROOT/"}"
done
echo ""

# Counters
TOTAL_PASS=0
TOTAL_WARN=0
TOTAL_ADVISORY=0

# Helper: print result line
result() {
    local level="$1" check="$2" msg="$3"
    case "$level" in
        PASS)     echo "$PREFIX PASS  [$check] $msg"; ((TOTAL_PASS++)) ;;
        WARN)     echo "$PREFIX WARN  [$check] $msg"; ((TOTAL_WARN++)) ;;
        ADVISORY) echo "$PREFIX ADVISORY [$check] $msg"; ((TOTAL_ADVISORY++)) ;;
    esac
}

# ---------------------------------------------------------------------------
# CHECK 1: STRUCTURE — Required sections present
# ---------------------------------------------------------------------------
echo "$PREFIX ── Check: STRUCTURE ──"

for f in "${RULES_FILES[@]}"; do
    fname="${f#"$PROJECT_ROOT/"}"
    for section in "${REQUIRED_SECTIONS[@]}"; do
        count=$(grep -ci "$section" "$f" 2>/dev/null || true)
        if [[ -z "$count" || "$count" -eq 0 ]]; then
            result "WARN" "STRUCTURE" "$fname — missing required section: '$section'"
        else
            result "PASS" "STRUCTURE" "$fname — contains '$section' section ($count reference(s))"
        fi
    done
done
echo ""

# ---------------------------------------------------------------------------
# CHECK 2: SIZE — Combined line count under max_lines
# ---------------------------------------------------------------------------
echo "$PREFIX ── Check: SIZE ──"

total_lines=0
for f in "${RULES_FILES[@]}"; do
    fname="${f#"$PROJECT_ROOT/"}"
    lines=$(wc -l < "$f" 2>/dev/null || echo 0)
    lines=$(echo "$lines" | tr -d '[:space:]')
    total_lines=$((total_lines + lines))
    echo "$PREFIX        $fname: $lines lines"
done

if [[ "$total_lines" -gt "$MAX_LINES" ]]; then
    result "WARN" "SIZE" "Combined rules files total $total_lines lines (max: $MAX_LINES). Consider splitting or trimming."
else
    result "PASS" "SIZE" "Combined rules files total $total_lines lines (max: $MAX_LINES)."
fi
echo ""

# ---------------------------------------------------------------------------
# CHECK 3: CONTRADICTIONS — Opposing directives across files
# ---------------------------------------------------------------------------
echo "$PREFIX ── Check: CONTRADICTIONS ──"

if [[ ${#RULES_FILES[@]} -lt 2 ]]; then
    result "PASS" "CONTRADICTIONS" "Only one rules file found; cross-file contradiction check skipped."
else
    contradiction_found=false

    # Collect all ALWAYS and NEVER directives from each file
    declare -A always_directives
    declare -A never_directives

    for f in "${RULES_FILES[@]}"; do
        fname="${f#"$PROJECT_ROOT/"}"
        # Extract "always <topic>" patterns (case-insensitive, grab next few words)
        while IFS= read -r line; do
            # Normalize: lowercase, strip punctuation, collapse whitespace
            normalized=$(echo "$line" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]/ /g' | tr -s ' ')
            # Look for "always <words>"
            if echo "$normalized" | grep -q 'always'; then
                topic=$(echo "$normalized" | sed -n 's/.*always \+\([a-z0-9 ]\{3,40\}\).*/\1/p' | head -1)
                if [[ -n "$topic" ]]; then
                    topic=$(echo "$topic" | xargs)  # trim
                    always_directives["$fname|$topic"]="$line"
                fi
            fi
            # Look for "never <words>"
            if echo "$normalized" | grep -q 'never'; then
                topic=$(echo "$normalized" | sed -n 's/.*never \+\([a-z0-9 ]\{3,40\}\).*/\1/p' | head -1)
                if [[ -n "$topic" ]]; then
                    topic=$(echo "$topic" | xargs)  # trim
                    never_directives["$fname|$topic"]="$line"
                fi
            fi
        done < "$f"
    done

    # Cross-check: if file A says "always X" and file B says "never X" (or vice versa)
    for always_key in "${!always_directives[@]}"; do
        always_file="${always_key%%|*}"
        always_topic="${always_key#*|}"
        for never_key in "${!never_directives[@]}"; do
            never_file="${never_key%%|*}"
            never_topic="${never_key#*|}"
            # Only flag cross-file contradictions
            if [[ "$always_file" != "$never_file" ]]; then
                # Check if topics overlap (one contains the other or first 3 words match)
                always_words=$(echo "$always_topic" | awk '{print $1, $2, $3}')
                never_words=$(echo "$never_topic" | awk '{print $1, $2, $3}')
                if [[ "$always_words" == "$never_words" && -n "$always_words" ]]; then
                    result "WARN" "CONTRADICTIONS" "Potential conflict: '$always_file' says ALWAYS '$always_topic' but '$never_file' says NEVER '$never_topic'"
                    contradiction_found=true
                fi
            fi
        done
    done

    # Also check within a single file for ALWAYS/NEVER on same topic
    for f in "${RULES_FILES[@]}"; do
        fname="${f#"$PROJECT_ROOT/"}"
        for always_key in "${!always_directives[@]}"; do
            [[ "${always_key%%|*}" == "$fname" ]] || continue
            always_topic="${always_key#*|}"
            for never_key in "${!never_directives[@]}"; do
                [[ "${never_key%%|*}" == "$fname" ]] || continue
                never_topic="${never_key#*|}"
                always_words=$(echo "$always_topic" | awk '{print $1, $2, $3}')
                never_words=$(echo "$never_topic" | awk '{print $1, $2, $3}')
                if [[ "$always_words" == "$never_words" && -n "$always_words" ]]; then
                    result "WARN" "CONTRADICTIONS" "Potential conflict within '$fname': ALWAYS '$always_topic' vs NEVER '$never_topic'"
                    contradiction_found=true
                fi
            done
        done
    done

    if [[ "$contradiction_found" == false ]]; then
        result "PASS" "CONTRADICTIONS" "No obvious ALWAYS/NEVER contradictions detected across rules files."
    fi
fi
echo ""

# ---------------------------------------------------------------------------
# CHECK 4: CLARITY — Flag vague language
# ---------------------------------------------------------------------------
echo "$PREFIX ── Check: CLARITY ──"

VAGUE_PATTERNS=(
    "maybe"
    "sometimes"
    "try to"
    "if possible"
    "consider"
    "might want"
    "could potentially"
    "when feasible"
    "ideally"
    "optionally"
    "where appropriate"
    "as needed"
)

vague_found=false
for f in "${RULES_FILES[@]}"; do
    fname="${f#"$PROJECT_ROOT/"}"
    for pattern in "${VAGUE_PATTERNS[@]}"; do
        matches=$(grep -ni "$pattern" "$f" 2>/dev/null || true)
        if [[ -n "$matches" ]]; then
            vague_found=true
            while IFS= read -r match; do
                line_num=$(echo "$match" | cut -d: -f1)
                result "ADVISORY" "CLARITY" "$fname:$line_num — vague language '$pattern' found. Use absolute directives (MUST/MUST NOT/ALWAYS/NEVER)."
            done <<< "$matches"
        fi
    done
done

if [[ "$vague_found" == false ]]; then
    result "PASS" "CLARITY" "No vague language detected. Rules use clear, absolute directives."
fi
echo ""

# ---------------------------------------------------------------------------
# CHECK 5: COMPLETENESS — Common risk topics covered
# ---------------------------------------------------------------------------
echo "$PREFIX ── Check: COMPLETENESS ──"

RISK_TOPICS=(
    "security:security"
    "error handling:error.handl"
    "secrets/credentials:secret\|credential\|api.key\|token"
    "input validation:input.valid\|sanitiz\|validat"
)

# Concatenate all rules files for a combined check
combined_content=""
for f in "${RULES_FILES[@]}"; do
    combined_content+=$'\n'"$(cat "$f" 2>/dev/null)"
done

for entry in "${RISK_TOPICS[@]}"; do
    topic="${entry%%:*}"
    pattern="${entry#*:}"
    count=$(echo "$combined_content" | grep -ci "$pattern" 2>/dev/null || true)
    if [[ -z "$count" || "$count" -eq 0 ]]; then
        result "WARN" "COMPLETENESS" "No mention of '$topic' found across rules files. Consider adding guidance."
    else
        result "PASS" "COMPLETENESS" "'$topic' covered ($count reference(s) across all rules files)."
    fi
done
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "$PREFIX ─── Summary ───"
echo "$PREFIX   PASS:     $TOTAL_PASS"
echo "$PREFIX   WARN:     $TOTAL_WARN"
echo "$PREFIX   ADVISORY: $TOTAL_ADVISORY"
echo ""

if [[ "$TOTAL_WARN" -gt 0 ]]; then
    echo "$PREFIX Action recommended: Review WARN items above to strengthen rules files."
elif [[ "$TOTAL_ADVISORY" -gt 0 ]]; then
    echo "$PREFIX Rules files are solid. Consider addressing ADVISORY items for further clarity."
else
    echo "$PREFIX All checks passed. Rules files are well-structured."
fi

exit 0
