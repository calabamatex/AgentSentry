# AgentOps v4.0

![AgentOps Banner](agentops/dashboard/assets/agentops-banner.png)

[![npm version](https://img.shields.io/npm/v/agentops.svg)](https://www.npmjs.com/package/agentops)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/calabamatex/AgenticManagement/actions/workflows/ci.yml/badge.svg)](https://github.com/calabamatex/AgenticManagement/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-1003%20passing-brightgreen.svg)](#)

**Memory-aware management and safety framework for AI agents.**

> Your AI agents forget everything between sessions. AgentOps gives them persistent memory, safety guardrails, and operational oversight — so every session builds on the last.

---

## Install

```bash
npm install agentops
```

Or clone and use directly:

```bash
git clone https://github.com/calabamatex/AgenticManagement.git
cd AgenticManagement/agentops && npm install && npm run build
```

**Requirements:** Node.js >= 18

**Dependencies:** `@modelcontextprotocol/sdk`, `better-sqlite3`, `onnxruntime-node`, `uuid`, `zod`

---

## What AgentOps Does

AgentOps is a local-first memory and safety layer for AI coding sessions. Primary integration: **Claude Code**. The MCP server interface enables compatibility with any MCP-compatible tool (Cursor, Codex, ChatGPT, GitHub Copilot, etc.).

What makes it different: AgentOps *remembers*. Every decision, violation, incident, and handoff is captured to a vector-indexed memory store that survives across sessions. When a new session starts next week, it can ask "what went wrong the last time someone touched the payment system?" and get a ranked answer from weeks of operational history.

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

### Memory & Intelligence (v4.0)

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
npm install agentops
```

```typescript
import { MemoryStore, createProvider } from 'agentops';

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
# Add AgentOps as an MCP server
claude mcp add agentops -- node agentops/dist/src/mcp/server.js
```

Or in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "agentops": {
      "command": "node",
      "args": ["agentops/dist/src/mcp/server.js"]
    }
  }
}
```

### Option 3: Claude Code Hooks

```bash
# Copy slash commands
cp -r agentops/.claude/commands/agentops/ .claude/commands/agentops/
```

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{ "command": "bash agentops/scripts/permission-enforcer.sh" }],
    "PostToolUse": [{ "command": "bash agentops/scripts/post-write-checks.sh" }],
    "SessionStart": [{ "command": "bash agentops/scripts/session-start-checks.sh" }]
  }
}
```

### Setup Wizard

```bash
bash agentops/scripts/setup-wizard.sh
```

Prompts for your enablement level (1-5) and generates `agentops.config.json`.

---

## MCP Tools

When running as an MCP server, AgentOps exposes 9 tools:

| Tool | What It Does |
|------|-------------|
| `agentops_check_git` | Git hygiene status -- uncommitted files, time since last commit, branch safety |
| `agentops_check_context` | Context window usage, degradation signals, continue/refresh recommendation |
| `agentops_check_rules` | Validates a proposed change against rules files, returns violations |
| `agentops_size_task` | Risk score + decomposition recommendation for a task description |
| `agentops_scan_security` | Scans for secrets and dangerous code patterns (SQL injection, eval, private keys) |
| `agentops_capture_event` | Writes a decision, violation, or incident to persistent memory |
| `agentops_search_history` | Semantic search across all stored operational events |
| `agentops_recall_context` | Cross-session context recall -- finds relevant prior session data for current task |
| `agentops_health` | Current health scores, KPIs, and skill-level status |

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

All settings in `agentops/agentops.config.json`:

| Section | Setting | Default |
|---------|---------|---------|
| enablement | level | 1 |
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
{ "memory": { "provider": "sqlite", "database_path": "agentops/data/ops.db" } }

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
open agentops/dashboard/agentops-dashboard.html
# Or serve it:
npx serve agentops/dashboard/
```

---

## Benchmarks

Baseline performance on Node v22, darwin/arm64, 8 CPU / 16 GB:

| Operation | ops/sec |
|-----------|---------|
| Insert | 93 |
| Search | 49 |
| Batch | 151 |
| Cache | 38 |
| Concurrent | 61 |

Run benchmarks locally:

```bash
npm run benchmark
```

---

## Development

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript
npm test           # Run tests (1003 passing)
npm run benchmark  # Run performance benchmarks
```

---

## Project Structure

```
agentops/
  src/
    memory/           # MemoryStore, embeddings, providers, migrations
    mcp/              # MCP server, 9 tools, transport, auth
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

## Slash Commands

- `/agentops check` -- Run all health and safety checks
- `/agentops audit` -- Generate a full security audit report
- `/agentops scaffold` -- Create planning and workflow files from templates

---

## License

MIT -- see [LICENSE](LICENSE) for details.

---

## Links

- [API Reference](agentops/docs/api-reference.md)
- [Getting Started Guide](agentops/docs/getting-started.md)
- [Product Specification](AgentOps-Product-Spec.md) -- Full v4.0 spec covering architecture, skills, memory, MCP, and integrations
- [Architecture Evolution](AgentOps-Architecture-Evolution.md) -- Design decisions and architectural history
- [Implementation Guide](Agent-Management-Implementation-Guide.md) -- Practical guide for managing AI agents
- [Synopsis](AgentOps-Synopsis.md) -- Non-technical project overview
