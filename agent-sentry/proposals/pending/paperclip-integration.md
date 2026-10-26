# Spec: AgentSentry × Paperclip Integration

- **Status:** Proposed — Phase 0 (interface confirmation) complete; R-2 resolved
- **Date:** 2026-10-26 (updated 2026-10-26 after Phase 0)
- **Owner:** _unassigned_
- **Target repo (external):** [`paperclipai/paperclip`](https://github.com/paperclipai/paperclip) (MIT, TypeScript)
- **This repo:** AgentSentry v0.6.0-beta.1

> Grounding legend: **[V]** = verified against source (AgentSentry repo; Paperclip `master` docs read via GitHub API). **[I]** = inferred, pending confirmation.

---

## 1. Thesis

Paperclip is a fleet **control plane** ("the company") for teams of AI agents; AgentSentry is a per-agent **safety + memory substrate**. They are complementary, not competing:

- Paperclip governs **whether a tool may run** — identity, budget, approval, org chart. **[V]**
- AgentSentry judges **whether this specific content/action is safe** and **what the agent remembers** — secret scanning, risk scoring, rules validation, cross-session recall. **[V]**

AgentSentry's strategic placement is **inside** a Paperclip org as the content-aware safety and memory layer — not as a rival control plane. This maximizes utility (fills a real gap) and visibility (Paperclip's connector store reaches a large audience).

## 2. Verified facts

**Paperclip** (`master` branch, read 2026-10-26): **[V]**
- 107,593 stars / 17,854 forks, MIT, TypeScript, actively maintained (`gh repo view`).
- Connects **any standards-compliant remote-HTTP MCP server with zero Paperclip code change** (`doc/connections/GENERIC-REMOTE-MCP.md`). Transport is `remote_http` (preferred) or `local_stdio` (gated).
- MCP governance model (`doc/MCP-ACCESS-GOVERNANCE.md`): **Connection** (endpoint) → **Catalog Entry** (one tool, risk-classified `read`/`write`/`destructive`, status `active`/`quarantined`/`disabled`) → **Profile** (allow/deny bundle, bound to `company`/`agent`/`project`/`routine`/`issue`) → **Policy** (`allow`/`block`/`require_approval`/`rate_limit`/`trust_rule`; deny beats allow) → **Gateway** (returns decision, writes a **Call Event** to the audit log, opens an **Action Request** for human approval).
- Newly discovered tools are **quarantined until reviewed**; reads enabled for review. Secrets stored write-only; only header *names* are ever shown.
- Install application+connection+profile and run a smoke check via a documented `curl`/Bearer API.
- Plugins are **external packages** scaffolded with `paperclipai plugin init` (`.agents/skills/paperclip-create-plugin`); workers are capability-gated.
- Plugin worker lifecycle hooks (`packages/plugins/sdk/README.md`) are `setup`, `onHealth`, `onConfigChanged`, `onShutdown`, `onValidateConfig`, `onWebhook`, `onIdleDrain`, `onAgentLifecycle`, `onResourceLifecycle`. **None intercept or gate a tool call synchronously.**
- **Plugins cannot implement a hard content gate — by design.** `PLUGIN_SPEC.md` §4.73: "Board governance, approval gates, budget hard-stops, and core task invariants remain owned by Paperclip core." §99 lists as an explicit non-goal: "Allow arbitrary plugins to mutate approval, auth, issue checkout, or budget enforcement logic." *(Resolves R-2.)*
- What plugins **can** do (capability-gated, verified in `sdk/README.md` / `PLUGIN_SPEC.md`): observe domain events (`events.on`: `approval.created`, `approval.decided`, `cost_event.created`, `issue.*`); contribute tools/actions (`ctx.tools.register`, `agent.tools.register`); create issues and set holds (`ctx.issues.relations.setBlockedBy`/`addBlockers`, `ctx.issues.requestWakeup` — which honor budget-stop/blocker/assignee checks); read and write authorization policies/grants (`authorization.policies.write`, `authorization.grants.write`).
- Public MCP + plugins direction with a **Store listing** and connector qualification/eval track (`doc/plans/2026-09-30-paperclip-public-mcp-and-plugins.md`, `doc/plans/2026-10-01-public-mcp-paid-eval-results.md`).

**AgentSentry** (this repo): **[V]**
- MCP server with **stdio + `StreamableHTTPServerTransport`** (`src/mcp/transport.ts`) and Bearer auth (`src/mcp/auth.ts`). CORS via `AGENT_SENTRY_CORS_ORIGIN`.
- **10 tools**: `agent_sentry_health`, `capture_event`, `check_rules`, `check_context`, `size_task`, `search_history`, `scan_security`, `check_git`, `recall_context`, `generate_handoff`.
- 7 primitives incl. `risk-scoring`, `secret-detection`, `rules-validation` (`src/primitives/`); enforcement engine (`src/enforcement/engine.ts`).
- Storage: SQLite default; Supabase provider **experimental**; multi-agent coordination **single-machine** (README; `src/coordination/`).

## 3. Constraints & open risks

- **R-1 — Single-tenant store [V].** AgentSentry's store/coordination are single-machine/single-namespace. A hosted Paperclip serving multiple companies requires AgentSentry to run as a shared service with `companyId`/`agentId` isolation. The remote (Supabase) provider is experimental. **This is the critical path for team use.**
- **R-2 — Hard gate vs. advisory [V, RESOLVED].** Confirmed via `packages/plugins/sdk/README.md` + `doc/plugins/PLUGIN_SPEC.md`: **no plugin pre-action/tool-call interception hook exists, and it is an explicit architectural non-goal** — approval/auth/budget enforcement is owned by Paperclip core and plugins may not mutate it. Consequence: a plugin cannot synchronously block a call on content. **Enforcement must be composed from three native mechanisms instead:** (1) **hard, static** — Paperclip gateway `require_approval`/`block`/`trust_rule` policy on write/destructive catalog entries (core-owned, set in Phase 1); (2) **advisory** — agents call AgentSentry `scan_security`/`size_task` before risky actions (relies on compliance); (3) **async hold** — an AgentSentry plugin observes events and, on a secret/CRITICAL signal, creates a **blocker issue** / requests a held wakeup (`ctx.issues.relations.setBlockedBy`, `ctx.issues.requestWakeup`) and may escalate the tool's policy to `require_approval` (`authorization.policies.write`). This is an issue-level hold, not a synchronous per-call veto.
- **R-3 — Distribution is a process [V].** Store/curated listing goes through Paperclip's connector qualification/eval, not just a PR.
- **R-4 — Tool classification [I].** Paperclip auto-classifies discovered tools; `capture_event`/`generate_handoff` must land as `write` (agent-scoped), the rest as `read`. Verify classification during Phase 1.

## 4. Non-goals

- Reimplementing Paperclip's approval UI, budgets, or org chart in AgentSentry.
- Replacing Paperclip's audit log — AgentSentry's hash chain complements it; it does not substitute.
- Positioning AgentSentry as a competing "manage your agents" control plane.

## 5. Architecture

```
Paperclip org
  ├─ Agent run ──calls──▶ Paperclip MCP Gateway (policy + audit + Action Request)
  │                           │
  │                           └─▶ Connection: AgentSentry (remote_http MCP)
  │                                   ├─ read tools:  scan_security, size_task, check_rules,
  │                                   │               check_context, check_git, health,
  │                                   │               recall_context, search_history
  │                                   └─ write tools: capture_event, generate_handoff (agent-scoped)
  └─ [Phase 3] AgentSentry plugin ──observes events──▶ scan+score → blocker issue / require_approval policy
                                   (async hold — NOT a synchronous per-call veto; core owns hard gates)
```

AgentSentry runs as a long-lived HTTP service. Tool verdicts are written back via `capture_event` so they appear in both AgentSentry's hash-chained audit and Paperclip's Call Event log.

## 6. Phased plan

### Phase 0 — Confirm interfaces ✅ DONE (2026-10-26)
- Read `doc/plugins/PLUGIN_AUTHORING_GUIDE.md`, `packages/plugins/sdk/README.md`, `doc/plugins/PLUGIN_SPEC.md`.
- **Finding (R-2 resolved, negative):** no plugin pre-action/tool-call interception hook exists, and it is an explicit non-goal — Paperclip core owns approval/auth/budget enforcement. Hard gating therefore stays native (gateway `require_approval`/`block`/`trust_rule`); plugins can only observe events and react (blocker issues, policy/grant writes). See §3 R-2.
- Remaining Phase 0 item (do at the start of Phase 1): install Paperclip's bundled `safe-read-only-todo-kv` example and run its smoke to learn the install/profile API shape.

### Phase 1 — R1: AgentSentry as a governed Connection
- Deploy AgentSentry HTTP service; set `AGENT_SENTRY_CORS_ORIGIN` to the Paperclip origin; issue a Bearer token stored as a Paperclip secret.
- Register via **Apps → Connect your own MCP server**; review Catalog, confirm classifications (**R-4**).
- Install application+connection+profile and run the smoke API.
- **Exit / acceptance:** read tools allowed; `capture_event`/`generate_handoff` agent-namespaced; every call recorded as a Paperclip Call Event; a denied write is blocked and audited.

### Phase 2 — Multi-tenant isolation (**R-1**)
- Add `companyId`/`agentId` dimensions to event capture, `recall_context`, and `search_history`.
- Decide shared-store strategy: harden Supabase provider **or** front SQLite with a single-writer service.
- **Exit / acceptance:** two orgs' `recall_context`/`search_history` never cross; load test at target concurrency.

### Phase 3 — Safety plugin (observe + react; hard gate stays native)
> Revised after Phase 0: a plugin cannot synchronously veto a call. Enforcement is composed, not plugin-owned.
- **Native hard gate (Phase 1 config, not plugin):** set gateway `require_approval`/`block` policy on write/destructive catalog entries so risky tools already route to an Action Request.
- **Plugin (`paperclipai plugin init`), capability-gated:**
  - Register AgentSentry tools via `agent.tools.register` so agents can/should call `scan_security` + `size_task` before risky work (advisory layer).
  - Subscribe (`events.on`) to `approval.created`/`approval.decided`/`cost_event.created`/`issue.*`; mirror verdicts to AgentSentry via `capture_event`.
  - On a secret-found or HIGH/CRITICAL signal, **react**: create a blocker issue / hold the task (`ctx.issues.relations.setBlockedBy`, `ctx.issues.requestWakeup`), and optionally escalate the offending tool to `require_approval` (`authorization.policies.write`).
- Thresholds mirror AgentSentry enablement levels 3→5.
- **Exit / acceptance:** a write catalog entry with `require_approval` routes to human approval (native); a task where AgentSentry flags a secret is held by a blocker issue with the verdict attached; a LOW-risk clean change proceeds. *Note the residual gap: a non-compliant agent that skips the advisory check and calls only read-classified tools is not hard-blocked — document this limitation.*

### Phase 4 — Distribution
- Author a curated AppDefinition (branding/scoped defaults) + Store listing; enter Paperclip's connector qualification/eval (**R-3**).
- **Exit:** AgentSentry discoverable/installable from the Paperclip store.

### Phase 5 — Depth
- Task↔event schema bridge: attach `task_id`/`project_id`/`goal_id` to events (per `docs/memory-schema.md`); enable `search_history` filtering by Paperclip `task_id`.
- Routine continuity: `generate_handoff` on heartbeat end, `recall_context` on start.
- Risk-weighted budget gating: fuse `size_task` with Paperclip budget hard-stops.

## 7. Dependencies

| Need | Source | Status |
| --- | --- | --- |
| Remote-HTTP MCP endpoint | AgentSentry `transport.ts` | ready **[V]** |
| Bearer auth | AgentSentry `auth.ts` | ready **[V]** |
| Plugin pre-action/gateway hook | Paperclip SDK | **confirmed absent — explicit non-goal [V]**; use native policy + observe/react |
| Native approval policy (hard gate) | Paperclip gateway | ready **[V]** (`require_approval`/`block`/`trust_rule`) |
| Plugin observe/react APIs | Paperclip SDK | ready **[V]** (`events.on`, `issues.relations`, `requestWakeup`, `authorization.policies.write`) |
| Shared multi-tenant store | AgentSentry Phase 2 | to build |
| Store qualification | Paperclip eval track | process **[V]** |

## 8. Decision checkpoints

1. ~~After Phase 0: does a hard-gate hook exist?~~ **Resolved: no.** Hard gating is native-policy-only; Phase 3 is observe+react, not a per-call veto. **Decided (2026-10-26):** launch with the advisory layer + async blocker-issue hold **and** apply native `require_approval`/`block` policy to the highest-risk (write/destructive) catalog entries; file a core change request to Paperclip for a content-gate hook in parallel. The residual gap (a non-compliant agent that skips the advisory check and uses only non-gated tools) is accepted for launch and documented.
2. After **Phase 1**: is single-tenant connection useful enough to ship for self-hosted users before Phase 2?
3. Before **Phase 4**: is store qualification worth the eval cost given adoption signal?

---

### References
- Paperclip: `doc/connections/GENERIC-REMOTE-MCP.md`, `doc/MCP-ACCESS-GOVERNANCE.md`, `.agents/skills/paperclip-create-plugin/SKILL.md`, `doc/plugins/PLUGIN_AUTHORING_GUIDE.md`, `packages/plugins/sdk/README.md`, `doc/plugins/PLUGIN_SPEC.md` (§4.73 governance ownership, §99 non-goals), `doc/plans/2026-09-30-paperclip-public-mcp-and-plugins.md`
- AgentSentry: `src/mcp/transport.ts`, `src/mcp/auth.ts`, `src/primitives/`, `src/enforcement/engine.ts`, `docs/memory-schema.md`, `docs/architecture/mcp-integration.md`
