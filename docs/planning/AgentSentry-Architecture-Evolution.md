# AgentSentry: Architectural Analysis & Framework Evolution

## What's Missing From the Current Spec — and What Needs to Be Built for 2026-2027

**Context:** The current AgentSentry spec covers the 5 management skills well (version control, context health, rules files, task sizing, safety checks), and it integrates cleanly with RuFlo. But it was designed as an oversight layer for a human managing coding agents. The agent landscape is moving fast, and several architectural concerns will determine whether AgentSentry becomes a durable framework or a 2026 artifact. This document identifies those gaps and proposes the extensions needed.

---

## 1. Agent Observability & Tracing

### What's Missing

The current spec logs events to NDJSON files and displays them in a dashboard. That works for a single operator watching a single session. It does not work when RuFlo is running 12 agents in a swarm, each making tool calls, LLM requests, and inter-agent messages simultaneously. There is no way to trace a single task through the chain of agents that touched it.

### What Needs to Be Built

**Distributed tracing using the OpenTelemetry AI Agent Semantic Convention.** Every agent action gets a trace ID and span:

```
Trace: "Add customer reviews feature"
├── Span: queen-tactical-01 → decompose task (12ms)
├── Span: coder-ts-01 → create database table (4.2s, 1,847 tokens)
│   ├── Span: tool:Write → reviews.sql (230ms)
│   └── Span: tool:Bash → run migration (1.1s)
├── Span: coder-ts-02 → build API route (6.8s, 3,201 tokens)
├── Span: tester-01 → run integration tests (8.3s)
│   └── Span: tool:Bash → npm test (7.9s)
└── Span: reviewer-01 → code review (3.1s, 1,402 tokens)
```

Each span records: agent ID, tool called, input/output tokens, latency, cost, success/failure, and the parent span that delegated to it.

**Concrete additions to the spec:**

| Component | Purpose | Priority |
|---|---|---|
| `agent-sentry/tracing/trace-context.ts` | Trace ID propagation across agent boundaries | P0 |
| `agent-sentry/tracing/span-logger.ts` | Structured span logging with OpenTelemetry-compatible format | P0 |
| `agent-sentry/tracing/trace-viewer.html` | Visual trace waterfall in the dashboard (new page) | P1 |
| Hook: inject trace context into swarm deploys | Ensure every agent in a swarm shares the trace ID | P0 |
| Dashboard: trace search and filter | Find traces by agent, task, time range, error | P1 |

**Data format extension:**

```json
{
  "traceId": "abc123",
  "spanId": "span-456",
  "parentSpanId": "span-123",
  "agentId": "coder-ts-01",
  "operation": "tool:Write",
  "input_tokens": 412,
  "output_tokens": 1435,
  "latency_ms": 4200,
  "cost_usd": 0.0034,
  "status": "ok",
  "ts": "2026-03-19T14:15:00Z"
}
```

---

## 2. Agent Identity, Permissions & Capability Model

### What's Missing

The current spec treats all agents the same. A coder agent and a security-auditor agent have no formal permission differences — any agent can read any file, write anywhere, run any command. RuFlo has 60+ specialized agents, but their specialization is semantic (defined in their descriptions), not enforced.

This is a real vulnerability. If a coder agent's context gets polluted with a prompt injection from a malicious file, there's nothing stopping it from modifying security configurations or deleting critical data.

### What Needs to Be Built

**A formal permission model with three layers:**

**Layer 1 — Agent Identity Registry**

Every agent gets a formal identity with declared capabilities:

```yaml
# .claude/agents/coder-ts-01.md (extend existing definition)
---
name: coder-ts-01
identity:
  role: worker
  specialization: typescript-development
permissions:
  files:
    read: ["ruflo/src/**", "ruflo/docs/**", "package.json", "tsconfig.json"]
    write: ["ruflo/src/**"]
    deny: [".env*", ".claude/settings.json", ".claude/mcp.json", "*.key"]
  tools:
    allow: [Read, Write, Edit, Bash, Grep, Glob]
    deny: [Agent]  # Cannot spawn sub-agents
  bash:
    allow: ["npm test", "npm run build", "tsc", "eslint"]
    deny: ["rm -rf", "git push", "curl", "wget"]  # No destructive or network ops
  escalation: queen-tactical-01  # Who to escalate to
---
```

**Layer 2 — Runtime Permission Enforcement**

A PreToolUse hook validates every tool call against the agent's permission model:

```
ON PreToolUse:
  agent = get_current_agent()
  tool = get_pending_tool()
  target = get_tool_target()  # file path, bash command, etc.

  IF NOT agent.permissions.allows(tool, target):
    BLOCK (exit 2): "Agent {agent.id} does not have permission for {tool}:{target}"
    LOG: Permission violation to audit trail
    ESCALATE: Notify queen agent or operator
```

**Layer 3 — Delegation Scope Narrowing**

When a queen agent delegates to a worker, the delegation token narrows permissions:

```
Queen permissions (broad) → Worker delegation (narrow)
- Queen can read/write all of ruflo/src/
- Queen delegates "fix the router" to coder-ts-01
- Delegation token scopes worker to ruflo/src/routing/ only
- Worker cannot exceed this scope even if its base permissions are broader
```

**Concrete additions:**

| Component | Purpose | Priority |
|---|---|---|
| Permission schema in agent YAML definitions | Formal per-agent permissions | P0 |
| `agent-sentry/scripts/permission-enforcer.sh` | PreToolUse hook that validates permissions | P0 |
| Agent Identity Registry page in dashboard | Shows all agents, their roles, permissions, and violation history | P1 |
| Delegation token format and validator | Scope narrowing for queen → worker delegation | P1 |
| Audit trail for all permission checks | Append-only log of every allow/deny decision | P0 |

---

## 3. Cost Management & Token Budgeting

### What's Missing

The current spec has no cost awareness at all. RuFlo supports Claude, GPT, Gemini, Cohere, and Ollama — each with different token pricing. A swarm of 12 agents running for an hour can easily burn $20-50 in API costs, and agentic overhead (retry loops, self-correction, context reloading) amplifies costs 3-5x beyond what you'd expect from the raw token count.

### What Needs to Be Built

**Hierarchical token budget system:**

```
Budget Hierarchy:
├── Session budget: $10.00 (hard cap per session)
│   ├── Swarm budget: $7.00 (swarm operations)
│   │   ├── queen-tactical-01: $1.00
│   │   ├── coder-ts-01: $2.00
│   │   ├── coder-ts-02: $2.00
│   │   └── tester-01: $1.00
│   └── Interactive budget: $3.00 (direct human-agent chat)
└── Monthly budget: $500.00 (organizational cap)
```

**Per-agent metering:**

Every LLM call is tracked:

```json
{
  "agentId": "coder-ts-01",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "input_tokens": 4521,
  "output_tokens": 1847,
  "cost_usd": 0.0089,
  "cumulative_session_cost": 1.47,
  "budget_remaining": 0.53,
  "retry_count": 0,
  "ts": "2026-03-19T14:15:00Z"
}
```

**Budget enforcement:**

```
AFTER each LLM call:
  Update agent's cumulative cost

  IF agent_cost > agent_budget * 0.80:
    WARN: "Agent {id} at 80% of budget (${spent}/${budget})"

  IF agent_cost > agent_budget:
    ACTION: Downgrade model (e.g., sonnet → haiku) or pause agent
    NOTIFY: "Agent {id} exceeded budget. Downgraded to cheaper model."

  IF session_cost > session_budget * 0.90:
    WARN: "Session at 90% of budget. Consider wrapping up."

  IF session_cost > session_budget:
    BLOCK: Halt all non-essential agent operations
    NOTIFY: "Session budget exceeded. Only critical operations allowed."
```

**Cost-aware routing integration with RuFlo's MoE:**

RuFlo already has MoE routing with 8 experts and WASM fast-path for simple operations. AgentSentry should feed cost data back into the routing decision:

```
IF task is simple code transform AND WASM can handle it:
  Route to WASM (cost: $0.00, latency: <1ms)
ELSE IF task is classification/simple AND budget is tight:
  Route to Haiku/GPT-3.5 (cost: ~$0.001)
ELSE IF task requires complex reasoning:
  Route to Opus/Sonnet (cost: ~$0.01-0.03)
```

**Concrete additions:**

| Component | Purpose | Priority |
|---|---|---|
| `agent-sentry.config.json` → budget section | Per-agent, per-session, monthly budgets | P0 |
| `agent-sentry/scripts/cost-tracker.sh` | PostToolUse hook logging token usage and cost | P0 |
| Dashboard: Cost page | Real-time spend per agent, per session, per provider, with trends | P1 |
| Budget enforcement in PreToolUse | Block or downgrade when budget exceeded | P1 |
| MoE cost feedback loop | Feed cost data into RuFlo's routing decisions | P2 |

---

## 4. Agent Lifecycle Management

### What's Missing

The current spec has no formal model for what state an agent is in. Agents are either "running" or "not running." This is insufficient when you have queen agents coordinating workers, agents that pause waiting for human approval, and long-running swarms that may need graceful shutdown.

### What Needs to Be Built

**Formal state machine aligned with the Agent Communication Protocol:**

```
                    ┌──────────┐
                    │ CREATED  │
                    └────┬─────┘
                         │ start
                         ▼
                    ┌──────────┐
              ┌────▶│  ACTIVE  │◀────┐
              │     └────┬─────┘     │
              │          │           │
          resume    pause│     resume│
              │          ▼           │
              │     ┌──────────┐    │
              └─────│ AWAITING │────┘
                    └────┬─────┘
                         │ timeout / resume
                         ▼
              ┌──────────┐   ┌──────────┐
              │COMPLETED │   │  FAILED  │
              └──────────┘   └──────────┘
                                  ▲
                    ┌──────────┐  │
                    │CANCELLED │──┘ (if cleanup fails)
                    └──────────┘
```

**States:**

| State | Meaning | Transitions |
|---|---|---|
| CREATED | Agent instantiated, not yet started | → ACTIVE |
| ACTIVE | Agent is executing, consuming tokens | → AWAITING, COMPLETED, FAILED, CANCELLED |
| AWAITING | Paused, waiting for input (human approval, API callback, sub-agent result) | → ACTIVE, CANCELLED |
| COMPLETED | Task finished successfully, result returned | Terminal |
| FAILED | Unrecoverable error | Terminal |
| CANCELLED | Gracefully terminated by operator or budget enforcement | Terminal |

**Graceful shutdown protocol:**

```
ON cancel request:
  1. Set agent state to CANCELLING
  2. Agent finishes current tool call (don't interrupt mid-write)
  3. Agent saves current progress to WORKFLOW.md
  4. Agent commits any uncommitted work with "[agent-sentry] cancelled — checkpoint"
  5. Agent returns partial results to parent
  6. Set state to CANCELLED
  7. Clean up resources (kill child processes, release file locks)
```

**Concrete additions:**

| Component | Purpose | Priority |
|---|---|---|
| Agent state schema in agent definitions | Formal lifecycle states per agent | P0 |
| `agent-sentry/scripts/lifecycle-manager.sh` | State tracking, graceful shutdown, cleanup | P0 |
| Dashboard: Agent lifecycle view | Visual state for every active agent with transitions | P1 |
| Timeout enforcement | Auto-cancel agents that exceed max duration | P1 |
| Resource cleanup on termination | Kill child processes, release locks, commit checkpoint | P0 |

---

## 5. Multi-Provider Orchestration Layer

### What's Missing

RuFlo already supports Claude, GPT, Gemini, Cohere, and Ollama. But the current spec has no awareness of this. AgentSentry monitors "the agent" as if it's always one provider. When a swarm has agents using different providers, cost tracking, error handling, and observability all need to be provider-aware.

### What Needs to Be Built

**Provider abstraction in the tracing and cost layers:**

```json
{
  "agentId": "coder-ts-01",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "fallback_used": false,
  "...": "..."
}
```

vs.

```json
{
  "agentId": "coder-ts-02",
  "provider": "openai",
  "model": "gpt-4o",
  "fallback_used": true,
  "original_provider": "anthropic",
  "failover_reason": "rate_limited",
  "...": "..."
}
```

**Provider health monitoring:**

```
Track per-provider:
  - Availability (% of calls that succeed)
  - Latency (p50, p95, p99)
  - Error rate by type (rate limit, timeout, server error)
  - Cost per 1K tokens (input/output)
  - Current rate limit headroom

Dashboard: Provider Health page showing all providers side by side
Alert: When a provider's error rate exceeds 5% or latency exceeds 10s
```

**Failover audit trail:**

Every provider switch is logged so you can answer: "Why did agent X use GPT-4o instead of Claude? Was it a failover or a routing decision?"

**Concrete additions:**

| Component | Purpose | Priority |
|---|---|---|
| Provider field in all trace/cost records | Attribution by provider | P0 |
| `agent-sentry/scripts/provider-health.sh` | Track availability, latency, error rates per provider | P1 |
| Dashboard: Provider Health page | Visual comparison across Claude, GPT, Gemini, etc. | P1 |
| Failover logging in session-log.json | Record every provider switch with reason | P0 |

---

## 6. Agent Testing & Evaluation Framework

### What's Missing

The current spec monitors agents in production but has no mechanism for testing them before deployment. When you change a skill definition, modify a rules file, or update an agent prompt, there's no way to verify the change didn't break agent behavior.

### What Needs to Be Built

**Three-tier evaluation system:**

**Tier 1 — Golden Dataset (Per-Skill)**

Each AgentSentry skill and each RuFlo agent skill gets a set of test cases:

```yaml
# agent-sentry/evals/secret-scanner/cases.yaml
- name: "Detects hardcoded Anthropic key"
  input_file: "fixtures/hardcoded-anthropic-key.ts"
  expected: { blocked: true, pattern: "ANTHROPIC_API_KEY" }

- name: "Allows environment variable reference"
  input_file: "fixtures/env-var-reference.ts"
  expected: { blocked: false }

- name: "Detects JWT in MCP config"
  input_file: "fixtures/mcp-config-with-jwt.json"
  expected: { blocked: true, pattern: "JWT" }
```

**Tier 2 — Regression Suite**

When a bug is found in production, add a test case that reproduces it. Run the full regression suite on every rules file or agent definition change:

```bash
# agent-sentry/scripts/run-evals.sh
# Runs all golden datasets, reports pass/fail, blocks merge if regressions
```

**Tier 3 — Behavioral Benchmarks**

Periodic full-system benchmarks that measure:

- Does the task sizer correctly score known high-risk tasks?
- Does the context degradation detector fire at the right message count?
- Does the rules violation detector catch known violation patterns?
- Does the scaffold subagent produce valid, useful documents?

**Concrete additions:**

| Component | Purpose | Priority |
|---|---|---|
| `agent-sentry/evals/` directory | Test fixtures and expected results per module | P1 |
| `agent-sentry/scripts/run-evals.sh` | Evaluate all modules against golden datasets | P1 |
| CI integration (GitHub Actions) | Run evals on every PR that touches agent-sentry/ | P2 |
| Dashboard: Eval Results page | Pass/fail rates, regression trends | P2 |

---

## 7. Compliance & Audit Trail

### What's Missing

The current spec logs events for operational visibility. It does not produce a compliance-grade audit trail. With the EU AI Act becoming fully enforceable on August 2, 2026, any system deploying autonomous agents in the EU market needs immutable, complete audit records.

### What Needs to Be Built

**Append-only, immutable audit log:**

Every agent action is recorded with:

```json
{
  "eventId": "evt-789",
  "traceId": "abc123",
  "ts": "2026-03-19T14:15:00.000Z",
  "actor": {
    "type": "agent",
    "id": "coder-ts-01",
    "model": "claude-sonnet-4-6",
    "provider": "anthropic"
  },
  "delegatedBy": {
    "type": "agent",
    "id": "queen-tactical-01"
  },
  "originalUser": "ethan@example.com",
  "action": "tool:Write",
  "target": "ruflo/src/routing/moe-router.ts",
  "input_summary": "Modified expert selection algorithm",
  "output_summary": "File written, 47 lines changed",
  "permissionCheck": "ALLOWED",
  "status": "success",
  "tokens": { "input": 412, "output": 1435 },
  "cost_usd": 0.0034,
  "riskScore": 4,
  "metadata": {
    "commitBefore": "a3f2c1d",
    "branch": "feature/agent-routing"
  }
}
```

**Key compliance properties:**

- **Append-only:** Records can never be modified or deleted
- **Complete:** Every action, not samples
- **Attributable:** Full chain from user → queen → worker → tool
- **Timestamped:** Millisecond precision
- **Integrity-checked:** SHA-256 hash chain linking records (any tampering breaks the chain)

**Hash chain for tamper detection:**

```
Record N:   hash = SHA256(record_content + hash_of_record_N-1)
Record N+1: hash = SHA256(record_content + hash_of_record_N)
```

If any record is modified, all subsequent hashes break, making tampering detectable.

**Concrete additions:**

| Component | Purpose | Priority |
|---|---|---|
| `agent-sentry/audit/audit-logger.ts` | Append-only, hash-chained audit logging | P0 (for EU market) |
| `agent-sentry/audit/integrity-verifier.sh` | Verify hash chain hasn't been tampered with | P1 |
| Dashboard: Audit Trail page | Searchable, filterable audit log viewer | P1 |
| Compliance report generator | Produce EU AI Act Article 12-compliant documentation | P2 |
| Data retention policy enforcement | Auto-archive records older than retention period | P2 |

---

## 8. Agent-to-Agent Trust & Delegation

### What's Missing

RuFlo's queen agents delegate to worker agents, but there's no formal trust boundary. A worker agent that gets compromised (via prompt injection from a malicious file, for example) could escalate its own permissions, modify other agents' definitions, or exfiltrate data through its tool access.

### What Needs to Be Built

**Delegation token system:**

When a queen delegates to a worker, it issues a scoped token:

```
DelegationToken {
  issuer: "queen-tactical-01"
  delegate: "coder-ts-01"
  original_user: "ethan@example.com"
  task: "Fix MoE expert selection"
  scope: {
    files: ["ruflo/src/routing/**"],
    tools: ["Read", "Write", "Edit", "Bash:npm test"],
    max_tokens: 50000,
    max_duration: "30m",
    can_delegate: false   // Cannot further delegate
  }
  issued_at: "2026-03-19T14:00:00Z"
  expires_at: "2026-03-19T14:30:00Z"
  signature: "<cryptographic signature>"
}
```

**Enforcement rules:**

- Delegation tokens can only **narrow** permissions, never widen
- Workers cannot delegate further unless explicitly allowed (`can_delegate: true`)
- Tokens expire — no indefinite delegation
- Every permission check logs the full delegation chain
- Token revocation is immediate (queen can cancel a worker mid-task)

**Output validation on return:**

When a worker returns results to the queen:

```
ON worker_result received:
  Validate result structure (prevent injection)
  Check files modified are within delegation scope
  Verify no permission violations occurred during execution
  Log the complete delegation chain in audit trail

  IF out_of_scope_modifications:
    REJECT result
    REVERT worker's changes (git checkout)
    ALERT operator
```

**Concrete additions:**

| Component | Purpose | Priority |
|---|---|---|
| Delegation token schema | Formal scoped delegation format | P1 |
| Token validator in PreToolUse | Enforce delegation scope on every tool call | P1 |
| Output validator for delegation returns | Verify worker stayed in scope | P1 |
| Dashboard: Delegation chain visualization | Show who delegated to whom, with what scope | P2 |

---

## 9. Self-Improvement with Guardrails

### What's Missing

The current spec's rules file is manually updated by the operator. But RuFlo's agents have SONA (Self-Optimizing Neural Architecture) and EWC++ for learning. As agents get smarter, they'll identify their own failure patterns and want to update their own rules. The current spec has no mechanism for this.

### What Needs to Be Built

**Propose-review-apply pattern:**

```
Agent detects repeated failure pattern:
  "I keep importing from the wrong module path"

Agent proposes a rules file update:
  PROPOSED RULE: "When importing routing utilities, always use
  '@ruflo/routing' not 'ruflo/src/routing' — the alias is configured
  in tsconfig.json paths."

Proposal goes to PENDING queue (not applied):
  Stored in agent-sentry/proposals/pending/001-import-path.md

Operator reviews in dashboard:
  - See the proposed rule
  - See the evidence (which sessions triggered it, how many times)
  - See the impact estimate (how much context does this rule consume?)
  - Approve, modify, or reject

On approval:
  Rule is appended to CLAUDE.md
  Append-only log records: who proposed, who approved, when
  Original proposal archived to agent-sentry/proposals/approved/

CRITICAL CONSTRAINT: Rules can only be ADDED, never REMOVED by agents.
Only operators can remove rules. This prevents an agent from
weakening its own guardrails.
```

**Concrete additions:**

| Component | Purpose | Priority |
|---|---|---|
| `agent-sentry/proposals/` directory | Pending and approved rule proposals | P2 |
| Proposal format and submission mechanism | Agents propose, operators approve | P2 |
| Dashboard: Proposals page | Review queue with evidence and impact analysis | P2 |
| Append-only enforcement | Agents can only add rules, never remove | P1 |

---

## 10. Plugin & Extension Architecture

### What's Missing

The current spec is a monolithic set of scripts and hooks. Adding a new check (say, a Kubernetes deployment validator or a GraphQL schema linter) requires modifying core scripts. There's no way for the community or individual teams to extend AgentSentry with custom checks without forking.

### What Needs to Be Built

**Plugin system for custom checks:**

```
agent-sentry/
├── plugins/
│   ├── registry.json              # Installed plugins
│   ├── core/                      # Built-in plugins (the current scripts)
│   │   ├── secret-scanner/
│   │   │   ├── plugin.json        # Metadata: hooks, triggers, config schema
│   │   │   └── check.sh
│   │   ├── blast-radius/
│   │   ├── context-health/
│   │   └── ...
│   └── community/                 # User-installed plugins
│       ├── k8s-deploy-check/
│       │   ├── plugin.json
│       │   └── check.sh
│       └── graphql-schema-lint/
│           ├── plugin.json
│           └── check.sh
```

**Plugin manifest:**

```json
{
  "name": "k8s-deploy-check",
  "version": "1.0.0",
  "description": "Validates Kubernetes manifests before deployment",
  "hooks": {
    "PreToolUse": {
      "matcher": "Bash",
      "filter": "kubectl apply"
    }
  },
  "config_schema": {
    "namespace_allowlist": { "type": "array", "items": { "type": "string" } },
    "require_resource_limits": { "type": "boolean", "default": true }
  },
  "dashboard_panel": {
    "title": "K8s Deployments",
    "type": "audit-table"
  }
}
```

**Why this matters:** RuFlo already has a plugin SDK and IPFS-based marketplace. AgentSentry should follow the same pattern so that the agent management community can contribute checks, dashboards, and integrations.

---

## 11. Architectural Decision: Event-Driven Core

### The Structural Change That Enables Everything Above

Right now AgentSentry is a collection of shell scripts triggered by hooks. Each script runs independently, logs to its own file, and has no awareness of other scripts' state. This works for the 5 core skills but collapses under the weight of the extensions above.

**The proposal: an event bus at the center.**

```
                     ┌───────────────────────┐
                     │    AgentSentry Event Bus   │
                     │  (in-process pub/sub)   │
                     └─────────┬───────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
     ┌─────▼─────┐     ┌──────▼──────┐    ┌──────▼──────┐
     │  Hooks     │     │  Plugins    │    │  Dashboard  │
     │ (emit      │     │ (subscribe  │    │ (subscribe  │
     │  events)   │     │  & react)   │    │  & render)  │
     └───────────┘     └─────────────┘    └─────────────┘
           │                   │                   │
     ┌─────▼─────┐     ┌──────▼──────┐    ┌──────▼──────┐
     │ Tracing    │     │ Cost Meter  │    │ Audit Log   │
     │ (consume   │     │ (consume    │    │ (consume    │
     │  spans)    │     │  token evts)│    │  all events)│
     └───────────┘     └─────────────┘    └─────────────┘
```

Every hook emits a typed event. Plugins subscribe to events they care about. The audit log subscribes to everything. The dashboard subscribes to everything for display. The cost meter subscribes to LLM call events. The tracing system subscribes to tool use events.

**Implementation:** A lightweight TypeScript event emitter running as a local process (or just an in-memory pub/sub if running within Claude Code's Node.js runtime). Events are also persisted to NDJSON for the dashboard.

This is the single architectural change that makes observability, cost tracking, compliance, plugins, and real-time dashboards all feasible without turning AgentSentry into spaghetti.

---

## 12. Framework Evolution Roadmap

### Phase Map: From Current Spec to Full Framework

```
CURRENT (v2.0)              NEAR-TERM (v3.0)           FUTURE (v4.0)
─────────────────           ─────────────────           ─────────────────
5 Core Skills               + Event Bus Core            + Plugin Marketplace
Shell Scripts               + Tracing (OTEL)            + Self-Improvement
NDJSON Logs                 + Cost Metering             + Delegation Tokens
HTML Dashboard              + Agent Identity             + Compliance Reports
RuFlo Integration           + Lifecycle States           + Community Plugins
                            + Provider Health            + Behavioral Evals
                            + Audit Trail (hash-chain)   + Multi-Org Federation
                            + Testing Framework
```

### v3.0 Priority Stack (Next 8 Weeks)

| Priority | Component | Why Now |
|---|---|---|
| 1 | Event bus core | Everything else depends on it |
| 2 | Agent identity + permissions | Security foundation |
| 3 | Distributed tracing | Debug multi-agent issues |
| 4 | Cost metering + budgets | Prevent runaway spend |
| 5 | Lifecycle state machine | Graceful shutdown, pause/resume |
| 6 | Append-only audit trail | EU AI Act deadline Aug 2 2026 |
| 7 | Provider health monitoring | Multi-provider awareness |
| 8 | Eval framework (golden datasets) | Catch regressions |

### v4.0 (Post-Stabilization)

| Component | Why Later |
|---|---|
| Plugin architecture | Needs stable event bus and dashboard first |
| Self-improvement proposals | Needs stable rules system and audit trail first |
| Delegation tokens | Needs identity system first |
| Compliance report generator | Needs audit trail first |
| Multi-org federation | Needs everything above first |

---

## 13. Key Architectural Principles for Longevity

These principles should guide every design decision as AgentSentry evolves:

**1. Append-only by default.** Logs, audit trails, rules changes, and proposals are append-only. Nothing is ever deleted by agents. This provides compliance, debuggability, and protection against agents weakening their own guardrails.

**2. Event-driven, not script-driven.** The event bus is the spine. Every component is a publisher or subscriber. New capabilities are added by subscribing to existing events, not by modifying existing scripts.

**3. Provider-agnostic.** Every data structure includes a provider field. Every cost calculation is provider-aware. Every trace span knows which model it used. This ensures AgentSentry works as the LLM landscape fragments.

**4. Scope narrows, never widens.** Delegation tokens, permission overrides, and budget allocations can only narrow scope from what the parent granted. No agent can grant itself more access than it was given.

**5. Human-in-the-loop at trust boundaries.** Agents can propose, but operators approve. This applies to rules changes, permission escalations, budget increases, and production deployments. The automation runs within boundaries; the human sets the boundaries.

**6. Test what you ship.** Every check, every hook, every detection pattern has a golden dataset. If you can't write a test case for it, you can't trust it in production.

**7. Dashboard is the contract.** If it's not visible in the dashboard, it doesn't exist for the operator. Every new capability must have a corresponding dashboard view, or the operator can't manage what they can't see.
