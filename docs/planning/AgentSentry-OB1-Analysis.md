# AgentSentry × Open Brain (OB1): Cross-Pollination Analysis

## What This Document Is

An analysis of [Open Brain (OB1)](https://github.com/NateBJones-Projects/OB1) — a persistent AI memory system — and how its architecture, patterns, and design philosophy can inform updates to the AgentSentry product specification.

OB1 and AgentSentry solve different problems, but they share a critical insight: **AI agents working across sessions and tools need infrastructure that the agents themselves don't provide.** OB1 solves this for *memory*. AgentSentry solves it for *management*. The overlap is where the most valuable updates live.

---

## OB1 in 60 Seconds

Open Brain is a persistent memory layer for AI interactions. One Supabase database (PostgreSQL + pgvector), one MCP server, any AI client. You capture "thoughts" — notes, decisions, ideas, references — and every AI tool you use (Claude, ChatGPT, Cursor, Copilot) can search, retrieve, and build on them through the Model Context Protocol.

The technical core is a ~250-line Deno MCP server with four tools: `capture_thought`, `search_thoughts`, `list_thoughts`, and `thought_stats`. Every thought gets a vector embedding (for semantic search) and auto-extracted metadata (type, topics, people, action items, dates). The community layer adds extensions (progressive learning path), recipes (standalone capabilities), schemas, dashboards, integrations (Slack/Discord capture), and primitives (reusable concept guides).

The key architectural choices: no middleware, no SaaS chains, single database, row-level security for multi-user isolation, remote MCP via Supabase Edge Functions, and a contribution model with automated review (11 machine-readable checks) plus human review.

---

## Seven Updates for AgentSentry

### 1. Add a Persistent Memory Layer (The Big One)

**What OB1 does:** Every "thought" is stored with a vector embedding and structured metadata, making the entire history semantically searchable across AI tools and sessions.

**What AgentSentry is missing:** AgentSentry currently uses flat markdown scaffold documents (PLANNING.md, TASKS.md, CONTEXT.md, WORKFLOW.md) as its cross-session memory. These work for human-readable state, but they have three limitations:

- They're not searchable by meaning — an agent can't ask "what security decisions have we made?" and get ranked results
- They lose granularity — when the scaffold subagent updates CONTEXT.md, the *history* of decisions that led to the current state is overwritten
- They don't compound — session 47's context handoff doesn't learn from session 12's similar situation

**The update:** Add an **AgentSentry Memory Store** — a local, vector-indexed database of agent operations events. Every significant event gets captured as a structured record with an embedding:

```
Event types:
- decision: "Chose JWT over session tokens for auth — stateless, scales horizontally"
- violation: "Agent hardcoded DB connection string in config.js — blocked by secret scanner"
- incident: "Agent rewrote auth module on main branch — auto-branched to safety/auth-rewrite"
- pattern: "Third time this week an agent exceeded 8-file blast radius on 'refactor' tasks"
- handoff: "Session ended at 78% context — scaffold docs updated, 3 tasks remaining"
- audit_finding: "Security audit found 2 API endpoints missing input validation"
```

Each record gets: timestamp, event type, affected files, risk level, session ID, agent ID, auto-extracted topic tags, and a vector embedding for semantic search.

**How it works in practice:**
- A new agent session starts. Before reading the scaffold docs, it queries: `search_ops_memory("authentication decisions", limit=5)` and gets the ranked history of every auth-related decision, violation, and incident
- The dashboard's trend charts pull from this store instead of parsing log files
- The compliance audit trail (§20 in the spec) gets a queryable index for free
- Context handoffs become richer: instead of summarizing into CONTEXT.md, the handoff captures discrete events that the next session can search semantically

**Implementation:** SQLite with the `sqlite-vec` extension (local, zero-dependency, no server), or optionally Supabase for teams. The MCP server pattern from OB1 maps directly — AgentSentry exposes `capture_event`, `search_events`, `event_stats` as MCP tools.

**Spec sections affected:** §6 (Context Health), §8 (Proactive Safety), §10 (Dashboard), §20 (Compliance/Audit Trail). New section: §25 (Persistent Operations Memory).

---

### 2. Adopt MCP as the Primary Interface Protocol

**What OB1 does:** The entire system is an MCP server. Any AI client that speaks MCP can use it — no tool-specific hooks required.

**What AgentSentry currently does:** Relies heavily on Claude Code hooks (PreToolUse, PostToolUse, etc.), with secondary support for git hooks and rules file syncing to Cursor/Codex. This means the real-time monitoring — the core value — only works fully in Claude Code.

**The update:** Add an **AgentSentry MCP Server** that exposes the five core skills as MCP tools:

| MCP Tool | Maps To | What It Does |
|---|---|---|
| `agent_sentry_check_git` | Skill 1 (Save Points) | Returns git hygiene status — uncommitted files, time since last commit, branch safety |
| `agent_sentry_check_context` | Skill 2 (Context Health) | Returns estimated context usage, message count, degradation signals |
| `agent_sentry_check_rules` | Skill 3 (Standing Orders) | Validates a proposed change against rules files, returns violations |
| `agent_sentry_size_task` | Skill 4 (Small Bets) | Analyzes a task description and returns risk score + decomposition recommendation |
| `agent_sentry_scan_security` | Skill 5 (Proactive Safety) | Scans a file or change for secrets, PII, missing error handling |
| `agent_sentry_capture_event` | Memory Store | Captures a decision, violation, or incident to the persistent memory |
| `agent_sentry_search_history` | Memory Store | Semantic search across all stored operations events |
| `agent_sentry_health` | Dashboard | Returns current health scores and KPIs as structured data |

**Why this matters:** MCP is becoming the universal protocol. Claude Desktop, ChatGPT, Cursor, Windsurf, and others are adding MCP support. By exposing AgentSentry as an MCP server, every AI client gets access to the management layer — not just the ones with hook systems. A developer using ChatGPT with Cursor gets the same oversight as someone using Claude Code.

The existing Claude Code hooks remain (they're faster and can block operations). The MCP server is an additional, universal access layer.

**Spec sections affected:** §1 (System Overview), §9 (Hook Configuration). New section: §26 (MCP Server Interface).

---

### 3. Introduce a "Primitives" Layer for Reusable Management Patterns

**What OB1 does:** Primitives are concept guides extracted when a pattern appears in 2+ extensions. "Deploy an Edge Function" is a primitive because every extension needs it. You learn it once, apply it everywhere.

**What AgentSentry currently does:** The 5 core skills are implemented as independent modules. Shared concepts (like "checkpoint before risky operation" or "validate against rules file") are duplicated across skills rather than extracted.

**The update:** Create an `agent-sentry/primitives/` directory with reusable management patterns:

| Primitive | Used By | What It Teaches |
|---|---|---|
| `checkpoint-and-branch` | Skills 1, 4 | How to create a safe restore point before any risky operation |
| `rules-file-validation` | Skills 3, 5 | How to compare a change against a rules file and generate violations |
| `risk-scoring` | Skills 4, 5 | The universal risk scoring model (file count + DB changes + shared code) |
| `context-estimation` | Skills 2, 4 | How to estimate current context window usage and remaining capacity |
| `scaffold-update` | Skills 2, 3 | How to safely update scaffold documents without losing history |
| `secret-detection` | Skills 1, 5 | Pattern matching for API keys, tokens, connection strings |
| `event-capture` | All skills | How to log a structured event to the operations memory store |

**Why this matters:** As AgentSentry grows (plugins, community extensions, custom rules), reusable primitives prevent fragmentation. A plugin author building a "Kubernetes deployment validator" can compose from existing primitives (risk-scoring + rules-file-validation + event-capture) instead of reinventing them.

This also creates a cleaner architecture: skills become *orchestrations* of primitives rather than monolithic scripts.

**Spec sections affected:** §1.4 (Installation Architecture), §23 (Plugin Architecture). New section: §27 (Primitives Library).

---

### 4. Structure the Plugin System with OB1's Contribution Model

**What OB1 does:** Six distinct contribution categories (extensions, primitives, recipes, schemas, dashboards, integrations), each with a `_template/` directory, required `metadata.json` with a validated schema, required `README.md` with specific sections, and 11 automated checks before human review.

**What AgentSentry currently does:** §23 describes a plugin manifest format with hook subscriptions, config schema, and dashboard panels — but it's abstract. There's no contribution workflow, no validation pipeline, and no category taxonomy.

**The update:** Formalize AgentSentry plugins into four contribution categories:

| Category | Purpose | Example |
|---|---|---|
| **Monitors** | New real-time checks that hook into agent activity | Kubernetes manifest validator, GraphQL schema drift detector |
| **Auditors** | On-demand scans for project-wide issues | License compliance checker, accessibility audit, dependency vulnerability scan |
| **Dashboards** | Custom dashboard views and visualizations | Sprint velocity tracker, cost-per-feature view, team agent activity heatmap |
| **Integrations** | Connectors to external systems | Slack alerts for violations, GitHub Actions for CI audit, Jira ticket creation for findings |

Each category gets:
- A `_template/` directory with starter files
- A `metadata.json` schema (validated automatically):
  ```json
  {
    "name": "k8s-manifest-validator",
    "description": "Validates Kubernetes manifests against best practices before agent deployment",
    "category": "monitor",
    "author": { "name": "...", "github": "..." },
    "version": "1.0.0",
    "hooks": ["PreToolUse"],
    "requires": { "agent-sentry": ">=3.0" },
    "tags": ["kubernetes", "deployment", "infrastructure"],
    "difficulty": "intermediate"
  }
  ```
- A README template with required sections: What It Does, Prerequisites, Installation, Configuration, How It Works, Troubleshooting
- Automated validation checks (valid JSON, no secrets, required files present, hook subscriptions valid)

**Spec sections affected:** §23 (Plugin Architecture). Significant expansion.

---

### 5. Add Semantic Search to the Audit Trail

**What OB1 does:** Every thought gets a vector embedding via `text-embedding-3-small`. You search by meaning: "conversations about hiring" returns notes about recruiting, interviews, and onboarding even if they never use the word "hiring."

**What AgentSentry currently does:** §20 (Compliance & Audit Trail) specifies append-only, hash-chained audit records — but they're structured logs, not semantically indexed. To find "all incidents related to authentication," you'd need to know the exact field values to query.

**The update:** Add optional vector indexing to the audit trail. When an audit record is created:

1. The structured fields (action, agent, timestamp, risk level) stay as-is for compliance queries
2. A text summary is generated from the record (e.g., "Agent coder-1 modified auth/jwt.ts and auth/middleware.ts — risk score HIGH — triggered by task 'add refresh token support'")
3. The summary gets embedded and stored alongside the record

This enables natural-language audit queries:
- "Show me everything related to database schema changes last week"
- "What security violations happened during the payment integration work?"
- "Find all incidents where agents exceeded their permission boundaries"

**Implementation note:** The embedding step is optional and configurable. For local-only setups, use a local embedding model (e.g., `all-MiniLM-L6-v2` via ONNX). For teams with API access, use OpenAI or Anthropic embeddings. For environments where no embedding is available, the structured query path remains the default.

**Spec sections affected:** §20 (Compliance & Audit Trail), §25 (Persistent Operations Memory).

---

### 6. Adopt OB1's Auto-Classification Pattern for Agent Events

**What OB1 does:** Every captured thought is automatically classified by a small LLM into: type (observation/task/idea/reference/person_note), topics (1-3 tags), people mentioned, action items, and dates. No manual tagging required.

**What AgentSentry currently does:** Events are classified by the code that generates them — a secret scanner violation is tagged "security," a blast radius warning is tagged "task-sizing." This is accurate but rigid. Cross-cutting concerns (like "this security violation happened because of poor task decomposition") aren't captured.

**The update:** Add an **auto-enrichment step** to the event capture pipeline. After the primary classification (which stays), a lightweight LLM pass adds:

- **Cross-cutting tags:** "This blast radius violation also relates to: authentication, database-schema, shared-code"
- **Root cause hints:** "This is the third time an agent has attempted to modify auth and payments in the same task — consider adding a decomposition rule for cross-domain changes"
- **Related events:** "Similar to incident #47 from 3 sessions ago — same file set, same risk pattern"
- **Severity refinement:** The risk scoring model gives a number; the enrichment adds context like "HIGH risk but low actual impact because the change was on a feature branch with no downstream dependencies"

**Implementation:** Use the cheapest available model (GPT-4o-mini equivalent, Haiku, or a local model). The enrichment is asynchronous — it doesn't block the agent's work. If no LLM is available (offline mode), skip enrichment and use the structured classification only.

**Spec sections affected:** §8 (Proactive Safety), §20 (Compliance), §25 (Persistent Operations Memory).

---

### 7. Build a Progressive Enablement Path (Not Just Install-and-Go)

**What OB1 does:** Six extensions that build on each other in progressive difficulty. Each extension references primitives when introducing new concepts. Users build competence incrementally.

**What AgentSentry currently does:** §13 defines 4 implementation phases (Foundation → Extended Monitoring → Advanced Safety → Full Integration), but these are build phases for the framework itself, not enablement phases for the user.

**The update:** Create a **progressive enablement path** for AgentSentry users — five levels that mirror the five core skills:

| Level | Name | What Gets Enabled | Complexity |
|---|---|---|---|
| 1 | **Safe Ground** | Git hygiene checks, auto-commit before risky changes, branch protection | Beginner — just install and go |
| 2 | **Clear Head** | Context health monitoring, scaffold document creation, session handoffs | Beginner — read the handoff, start fresh |
| 3 | **House Rules** | Rules file creation (AGENTS.md), real-time compliance checking, rules linter | Intermediate — write your first rules file |
| 4 | **Right Size** | Task risk scoring, blast radius analysis, decomposition recommendations | Intermediate — learn to size tasks |
| 5 | **Full Guard** | Secret scanning, PII detection, error handling enforcement, security audit | Advanced — full proactive safety suite |

Each level:
- Can be enabled independently, but the recommended path is sequential
- Has a "getting started" guide that takes 15 minutes or less
- Includes a "what you'll catch" section with real examples of prevented disasters
- References primitives for any shared concepts
- Has a dashboard view that shows only the relevant metrics for that level

The `agent-sentry.config.json` gets a new field:
```json
{
  "enablement_level": 3,
  "skills": {
    "save_points": { "enabled": true, "level": "full" },
    "context_health": { "enabled": true, "level": "full" },
    "standing_orders": { "enabled": true, "level": "basic" },
    "small_bets": { "enabled": false },
    "proactive_safety": { "enabled": false }
  }
}
```

**Why this matters:** The current spec presents AgentSentry as an all-or-nothing install. For the target audience (agentic developers who may be new to agent management), a progressive path reduces friction and builds confidence. You don't need to understand blast radius analysis on day one — you just need git checkpoints. The rest comes when you're ready.

**Spec sections affected:** §1 (System Overview), §12 (Configuration), §13 (Implementation Phases).

---

## Three Architectural Observations (Not Direct Updates, But Worth Noting)

### A. OB1's "No Middleware" Philosophy Validates AgentSentry' Local-First Design

OB1 explicitly rejects SaaS chains and middleware. Everything runs against a single database the user controls. This validates AgentSentry' existing choice to run locally with no server dependency. Worth emphasizing more strongly in the spec — "your management data never leaves your machine" is a selling point for security-conscious developers and teams subject to data residency requirements.

### B. OB1's Row-Level Security Pattern Is Relevant for Team AgentSentry

OB1 uses PostgreSQL RLS to isolate multi-user data while enabling shared access patterns. AgentSentry §17 (Agent Identity & Permissions) defines permission boundaries per agent, but doesn't address multi-developer teams sharing an AgentSentry installation. When two developers run agents on the same repo, whose scaffold docs win? Whose risk thresholds apply? OB1's RLS pattern offers a model: each developer's AgentSentry events are isolated by default, with explicit sharing for team-level dashboards and audit trails.

### C. OB1's Automated PR Review (11 Checks) Is a Template for AgentSentry Plugin Validation

OB1's `.github/workflows/ob1-review.yml` runs 11 structural and security checks on every PR before human review. This exact pattern should be adopted for AgentSentry plugin submissions — automated validation of metadata.json, no secrets, required README sections, valid hook subscriptions, and passing test suite before any human reviews the plugin.

---

## Priority Ranking

| # | Update | Impact | Effort | Priority |
|---|---|---|---|---|
| 1 | Persistent Memory Layer | Transforms cross-session intelligence | High | **P0** — This is the conceptual breakthrough |
| 2 | MCP Server Interface | Universal tool compatibility | Medium | **P0** — MCP adoption is accelerating |
| 7 | Progressive Enablement Path | Dramatically reduces adoption friction | Low | **P1** — Documentation and config, not code |
| 3 | Primitives Layer | Cleaner architecture, enables community | Medium | **P1** — Architectural improvement |
| 4 | Structured Plugin Contribution Model | Enables ecosystem growth | Medium | **P1** — Community enablement |
| 5 | Semantic Search on Audit Trail | Makes compliance data actionable | Medium | **P2** — Builds on #1 |
| 6 | Auto-Classification Enrichment | Smarter event correlation | Low | **P2** — Nice-to-have, builds on #1 |

---

## What Stays the Same

OB1 doesn't change AgentSentry' core value proposition. The five management skills, the hook-based monitoring, the dashboard, the audit trail, the plugin system — all of that stands. What OB1 contributes is:

1. A **memory model** that makes AgentSentry smarter across sessions (not just within them)
2. A **protocol choice** (MCP) that makes AgentSentry universal across tools (not just Claude Code)
3. A **contribution architecture** that makes AgentSentry extensible by a community (not just the maintainer)
4. An **onboarding philosophy** that makes AgentSentry adoptable by non-experts (not just power users)

These are the same four things that make OB1 itself successful — persistent memory, universal protocol, community extensibility, and progressive learning. The patterns transfer cleanly because both projects are solving the same meta-problem: building infrastructure that AI tools need but don't ship with.
