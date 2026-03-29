# AgentOps Quick-Start Guide

Install AgentOps into an existing project in under ten minutes. This guide walks through every step from prerequisites to your first audit.

---

## Feature Maturity

| Feature | Status |
|---------|--------|
| Save Points | **[stable]** |
| Context Health | **[stable]** |
| Standing Orders | **[stable]** |
| Small Bets (Task Sizing) | **[stable]** |
| Safety (Secret Scanner) | **[stable]** |
| Distributed Tracing | **[beta]** |
| Agent Identity & Permissions | **[beta]** |
| Agent-to-Agent Delegation | **[beta]** |
| Cost Tracking | **[beta]** |
| Plugin Architecture | **[stable]** |
| Persistent Memory Store | **[stable]** |
| MCP Server Interface (9 tools) | **[stable]** |
| Primitives Library (7 modules) | **[stable]** |
| Progressive Enablement (5 levels) | **[stable]** |
| Auto-Classification Enrichment | **[beta]** |
| Semantic Audit Search | **[beta]** |

---

## 1. Requirements

| Category | Tool | Version | Purpose |
|----------|------|---------|---------|
| **Required** | bash | 3.2+ | All AgentOps scripts are bash-based |
| **Required** | git | 2.x | Hooks, hygiene checks, commit tracking |
| **Recommended** | jq | 1.6+ | Config parsing in shell scripts (falls back to defaults without it) |
| **Required** | Node.js | 18+ | TypeScript runtime for MCP server, primitives, and memory store |
| **Evals only** | yq | latest | YAML eval fixtures |

Verify them quickly:

```bash
bash --version | head -1
git --version
jq --version        # recommended — scripts fall back to defaults without it
yq --version        # optional — needed for YAML eval fixtures only
```

---

## 2. Install AgentOps

Copy the `agent-sentry/` directory from this repository into the root of your project:

```bash
cp -r /path/to/AgenticManagement/agentops /path/to/your-project/agentops
```

Your project tree should now contain:

```
your-project/
  agent-sentry/
    agentops.config.json
    scripts/
    dashboard/
    templates/
    audit/
    plugins/
    src/
      memory/          # Persistent memory store
      mcp/             # MCP server (9 tools)
      primitives/      # Composable TypeScript primitives
      enablement/      # Progressive skill enablement
    config/            # JSON schemas
    ...
```

---

## 2b. Install Node Dependencies

AgentOps v4.0 includes TypeScript modules that require Node.js:

```bash
cd agent-sentry && npm install
```

This installs the MCP SDK, vector search, and other runtime dependencies.

---

## 3. Set Up Git Hooks

AgentOps ships two git hooks (`pre-commit` and `post-commit`) that scan for secrets and track commits automatically.

```bash
# Copy the hooks directory into your project
cp -r /path/to/AgenticManagement/.githooks /path/to/your-project/.githooks

# Tell git to use it
cd /path/to/your-project
git config core.hooksPath .githooks
```

The **pre-commit** hook blocks commits that contain hardcoded secrets, leaked API keys, `.env` files, PII in logging statements, or WASM build artifacts. The **post-commit** hook updates `WORKFLOW.md` with a commit summary and resets blast-radius counters.

---

## 4. Create Rules Files

### AGENTS.md (cross-tool, universal)

Copy the `AGENTS.md` file from this repository into your project root:

```bash
cp /path/to/AgenticManagement/AGENTS.md /path/to/your-project/AGENTS.md
```

`AGENTS.md` defines rules that every AI coding tool honors (Claude Code, Cursor, Windsurf, Copilot, and others). Edit it to match your project conventions.

### CLAUDE.md (Claude Code specific, optional)

If you use Claude Code, create a `CLAUDE.md` at your project root with project-specific rules and agent configuration. The session-start checks will verify that it exists and contains required sections (`security`, `error handling`) as well as an AgentOps reference.

---

## 5. Configure for Claude Code

Add the AgentOps hook entries to `.claude/settings.json` in your project. Create the file if it does not exist. Below is the minimal AgentSentry-specific configuration -- merge these entries into any existing hooks you already have:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "bash agent-sentry/scripts/secret-scanner.sh",
            "timeout": 5000
          },
          {
            "type": "command",
            "command": "bash agent-sentry/scripts/git-hygiene-check.sh --pre-write",
            "timeout": 5000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "bash agent-sentry/scripts/post-write-checks.sh",
            "timeout": 10000
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash agent-sentry/scripts/task-sizer.sh",
            "timeout": 5000
          },
          {
            "type": "command",
            "command": "bash agent-sentry/scripts/context-estimator.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash agent-sentry/scripts/session-start-checks.sh",
            "timeout": 10000
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash agent-sentry/scripts/session-checkpoint.sh",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
```

### What each hook does

| Hook event | Script | Behavior |
|-----------|--------|----------|
| **PreToolUse** (`Write\|Edit\|MultiEdit`) | `secret-scanner.sh` | Blocks file writes that contain hardcoded secrets or API keys (exit 2 = block) |
| **PreToolUse** (`Write\|Edit\|MultiEdit`) | `git-hygiene-check.sh --pre-write` | Warns when uncommitted file count is high or blast radius is growing |
| **PostToolUse** (`Write\|Edit\|MultiEdit`) | `post-write-checks.sh` | Runs post-write validations (lint-level checks, file-count tracking) |
| **UserPromptSubmit** | `task-sizer.sh` | Scores the incoming prompt for risk and emits advisory notifications |
| **UserPromptSubmit** | `context-estimator.sh` | Estimates context window usage and warns before it gets critical |
| **SessionStart** | `session-start-checks.sh` | Validates rules files, scaffold docs, and git state at session open |
| **Stop** | `session-checkpoint.sh` | Saves a checkpoint of session state for continuity across sessions |

---

## 5b. Configure MCP Server (Optional)

AgentOps exposes 9 tools via the Model Context Protocol. Register with Claude Code:

```bash
claude mcp add agentops -- node agent-sentry/dist/src/mcp/server.js
```

This gives Claude Code direct access to: `agentops_check_git`, `agentops_check_context`, `agentops_check_rules`, `agentops_size_task`, `agentops_scan_security`, `agentops_capture_event`, `agentops_search_history`, `agentops_health`, and `agentops_recall_context`.

For HTTP transport (team/remote access):

```bash
node agent-sentry/dist/src/mcp/server.js --http --port 3100
```

---

## 5c. Choose Enablement Level (Optional)

AgentOps supports 5 progressive adoption levels:

| Level | Name | Skills Active |
|-------|------|--------------|
| 1 | Safe Ground | Save Points |
| 2 | Clear Head | + Context Health |
| 3 | House Rules | + Standing Orders |
| 4 | Right Size | + Small Bets |
| 5 | Full Guard | + Proactive Safety |

Run the setup wizard (a configuration generator that writes enablement settings to `agentops.config.json`):

```bash
bash agent-sentry/scripts/setup-wizard.sh
```

Or set a level directly:

```bash
bash agent-sentry/scripts/setup-wizard.sh --level 3
```

Preview without writing changes:

```bash
bash agent-sentry/scripts/setup-wizard.sh --dry-run
```

The wizard prompts for an enablement level (1-5), generates the corresponding enablement JSON, and merges it into `agentops.config.json`. It does **not** install git hooks, register MCP servers, or modify `.claude/settings.json` -- those are separate steps.

---

## 5d. Manual Wiring (Required Separately)

The setup wizard handles enablement configuration only. You must wire up hooks and MCP registration separately:

1. **Git hooks** -- see Step 3 above.
2. **Claude Code hooks** -- see Step 5 above (`.claude/settings.json`).
3. **MCP server registration:**

```bash
claude mcp add agentops -- node agent-sentry/dist/src/mcp/server.js
```

---

## 6. Configure for Other Tools

`AGENTS.md` is a universal rules file recognized by most AI coding tools. No extra integration work is needed for tools that read it natively.

For tools that do not support Claude Code-style hooks, you can still get value from AgentOps by:

- Running the scripts manually (see step 7).
- Wiring the scripts into your tool's extension or plugin system.
- Using the git hooks (step 3), which work with every tool that commits through git.

The `agent-sentry/plugins/plugin-loader.sh` script provides an extension point for custom integrations.

---

## 7. Verify Installation

Run the session-start health check to confirm everything is wired up:

```bash
bash agent-sentry/scripts/session-start-checks.sh
```

You should see output like:

```
[AgentOps] Session Start Health Check
───────────────────────────────────────────────
  ○ ADVISORY: Missing scaffold docs: PLANNING.md TASKS.md CONTEXT.md WORKFLOW.md. Run /agentops scaffold to create them.
───────────────────────────────────────────────
[AgentOps] 0 critical, 0 warnings, 1 advisories
```

If you are inside Claude Code, you can also run:

```
/agentops check
```

Fix any CRITICAL or WARNING items before proceeding.

---

## 8. Create Scaffold Documents

AgentOps uses four markdown documents to maintain project context across sessions. Generate them from the bundled templates:

```
/agentops scaffold
```

This creates:

| File | Purpose |
|------|---------|
| `PLANNING.md` | High-level architecture and design decisions |
| `TASKS.md` | Current task list and backlog |
| `CONTEXT.md` | Session context summary (auto-refreshed) |
| `WORKFLOW.md` | Commit log and workflow audit trail |

Templates live in `agent-sentry/templates/` if you want to customize them before scaffolding.

---

## 9. Run Your First Audit

From inside Claude Code:

```
/agentops audit
```

The audit checks rules-file quality, security posture, scaffold doc freshness, git hygiene, and hook configuration. Review the output and address any findings.

You can also run the security audit script directly:

```bash
bash agent-sentry/scripts/security-audit.sh
```

---

## 10. View the Dashboard

Open the AgentOps dashboard in your browser:

```bash
open agent-sentry/dashboard/agentops-dashboard.html
```

The dashboard displays session metrics, commit history, risk scores, and audit findings. It reads data from `agent-sentry/dashboard/data/` which is populated automatically by the post-commit hook and other scripts.

---

## 11. Customize Thresholds

All AgentOps thresholds are controlled by a single configuration file:

```bash
# Open in your editor
$EDITOR agent-sentry/agentops.config.json
```

Key settings you may want to tune:

| Section | Setting | Default | Description |
|---------|---------|---------|-------------|
| `save_points` | `auto_commit_after_minutes` | 30 | Minutes of inactivity before suggesting a commit |
| `save_points` | `max_uncommitted_files_warning` | 5 | Warn when this many files are uncommitted |
| `context_health` | `message_count_warning` | 20 | Warn at this many messages in a session |
| `context_health` | `context_percent_critical` | 80 | Critical alert at this context window percentage |
| `task_sizing` | `medium_risk_threshold` | 4 | Risk score that triggers medium-risk advisory |
| `task_sizing` | `high_risk_threshold` | 8 | Risk score that triggers high-risk advisory |
| `task_sizing` | `max_files_per_task_warning` | 5 | Warn when a single task touches this many files |
| `security` | `block_on_secret_detection` | true | Whether to hard-block writes containing secrets |
| `budget` | `session_budget` | 10 | Per-session cost budget (USD) |
| `budget` | `monthly_budget` | 500 | Monthly cost budget (USD) |
| `memory` | `enabled` | `true` | Enable persistent memory store |
| `memory` | `provider` | `"sqlite"` | Storage backend (`sqlite` stable; `supabase` [beta] — requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars) |
| `memory` | `embedding_provider` | `"auto"` | Embedding provider (auto-detect, onnx, ollama, openai, noop) |
| `enablement` | `level` | `3` | Progressive enablement level (1-5) |

---

## What Happens Next

With AgentOps installed, every Claude Code session will automatically:

1. **On session start** -- validate rules files, check scaffold doc freshness, report git state.
2. **On every prompt** -- score the task for risk and estimate context usage.
3. **Before every file write** -- scan for secrets and check git hygiene.
4. **After every file write** -- run post-write validations and track blast radius.
5. **On stop** -- checkpoint session state for the next session to pick up.
6. **On every commit** -- scan staged files for secrets (git hook) and log commit metadata.
7. **MCP tools** -- AI clients can query git hygiene, context health, rules compliance, and event history via 9 MCP tools.
8. **Memory store** -- All operational events are captured, hash-chained, and searchable across sessions.
9. **Auto-enrichment** -- Events are enriched with cross-cutting tags and linked to related historical events.

All checks are advisory by default except the secret scanner, which blocks writes containing detected credentials.
