---
name: agentops-audit
description: >
  Full project audit. Runs all checks across all 5 AgentOps skills and presents
  results grouped by severity (Critical, Warning, Advisory, Pass).
---

Run a comprehensive AgentOps audit on this project. Execute all checks and present a full report.

## Phase 1: Run audit scripts

1. Run `bash agentops/scripts/security-audit.sh` and capture its output
2. Run `bash agentops/scripts/rules-file-linter.sh` and capture its output

## Phase 2: Run skill-specific checks

### Skill 1 — Save Points
- Check git initialized: `git rev-parse --is-inside-work-tree`
- Check .gitignore covers secrets: `grep -q '\.env' .gitignore`
- Check recent commits: `git log --oneline -1 --since='24 hours ago'` (warn if empty)
- Check commit frequency: `git log --oneline --since='7 days ago' | wc -l` (warn if < 3)

### Skill 2 — Context Health
- Check PLANNING.md exists
- Check TASKS.md exists with at least 1 task
- Check CONTEXT.md exists and freshness (warn if > 7 days stale)
- Check WORKFLOW.md exists

### Skill 3 — Standing Orders
- Check AGENTS.md exists and is non-empty
- Check CLAUDE.md (or tool-specific rules) exists
- Check both have security section: `grep -ci 'security'`
- Check both have error handling section: `grep -ci 'error handling'`
- Check combined line count < 300

### Skill 4 — Small Bets
- Check average commit size: `git log --oneline -20 --stat | grep 'files changed'` (warn if median > 8)
- Check for mega-commits: any single commit touching 20+ files
- Check branch usage: core changes not on main

### Skill 5 — Safety
- Results from security-audit.sh (Phase 1)
- Results from rules-file-linter.sh (Phase 1)
- Check dependency health: `npm audit --json 2>/dev/null | head -5` if package.json exists

## Phase 3: Present report

Show summary counts at the top:
```
AgentOps Full Audit Report
═══════════════════════════════════════════════
  CRITICAL: {n}  |  WARNING: {n}  |  ADVISORY: {n}  |  PASS: {n}
═══════════════════════════════════════════════
```

Then group all findings by severity:

### CRITICAL (must fix)
List all critical findings with check name and detail.

### WARNING (should fix)
List all warnings with check name and detail.

### ADVISORY (recommendations)
List all advisories with check name and detail.

### PASS
List all checks that passed.
