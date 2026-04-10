# AgentSentry -- End-to-End Tutorial

This tutorial walks you through the complete AgentSentry experience in a single
session. Every command is copy-pasteable. By the end you will have a working
MCP server, captured events in a tamper-evident hash chain, validated rules
compliance, scored a task's risk, and queried your audit trail.

**Time estimate:** ~12 minutes.

---

## Prerequisites

| Requirement | Minimum |
|---|---|
| Node.js | 18+ |
| Git | Initialized repo |
| MCP client | Claude Code (or any MCP-compatible client) |

---

## Step 1: Install (2 min)

From the repository root:

```bash
cd agent-sentry
npm install
npm run build
```

The build compiles TypeScript into `dist/`. The MCP server entry point lands at
`agent-sentry/dist/src/mcp/server.js`.

---

## Step 2: Wire the MCP Server (1 min)

Register AgentSentry as an MCP server so your client can call its tools:

```bash
claude mcp add agent-sentry -- node agent-sentry/dist/src/mcp/server.js
```

Verify it registered:

```bash
claude mcp list
```

You should see `agent-sentry` in the output. The server exposes ten tools:

| Tool | Purpose |
|---|---|
| `agent_sentry_capture_event` | Record decisions, violations, incidents |
| `agent_sentry_check_rules` | Validate changes against CLAUDE.md rules |
| `agent_sentry_size_task` | Score a task's risk and complexity |
| `agent_sentry_search_history` | Query the event audit trail |
| `agent_sentry_health` | System health dashboard |
| `agent_sentry_check_git` | Git hygiene checks |
| `agent_sentry_check_context` | Context window health |
| `agent_sentry_scan_security` | Security scanning |
| `agent_sentry_recall_context` | Cross-session context recall |
| `agent_sentry_generate_handoff` | Session handoff message generation |

---

## Step 3: Choose Your Enablement Level (1 min)

AgentSentry uses progressive enablement -- you pick how many safety skills to
activate. The setup wizard writes configuration to `agent-sentry.config.json`.
It is a config generator only; it does not install hooks or register MCP
servers.

```bash
bash agent-sentry/scripts/setup-wizard.sh --level 3
```

The five levels are:

| Level | Name | Skills Enabled |
|---|---|---|
| 1 | Safe Ground | Save Points |
| 2 | Clear Head | + Context Health |
| 3 | House Rules | + Standing Orders (basic) |
| 4 | Right Size | + Small Bets, Standing Orders (full) |
| 5 | Full Guard | All skills at full power |

Level 3 (House Rules) enables save points, context health, and basic rules
checking. It is a good starting point.

To preview without writing the file:

```bash
bash agent-sentry/scripts/setup-wizard.sh --level 3 --dry-run
```

---

## Step 4: Capture Your First Event (2 min)

Use the `agent_sentry_capture_event` tool to record a decision:

```json
{
  "event_type": "decision",
  "severity": "low",
  "skill": "system",
  "title": "Chose SQLite as default storage provider",
  "detail": "SQLite selected for local-first storage with zero config. Can migrate to Supabase later.",
  "affected_files": ["src/memory/providers/provider-factory.ts"],
  "tags": ["architecture", "storage"]
}
```

The response confirms the event was stored and returns an `id`, `timestamp`,
and `hash`.

**How the hash chain works:** each event's `hash` field is a SHA-256 digest
of its contents combined with the previous event's hash (`prev_hash`). This
creates a tamper-evident chain -- if any past event is modified, every
subsequent hash becomes invalid. The `agent_sentry_health` tool verifies this
chain on demand.

---

## Step 5: Check Rules Compliance (1 min)

Before making a change, validate it against your project's rules (drawn from
CLAUDE.md and AGENTS.md):

```json
{
  "file_path": "src/memory/store.ts",
  "change_description": "Added auto-pruning on initialize"
}
```

The tool returns:

- **violations**: any rules the change would break (file organization,
  security, testing requirements)
- **compliant**: boolean -- true if no violations found
- **rules_checked**: total number of rules evaluated

If violations are found, address them before proceeding.

---

## Step 6: Score a Change's Risk (1 min)

Use `agent_sentry_size_task` to estimate the risk of a task before starting:

```json
{
  "task": "Refactor authentication to use JWT tokens",
  "files": [
    "src/auth/login.ts",
    "src/auth/middleware.ts",
    "src/db/users.ts",
    "tests/auth/"
  ]
}
```

The response includes:

- **risk_level**: LOW, MEDIUM, HIGH, or CRITICAL
- **estimated_files**: number of files affected
- **factors**: what contributed to the score (e.g., `security`, `refactoring`,
  `file-count`)
- **recommendation**: suggested workflow for the risk level

Risk scoring analyzes keyword signals in the task description (security,
migration, database, destructive operations) and the number of affected files.
Higher risk tasks get recommendations for thorough testing and staged rollout.

---

## Step 7: Search Your Audit Trail (1 min)

Query past events with `agent_sentry_search_history`:

```json
{
  "query": "decision",
  "limit": 10
}
```

This returns matching events with their timestamps, types, severities, and
hash chain data. You can also filter by type and severity:

```json
{
  "query": "storage",
  "event_type": "decision",
  "severity": "low",
  "limit": 5
}
```

If embeddings are active (ONNX runtime detected), search uses semantic
similarity. Otherwise it falls back to text matching.

---

## Step 8: Check Session Health (1 min)

Call `agent_sentry_health` with no arguments:

```json
{}
```

The response has five sections:

| Section | What It Shows |
|---|---|
| **store** | Total events, breakdown by type/severity/skill, first and last event timestamps |
| **chain** | Whether the hash chain is intact, how many links were verified, and where it broke (if applicable) |
| **embedding** | Which embedding provider is active (onnx, none), vector dimension, and availability |
| **enablement** | Current level number, level name, and list of active skills |
| **config** | Max events, auto-prune days, database path |

A top-level `status` field reads `healthy`, `degraded`, or `error`. The
`issues` array lists any problems found.

---

## Step 9: Activate a Plugin (optional, 2 min)

AgentSentry has a plugin system. The `commit-monitor` plugin ships as an example
at `agent-sentry/plugins/core/commit-monitor/`.

Its `metadata.json` declares:

```json
{
  "name": "commit-monitor",
  "description": "Monitors git commit frequency and alerts when commits become infrequent",
  "category": "monitor",
  "version": "1.0.0",
  "requires": {
    "agentsentry": ">=0.5.0",
    "primitives": ["checkpoint-and-branch", "event-capture"]
  },
  "hooks": ["PostToolUse", "SessionStart"],
  "tags": ["git", "commit", "monitoring", "save-points"]
}
```

Key fields:

- **requires.agentsentry**: minimum AgentSentry version
- **requires.primitives**: which core primitives the plugin depends on
- **hooks**: lifecycle hooks the plugin subscribes to
- **category**: plugin type (monitor, auditor, dashboard, integration)

Validate the plugin before activating:

```bash
bash agent-sentry/scripts/validate-plugin.sh agent-sentry/plugins/core/commit-monitor
```

This runs 11 checks: directory structure, valid JSON, required fields, semver
compliance, and source file existence.

---

## What's Next

**Upgrade your enablement level.** Move to Level 4 or 5 for small bets
(incremental change sizing) and proactive safety:

```bash
bash agent-sentry/scripts/setup-wizard.sh --level 5
```

**Try HTTP transport.** The MCP server supports HTTP for remote or multi-client
setups:

```bash
node agent-sentry/dist/src/mcp/server.js --http --port 3100
```

This starts a Streamable HTTP server with CORS support. Set the
`AGENT_SENTRY_ACCESS_KEY` environment variable to enable key-based authentication
and rate limiting.

**Build a custom plugin.** Plugin templates live in
`agent-sentry/plugins/_templates/`. Four categories are available: monitor,
auditor, dashboard, and integration. Copy a template, edit `metadata.json`,
and implement your logic in `src/index.ts`.

**Supabase backend.** Cloud-hosted storage via Supabase is planned for a
future release. The current default is SQLite (local, zero-config).

---

## Quick Reference

| Action | Tool / Command |
|---|---|
| Capture an event | `agent_sentry_capture_event` |
| Check rules | `agent_sentry_check_rules` |
| Score task risk | `agent_sentry_size_task` |
| Search history | `agent_sentry_search_history` |
| Health check | `agent_sentry_health` |
| Git hygiene | `agent_sentry_check_git` |
| Context health | `agent_sentry_check_context` |
| Security scan | `agent_sentry_scan_security` |
| Setup wizard | `bash agent-sentry/scripts/setup-wizard.sh --level N` |
| Validate plugin | `bash agent-sentry/scripts/validate-plugin.sh <path>` |
| HTTP server | `node agent-sentry/dist/src/mcp/server.js --http --port 3100` |
