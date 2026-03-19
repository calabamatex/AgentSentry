---
name: agentops-check
description: >
  Quick health check for the current session. Reports git status, context usage,
  rules compliance, blast radius, and active warnings. Use at any time.
---

Run a quick AgentOps health check. Gather data and present results in this exact format:

```
AgentOps Session Health
───────────────────────────────────────────────
◉ Save Points      Last commit: {time} ago ({n} files uncommitted)
◉ Context Health    ~{pct}% capacity, {n} messages, {degradation status}
◉ Standing Orders   AGENTS.md: {n} lines, {violations} violations this session
◉ Blast Radius      Current task: {n} files modified ({LOW|MEDIUM|HIGH} risk)
◉ Safety Checks     {status}
───────────────────────────────────────────────
▲ {count} advisories: {summary}
```

## Data gathering steps

1. **Save Points**: Run `git log -1 --format='%cr'` for last commit time. Run `git status --porcelain | wc -l` for uncommitted file count.

2. **Context Health**: Estimate context usage as percentage. Count messages in this session. Note any degradation signals (repeated errors, instruction violations, contradictions). If no signals: "no degradation".

3. **Standing Orders**: Check if AGENTS.md exists (`test -f AGENTS.md`), count lines (`wc -l < AGENTS.md`). Check if CLAUDE.md exists, count lines. Check for required sections (security, error handling) with `grep -ci`. Report 0 violations unless you detected rules violations during this session.

4. **Blast Radius**: Count files modified in this session via `git diff --name-only | wc -l`. Classify risk: 1-3 files = LOW, 4-8 = MEDIUM, 9+ = HIGH.

5. **Safety Checks**: Check .gitignore exists and covers `.env` patterns (`grep -q '\.env' .gitignore`). Check scaffold docs exist: PLANNING.md, TASKS.md, CONTEXT.md, WORKFLOW.md. Report any missing.

6. **Advisories**: Compile a list of all warnings found:
   - CONTEXT.md missing or stale (last modified > 7 days ago)
   - Missing scaffold docs
   - .gitignore missing .env coverage
   - AGENTS.md or CLAUDE.md missing required sections
   - No commits in last 24 hours during active work

Present the dashboard, then list advisories below it.
