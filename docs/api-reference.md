# AgentSentry API & Script Reference

Comprehensive reference for every script, command, and module in the AgentSentry framework.

---

## Hook Scripts (run automatically)

These scripts are registered in `.claude/settings.json` and invoked automatically by the Claude Code hook system. Each receives JSON on stdin per the hook contract.

---

### secret-scanner.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/secret-scanner.sh` |
| **Hook Event** | `PreToolUse` |
| **Trigger (matcher)** | `Write\|Edit\|MultiEdit` |
| **Timeout** | 5000ms |

**What it does:** Scans file content for hardcoded secrets, API keys, tokens, connection strings, and credentials before allowing file writes or edits. Extracts `file_path` and `content` (or `new_string`) from `tool_input` JSON.

**Detected patterns:**
- Platform API keys: Stripe (`sk_live_*`, `sk_test_*`), AWS (`AKIA*`), GitHub (`ghp_*`), GitLab (`glpat-*`), Anthropic (`sk-ant-*`), OpenAI (`sk-*T3BlbkFJ*`)
- JWT tokens (`eyJ*` three-segment format)
- Private keys in PEM format (`-----BEGIN * PRIVATE KEY-----`)
- Connection strings with embedded credentials: PostgreSQL, MongoDB, Redis, SQLite
- Generic labeled secrets (`api_key = "..."`, `token: "..."`, `password = "..."`)
- Hardcoded provider environment variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `AWS_SECRET_ACCESS_KEY`, `STRIPE_SECRET_KEY`, `GITHUB_TOKEN`, `GITLAB_TOKEN`, `BITBUCKET_TOKEN`, `DATABASE_URL`, `MONGODB_URI`, `REDIS_URL`

**Exit codes:**
- `0` -- Content is clean, allow the tool to proceed
- `2` -- Secret detected, BLOCK the tool use

**Config keys read:** None (standalone pattern matching).

---

### git-hygiene-check.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/git-hygiene-check.sh` |
| **Hook Event** | `PreToolUse` |
| **Trigger (matcher)** | `Write\|Edit\|MultiEdit` (also processes Bash) |
| **Timeout** | 5000ms |

**What it does:** Ensures git is initialized, checks for uncommitted work, enforces checkpoint discipline, and tracks modified file counts for mid-session checkpoint logic. Performs auto-commits when thresholds are exceeded. Only blocks if no git repository is detected.

**Checks performed:**
1. Git repository exists (only blocking check)
2. Uncommitted file count vs threshold -- auto-commits if exceeded
3. Time since last commit vs threshold -- auto-commits if exceeded
4. Main/master branch warning when >3 uncommitted changes
5. Mid-session checkpoint at 8+ file modifications without a commit

**Exit codes:**
- `0` -- Allow (warns and takes preventive action but never blocks)
- `2` -- BLOCK (only when no git repository is detected)

**Config keys read:**
- `save_points.max_uncommitted_files_warning` (default: `5`)
- `save_points.auto_commit_after_minutes` (default: `30`)

---

### post-write-checks.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/post-write-checks.sh` |
| **Hook Event** | `PostToolUse` |
| **Trigger (matcher)** | `Write\|Edit\|MultiEdit` |
| **Timeout** | 10000ms |

**What it does:** Runs three post-edit analysis passes on the written/edited file. Always exits 0 (advisory only).

**Check 1 -- Error Handling Enforcer:** Scans for external/IO calls (`fetch()`, `axios`, `http.*`, `.query()`, `.execute()`, `fs.*`, `requests.*`, `subprocess.*`, etc.) and warns when no `try/catch/except` is found within a 5-line window.

**Check 2 -- PII Logging Scanner:** Identifies logging statements (`console.log`, `logging.*`, `print()`) that reference sensitive fields: `email`, `password`, `card`, `ssn`, `phone`, `secret`, `token`, `api_key`, and variants.

**Check 3 -- Blast Radius Tracking:** Tracks unique files modified during the session. When >8 files have been modified without a commit, performs an auto-checkpoint commit.

**Exit codes:**
- `0` -- Always (advisory only, never blocks)

**Config keys read:** None (uses hardcoded thresholds).

---

### task-sizer.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/task-sizer.sh` |
| **Hook Event** | `UserPromptSubmit` |
| **Trigger (matcher)** | All prompts (no matcher filter) |
| **Timeout** | 5000ms |

**What it does:** Scans user prompt text for risk keywords, computes a cumulative risk score (0--20), and emits notifications or auto-commits based on risk thresholds.

**Risk scoring signals:**
- File count scope: few files (+1), several files (+3), many files (+5)
- Database operations: create (+2), modify (+4), delete/drop (+5)
- Security-related keywords: auth, encryption, validation (+4)
- Refactoring scope: refactor, redesign, rewrite, migrate (+4)
- Broad scope: all, every, entire, whole (+3)

**Risk levels:**
- Low (0--3): Silent, no output
- Medium (4--7): Notification, auto-commit checkpoint
- High (8--12): Warning, auto-commit, decomposition recommended
- Critical (13+): Warning, auto-commit, dedicated branch recommended

**Exit codes:**
- `0` -- Always (advisory only, never blocks)

**Config keys read:**
- `task_sizing.medium_risk_threshold` (default: `4`)
- `task_sizing.high_risk_threshold` (default: `8`)
- `task_sizing.critical_risk_threshold` (default: `13`)

---

### context-estimator.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/context-estimator.sh` |
| **Hook Event** | `UserPromptSubmit` |
| **Trigger (matcher)** | All prompts (no matcher filter) |
| **Timeout** | 5000ms |

**What it does:** Estimates context window usage and message count. Warns when thresholds are approached or exceeded. Tracks session message count in a temp state file and estimates tokens consumed by counting characters in recently modified git-tracked files (chars / 4) plus conversation overhead (~500 tokens per message).

**Exit codes:**
- `0` -- Always (advisory only, never blocks)

**Config keys read:**
- `context_health.context_percent_warning` (default: `60`)
- `context_health.context_percent_critical` (default: `80`)
- `context_health.message_count_warning` (default: `20`)
- `context_health.message_count_critical` (default: `30`)

**Environment variables:**
- `AGENT_SENTRY_MAX_TOKENS` -- Override assumed context window size (default: `200000`)

---

### session-start-checks.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/session-start-checks.sh` |
| **Hook Event** | `SessionStart` |
| **Trigger (matcher)** | All sessions (no matcher filter) |
| **Timeout** | 10000ms |

**What it does:** Validates rules files, scaffold docs, and git state at the beginning of every session. Reports findings at three severity levels: CRITICAL, WARNING, ADVISORY.

**Checks performed:**
1. **Git state** -- Verifies git repository exists and reports uncommitted changes
2. **CLAUDE.md** -- Checks existence, line count vs threshold, presence of AgentSentry section, required sections (security, error handling)
3. **AGENTS.md** -- Checks existence and line count vs threshold
4. **Scaffold documents** -- Checks for `PLANNING.md`, `TASKS.md`, `CONTEXT.md`, `WORKFLOW.md`; checks `CONTEXT.md` freshness (warns if >7 days stale)

**Exit codes:**
- `0` -- Always (advisory only, never blocks)

**Config keys read:**
- `rules_file.claude_md_max_lines` (default: `300`)
- `rules_file.agents_md_max_lines` (default: `150`)

---

### session-checkpoint.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/session-checkpoint.sh` |
| **Hook Event** | `Stop` |
| **Trigger (matcher)** | All stop events (no matcher filter) |
| **Timeout** | 10000ms |

**What it does:** Runs when a session ends. Performs three steps:
1. **Auto-commit** -- Commits all uncommitted changes with message `[agent-sentry] session-end checkpoint`
2. **Reset state** -- Clears blast-radius-files, context-state, and git-hygiene-session temp files
3. **Log event** -- Appends a session-end NDJSON event to `agent-sentry/dashboard/data/session-log.json`

**Exit codes:**
- `0` -- Always (advisory only, never blocks)

**Config keys read:** None.

---

### cost-tracker.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/cost-tracker.sh` |
| **Hook Event** | `PostToolUse` |
| **Trigger (matcher)** | Not currently wired in settings.json (available for manual integration) |

**What it does:** Runs after tool use to estimate cost, track cumulative session spend, warn at budget thresholds, and log cost events as NDJSON to `agent-sentry/dashboard/data/cost-log.json`.

**Model tier detection:** Checks hook input `.model` field, then `CLAUDE_MODEL` / `ANTHROPIC_MODEL` environment variables. Defaults to sonnet.

**Cost estimates per call:**
- haiku: $0.0002
- sonnet: $0.003
- opus: $0.015

**Per-token pricing (per token):**
| Tier | Input | Output |
|---|---|---|
| haiku | $0.00000025 | $0.00000125 |
| sonnet | $0.000003 | $0.000015 |
| opus | $0.000015 | $0.000075 |

**Budget tracking:** Maintains session cumulative total and monthly rolling total. Warns at configurable thresholds.

**Exit codes:**
- `0` -- Always (advisory only, never blocks)

**Config keys read:**
- `budget.session_budget` (default: `10`)
- `budget.monthly_budget` (default: `500`)
- `budget.warn_threshold` (default: `0.80`)

---

### permission-enforcer.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/permission-enforcer.sh` |
| **Hook Event** | `PreToolUse` |
| **Trigger (matcher)** | Not currently wired in settings.json (available for manual integration) |

**What it does:** Implements agent identity and permissions. Reads YAML frontmatter from `.claude/agents/<agent-id>.md` files and enforces tool-level, file-level, and bash command-level access control per agent identity.

**Permission schema** (YAML frontmatter in agent definition files):
```yaml
---
agent_id: builder
permissions:
  files:
    read:  ["src/**", "docs/**"]
    write: ["src/**"]
    deny:  [".env", "secrets/**"]
  tools:
    allow: ["Read", "Edit", "Write", "Grep", "Glob"]
    deny:  ["Bash"]
  bash:
    allow: ["npm test", "npm run *"]
    deny:  ["rm -rf *", "curl *"]
---
```

**Enforcement order:**
1. Tool-level: checks `tools.deny` then `tools.allow`
2. File-level: checks `files.deny` then `files.read` or `files.write`
3. Bash command: checks `bash.deny` then `bash.allow`

**Identity detection:** Via `CLAUDE_AGENT_ID` or `CLAUDE_AGENT_FILE` environment variables. If neither is set (direct user session), everything is allowed.

**Exit codes:**
- `0` -- Permission granted (or no agent identity)
- `2` -- Permission denied, BLOCK the tool use

**Config keys read:** None (reads from `.claude/agents/*.md` YAML frontmatter).

**Logs to:** `agent-sentry/dashboard/data/permission-log.json` (NDJSON)

---

### delegation-validator.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/delegation-validator.sh` |
| **Hook Event** | `PreToolUse` |
| **Trigger (matcher)** | Not currently wired in settings.json (available for manual integration) |

**What it does:** Validates agent-to-agent delegation tokens before every tool use. When an agent delegates a task to another agent, it issues a delegation token (JSON) via the `AGENT_SENTRY_DELEGATION_TOKEN` environment variable.

**Token format:**
```json
{
  "issuer":     "<agent-id>",
  "delegate":   "<agent-id>",
  "task":       "<description>",
  "scope": {
    "files":        ["src/**", "tests/**"],
    "tools":        ["Read", "Edit", "Bash"],
    "max_tokens":   100000,
    "max_duration": 3600,
    "can_delegate": false
  },
  "issued_at":  "<ISO-8601>",
  "expires_at": "<ISO-8601>"
}
```

**Validation checks:**
1. Token not expired (`expires_at` > now)
2. Max duration not exceeded (`issued_at` + `max_duration` < now)
3. Current tool within `scope.tools`
4. Target file matches `scope.files` globs
5. Cumulative token count not exceeded (`scope.max_tokens`)

**Exit codes:**
- `0` -- Delegation valid (or no delegation token present)
- `2` -- Delegation check failed, BLOCK the tool use

**Config keys read:** None (reads from `AGENT_SENTRY_DELEGATION_TOKEN` env var).

**Logs to:** `agent-sentry/dashboard/data/delegation-log.json` (NDJSON)

---

## Standalone Scripts (run on demand)

These scripts are invoked manually or by slash commands. They are not registered as hooks.

---

### security-audit.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/security-audit.sh` |
| **Invoked by** | `/agent-sentry audit` |

**What it does:** Runs a comprehensive project security scan across 6 check categories. Results are grouped by severity (Critical, Warning, Advisory, Pass) and written to `agent-sentry/dashboard/data/audit-results.json` as NDJSON.

**Check categories:**
1. **Secrets in Code** -- Scans source files for hardcoded secrets, checks `.env.example` for real values, verifies `.env` is in `.gitignore`, optionally scans git history
2. **API Key Security** -- Verifies environment variable usage, checks error handlers for key exposure, verifies timeout configuration
3. **Input Validation** -- Checks for validation/sanitization libraries, path traversal prevention, SQL injection prevention (parameterized queries vs string concatenation)
4. **Error Handling** -- Checks for try/catch patterns, PII in error handlers, fallback/retry/circuit-breaker patterns
5. **Dependency Audit** -- Runs `npm audit`, `pip-audit`, or `cargo audit` depending on manifest files; checks lock files; flags outdated packages
6. **Database Security** -- Verifies DB connections use environment variables, checks for hardcoded passwords, validates parameterized queries

**Source file extensions scanned:** `ts`, `js`, `py`, `go`, `java`, `rb`, `sh`

**Environment variables:**
- `PROJECT_ROOT` -- Override project root (default: git root or cwd)
- `AGENT_SENTRY_AUDIT_SCAN_HISTORY` -- Set to `true` to scan git history for secrets

**Exit codes:**
- `0` -- Always (advisory tool, not a gate)

---

### rules-file-linter.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/rules-file-linter.sh` |
| **Invoked by** | `/agent-sentry audit` |

**What it does:** Validates `AGENTS.md`, `CLAUDE.md`, and nested rules files for structure, size, contradictions, clarity, and completeness.

**Checks performed:**
1. **STRUCTURE** -- Required sections present in each rules file
2. **SIZE** -- Combined line count of all rules files vs max threshold
3. **CONTRADICTIONS** -- Detects ALWAYS/NEVER directive conflicts across and within files
4. **CLARITY** -- Flags vague language: `maybe`, `sometimes`, `try to`, `if possible`, `consider`, `might want`, `could potentially`, `when feasible`, `ideally`, `optionally`, `where appropriate`, `as needed`
5. **COMPLETENESS** -- Checks coverage of risk topics: security, error handling, secrets/credentials, input validation

**Config keys read:**
- `rules_file.max_lines` (default: `300`)
- `rules_file.required_sections` (default: `["security", "error handling"]`)

**Exit codes:**
- `0` -- Always (advisory tool, never blocks)

---

### lifecycle-manager.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/lifecycle-manager.sh` |

**What it does:** Manages agent state transitions and emits NDJSON lifecycle events to `agent-sentry/dashboard/data/lifecycle.json`. State is stored in temp files at `$TMPDIR/agent-sentry/lifecycle/<agent-id>.state`.

**Subcommands:**

| Subcommand | Usage | Description |
|---|---|---|
| `start` | `lifecycle-manager.sh start <agent-id>` | Transitions CREATED->ACTIVE or resumes AWAITING->ACTIVE |
| `pause` | `lifecycle-manager.sh pause <agent-id>` | Transitions ACTIVE->AWAITING |
| `complete` | `lifecycle-manager.sh complete <agent-id>` | Transitions ACTIVE->COMPLETED |
| `fail` | `lifecycle-manager.sh fail <agent-id>` | Transitions any active state->FAILED |
| `cancel` | `lifecycle-manager.sh cancel <agent-id>` | Transitions any active state->CANCELLED |
| `status` | `lifecycle-manager.sh status <agent-id>` | Prints current state to stdout |
| `list` | `lifecycle-manager.sh list` | Lists all agents and their states |

**Valid states:** `CREATED`, `ACTIVE`, `AWAITING`, `COMPLETED`, `FAILED`, `CANCELLED`

**Exit codes:**
- `0` -- Success
- `1` -- Invalid state transition or missing agent-id

---

### provider-health.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/provider-health.sh` |

**What it does:** Tracks per-provider metrics, logs failover events, and aggregates stats. Stores per-provider call data as NDJSON in `$TMPDIR/agent-sentry/provider-state/<provider>.ndjson`.

**Subcommands:**

| Subcommand | Usage | Description |
|---|---|---|
| `status` | `provider-health.sh status` | Health summary for all providers (availability %, latency p50/p95/p99, error rate, cost/1K tokens, rate limit headroom, recent failovers) |
| `log-failover` | `provider-health.sh log-failover <original> <fallback> <reason>` | Records a failover event with estimated latency delta and cost difference |
| `summary` | `provider-health.sh summary` | Aggregate cost stats from `cost-log.json` grouped by provider |
| `record` | `provider-health.sh record <provider> <latency_ms> [status] [cost]` | Record a single provider call metric |
| `set-ratelimit` | `provider-health.sh set-ratelimit <provider> <remaining/limit>` | Cache rate limit headroom for a provider |

**Logs to:** `agent-sentry/dashboard/data/provider-health.json` (NDJSON)

**Exit codes:**
- `0` -- Always

---

### run-evals.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/run-evals.sh` |
| **Dependencies** | `jq`, `yq` (both required) |

**What it does:** Runs golden datasets found in `agent-sentry/evals/*/cases.yaml`. For each test case, the target script is executed with a synthetic hook payload, and the outcome (exit code + output pattern) is compared against expected results.

**Test case format** (`cases.yaml`):
```yaml
- name: "test case name"
  input: "content to pass to the script"
  expected:
    blocked: true|false
    pattern: "expected string in output"
```

**Exit codes:**
- `0` -- All test cases passed
- `1` -- One or more test cases failed

---

### plugin-loader.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/plugins/plugin-loader.sh` |
| **Dependencies** | `jq` (required) |

**What it does:** Discovers, validates, and executes plugins located in the `agent-sentry/plugins/community/` directory. Each plugin lives in its own subdirectory and exposes a `manifest.json`.

**Plugin manifest format:**
```json
{
  "name": "plugin-name",
  "version": "1.0.0",
  "hooks": {
    "PreToolUse": { "matcher": "Write|Edit" },
    "PostToolUse": { "matcher": "Bash" }
  }
}
```

**Handler convention:** `community/<plugin>/hooks/<hook-event>.sh`

**Subcommands:**

| Subcommand | Usage | Description |
|---|---|---|
| `list` | `plugin-loader.sh list` | List all installed plugins with name, version, and declared hooks |
| `validate` | `plugin-loader.sh validate` | Validate all plugin manifests (checks JSON validity, required fields, hook matcher presence) |
| `run` | `plugin-loader.sh run <plugin-name> <hook-event>` | Execute a specific plugin hook handler |

**Exit codes:**
- `0` -- Success
- `1` -- Missing dependency, invalid manifest, unknown subcommand, or handler not found

---

### validate-plugin.sh

| Field | Value |
|---|---|
| **Path** | `agent-sentry/scripts/validate-plugin.sh` |
| **Invoked by** | Manual or CI |

**What it does:** Validates a plugin directory against the AgentSentry plugin specification. Accepts a plugin path as the first argument.

**11 validation checks:**
1. Folder structure matches category template
2. `metadata.json` validates against JSON Schema
3. No secrets in any file
4. README.md has required sections (What It Does, Prerequisites, Installation, Configuration, How It Works, Troubleshooting)
5. `src/index.ts` exports valid plugin interface
6. Hook subscriptions reference valid types
7. MCP tool names follow `agent_sentry_plugin_{name}_{tool}` convention
8. No files exceed 500 lines
9. Required primitives exist in the primitives library
10. Tests exist and pass
11. No binary files exceeding 1MB

**Exit codes:**
- `0` — All checks passed
- `1` — One or more checks failed

---

## TypeScript Modules

These modules provide programmatic APIs for tracing, auditing, and event routing.

---

### tracing/trace-context.ts

| Field | Value |
|---|---|
| **Path** | `agent-sentry/tracing/trace-context.ts` |
| **Spec section** | Section 13 (Distributed Tracing) |

OpenTelemetry-compatible trace context propagation and span recording. Generates W3C-compliant trace IDs (32 hex chars / 128 bits) and span IDs (16 hex chars / 64 bits). Records spans as NDJSON to `agent-sentry/dashboard/data/traces.json`.

**Exports:**

| Function | Signature | Description |
|---|---|---|
| `generateTraceId` | `() => string` | Generate a 32-char hex trace ID (W3C-compliant) |
| `generateSpanId` | `() => string` | Generate a 16-char hex span ID (W3C-compliant) |
| `createSpan` | `(traceId, parentSpanId, agentId, operation, target) => Span` | Create a new Span record with defaults (0 tokens, 0 latency, status "ok") |
| `createTraceContext` | `(agentId) => TraceContext` | Create a root TraceContext for a new distributed trace |
| `childContext` | `(parent, childAgentId) => TraceContext` | Derive a child context preserving the trace ID with a fresh span ID |
| `finalizeSpan` | `(span, update) => Span` | Immutably update a span with measured values (tokens, latency, status) |
| `appendSpan` | `(span, path?) => void` | Append a span as NDJSON to the traces file (creates dir/file if needed) |
| `recordSpan` | `(traceId, parentSpanId, agentId, operation, target, metrics?, path?) => Span` | Create, finalize, and persist a span in one call |

**Types:**
- `Span` -- `{ traceId, spanId, parentSpanId, agentId, operation, target, input_tokens, output_tokens, latency_ms, status, ts }`
- `TraceContext` -- `{ traceId, spanId, agentId }`
- `SpanStatus` -- `"ok" | "error" | "timeout" | "cancelled"`

---

### audit/audit-logger.ts

| Field | Value |
|---|---|
| **Path** | `agent-sentry/audit/audit-logger.ts` |
| **Spec section** | Section 19 (Compliance and Immutable Audit Trail) |

Tamper-evident, append-only logging of all agent operations. Each record is SHA-256 hash-chained to its predecessor, forming a verifiable sequence. Records are stored as NDJSON in `agent-sentry/audit/audit-trail.jsonl`.

**Exports:**

| Function | Signature | Description |
|---|---|---|
| `createAuditRecord` | `(params: CreateAuditRecordParams) => AuditRecord` | Create a record with auto-generated eventId (UUIDv4), timestamp, and SHA-256 chain hash |
| `appendAuditRecord` | `(record: AuditRecord) => void` | Append a record as NDJSON to the audit trail file; updates in-memory chain head |
| `verifyChain` | `() => ChainVerificationResult` | Read all records and verify the hash chain from genesis forward |
| `resetHashCache` | `() => void` | Reset the in-memory last-hash cache (useful in tests) |

**Types:**
- `AuditRecord` -- `{ eventId, traceId, ts, actor, originalUser, action, target, input_summary, output_summary, permissionCheck, status, tokens, hash }`
- `ActorRef` -- `{ type, id }` (e.g. `"agent"`, `"human"`, `"system"`)
- `TokenUsage` -- `{ input, output }`
- `CreateAuditRecordParams` -- `AuditRecord` minus `eventId`, `ts`, `hash` (auto-generated)
- `ChainVerificationResult` -- `{ valid: boolean, brokenAt?: number }`

**Constants:**
- Genesis hash: 64 zero characters (`"0".repeat(64)`)

---

### core/event-bus.ts

| Field | Value |
|---|---|
| **Path** | `agent-sentry/core/event-bus.ts` |
| **Spec section** | Section 21.3 (Plugin Event Bus) |

Central publish/subscribe system for hook events. Uses a singleton pattern so all consumers share a single bus instance within a process.

**Exports:**

| Function | Signature | Description |
|---|---|---|
| `subscribe` | `(eventType: EventType, handler: EventHandler) => void` | Register a handler (deduplicated per event type) |
| `unsubscribe` | `(eventType: EventType, handler: EventHandler) => boolean` | Remove a handler; returns true if found and removed |
| `emit` | `(eventType: EventType, data?) => Promise<void>` | Emit an event, invoking all handlers concurrently via `Promise.allSettled` |
| `listSubscribers` | `() => Record<string, number>` | Snapshot of subscriptions keyed by event type with handler counts |
| `getEventBus` | `() => EventBus` | Return the singleton EventBus instance |

**EventType enum values:**
`PreToolUse`, `PostToolUse`, `PreSession`, `PostSession`, `PrePlan`, `PostPlan`, `OnError`, `OnMetric`, `OnAuditLog`, `PluginLoaded`, `PluginUnloaded`

**Types:**
- `EventPayload` -- `{ type: EventType, timestamp: string, data: Record<string, unknown> }`
- `EventHandler` -- `(payload: EventPayload) => void | Promise<void>`

---

### src/memory/store.ts

| Field | Value |
|---|---|
| **Path** | `agent-sentry/src/memory/store.ts` |
| **Spec section** | Section 25 (Persistent Operations Memory) |

Persistent, hash-chained event storage with vector search. Provider-agnostic (SQLite default; Supabase for teams planned for a future release).

**Exports:**

| Class/Function | Description |
|---|---|
| `MemoryStore` | Main store class — `capture()`, `search()`, `list()`, `stats()`, `verifyChain()`, `close()` |
| `MemoryStoreOptions` | Constructor options: `provider`, `embeddingProvider`, `config` |

**Key Types (from schema.ts):**
- `OpsEvent` — Full event record with id, timestamp, hash chain, embedding
- `OpsEventInput` — Input for `capture()` (event minus auto-generated fields)
- `EventType` — `'decision' | 'violation' | 'incident' | 'pattern' | 'handoff' | 'audit_finding'`
- `Severity` — `'low' | 'medium' | 'high' | 'critical'`
- `Skill` — `'save_points' | 'context_health' | 'standing_orders' | 'small_bets' | 'proactive_safety' | 'system'`
- `SearchResult` — `{ event: OpsEvent; score: number }`
- `OpsStats` — Aggregate counts by type, severity, skill

**Embedding Providers:** Auto-detects ONNX Runtime, Ollama, or OpenAI. Falls back to noop (text-only search).

**Storage Providers:** SQLite (local, default). Supabase (team/cloud) planned for a future release.

---

### src/mcp/server.ts

| Field | Value |
|---|---|
| **Path** | `agent-sentry/src/mcp/server.ts` |
| **Spec section** | Section 26 (MCP Server Interface) |

Model Context Protocol server exposing 8 tools via stdio or HTTP transport.

**MCP Tools:**

| Tool | Input | Description |
|---|---|---|
| `agent_sentry_check_git` | none | Git hygiene status — uncommitted files, branch, risk score |
| `agent_sentry_check_context` | `message_count?` | Context window health estimation |
| `agent_sentry_check_rules` | `file_path`, `change_description` | Rules compliance validation |
| `agent_sentry_size_task` | `task`, `files?` | Task risk scoring (LOW/MEDIUM/HIGH/CRITICAL) |
| `agent_sentry_scan_security` | `content`, `file_path?` | Secret and vulnerability detection |
| `agent_sentry_capture_event` | `event_type`, `severity`, `skill`, `title`, `detail`, ... | Capture event to memory store |
| `agent_sentry_search_history` | `query`, `limit?`, `event_type?`, `severity?`, `since?` | Semantic search across events |
| `agent_sentry_health` | none | System health dashboard |

**Transport:**
- Stdio (default): `node agent-sentry/dist/src/mcp/server.js`
- HTTP: `node agent-sentry/dist/src/mcp/server.js --http --port 3100`

**Auth (HTTP only):** `x-agent-sentry-key` header or `?key=` query param. Rate limited to 100 req/min.

**Integration:**
```bash
claude mcp add agent-sentry -- node agent-sentry/dist/src/mcp/server.js
```

---

### src/primitives/

| Field | Value |
|---|---|
| **Path** | `agent-sentry/src/primitives/` |
| **Spec section** | Section 27 (Primitives Library) |

Seven composable TypeScript primitives extracted from core skills.

**Modules:**

| Module | Key Exports | Used By |
|---|---|---|
| `checkpoint-and-branch.ts` | `createCheckpoint()`, `createSafetyBranch()`, `getCurrentBranch()` | Save Points, Small Bets |
| `rules-validation.ts` | `validateRules()`, `RuleViolation`, `ValidationResult` | Standing Orders, Proactive Safety |
| `risk-scoring.ts` | `assessRisk()`, `RiskAssessment`, `RiskFactor` | Small Bets, Proactive Safety |
| `context-estimation.ts` | `estimateContext()`, `ContextHealth` | Context Health, Small Bets |
| `scaffold-update.ts` | `updateScaffold()`, `ScaffoldResult` | Context Health, Standing Orders |
| `secret-detection.ts` | `scanForSecrets()`, `SecretFinding` | Save Points, Proactive Safety |
| `event-capture.ts` | `captureEvent()` | All skills |

**Risk Levels:** 0-3 LOW, 4-7 MEDIUM, 8-11 HIGH, 12-15 CRITICAL

**Factors:** file_count (weight 2), db_changes (weight 3), shared_code (weight 2), main_branch (weight 5)

---

### src/enablement/engine.ts

| Field | Value |
|---|---|
| **Path** | `agent-sentry/src/enablement/engine.ts` |
| **Spec section** | Section 28 (Progressive Enablement) |

Progressive skill enablement with 5 adoption levels.

**Exports:**

| Function | Description |
|---|---|
| `generateConfigForLevel(level)` | Generate enablement config for levels 1-5 |
| `isSkillEnabled(config, skill)` | Check if a skill is active |
| `getActiveSkills(config)` | List all enabled skills |
| `getNextLevel(config)` | Get next level info and what it unlocks |
| `validateEnablementConfig(config)` | Validate an enablement config object |

**Levels:**

| Level | Name | Skills Active |
|---|---|---|
| 1 | Safe Ground | save_points |
| 2 | Clear Head | + context_health |
| 3 | House Rules | + standing_orders |
| 4 | Right Size | + small_bets |
| 5 | Full Guard | + proactive_safety |

**Setup:** `bash agent-sentry/scripts/setup-wizard.sh --level 3`

---

### src/memory/enrichment.ts

| Field | Value |
|---|---|
| **Path** | `agent-sentry/src/memory/enrichment.ts` |
| **Spec section** | Section 25 (Persistent Operations Memory) |

Auto-classification enrichment for captured events.

**Exports:**

| Class | Description |
|---|---|
| `LocalPatternMatcher` | Zero-cost local enrichment provider (<10ms) |
| `EventEnricher` | Orchestrates enrichment across providers |

**Enrichment Result:**
- `cross_tags` — Domain tags derived from affected file paths (authentication, database, api, testing, configuration, infrastructure)
- `root_cause_hint` — Pattern-based suggestion when 3+ events share overlapping files
- `related_events` — IDs of similar past events (up to 5)
- `severity_context` — Branch-aware severity notes (e.g., "High score mitigated by feature branch isolation")

---

### src/memory/audit-index.ts

| Field | Value |
|---|---|
| **Path** | `agent-sentry/src/memory/audit-index.ts` |
| **Spec section** | Section 19 (Compliance & Audit Trail) |

Semantic search over audit records.

**Exports:**

| Class | Description |
|---|---|
| `AuditIndex` | Indexes events for semantic search, generates summaries |

**Key Methods:**
- `generateSummary(event)` — Creates searchable text summary
- `indexEvent(event)` — Indexes an event as an audit_finding record
- `search(query, options?)` — Semantic search across audit records
- `getFileAuditTrail(filePath, options?)` — Get audit trail for a specific file
- `getSessionTimeline(sessionId)` — Get chronological event timeline for a session

---

## Slash Commands

These are invoked as Claude Code slash commands.

---

### /agent-sentry check

Runs a session health dashboard. Executes `session-start-checks.sh` to validate rules files, scaffold docs, and git state. Reports criticals, warnings, and advisories.

### /agent-sentry audit

Runs a full project audit by executing both `security-audit.sh` (6-category security scan) and `rules-file-linter.sh` (5-check rules validation). Writes results to `agent-sentry/dashboard/data/audit-results.json`.

### /agent-sentry scaffold

Creates or updates scaffold documents (`PLANNING.md`, `TASKS.md`, `CONTEXT.md`, `WORKFLOW.md`) and ensures `CLAUDE.md` contains the AgentSentry rules section.

### /agent-sentry setup

Runs the progressive enablement setup wizard. Prompts for an enablement level (1-5) and generates the appropriate configuration.

---

## Configuration (agent-sentry.config.json)

**Path:** `agent-sentry/agent-sentry.config.json`

### save_points

| Key | Default | Description |
|---|---|---|
| `save_points.auto_commit_after_minutes` | `30` | Minutes since last commit before auto-save triggers |
| `save_points.auto_branch_on_risk_score` | `8` | Risk score threshold that triggers branch creation |
| `save_points.max_uncommitted_files_warning` | `5` | Number of uncommitted files before auto-save triggers |

### context_health

| Key | Default | Description |
|---|---|---|
| `context_health.message_count_warning` | `20` | Message count that triggers a warning notification |
| `context_health.message_count_critical` | `30` | Message count that triggers a critical notification |
| `context_health.context_percent_warning` | `60` | Estimated context usage percentage that triggers a warning |
| `context_health.context_percent_critical` | `80` | Estimated context usage percentage that triggers a critical warning |

### rules_file

| Key | Default | Description |
|---|---|---|
| `rules_file.max_lines` | `300` | Maximum combined line count for all rules files before warning |
| `rules_file.required_sections` | `["security", "error handling"]` | Sections that must be present in rules files |

### task_sizing

| Key | Default | Description |
|---|---|---|
| `task_sizing.medium_risk_threshold` | `4` | Risk score at which medium-risk notification fires |
| `task_sizing.high_risk_threshold` | `8` | Risk score at which high-risk warning fires |
| `task_sizing.critical_risk_threshold` | `13` | Risk score at which critical-risk warning fires |
| `task_sizing.max_files_per_task_warning` | `5` | Files-per-task count that triggers a warning |
| `task_sizing.max_files_per_task_critical` | `8` | Files-per-task count that triggers a critical warning |

### security

| Key | Default | Description |
|---|---|---|
| `security.block_on_secret_detection` | `true` | Whether to block writes when secrets are detected |
| `security.scan_git_history` | `false` | Whether the audit scans git history for leaked secrets |
| `security.check_common_provider_keys` | `true` | Whether to check for hardcoded provider API key assignments |

### budget

| Key | Default | Description |
|---|---|---|
| `budget.session_budget` | `10` | Maximum session cost in USD before warning/blocking |
| `budget.monthly_budget` | `500` | Maximum monthly cost in USD before warning/blocking |
| `budget.warn_threshold` | `0.80` | Fraction of budget at which warnings begin (0.0--1.0) |

### notifications

| Key | Default | Description |
|---|---|---|
| `notifications.verbose` | `false` | Whether to emit verbose diagnostic messages |
| `notifications.prefix_all_messages` | `"[AgentSentry]"` | Prefix string for all hook output messages |

### memory

| Key | Default | Description |
|---|---|---|
| `memory.enabled` | `true` | Enable persistent memory store |
| `memory.provider` | `"sqlite"` | Storage backend (`sqlite` or `supabase`) |
| `memory.embedding_provider` | `"auto"` | Embedding provider (auto, onnx, ollama, openai, noop) |
| `memory.database_path` | `"agent-sentry/data/ops.db"` | Path to SQLite database file |
| `memory.max_events` | `100000` | Maximum events before auto-pruning |
| `memory.auto_prune_days` | `365` | Days after which events are pruned |

### enablement

| Key | Default | Description |
|---|---|---|
| `enablement.level` | `3` | Progressive enablement level (1-5) |
| `enablement.skills.<name>.enabled` | varies | Whether the skill is active |
| `enablement.skills.<name>.mode` | varies | Skill mode: `off`, `basic`, or `full` |
