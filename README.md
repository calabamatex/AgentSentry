# AgentOps

![AgentOps Banner](agentops/dashboard/assets/agentops-banner.png)

**A standalone management and safety framework for AI agent oversight.**

<!-- Badges placeholder: version, license, tests, platform support -->

---

## What is AgentOps

AgentOps is a standalone framework for managing, monitoring, and safeguarding AI coding agents. It is not tied to any single platform or provider. AgentOps works with Claude Code, Cursor, Codex, GitHub Copilot, and any agent that operates through a CLI or editor integration. It gives engineering teams consistent oversight across every agent session through structured checkpoints, context monitoring, safety checks, and audit trails.

## Key Features

### Core Skills

- **Save Points** -- Automatic git checkpoints at configurable intervals, with branch-on-risk for dangerous operations.
- **Context Health** -- Monitors token usage and conversation length, warns before context windows overflow, and recommends session handoffs.
- **Standing Orders** -- Lints and enforces rules files (CLAUDE.md, .cursorrules, etc.) so agents stay aligned with project conventions.
- **Small Bets** -- Scores tasks by file count and complexity, flags oversized changes, and enforces incremental delivery.
- **Safety Checks** -- Scans for leaked secrets, validates permissions, and blocks commits containing sensitive data.

### Advanced Capabilities

- **Tracing** -- Structured span-based tracing for agent actions with OpenTelemetry-compatible context propagation.
- **Permissions** -- File-level and command-level permission enforcement with allowlist/denylist support.
- **Cost Management** -- Per-session and monthly budget tracking with configurable warn and hard-stop thresholds.
- **Lifecycle Management** -- Session start, checkpoint, and teardown hooks for repeatable agent workflows.
- **Audit Trail** -- Append-only event log capturing every significant agent action for post-hoc review.
- **Plugins** -- Community plugin loader for extending AgentOps with custom checks and integrations.
- **Evals** -- Built-in evaluation harness for testing safety rules against known attack patterns.

## Quick Start

1. Clone this repository:

```bash
git clone <repo-url>
cd AgenticManagement
```

2. Copy the `agentops/` directory into your target project:

```bash
cp -r agentops/ /path/to/your/project/agentops/
```

3. Set up git hooks:

```bash
cd /path/to/your/project
git config core.hooksPath .githooks
```

4. For Claude Code, copy the slash commands and add hook entries:

```bash
cp -r agentops/.claude/commands/agentops/ .claude/commands/agentops/
```

Then add the following to your `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{ "command": "bash agentops/scripts/permission-enforcer.sh" }],
    "PostToolUse": [{ "command": "bash agentops/scripts/post-write-checks.sh" }],
    "SessionStart": [{ "command": "bash agentops/scripts/session-start-checks.sh" }]
  }
}
```

5. Verify the installation:

```
/agentops check
```

## Project Structure

```
agentops/
  agentops.config.json        # Central configuration and thresholds
  scripts/
    session-start-checks.sh   # Runs all checks at session start
    session-checkpoint.sh      # Creates save points
    context-estimator.sh       # Monitors context health
    task-sizer.sh              # Scores task complexity
    secret-scanner.sh          # Detects leaked secrets
    security-audit.sh          # Full security audit
    permission-enforcer.sh     # File/command permissions
    cost-tracker.sh            # Budget enforcement
    lifecycle-manager.sh       # Session lifecycle hooks
    post-write-checks.sh       # Post-write validation
    git-hygiene-check.sh       # Git state validation
    rules-file-linter.sh       # Rules file linting
    delegation-validator.sh    # Agent delegation checks
    provider-health.sh         # Provider status checks
    run-evals.sh               # Evaluation runner
  templates/
    CONTEXT.md.template        # Context handoff template
    PLANNING.md.template       # Planning document template
    TASKS.md.template          # Task tracking template
    WORKFLOW.md.template       # Workflow definition template
  dashboard/
    agentops-dashboard.html    # Single-file monitoring dashboard
    data/                      # Dashboard data directory
  tracing/
    trace-context.ts           # Span-based tracing implementation
  audit/
    audit-logger.ts            # Append-only audit log
  core/
    event-bus.ts               # Internal event bus
  plugins/
    plugin-loader.sh           # Community plugin loader
    community/                 # Community plugins directory
  evals/
    secret-scanner/
      cases.yaml               # Secret scanner test cases
```

## Slash Commands

- `/agentops check` -- Run all health and safety checks against the current session.
- `/agentops audit` -- Generate a full security audit report for the project.
- `/agentops scaffold` -- Create standard planning and workflow files from templates.

## Dashboard

The AgentOps dashboard is a single HTML file with no external dependencies.

<!-- Screenshot placeholder: agentops/dashboard/screenshot.png -->

To open it locally:

```bash
open agentops/dashboard/agentops-dashboard.html
# Or serve it:
npx serve agentops/dashboard/
```

## Configuration

All thresholds and behavior are controlled through `agentops/agentops.config.json`. Key settings:

| Section          | Setting                     | Default |
|------------------|-----------------------------|---------|
| save_points      | auto_commit_after_minutes   | 30      |
| save_points      | auto_branch_on_risk_score   | 8       |
| context_health   | message_count_warning       | 20      |
| context_health   | context_percent_critical    | 80      |
| task_sizing      | high_risk_threshold         | 8       |
| task_sizing      | max_files_per_task_critical | 8       |
| security         | block_on_secret_detection   | true    |
| budget           | session_budget              | $10     |
| budget           | monthly_budget              | $500    |

See the full configuration file for all available options.

## Built With

This project was designed and built using RuFlo agent swarms -- coordinated multi-agent workflows for specification, architecture, implementation, and validation.

## License

MIT -- see LICENSE for details.

## Links

- [AgentOps Product Specification](AgentOps-Product-Spec.md) -- Full product spec covering architecture, skills, and integration patterns.
- [Implementation Plan](IMPLEMENTATION-PLAN.md) -- Phased build plan and task breakdown.
- [Architecture Evolution](AgentOps-Architecture-Evolution.md) -- Design decisions and architectural history.
- [Agent Management Guide](Agent-Management-Implementation-Guide.md) -- Practical guide for managing AI agents.
