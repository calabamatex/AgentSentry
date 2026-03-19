# AgentOps Commands

Slash commands for the AgentOps management oversight system.

## Available Commands

### `/agentops check`
Quick session health check. Reports git status, rules compliance, scaffold doc status, and active warnings. Use at any time during a session.

### `/agentops audit` (Phase 4)
Full project audit. Runs all checks across all 5 skills: save points, context health, standing orders, task sizing, and safety checks. Output grouped by severity.

### `/agentops scaffold` (Phase 3)
Create or update scaffold documents (PLANNING.md, TASKS.md, CONTEXT.md, WORKFLOW.md). Generates handoff messages for fresh sessions.

## Hook Scripts

These run automatically via `.claude/settings.json` hooks:

| Script | Hook Event | Purpose |
|---|---|---|
| `secret-scanner.sh` | PreToolUse (Write\|Edit) | Blocks hardcoded secrets |
| `git-hygiene-check.sh` | PreToolUse (Write\|Edit\|Bash) | Enforces checkpoint discipline |
| `session-start-checks.sh` | SessionStart | Validates rules files and git state |
