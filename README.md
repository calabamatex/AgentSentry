# AgentOps

![AgentOps Banner](agentops/dashboard/assets/agentops-banner.png)

**A standalone management and safety framework for AI agent oversight — with persistent memory.**

> AI agents are building your software unsupervised — and when they make mistakes, they don't tell you until something breaks. AgentOps watches every action your agents take, prevents disasters before they happen, and remembers everything across sessions so your agents get safer over time.

<!-- Badges placeholder: version, license, tests, platform support -->

---

## What is AgentOps

AgentOps is a standalone framework for managing, monitoring, and safeguarding AI coding agents. It is not tied to any single platform or provider. AgentOps works with Claude Code, Cursor, Codex, ChatGPT, GitHub Copilot, and any agent that supports the Model Context Protocol (MCP) or operates through a CLI or editor integration.

What makes it different from agent monitoring tools is that AgentOps *remembers*. Every decision, violation, incident, and handoff is captured to a persistent, vector-indexed memory store that survives across sessions. When a new agent session starts on your project next week, it can ask "what went wrong the last time someone touched the payment system?" and get a ranked answer drawn from weeks of operational history.

AgentOps gives engineering teams consistent oversight across every agent session through structured checkpoints, context monitoring, safety checks, audit trails, and cross-session intelligence.

## Key Features

### Core Skills

- **Save Points** -- Automatic git checkpoints at configurable intervals, with branch-on-risk for dangerous operations.
- **Context Health** -- Monitors token usage and conversation length, warns before context windows overflow, and recommends session handoffs.
- **Standing Orders** -- Lints and enforces rules files (CLAUDE.md, .cursorrules, etc.) so agents stay aligned with project conventions.
- **Small Bets** -- Scores tasks by file count and complexity, flags oversized changes, and enforces incremental delivery.
- **Safety Checks** -- Scans for leaked secrets, validates permissions, and blocks commits containing sensitive data.

### v4.0 — Memory & Intelligence Layer

- **Persistent Memory Store** -- Every agent event (decisions, violations, incidents, handoffs, audit findings) is captured to a vector-indexed database with semantic search. Sessions compound knowledge instead of starting from scratch. Dual-backend: SQLite + sqlite-vec locally by default, Supabase + pgvector for teams.
- **MCP Server Interface** -- All 5 core skills plus memory read/write exposed as 8 MCP tools. Any AI client that speaks MCP (Claude, ChatGPT, Cursor, Windsurf) gets the full management layer — not just tools with hook systems.
- **Primitives Library** -- 7 reusable management patterns (checkpoint-and-branch, risk-scoring, secret-detection, rules-validation, context-estimation, scaffold-update, event-capture) that skills compose from. Plugins build on primitives instead of reinventing them.
- **Progressive Enablement** -- 5 levels from beginner to advanced. Start with git checkpoints (Level 1: Safe Ground), add context health, rules enforcement, task sizing, and full safety as you're ready. No need to understand blast radius analysis on day one.
- **Auto-Classification** -- Events are automatically enriched with cross-cutting tags, root cause hints, related event links, and severity context. Local pattern matching runs at <10ms; optional LLM enrichment for deeper analysis.

### Advanced Capabilities

- **Tracing** -- Structured span-based tracing for agent actions with OpenTelemetry-compatible context propagation.
- **Permissions** -- File-level and command-level permission enforcement with allowlist/denylist support.
- **Cost Management** -- Per-session and monthly budget tracking with configurable warn and hard-stop thresholds.
- **Lifecycle Management** -- Session start, checkpoint, and teardown hooks for repeatable agent workflows.
- **Audit Trail** -- Append-only, hash-chained event log with optional semantic search. Tamper-proof, EU AI Act Article 12 compliant.
- **Plugins** -- 4 plugin categories (monitors, auditors, dashboards, integrations) with templates, metadata schemas, and 11 automated validation checks.
- **Evals** -- Built-in evaluation harness for testing safety rules against known attack patterns.

## Quick Start

### Level 1 — Safe Ground (5 minutes)

1. Clone this repository:

```bash
git clone https://github.com/calabamatex/AgenticManagement.git
cd AgenticManagement
```

2. Copy the `agentops/` directory into your target project:

```bash
cp -r agentops/ /path/to/your/project/agentops/
```

3. Run the setup wizard:

```bash
cd /path/to/your/project
bash agentops/scripts/setup-wizard.sh
```

The wizard asks what level you want to start at, generates your `agentops.config.json`, sets up git hooks, and registers only the hooks you need. Level 1 (Safe Ground) takes 5 minutes and gives you automatic git checkpoints and branch protection.

### Manual Setup

If you prefer manual configuration:

1. Set up git hooks:

```bash
git config core.hooksPath .githooks
```

2. For Claude Code, copy the slash commands and add hook entries:

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

3. For any MCP-compatible client (Claude, ChatGPT, Cursor):

```bash
# Add AgentOps as an MCP server
claude mcp add agentops -- node agentops/src/mcp/server.js
```

Or in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "agentops": {
      "command": "node",
      "args": ["agentops/src/mcp/server.js"]
    }
  }
}
```

4. Verify the installation:

```
/agentops check
```

## Project Structure

```
agentops/
  agentops.config.json          # Central configuration and thresholds
  src/
    memory/
      store.ts                  # MemoryStore — provider-agnostic CRUD + vector search
      schema.ts                 # Event record types and validation
      embeddings.ts             # Embedding provider abstraction (ONNX → Ollama → Cloud → No-op)
      enrichment.ts             # Auto-classification and event enrichment
      audit-index.ts            # Semantic search over audit trail
      migrate.ts                # SQLite → Supabase migration tool
      providers/
        storage-provider.ts     # StorageProvider interface
        sqlite-provider.ts      # SQLite + sqlite-vec (default, local-first)
        supabase-provider.ts    # Supabase + pgvector (opt-in, teams)
        provider-factory.ts     # Auto-detect or config-driven provider selection
      migrations/
        sqlite-migrations.ts    # SQLite schema creation and versioning
        supabase-migrations.ts  # Supabase table setup and RLS policies
    mcp/
      server.ts                 # MCP server setup and tool registration
      tools/
        check-git.ts            # agentops_check_git
        check-context.ts        # agentops_check_context
        check-rules.ts          # agentops_check_rules
        size-task.ts            # agentops_size_task
        scan-security.ts        # agentops_scan_security
        capture-event.ts        # agentops_capture_event
        search-history.ts       # agentops_search_history
        health.ts               # agentops_health
      transport.ts              # Stdio + HTTP transport options
      auth.ts                   # Access key validation
    primitives/
      checkpoint-and-branch.ts  # Safe restore points before risky operations
      rules-validation.ts       # Compare changes against rules files
      risk-scoring.ts           # Universal risk scoring model
      context-estimation.ts     # Context window usage estimation
      scaffold-update.ts        # Safe scaffold document updates
      secret-detection.ts       # API key, token, and connection string detection
      event-capture.ts          # Structured event logging to memory store
  scripts/
    setup-wizard.sh             # Interactive setup with progressive enablement
    session-start-checks.sh     # Runs all checks at session start
    session-checkpoint.sh       # Creates save points
    context-estimator.sh        # Monitors context health
    task-sizer.sh               # Scores task complexity
    secret-scanner.sh           # Detects leaked secrets
    security-audit.sh           # Full security audit
    permission-enforcer.sh      # File/command permissions
    cost-tracker.sh             # Budget enforcement
    lifecycle-manager.sh        # Session lifecycle hooks
    post-write-checks.sh        # Post-write validation
    git-hygiene-check.sh        # Git state validation
    rules-file-linter.sh        # Rules file linting
    delegation-validator.sh     # Agent delegation checks
    provider-health.sh          # Provider status checks
    run-evals.sh                # Evaluation runner
    validate-plugin.sh          # 11-check plugin validation pipeline
  templates/
    CONTEXT.md.template         # Context handoff template
    PLANNING.md.template        # Planning document template
    TASKS.md.template           # Task tracking template
    WORKFLOW.md.template        # Workflow definition template
  dashboard/
    agentops-dashboard.html     # Single-file monitoring dashboard
    data/                       # Dashboard data directory
  tracing/
    trace-context.ts            # Span-based tracing implementation
  audit/
    audit-logger.ts             # Append-only, hash-chained audit log
  core/
    event-bus.ts                # Internal event bus
  models/
    all-MiniLM-L6-v2/          # Bundled ONNX embedding model (~23MB)
  plugins/
    _templates/                 # Plugin starter templates per category
      monitor/
      auditor/
      dashboard/
      integration/
    core/                       # Bundled first-party plugins
    community/                  # User-installed plugins
  evals/
    secret-scanner/
      cases.yaml                # Secret scanner test cases
  data/
    ops.db                      # SQLite memory store (auto-created)
```

## MCP Tools

When running as an MCP server, AgentOps exposes 8 tools that any compatible AI client can call:

| Tool | What It Does |
|------|-------------|
| `agentops_check_git` | Git hygiene status — uncommitted files, time since last commit, branch safety |
| `agentops_check_context` | Context window usage, degradation signals, continue/refresh recommendation |
| `agentops_check_rules` | Validates a proposed change against rules files, returns violations |
| `agentops_size_task` | Risk score + decomposition recommendation for a task description |
| `agentops_scan_security` | Scans content for secrets, PII, missing error handling |
| `agentops_capture_event` | Writes a decision, violation, or incident to persistent memory |
| `agentops_search_history` | Semantic search across all stored operational events |
| `agentops_health` | Current health scores, KPIs, and skill-level status as JSON |

## Slash Commands

- `/agentops check` -- Run all health and safety checks against the current session.
- `/agentops audit` -- Generate a full security audit report for the project.
- `/agentops scaffold` -- Create standard planning and workflow files from templates.

## Dashboard

The AgentOps dashboard is a single HTML file with no external dependencies. It adapts to your enablement level — disabled skills show an "Enable Level X to unlock" prompt instead of empty panels.

<!-- Screenshot placeholder: agentops/dashboard/screenshot.png -->

To open it locally:

```bash
open agentops/dashboard/agentops-dashboard.html
# Or serve it:
npx serve agentops/dashboard/
```

## Configuration

All thresholds and behavior are controlled through `agentops/agentops.config.json`. Key settings:

| Section          | Setting                     | Default     |
|------------------|-----------------------------|-------------|
| enablement       | level                       | 1           |
| memory           | provider                    | sqlite      |
| memory           | embedding_provider          | auto        |
| save_points      | auto_commit_after_minutes   | 30          |
| save_points      | auto_branch_on_risk_score   | 8           |
| context_health   | message_count_warning       | 20          |
| context_health   | context_percent_critical    | 80          |
| task_sizing      | high_risk_threshold         | 8           |
| task_sizing      | max_files_per_task_critical | 8           |
| security         | block_on_secret_detection   | true        |
| budget           | session_budget              | $10         |
| budget           | monthly_budget              | $500        |

**Memory provider options:**

```json
// Solo developer (default — zero config needed):
{
  "memory": {
    "provider": "sqlite",
    "database_path": "agentops/data/ops.db"
  }
}

// Team setup (shared memory, per-developer isolation):
{
  "memory": {
    "provider": "supabase",
    "supabase_url": "${SUPABASE_URL}",
    "supabase_key": "${SUPABASE_SERVICE_ROLE_KEY}"
  }
}
```

Migrate from SQLite to Supabase when your team is ready:

```bash
node agentops/src/memory/migrate.ts \
  --from sqlite --from-path agentops/data/ops.db \
  --to supabase --to-url "$SUPABASE_URL" --to-key "$SUPABASE_SERVICE_ROLE_KEY"
```

See the full configuration file for all available options.

## Progressive Enablement

You don't have to use everything on day one. AgentOps has 5 levels that match the 5 core skills:

| Level | Name | What You Get | Time to Set Up |
|-------|------|-------------|----------------|
| 1 | Safe Ground | Git checkpoints, auto-commit, branch protection | 5 minutes |
| 2 | Clear Head | + Context health monitoring, scaffold docs, session handoffs | 10 minutes |
| 3 | House Rules | + Rules file creation and real-time compliance checking | 15 minutes |
| 4 | Right Size | + Task risk scoring, blast radius analysis, decomposition | 15 minutes |
| 5 | Full Guard | + Secret scanning, PII detection, error handling enforcement | 15 minutes |

Start at Level 1. Upgrade when you're ready. Each level builds on the last.

## License

MIT -- see LICENSE for details.

## Links

- [AgentOps Product Specification](AgentOps-Product-Spec.md) -- Full product spec (v4.0) covering architecture, skills, memory layer, MCP interface, and integration patterns.
- [v4.0 Build Plan](AgentOps-OB1-Build-Plan.md) -- OB1 memory integration build plan with phase breakdown.
- [OB1 Cross-Pollination Analysis](AgentOps-OB1-Analysis.md) -- How Open Brain's architecture informed the v4.0 memory layer.
- [OB1 vs AgentOps Comparison](AgentOps-vs-OB1-Comparison.html) -- Interactive comparison across 60+ dimensions.
- [Architecture Evolution](AgentOps-Architecture-Evolution.md) -- Design decisions and architectural history.
- [Implementation Guide](Agent-Management-Implementation-Guide.md) -- Practical guide for managing AI agents.
- [Interactive Learning Guide](agent-management-guide.html) -- HTML app with drill-down sections, progress tracking, and copyable templates.
- [Synopsis for Agentic Developers](AgentOps-Synopsis.md) -- Non-technical project overview.
