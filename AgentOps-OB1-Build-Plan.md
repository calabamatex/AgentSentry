# AgentOps v4.0 — OB1 Memory Integration Build Plan

**Date:** March 20, 2026
**Source:** AgentOps-Product-Spec.md v3.0 + AgentOps-OB1-Analysis.md
**Build Target:** AgentOps v4.0 — Memory-Aware Agent Management
**Stack:** TypeScript / Node.js (matching MCP ecosystem and target audience)

---

## Executive Summary

This plan upgrades AgentOps from a stateless, session-scoped monitoring system to a memory-aware, cross-session intelligence layer. Seven changes derived from Open Brain (OB1) analysis, executed as four build phases.

**What changes:** Persistent memory store, MCP server interface, primitives library, structured plugin model, progressive enablement, semantic audit search, auto-classification enrichment.

**What stays:** Five core skills, hook architecture, event bus, dashboard, security model, local-first design, multi-tool compatibility.

**Important:** AgentOps is a standalone, generic product. It has no runtime dependency on any specific build tool, orchestration framework, or agent system. The build orchestration instructions in Appendix A describe how to execute this plan using multi-agent swarm tooling — they are not part of the AgentOps product.

---

## Agent Roster (8 agents, hierarchical)

| Role | Agent Type | Tier | Responsibility |
|------|-----------|------|----------------|
| **Coordinator** | `hierarchical-coordinator` | 3 (Opus) | Orchestrates phases, resolves conflicts, maintains spec coherence |
| **Memory Architect** | `architecture` | 3 (Sonnet) | Designs StorageProvider interface, dual-backend schema (SQLite + Supabase), vector indexing, query API, migration tool |
| **MCP Engineer** | `coder` | 3 (Sonnet) | Builds MCP server, tool registrations, transport layer |
| **Primitives Engineer** | `coder` | 2 (Haiku) | Extracts shared patterns into composable primitives |
| **Plugin Architect** | `architecture` | 3 (Sonnet) | Designs contribution model, metadata schemas, validation |
| **Security Auditor** | `security-auditor` | 3 (Sonnet) | Reviews all new code for secrets, injection, data leakage |
| **Test Engineer** | `tester` | 2 (Haiku) | TDD mock-first tests for every module |
| **Spec Writer** | `planner` | 3 (Sonnet) | Updates AgentOps-Product-Spec.md with new sections |

---

## Phase 1: Persistent Memory Store (P0 — Week 1)

**Goal:** Replace flat scaffold docs with a vector-indexed, queryable operations memory.

**Agents:** Memory Architect, Coder, Test Engineer, Security Auditor
**Priority:** Critical

### 1.1 Memory Store Core (`src/memory/store.ts`) — Memory Architect + Coder

**Domain context:** AgentOps currently writes PLANNING.md, TASKS.md, CONTEXT.md, WORKFLOW.md as cross-session state. These are overwritten on each update. We need append-only, vector-indexed event storage that supplements (not replaces) scaffold docs.

**Implementation:**

```
agentops/
├── src/
│   ├── memory/
│   │   ├── store.ts               # MemoryStore class — CRUD + vector search (provider-agnostic)
│   │   ├── schema.ts              # Event record types and validation
│   │   ├── embeddings.ts          # Embedding provider abstraction
│   │   ├── providers/
│   │   │   ├── storage-provider.ts    # StorageProvider interface
│   │   │   ├── sqlite-provider.ts     # SQLite + sqlite-vec (default, local-first)
│   │   │   ├── supabase-provider.ts   # Supabase + pgvector (opt-in, teams)
│   │   │   └── provider-factory.ts    # Auto-detect or config-driven provider selection
│   │   ├── migrations/
│   │   │   ├── sqlite-migrations.ts   # SQLite schema creation and versioning
│   │   │   └── supabase-migrations.ts # Supabase table setup and RLS policies
│   │   └── index.ts               # Public API exports
```

**Event Record Schema:**

```typescript
interface OpsEvent {
  id: string;                    // UUID v4
  timestamp: string;             // ISO 8601
  session_id: string;            // Links to the agent session
  agent_id: string;              // Which agent generated this event
  event_type: EventType;         // decision | violation | incident | pattern | handoff | audit_finding
  severity: Severity;            // low | medium | high | critical
  skill: Skill;                  // save_points | context_health | standing_orders | small_bets | proactive_safety
  title: string;                 // Short description (< 120 chars)
  detail: string;                // Full context
  affected_files: string[];      // File paths involved
  tags: string[];                // Auto-extracted + manual tags
  metadata: Record<string, unknown>; // Extensible key-value pairs
  embedding?: number[];          // Vector embedding (when available)
  hash: string;                  // SHA-256 of content for tamper detection
  prev_hash: string;             // Hash chain link to previous event
}

type EventType = 'decision' | 'violation' | 'incident' | 'pattern' | 'handoff' | 'audit_finding';
type Severity = 'low' | 'medium' | 'high' | 'critical';
type Skill = 'save_points' | 'context_health' | 'standing_orders' | 'small_bets' | 'proactive_safety' | 'system';
```

**Storage Provider Interface:**

```typescript
// All storage backends implement this interface.
// MemoryStore delegates to whichever provider is configured.
// Provider selection happens once at startup via provider-factory.ts.

interface StorageProvider {
  name: string;                    // 'sqlite' | 'supabase'
  mode: 'local' | 'remote';

  // Lifecycle
  initialize(): Promise<void>;     // Create tables, run migrations
  close(): Promise<void>;          // Clean shutdown

  // Write
  insert(event: OpsEvent): Promise<void>;

  // Read
  getById(id: string): Promise<OpsEvent | null>;
  query(options: QueryOptions): Promise<OpsEvent[]>;
  count(options: QueryOptions): Promise<number>;

  // Vector search (returns empty array if embeddings unavailable)
  vectorSearch(embedding: number[], options: VectorSearchOptions): Promise<SearchResult[]>;

  // Aggregates
  aggregate(options: AggregateOptions): Promise<OpsStats>;

  // Audit
  getChain(since?: string): Promise<OpsEvent[]>;  // For hash verification
}
```

**Backend A — SQLite + sqlite-vec (default):**

```typescript
// Local, zero-dependency, offline-capable.
// Chosen when: no config specified, or "provider": "sqlite"
//
// Schema:
// CREATE TABLE ops_events (
//   id TEXT PRIMARY KEY,
//   timestamp TEXT NOT NULL,
//   session_id TEXT NOT NULL,
//   agent_id TEXT NOT NULL,
//   event_type TEXT NOT NULL,
//   severity TEXT NOT NULL,
//   skill TEXT NOT NULL,
//   title TEXT NOT NULL,
//   detail TEXT NOT NULL,
//   affected_files TEXT NOT NULL,  -- JSON array
//   tags TEXT NOT NULL,            -- JSON array
//   metadata TEXT NOT NULL,        -- JSON object
//   hash TEXT NOT NULL,
//   prev_hash TEXT NOT NULL
// );
//
// CREATE VIRTUAL TABLE ops_events_vec USING vec0(
//   id TEXT PRIMARY KEY,
//   embedding FLOAT[384]           -- all-MiniLM-L6-v2 dimension
// );
//
// CREATE INDEX idx_events_type ON ops_events(event_type);
// CREATE INDEX idx_events_session ON ops_events(session_id);
// CREATE INDEX idx_events_severity ON ops_events(severity);
// CREATE INDEX idx_events_skill ON ops_events(skill);
// CREATE INDEX idx_events_timestamp ON ops_events(timestamp);
```

**Backend B — Supabase + pgvector (opt-in for teams):**

```typescript
// Cloud-hosted, shared across developers, RLS-isolated.
// Chosen when: "provider": "supabase" in config
// Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
//
// Same logical schema as SQLite, mapped to PostgreSQL:
//
// CREATE TABLE ops_events (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
//   session_id TEXT NOT NULL,
//   agent_id TEXT NOT NULL,
//   developer_id TEXT NOT NULL,       -- RLS isolation key (not in SQLite)
//   event_type TEXT NOT NULL,
//   severity TEXT NOT NULL,
//   skill TEXT NOT NULL,
//   title TEXT NOT NULL,
//   detail TEXT NOT NULL,
//   affected_files JSONB NOT NULL,
//   tags JSONB NOT NULL,
//   metadata JSONB NOT NULL,
//   embedding VECTOR(384),            -- pgvector column
//   hash TEXT NOT NULL,
//   prev_hash TEXT NOT NULL
// );
//
// -- Row-Level Security: each developer sees only their own events
// -- Team dashboards use a service role that bypasses RLS
// ALTER TABLE ops_events ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "developer_isolation" ON ops_events
//   USING (developer_id = current_setting('app.developer_id'));
//
// -- Shared team view (read-only, for dashboards)
// CREATE POLICY "team_read" ON ops_events FOR SELECT
//   USING (developer_id = ANY(
//     SELECT member_id FROM team_members
//     WHERE team_id = current_setting('app.team_id')
//   ));
//
// CREATE INDEX idx_events_embedding ON ops_events
//   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

**Provider factory logic (`src/memory/providers/provider-factory.ts`):**

```typescript
// Provider selection priority:
// 1. Explicit config: "provider": "supabase" → SupabaseProvider
// 2. Explicit config: "provider": "sqlite"   → SqliteProvider
// 3. Auto-detect: SUPABASE_URL env var set   → SupabaseProvider
// 4. Default (no config, no env vars)        → SqliteProvider
//
// The factory validates prerequisites before returning:
// - SQLite: checks sqlite-vec extension loads correctly
// - Supabase: checks connection + table existence, runs migrations if needed
```

**Query API:**

```typescript
interface MemoryStore {
  // Write
  capture(event: Omit<OpsEvent, 'id' | 'hash' | 'prev_hash' | 'embedding'>): Promise<OpsEvent>;

  // Semantic search
  search(query: string, options?: {
    limit?: number;          // default 10
    threshold?: number;      // similarity threshold, default 0.5
    event_type?: EventType;
    severity?: Severity;
    skill?: Skill;
    since?: string;          // ISO timestamp
    session_id?: string;
  }): Promise<SearchResult[]>;

  // Structured queries
  list(options?: {
    limit?: number;
    offset?: number;
    event_type?: EventType;
    severity?: Severity;
    skill?: Skill;
    since?: string;
    until?: string;
    session_id?: string;
    agent_id?: string;
    tag?: string;
  }): Promise<OpsEvent[]>;

  // Aggregates
  stats(options?: {
    since?: string;
    until?: string;
    session_id?: string;
  }): Promise<OpsStats>;

  // Audit
  verifyChain(since?: string): Promise<ChainVerification>;
}
```

**Build checkpoint:** Record architectural decision — dual-backend StorageProvider with SQLite default and Supabase opt-in. 384-dim embeddings. Hash-chained. Migration tool for SQLite→Supabase.

### 1.2 Embedding Provider Abstraction (`src/memory/embeddings.ts`) — Coder

**Requirement:** AgentOps is local-first. Embeddings must work offline. Optional cloud upgrade for teams.

```typescript
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  dimension: number;
  name: string;
}

// Provider priority (auto-detected at startup):
// 1. Local ONNX model (all-MiniLM-L6-v2) — zero network, ~50ms/embed
// 2. Ollama local API (if running) — zero cloud, ~100ms/embed
// 3. OpenAI API (if OPENAI_API_KEY set) — cloud, ~200ms/embed
// 4. Anthropic API (if ANTHROPIC_API_KEY set) — cloud, ~200ms/embed
// 5. No-op provider — stores events without embeddings, structured queries only
```

**Implementation notes:**
- Bundle `all-MiniLM-L6-v2` ONNX model (~23MB) in `agentops/models/`
- Use `onnxruntime-node` for inference (works offline, no Python required)
- Fallback gracefully: if no embedding available, `search()` returns structured-query results only
- Configuration in `agentops.config.json`:

```json
// Solo developer (default — zero config needed):
{
  "memory": {
    "enabled": true,
    "provider": "sqlite",
    "embedding_provider": "auto",
    "database_path": "agentops/data/ops.db",
    "max_events": 100000,
    "auto_prune_days": 365
  }
}

// Team setup (shared memory, RLS-isolated):
{
  "memory": {
    "enabled": true,
    "provider": "supabase",
    "embedding_provider": "auto",
    "supabase_url": "${SUPABASE_URL}",
    "supabase_key": "${SUPABASE_SERVICE_ROLE_KEY}",
    "developer_id": "${AGENTOPS_DEVELOPER_ID}",
    "team_id": "${AGENTOPS_TEAM_ID}",
    "max_events": 500000,
    "auto_prune_days": 730
  }
}
```

**Migration path:** A developer who starts with SQLite can migrate to Supabase later. AgentOps provides a one-command migration:

```bash
# Export all events from SQLite → import into Supabase
node agentops/src/memory/migrate.ts \
  --from sqlite --from-path agentops/data/ops.db \
  --to supabase --to-url "$SUPABASE_URL" --to-key "$SUPABASE_SERVICE_ROLE_KEY"
```

### 1.3 Hook Integration — Coder

**Every existing hook now captures events to the memory store.** The hooks continue to work exactly as specified in the v3.0 spec — this adds a `capture()` call after each check completes.

| Hook | Event Type | Example Capture |
|------|-----------|----------------|
| Secret scanner blocks a write | `violation` | "Agent coder-1 attempted to write AWS key to config/db.ts — blocked" |
| Git hygiene auto-commits | `decision` | "Auto-committed 7 uncommitted files before agent modification of auth/jwt.ts" |
| Git hygiene auto-branches | `incident` | "Auto-branched from main to safety/payment-refactor — risk score 9 (HIGH)" |
| Context health warning | `pattern` | "Session at 82% context capacity after 34 messages — degradation signals detected" |
| Rules file violation | `violation` | "Agent attempted to modify shared/utils.ts without updating TASKS.md — standing order violation" |
| Task risk assessment | `decision` | "Task 'refactor auth module' scored HIGH risk (12 files, 2 DB migrations, shared code). Decomposition recommended." |
| Session handoff | `handoff` | "Session ended at 78% context. 3 tasks remaining. Scaffold docs updated." |
| Security audit finding | `audit_finding` | "2 API endpoints missing input validation in routes/payments.ts" |

**Implementation:** Each hook script gets a `capture_event` call at the end. In shell scripts:

```bash
# At the end of every hook script, append:
capture_event() {
  node agentops/src/memory/cli-capture.js \
    --type "$1" \
    --severity "$2" \
    --skill "$3" \
    --title "$4" \
    --detail "$5" \
    --files "$6" \
    --tags "$7"
}
```

### 1.4 Scaffold Doc Generation from Memory — Coder

**Scaffold docs shift from being the memory to being a view of the memory.**

When the scaffold subagent updates CONTEXT.md at session end, it now:
1. Queries the memory store for all events from the current session
2. Generates a human-readable summary from those events
3. Writes the summary to CONTEXT.md (as before)
4. The discrete events remain in the memory store (never overwritten)

This means CONTEXT.md is still human-readable (as before), but the full event history is preserved and searchable.

### 1.5 Tests — Test Engineer

```
tests/
├── memory/
│   ├── store.test.ts              # CRUD, hash chain, pagination (provider-agnostic via interface)
│   ├── embeddings.test.ts         # Provider detection, fallback chain
│   ├── search.test.ts             # Semantic search, filtered search, threshold
│   ├── providers/
│   │   ├── sqlite-provider.test.ts    # SQLite-specific: vec0 extension, file locking, WAL mode
│   │   ├── supabase-provider.test.ts  # Supabase-specific: RLS policies, pgvector, connection pooling
│   │   ├── provider-factory.test.ts   # Auto-detection logic, config-driven selection, prerequisite checks
│   │   └── provider-parity.test.ts    # Same test suite runs against BOTH providers, asserts identical results
│   ├── migrations/
│   │   ├── sqlite-migrations.test.ts  # Schema creation, version upgrades, rollback
│   │   └── supabase-migrations.test.ts # Table creation, RLS setup, index creation
│   ├── migrate.test.ts           # SQLite → Supabase migration: event integrity, embedding preservation, hash chain continuity
│   └── integration.test.ts       # Full capture → search → verify workflow
```

- TDD London School: mock storage providers and embedding providers
- Golden dataset: 50 pre-embedded events for search quality tests
- **Provider parity test:** identical test suite runs against both SQLite and Supabase providers — asserts that `capture()`, `search()`, `list()`, `stats()`, and `verifyChain()` return identical results for identical inputs. This is the critical test that guarantees backend-swappability.
- **Migration test:** captures 100 events into SQLite, runs migration to Supabase, verifies all events present, embeddings intact, hash chain unbroken, and search results equivalent
- Hash chain verification: test tamper detection with corrupted records
- Performance: SQLite capture <50ms, search <200ms; Supabase capture <300ms, search <500ms (network overhead accepted)

### Phase 1 Deliverables

| Deliverable | File(s) | Verification |
|------------|---------|-------------|
| StorageProvider interface | `src/memory/providers/storage-provider.ts` | Typed, exported, documented |
| SQLite provider (default) | `src/memory/providers/sqlite-provider.ts` | `npm test -- --grep sqlite` passes |
| Supabase provider (opt-in) | `src/memory/providers/supabase-provider.ts` | `npm test -- --grep supabase` passes |
| Provider factory | `src/memory/providers/provider-factory.ts` | Auto-detect + config-driven selection works |
| Provider parity tests | `tests/memory/providers/provider-parity.test.ts` | Identical results from both backends |
| Migration tool | `src/memory/migrate.ts` | SQLite → Supabase with hash chain preserved |
| Memory store module | `src/memory/store.ts` | Provider-agnostic CRUD + search via interface |
| Embedding abstraction | `src/memory/embeddings.ts` | Offline ONNX + fallback chain works |
| Hook integration | All hook scripts updated | Events captured on every hook firing |
| Scaffold generation | `src/scaffold/generator.ts` updated | CONTEXT.md generated from memory store |
| Config schema update | `config/agentops.config.schema.json` | `memory.provider` accepts "sqlite" or "supabase" |
| Spec update | `docs/AgentOps-Product-Spec.md` §25 added | New section reviewed |

```bash
# Phase 1 verification
npm test && npm run build && npx @claude-flow/cli@latest security scan
```

---

## Phase 2: MCP Server Interface (P0 — Week 2)

**Goal:** Expose AgentOps as an MCP server so any AI client can query the management layer.

**Agents:** MCP Engineer, Security Auditor, Test Engineer
**Priority:** Critical

### 2.1 MCP Server Core (`src/mcp/server.ts`) — MCP Engineer

```
agentops/
├── src/
│   ├── mcp/
│   │   ├── server.ts          # MCP server setup, tool registration
│   │   ├── tools/
│   │   │   ├── check-git.ts       # agentops_check_git
│   │   │   ├── check-context.ts   # agentops_check_context
│   │   │   ├── check-rules.ts     # agentops_check_rules
│   │   │   ├── size-task.ts       # agentops_size_task
│   │   │   ├── scan-security.ts   # agentops_scan_security
│   │   │   ├── capture-event.ts   # agentops_capture_event
│   │   │   ├── search-history.ts  # agentops_search_history
│   │   │   └── health.ts         # agentops_health
│   │   ├── transport.ts       # Stdio + HTTP transport options
│   │   └── auth.ts            # Access key validation
```

**Tool Registrations (8 tools):**

```typescript
// Tool 1: Git hygiene status
server.registerTool("agentops_check_git", {
  description: "Returns git hygiene status — uncommitted files, time since last commit, branch safety, risk score.",
  inputSchema: { /* no required inputs */ }
});

// Tool 2: Context health
server.registerTool("agentops_check_context", {
  description: "Returns estimated context window usage, message count, degradation signals, and recommendation (continue/refresh).",
  inputSchema: {
    message_count: z.number().optional().describe("Current message count in session"),
  }
});

// Tool 3: Rules compliance
server.registerTool("agentops_check_rules", {
  description: "Validates a proposed file change against AGENTS.md, CLAUDE.md, and project rules. Returns violations.",
  inputSchema: {
    file_path: z.string().describe("File being modified"),
    change_description: z.string().describe("What the change does"),
  }
});

// Tool 4: Task sizing
server.registerTool("agentops_size_task", {
  description: "Analyzes a task description and returns risk score (LOW/MEDIUM/HIGH/CRITICAL), affected file estimate, and decomposition recommendation.",
  inputSchema: {
    task: z.string().describe("Task description to analyze"),
    files: z.array(z.string()).optional().describe("Known files to be modified"),
  }
});

// Tool 5: Security scan
server.registerTool("agentops_scan_security", {
  description: "Scans file content or a diff for secrets, PII, missing error handling, and injection risks.",
  inputSchema: {
    content: z.string().describe("File content or diff to scan"),
    file_path: z.string().optional().describe("File path for context"),
  }
});

// Tool 6: Capture event (memory write)
server.registerTool("agentops_capture_event", {
  description: "Captures a decision, violation, incident, or other operational event to the persistent memory store.",
  inputSchema: {
    event_type: z.enum(["decision", "violation", "incident", "pattern", "handoff", "audit_finding"]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    skill: z.enum(["save_points", "context_health", "standing_orders", "small_bets", "proactive_safety", "system"]),
    title: z.string().max(120),
    detail: z.string(),
    affected_files: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  }
});

// Tool 7: Search history (memory read)
server.registerTool("agentops_search_history", {
  description: "Semantic search across all stored operational events. Returns ranked results by relevance.",
  inputSchema: {
    query: z.string().describe("Natural language search query"),
    limit: z.number().optional().default(10),
    event_type: z.string().optional(),
    severity: z.string().optional(),
    since: z.string().optional().describe("ISO timestamp — only events after this date"),
  }
});

// Tool 8: Health dashboard
server.registerTool("agentops_health", {
  description: "Returns current health scores, KPIs, recent alerts, and skill-level status as structured JSON.",
  inputSchema: { /* no required inputs */ }
});
```

**Transport options:**

```typescript
// Stdio transport (default — for Claude Code, Cursor MCP config)
// Start: node agentops/src/mcp/server.js

// HTTP transport (optional — for remote/team access)
// Start: node agentops/src/mcp/server.js --http --port 3100
// Auth: x-agentops-key header or ?key= query param
```

**Claude Code integration (`claude mcp add`):**
```bash
claude mcp add agentops -- node agentops/src/mcp/server.js
```

**Cursor integration (`.cursor/mcp.json`):**
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

### 2.2 Security — Security Auditor

- Access key required for HTTP transport (generated on install, stored in `.env`)
- Stdio transport inherits process-level permissions (no additional auth needed)
- `agentops_capture_event` validates all inputs against schema (no arbitrary SQL)
- `agentops_scan_security` never executes scanned content
- Rate limiting on HTTP transport (100 req/min default)
- No MCP tool exposes raw database access

### 2.3 Tests — Test Engineer

```
tests/
├── mcp/
│   ├── server.test.ts         # Tool registration, request routing
│   ├── tools/*.test.ts        # Each tool unit-tested
│   ├── transport.test.ts      # Stdio and HTTP transport
│   ├── auth.test.ts           # Key validation, rate limiting
│   └── integration.test.ts    # Full MCP client → server round-trip
```

### Phase 2 Deliverables

| Deliverable | File(s) | Verification |
|------------|---------|-------------|
| MCP server | `src/mcp/server.ts` | Responds to MCP tool calls via stdio |
| 8 MCP tools | `src/mcp/tools/*.ts` | Each tool returns valid MCP responses |
| Transport layer | `src/mcp/transport.ts` | Stdio and HTTP both work |
| Auth module | `src/mcp/auth.ts` | HTTP requires valid key |
| Claude integration | README section | `claude mcp add` works |
| Cursor integration | Example config | `.cursor/mcp.json` works |
| Spec update | `docs/AgentOps-Product-Spec.md` §26 added | New section reviewed |

---

## Phase 3: Primitives & Plugin Model (P1 — Week 3)

**Goal:** Extract reusable patterns, formalize the plugin contribution model.

**Agents:** Primitives Engineer, Plugin Architect, Test Engineer
**Priority:** High

### 3.1 Primitives Library (`src/primitives/`) — Primitives Engineer

Extract shared patterns from the 5 core skills into composable modules:

```
agentops/
├── src/
│   ├── primitives/
│   │   ├── checkpoint-and-branch.ts    # Used by: Skills 1, 4
│   │   ├── rules-validation.ts         # Used by: Skills 3, 5
│   │   ├── risk-scoring.ts             # Used by: Skills 4, 5
│   │   ├── context-estimation.ts       # Used by: Skills 2, 4
│   │   ├── scaffold-update.ts          # Used by: Skills 2, 3
│   │   ├── secret-detection.ts         # Used by: Skills 1, 5
│   │   ├── event-capture.ts            # Used by: All skills
│   │   └── index.ts                    # Public API
```

**Each primitive exports a typed interface:**

```typescript
// Example: risk-scoring.ts
export interface RiskAssessment {
  score: number;           // 0-15
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: RiskFactor[];
  recommendation: string;
}

export interface RiskFactor {
  name: string;            // 'file_count' | 'db_changes' | 'shared_code' | 'main_branch'
  value: number;
  weight: number;
  contribution: number;
}

export function assessRisk(params: {
  files: string[];
  hasDatabaseChanges: boolean;
  touchesSharedCode: boolean;
  isMainBranch: boolean;
}): RiskAssessment;
```

**Refactor existing skills to use primitives:**
- `scripts/git-hygiene-check.sh` → calls `checkpoint-and-branch` + `event-capture`
- `scripts/security-audit.sh` → calls `secret-detection` + `rules-validation` + `event-capture`
- `scripts/task-sizer.sh` → calls `risk-scoring` + `context-estimation` + `event-capture`
- `scripts/rules-file-linter.sh` → calls `rules-validation` + `event-capture`
- `scripts/context-estimator.sh` → calls `context-estimation` + `scaffold-update` + `event-capture`

### 3.2 Plugin Contribution Model — Plugin Architect

```
agentops/
├── plugins/
│   ├── _templates/
│   │   ├── monitor/
│   │   │   ├── metadata.json
│   │   │   ├── README.md
│   │   │   └── src/index.ts
│   │   ├── auditor/
│   │   │   ├── metadata.json
│   │   │   ├── README.md
│   │   │   └── src/index.ts
│   │   ├── dashboard/
│   │   │   ├── metadata.json
│   │   │   ├── README.md
│   │   │   └── src/index.ts
│   │   └── integration/
│   │       ├── metadata.json
│   │       ├── README.md
│   │       └── src/index.ts
│   ├── core/                  # Bundled plugins
│   └── community/             # User-installed plugins
```

**metadata.json schema (`config/plugin.schema.json`):**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["name", "description", "category", "author", "version", "requires", "tags"],
  "properties": {
    "name": { "type": "string", "pattern": "^[a-z0-9-]+$" },
    "description": { "type": "string", "maxLength": 200 },
    "category": { "enum": ["monitor", "auditor", "dashboard", "integration"] },
    "author": {
      "type": "object",
      "required": ["name"],
      "properties": {
        "name": { "type": "string" },
        "github": { "type": "string" },
        "email": { "type": "string", "format": "email" }
      }
    },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "requires": {
      "type": "object",
      "required": ["agentops"],
      "properties": {
        "agentops": { "type": "string" },
        "primitives": { "type": "array", "items": { "type": "string" } }
      }
    },
    "hooks": { "type": "array", "items": { "enum": ["PreToolUse", "PostToolUse", "SessionStart", "Stop"] } },
    "mcp_tools": { "type": "array", "items": { "type": "string" } },
    "tags": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "difficulty": { "enum": ["beginner", "intermediate", "advanced"] }
  }
}
```

**Automated validation script (`scripts/validate-plugin.sh`):**

11 checks (modeled on OB1's PR review pipeline):

1. Folder structure matches category template
2. `metadata.json` validates against schema
3. No credentials, API keys, or secrets in any file
4. README.md contains required sections (What It Does, Prerequisites, Installation, Configuration, How It Works, Troubleshooting)
5. `src/index.ts` exports a valid plugin interface
6. Hook subscriptions reference valid hook types
7. MCP tool names follow `agentops_plugin_{name}_{tool}` convention
8. No files exceed 500 lines
9. Required primitives exist in the primitives library
10. Tests exist and pass (`tests/` directory, `npm test` returns 0)
11. No binary files exceeding 1MB

### Phase 3 Deliverables

| Deliverable | File(s) | Verification |
|------------|---------|-------------|
| 7 primitives | `src/primitives/*.ts` | Unit tests pass, typed interfaces exported |
| Skill refactor | `scripts/*.sh` updated | Skills use primitives, behavior unchanged |
| 4 plugin templates | `plugins/_templates/*` | Each template validates against schema |
| Plugin schema | `config/plugin.schema.json` | JSON Schema valid |
| Validation script | `scripts/validate-plugin.sh` | 11 checks pass on template plugins |
| Spec update | `docs/AgentOps-Product-Spec.md` §27, §23 expanded | Reviewed |

---

## Phase 4: Progressive Enablement & Enrichment (P1-P2 — Week 4)

**Goal:** Make AgentOps adoptable by non-experts. Add smart event classification.

**Agents:** Spec Writer, Coder, Test Engineer
**Priority:** High

### 4.1 Progressive Enablement — Spec Writer + Coder

**Config schema update (`agentops.config.json`):**

```json
{
  "enablement": {
    "level": 3,
    "skills": {
      "save_points":      { "enabled": true,  "mode": "full" },
      "context_health":   { "enabled": true,  "mode": "full" },
      "standing_orders":  { "enabled": true,  "mode": "basic" },
      "small_bets":       { "enabled": false, "mode": "off" },
      "proactive_safety": { "enabled": false, "mode": "off" }
    }
  }
}
```

**Five levels:**

| Level | Name | Skills Active | Config |
|-------|------|--------------|--------|
| 1 | Safe Ground | Save Points only | `"level": 1` |
| 2 | Clear Head | + Context Health | `"level": 2` |
| 3 | House Rules | + Standing Orders | `"level": 3` |
| 4 | Right Size | + Small Bets | `"level": 4` |
| 5 | Full Guard | + Proactive Safety | `"level": 5` |

**Setup wizard (`scripts/setup-wizard.sh`):**
- Interactive CLI: "What level do you want to start at?"
- Generates `agentops.config.json` with appropriate enablement level
- Creates only the scaffold docs needed for that level
- Registers only the hooks needed for that level
- Estimated time: 5 minutes for Level 1, 15 minutes for Level 5

**Dashboard adaptation:**
- Dashboard shows only metrics for enabled skills
- Disabled skill panels show "Enable Level X to unlock" with one-click upgrade
- Level indicator in header: "AgentOps Level 3 — House Rules"

### 4.2 Auto-Classification Enrichment — Coder

**`src/memory/enrichment.ts`:**

```typescript
interface EnrichmentResult {
  cross_tags: string[];        // Tags from other skill domains
  root_cause_hint?: string;    // Pattern-based suggestion
  related_events: string[];    // IDs of similar past events
  severity_context?: string;   // Why this severity level (not just the number)
}

// Enrichment runs asynchronously after event capture.
// Does NOT block the agent's work.
//
// Provider priority:
// 1. Local pattern matching (zero cost, <10ms) — always runs
// 2. Local LLM via Ollama (if available) — richer enrichment
// 3. Cloud LLM (if API key configured) — richest enrichment
// 4. Skip enrichment — structured classification only
```

**Local pattern matching (always available):**
- If an event mentions files in `auth/`, `login/`, `session/`, `jwt/` → add tag `authentication`
- If 3+ events with the same `affected_files` pattern in the last 7 days → add `root_cause_hint: "Recurring pattern on these files — consider a dedicated rule"`
- If severity is HIGH but the affected files are on a feature branch → add `severity_context: "High score mitigated by feature branch isolation"`

### 4.3 Semantic Audit Search — Coder

**Extend the existing audit trail (§19 in spec) with optional vector indexing.**

The hash-chained audit records remain unchanged. A parallel index adds:

```typescript
// When an audit record is created:
// 1. Hash-chain it (existing behavior)
// 2. Generate a text summary: "Agent {id} performed {action} on {target} — {outcome}"
// 3. Embed the summary and store in ops_events_vec
// 4. Link via audit_record_id in metadata

// This enables:
// agentops_search_history("database schema changes that caused issues")
// → returns ranked audit records matching that semantic query
```

### 4.4 Spec Updates — Spec Writer

Update `AgentOps-Product-Spec.md` to v4.0:

| Section | Change |
|---------|--------|
| §1.1 Purpose | Add: "maintains persistent, searchable memory of all agent operations across sessions" |
| §1.4 Installation Architecture | Add: `src/memory/`, `src/mcp/`, `src/primitives/`, `models/` directories |
| §1.5 Key Design Principles | Add: "Memory-aware — every agent event is captured, indexed, and searchable by meaning" |
| §3 Context Health | Add: memory store queries at session start for relevant historical context |
| §6 Proactive Safety | Add: auto-enrichment of security events with cross-cutting tags |
| §9 Hook Configuration | Add: MCP server as alternative/complement to hooks |
| §11 Configuration | Add: `memory` and `enablement` sections to config schema |
| §13 Implementation Phases | Rewrite to reflect v4.0 build phases |
| §19 Compliance & Audit Trail | Add: optional semantic indexing of audit records |
| §21 Plugin Architecture | Expand: 4 categories, metadata schema, validation pipeline, templates |
| NEW §25 | Persistent Operations Memory — full section |
| NEW §26 | MCP Server Interface — full section |
| NEW §27 | Primitives Library — full section |
| NEW §28 | Progressive Enablement — full section |

### Phase 4 Deliverables

| Deliverable | File(s) | Verification |
|------------|---------|-------------|
| Progressive config | `config/agentops.config.schema.json` | All 5 levels generate valid configs |
| Setup wizard | `scripts/setup-wizard.sh` | Interactive flow works for each level |
| Dashboard adaptation | `agentops/dashboard/*.html` | Disabled skills show upgrade prompt |
| Auto-enrichment | `src/memory/enrichment.ts` | Local patterns run <10ms, enrichments are accurate |
| Semantic audit | `src/memory/audit-index.ts` | Natural language audit queries return ranked results |
| Spec v4.0 | `docs/AgentOps-Product-Spec.md` | All new sections present, version bumped |

---

## Cross-Phase Coordination

### RuFlo Memory Namespace

All agents share the `agentops-build` memory namespace:

```bash
# Key conventions:
# agentops-build:schema-*     → data schemas and interfaces
# agentops-build:decision-*   → architectural decisions
# agentops-build:blocker-*    → issues requiring coordinator attention
# agentops-build:complete-*   → phase completion signals

# Example: Memory Architect records a schema decision
npx @claude-flow/cli@latest memory store \
  --key "decision-embedding-dim" \
  --value "384 dimensions (all-MiniLM-L6-v2). Chosen for: small model size (23MB), good quality, MIT license, ONNX support." \
  --namespace agentops-build \
  --tags "decision,embeddings,phase-1"
```

### Checkpoint Hooks

```bash
# After each phase, run:
npx @claude-flow/cli@latest hooks run post-task --phase "phase-N"

# This triggers:
# 1. npm test (all tests must pass)
# 2. npm run build (must succeed)
# 3. npx @claude-flow/cli@latest security scan
# 4. Memory store: record phase completion
# 5. Git commit with phase tag
```

### Dependency Graph

```
Phase 1 (Memory Store)
  ├── Phase 2 (MCP Server) — depends on memory store API
  ├── Phase 3 (Primitives) — depends on event-capture primitive from Phase 1
  │   └── Phase 3 (Plugins) — depends on primitives being extractable
  └── Phase 4 (Enablement) — depends on config schema from Phases 1-3
       └── Phase 4 (Enrichment) — depends on memory store from Phase 1
```

Phases 2 and 3 can run in parallel after Phase 1 completes. Phase 4 requires all prior phases.

---

## Verification & Completion Criteria

### Per-Phase Gates

| Phase | Gate | Command |
|-------|------|---------|
| 1 | Memory store captures and retrieves events | `npm test -- --grep "memory"` |
| 1 | Embedding fallback chain works (ONNX → Ollama → Cloud → No-op) | `npm test -- --grep "embedding"` |
| 1 | Hash chain verifies integrity | `npm test -- --grep "chain"` |
| 2 | All 8 MCP tools respond correctly via stdio | `npm test -- --grep "mcp"` |
| 2 | Claude Code can call AgentOps MCP tools | Manual: `claude mcp add agentops` |
| 3 | All 7 primitives extracted and typed | `npm test -- --grep "primitives"` |
| 3 | Skills produce identical output using primitives | `npm test -- --grep "skills"` |
| 3 | Plugin template validates against schema | `bash scripts/validate-plugin.sh plugins/_templates/monitor` |
| 4 | Setup wizard generates valid config for all 5 levels | `npm test -- --grep "enablement"` |
| 4 | Dashboard adapts to enablement level | Manual: visual check at each level |
| 4 | Semantic search returns relevant audit results | `npm test -- --grep "audit-search"` |

### Final Acceptance

```bash
# Full verification sequence
npm test                                           # All tests pass (including provider parity)
npm run build                                      # Build succeeds
npx @claude-flow/cli@latest security scan          # No security issues
node agentops/src/mcp/server.js --self-test        # MCP server responds to all 8 tools
npm test -- --grep "provider-parity"               # Both backends produce identical results
npm test -- --grep "migrate"                       # SQLite → Supabase migration preserves integrity
bash scripts/validate-plugin.sh plugins/_templates/*  # All templates valid
bash scripts/setup-wizard.sh --dry-run --level 1   # Level 1 config valid
bash scripts/setup-wizard.sh --dry-run --level 5   # Level 5 config valid
```

### Spec Diff Summary

After all phases complete, `AgentOps-Product-Spec.md` should show:

- Version: 4.0 (was 3.0)
- 4 new sections (§25-28)
- 5 modified sections (§1, §3, §11, §13, §19, §21)
- Installation architecture updated with new directories
- Config schema expanded with `memory` and `enablement` blocks
- File registry updated with all new source files

---

## Timeline

| Week | Phase | Agents Active | Key Output |
|------|-------|--------------|------------|
| 1 | Phase 1: Memory Store | Memory Architect, Coder, Tester, Security Auditor | `src/memory/*`, hook integrations |
| 2 | Phase 2: MCP Server | MCP Engineer, Security Auditor, Tester | `src/mcp/*`, 8 tools, transport |
| 2 | Phase 3: Primitives & Plugins (parallel with Phase 2) | Primitives Engineer, Plugin Architect, Tester | `src/primitives/*`, `plugins/_templates/*` |
| 3 | Phase 4: Enablement & Enrichment | Spec Writer, Coder, Tester | Config, wizard, enrichment, spec v4.0 |
| 3 | Final verification & commit | Coordinator, Security Auditor | All gates pass, tagged release |
