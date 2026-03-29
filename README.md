# AgentSentry v4.1.0-beta

![AgentSentry Banner](agent-sentry/dashboard/assets/agent-sentry-banner.png)

[![npm version](https://img.shields.io/npm/v/agent-sentry.svg)](https://www.npmjs.com/package/agent-sentry)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/calabamatex/AgenticManagement/actions/workflows/ci.yml/badge.svg)](https://github.com/calabamatex/AgenticManagement/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-1113%20passing-brightgreen.svg)](#)

**Memory-aware management and safety framework for AI agents.**

> Your AI agents forget everything between sessions. AgentSentry gives them persistent memory, safety guardrails, and operational oversight — so every session builds on the last.

---

## Install

```bash
npm install agent-sentry
```

Or clone and use directly:

```bash
git clone https://github.com/calabamatex/AgenticManagement.git
cd AgenticManagement/agent-sentry && npm install && npm run build
```

**Requirements:** Node.js >= 18

**Dependencies:** `@modelcontextprotocol/sdk`, `better-sqlite3`, `uuid`, `zod`
**Optional:** `onnxruntime-node` (for native ONNX embeddings — falls back to JS cosine similarity if absent)

---

## What AgentSentry Does

AgentSentry is a local-first memory and safety layer for AI coding sessions. Primary integration: **Claude Code**. The MCP server interface enables compatibility with any MCP-compatible tool (Cursor, Codex, ChatGPT, GitHub Copilot, etc.).

What makes it different: AgentSentry *remembers*. Every decision, violation, incident, and handoff is captured to a vector-indexed memory store that survives across sessions. When a new session starts next week, it can ask "what went wrong the last time someone touched the payment system?" and get a ranked answer from weeks of operational history.

---

## Features

### Core Skills

| Skill | What It Does |
|-------|-------------|
| **Save Points** | Automatic git checkpoints at configurable intervals, branch-on-risk for dangerous operations |
| **Context Health** | Monitors token usage and conversation length, warns before context overflow, recommends session handoffs |
| **Standing Orders** | Lints and enforces rules files (CLAUDE.md, .cursorrules, etc.) for project convention compliance |
| **Small Bets** | Scores tasks by file count and complexity, flags oversized changes, enforces incremental delivery |
| **Safety Checks** | Scans for leaked secrets, validates permissions, blocks commits containing sensitive data |

### Memory & Intelligence (v4.1.0-beta)

- **Persistent Memory Store** -- Vector-indexed database with semantic search. SQLite with JS cosine similarity locally, Supabase [beta] for teams.
- **MCP Server Interface** -- All 5 core skills plus memory read/write exposed as 9 MCP tools. Works with any MCP-compatible client.
- **Primitives Library** -- 7 reusable management patterns (checkpoint-and-branch, risk-scoring, secret-detection, rules-validation, context-estimation, scaffold-update, event-capture).
- **Auto-Classification** -- Events enriched with tags, root cause hints, related event links, and severity context. Local pattern matching at <10ms.
- **Progressive Enablement** -- 5 levels from beginner to advanced. Start simple, add capabilities when ready.

### Advanced Capabilities

- **Tracing** -- Span-based tracing with OpenTelemetry-compatible context propagation
- **Permissions** -- File-level and command-level enforcement with allowlist/denylist
- **Cost Management** -- Per-session and monthly budget tracking with warn and hard-stop thresholds
- **Audit Trail** -- Append-only, hash-chained event log with semantic search (EU AI Act Article 12 compliant)
- **Plugins** -- 4 categories (monitors, auditors, dashboards, integrations) with templates and 11 validation checks
- **Evals** -- Built-in evaluation harness for testing safety rules against known attack patterns

---

## Quick Start

### Option 1: npm Package

```bash
npm install agent-sentry
```

```typescript
import { MemoryStore, createProvider } from 'agent-sentry';

const store = new MemoryStore({
  provider: createProvider({ provider: 'sqlite', database_path: './ops.db' }),
});
await store.initialize();

// Capture an event
await store.capture({
  timestamp: new Date().toISOString(),
  session_id: 'session-001',
  agent_id: 'agent-coder',
  event_type: 'decision',
  severity: 'low',
  skill: 'save_points',
  title: 'Chose JWT with refresh tokens for auth',
  detail: 'Selected JWT with rotating refresh tokens for session management',
  affected_files: ['src/auth/session.ts'],
  tags: ['auth', 'architecture'],
  metadata: {},
});

// Search history
const results = await store.search('authentication patterns');
```

### Option 2: MCP Server

For any MCP-compatible client (Claude Code is the primary tested integration):

```bash
# Add AgentSentry as an MCP server
claude mcp add agent-sentry -- node agent-sentry/dist/src/mcp/server.js
```

Or in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "agent-sentry": {
      "command": "node",
      "args": ["agent-sentry/dist/src/mcp/server.js"]
    }
  }
}
```

### Option 3: Claude Code Hooks

```bash
# Copy slash commands
cp -r agent-sentry/.claude/commands/agent-sentry/ .claude/commands/agent-sentry/
```

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{ "command": "bash agent-sentry/scripts/permission-enforcer.sh" }],
    "PostToolUse": [{ "command": "bash agent-sentry/scripts/post-write-checks.sh" }],
    "SessionStart": [{ "command": "bash agent-sentry/scripts/session-start-checks.sh" }]
  }
}
```

### Setup Wizard

```bash
bash agent-sentry/scripts/setup-wizard.sh
```

Prompts for your enablement level (1-5) and generates `agent-sentry.config.json`.

---

## MCP Tools

When running as an MCP server, AgentSentry exposes 10 tools:

| Tool | What It Does |
|------|-------------|
| `agent_sentry_check_git` | Git hygiene status -- uncommitted files, time since last commit, branch safety |
| `agent_sentry_check_context` | Context window usage, degradation signals, continue/refresh recommendation |
| `agent_sentry_check_rules` | Validates a proposed change against rules files, returns violations |
| `agent_sentry_size_task` | Risk score + decomposition recommendation for a task description |
| `agent_sentry_scan_security` | Scans for secrets and dangerous code patterns (SQL injection, eval, private keys) |
| `agent_sentry_capture_event` | Writes a decision, violation, or incident to persistent memory |
| `agent_sentry_search_history` | Semantic search across all stored operational events |
| `agent_sentry_recall_context` | Cross-session context recall -- finds relevant prior session data for current task |
| `agent_sentry_generate_handoff` | Generates a structured handoff message for session continuity |
| `agent_sentry_health` | Current health scores, KPIs, and skill-level status |

---

## Progressive Enablement

| Level | Name | What's Active | Setup Time |
|-------|------|--------------|------------|
| 1 | Safe Ground | save_points (full) | 5 min |
| 2 | Clear Head | + context_health (full) | 10 min |
| 3 | House Rules | + standing_orders (basic) | 15 min |
| 4 | Right Size | standing_orders → full, + small_bets (basic) | 15 min |
| 5 | Full Guard | small_bets → full, + proactive_safety (full) | 15 min |

Start at Level 1. Upgrade when ready. Each level builds on the last.

---

## Configuration

All settings in `agent-sentry/agent-sentry.config.json`:

| Section | Setting | Default |
|---------|---------|---------|
| enablement | level | 2 |
| memory | provider | sqlite |
| memory | embedding_provider | auto |
| save_points | auto_commit_after_minutes | 30 |
| save_points | auto_branch_on_risk_score | 8 |
| context_health | context_percent_critical | 80 |
| task_sizing | high_risk_threshold | 8 |
| security | block_on_secret_detection | true |
| budget | session_budget | $10 |
| budget | monthly_budget | $500 |

### Memory Providers

```json
// Solo developer (default -- zero config):
{ "memory": { "provider": "sqlite", "database_path": "agent-sentry/data/ops.db" } }

// Team setup (shared memory) [beta]:
// Supabase provider reads credentials from environment variables:
//   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
{ "memory": { "provider": "supabase" } }
```

> **Note:** Migration tooling between providers is planned for a future release.

---

## Dashboard

Single-file HTML dashboard with no external dependencies. Adapts to your enablement level.

```bash
open agent-sentry/dashboard/agent-sentry-dashboard.html
# Or serve it:
npx serve agent-sentry/dashboard/
```

---

## Benchmarks

Baseline performance on Node v22, darwin/arm64, 8 CPU / 16 GB:

| Operation | ops/sec |
|-----------|---------|
| Insert | 30 |
| Search | 62 |
| Batch | 184 |
| Cache | 118 |
| Concurrent | 147 |

Run benchmarks locally:

```bash
npm run benchmark
```

---

## Development

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript
npm test           # Run tests (1113 passing)
npm run benchmark  # Run performance benchmarks
```

---

## Project Structure

```
agent-sentry/
  src/
    memory/           # MemoryStore, embeddings, providers, migrations
    mcp/              # MCP server, 10 tools, transport, auth
    primitives/       # 7 reusable management patterns
    cli/              # CLI commands, TypeScript hook handlers
  scripts/            # Thin wrapper hooks, setup wizard, validators
  templates/          # CONTEXT.md, PLANNING.md, TASKS.md, WORKFLOW.md
  dashboard/          # Single-file HTML monitoring dashboard
  tracing/            # Span-based tracing
  audit/              # Append-only hash-chained audit log
  plugins/            # Templates and community plugins
  evals/              # Safety rule evaluation harness
  models/             # Bundled ONNX embedding model (~23MB)
```

---

## CLI Commands

```bash
npx agent-sentry init           # Interactive project setup wizard
npx agent-sentry config          # View or update agent-sentry.config.json
npx agent-sentry enable <level>  # Set enablement level (1-5)
npx agent-sentry health          # System health and embedding status
npx agent-sentry memory          # Query persistent memory store
npx agent-sentry metrics         # Session and cost metrics
npx agent-sentry dashboard       # Launch monitoring dashboard
npx agent-sentry stream          # Live event stream
npx agent-sentry plugin          # Plugin management
npx agent-sentry handoff         # Generate session handoff message
npx agent-sentry prune           # Clean up old events from memory store
npx agent-sentry export          # Export memory store data
npx agent-sentry import          # Import memory store data
```

## Slash Commands

- `/agent-sentry check` -- Run all health and safety checks
- `/agent-sentry audit` -- Generate a full security audit report
- `/agent-sentry scaffold` -- Create planning and workflow files from templates

---

## License

MIT -- see [LICENSE](LICENSE) for details.

---

## Links

- [Getting Started Guide](agent-sentry/docs/getting-started.md)
- [First Session Walkthrough](agent-sentry/docs/first-session.md)
- [API Reference](agent-sentry/docs/api-reference.md)
- [Product Specification](docs/planning/AgentOps-Product-Spec.md) -- Full v4.1.0-beta spec covering architecture, skills, memory, MCP, and integrations
- [Architecture Evolution](docs/planning/AgentOps-Architecture-Evolution.md) -- Design decisions and architectural history
- [Implementation Guide](docs/planning/Agent-Management-Implementation-Guide.md) -- Practical guide for managing AI agents
- [Synopsis](docs/planning/AgentOps-Synopsis.md) -- Non-technical project overview
- [Memory Model](agent-sentry/docs/architecture/memory-model.md) -- Hash chains, search, and storage providers
- [Enablement Model](agent-sentry/docs/architecture/enablement-model.md) -- 5 levels with skill mapping
- [MCP Integration](agent-sentry/docs/architecture/mcp-integration.md) -- Tools, transports, and auth
- [Configuration Reference](agent-sentry/docs/configuration.md) -- Every config option explained
- [Dashboard Guide](agent-sentry/docs/dashboard-guide.md) -- Monitoring dashboard and streaming
- [Supabase Setup](agent-sentry/docs/supabase-setup.md) -- Remote storage for teams
- [Troubleshooting](agent-sentry/docs/troubleshooting.md) -- Common issues and solutions
- [Changelog](agent-sentry/CHANGELOG.md) -- Version history
- [Contributing](CONTRIBUTING.md) -- Development setup and PR process
