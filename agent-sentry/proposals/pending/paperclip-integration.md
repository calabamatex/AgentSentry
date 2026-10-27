# Strategy & Recommendations — AgentSentry × Paperclip Integration

> This is a **strategy / decision document** (thesis, constraints, phasing, risks), not an implementation spec. The build-ready detail lives in one engineering spec per phase: [Phase 1](./paperclip-phase1-engineering-spec.md) · [Phase 2](./paperclip-phase2-engineering-spec.md) · [Phase 3](./paperclip-phase3-engineering-spec.md) · [Phase 4](./paperclip-phase4-engineering-spec.md) · [Phase 5](./paperclip-phase5-engineering-spec.md).

- **Status:** Proposed — Phase 0 complete; R-2 and R-4 resolved; G-1 verified; G-2/G-3 resolved in the Phase 1 spec. Phase 1–5 engineering specs written against Paperclip source at commit `50b932a` (2026-10-27).
- **Date:** 2026-10-26 (updated 2026-10-27: source-grounded corrections to §2/§3/§5/§6/§7 — see each phase spec's discrepancy log)
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
- Quarantine of newly discovered tools is **per-connection** (`quarantineNewEntries`) and is **off** for custom remote MCP servers **[V, corrected 2026-10-27]** — see Phase 1 spec §3.4. Secrets stored write-only; only header *names* are ever shown.
- Install application+connection+profile and run a smoke check via a documented `curl`/Bearer API.
- Plugins are **external packages** scaffolded with `paperclipai plugin init` (`.agents/skills/paperclip-create-plugin`); workers are capability-gated.
- Plugin worker lifecycle hooks (`packages/plugins/sdk/README.md`) are `setup`, `onHealth`, `onConfigChanged`, `onShutdown`, `onValidateConfig`, `onWebhook`, `onIdleDrain`, `onAgentLifecycle`, `onResourceLifecycle`. **None intercept or gate a tool call synchronously.**
- **Plugins cannot implement a hard content gate — by design.** `PLUGIN_SPEC.md` §4.73: "Board governance, approval gates, budget hard-stops, and core task invariants remain owned by Paperclip core." §99 lists as an explicit non-goal: "Allow arbitrary plugins to mutate approval, auth, issue checkout, or budget enforcement logic." *(Resolves R-2.)*
- What plugins **can** do (capability-gated, verified in SDK source 2026-10-27): observe domain events (`ctx.events.on`: `approval.*`, `issue.*`, `agent.run.*`, `budget.incident.*`; **`cost_event.created` is declared but never emitted**, and no `tool_call.*` event exists); contribute agent tools (`ctx.tools.register`, capability `agent.tools.register`, governed by the same tool-access policy engine); create issues and set holds (`ctx.issues.relations.setBlockedBy`/`addBlockers`, `ctx.issues.requestWakeup`). **`ctx.authorization.policies.*` is Paperclip's issue/permission authorization, not tool-access policy — a plugin cannot create or escalate tool policies.** Details and citations: Phase 3 spec.
- Public MCP + plugins direction with a **Store listing** and connector qualification/eval track (`doc/plans/2026-09-30-paperclip-public-mcp-and-plugins.md`, `doc/plans/2026-10-01-public-mcp-paid-eval-results.md`).

**AgentSentry** (this repo): **[V]**
- MCP server with **stdio + `StreamableHTTPServerTransport`** (`src/mcp/transport.ts`) and shared-key auth via the `x-agent-sentry-key` header (`src/mcp/auth.ts`; not `Authorization: Bearer`). CORS via `AGENT_SENTRY_CORS_ORIGIN`. One MCP session per process today (Phase 1 X-8).
- **10 tools**: `agent_sentry_health`, `capture_event`, `check_rules`, `check_context`, `size_task`, `search_history`, `scan_security`, `check_git`, `recall_context`, `generate_handoff`.
- 7 primitives incl. `risk-scoring`, `secret-detection`, `rules-validation` (`src/primitives/`); enforcement engine (`src/enforcement/engine.ts`).
- Storage: SQLite default; Supabase provider **experimental**; multi-agent coordination **single-machine** (README; `src/coordination/`).

## 3. Constraints & open risks

- **R-1 — Single-tenant store [V].** AgentSentry's store/coordination are single-machine/single-namespace. A hosted Paperclip serving multiple companies requires AgentSentry to run as a shared service with `companyId`/`agentId` isolation. The remote (Supabase) provider is experimental. **This is the critical path for team use.**
- **R-2 — Hard gate vs. advisory [V, RESOLVED].** Confirmed via `packages/plugins/sdk/README.md` + `doc/plugins/PLUGIN_SPEC.md`: **no plugin pre-action/tool-call interception hook exists, and it is an explicit architectural non-goal** — approval/auth/budget enforcement is owned by Paperclip core and plugins may not mutate it. Consequence: a plugin cannot synchronously block a call on content. **Enforcement must be composed from three native mechanisms instead:** (1) **hard, static** — Paperclip gateway `require_approval`/`block`/`trust_rule` policy on write/destructive catalog entries (core-owned, set in Phase 1); (2) **advisory** — agents call AgentSentry `scan_security`/`size_task` before risky actions (relies on compliance); (3) **async hold** — an AgentSentry plugin observes events and, on a secret/CRITICAL signal, creates a **blocker issue** / requests a held wakeup (`ctx.issues.relations.setBlockedBy`, `ctx.issues.requestWakeup`). It **cannot** escalate the tool's policy — there is no plugin API for tool-access policies (corrected 2026-10-27); escalation is an operator action via the board API. This is an issue-level hold, not a synchronous per-call veto.
- **R-3 — Distribution is a PR, not a marketplace [V, corrected 2026-10-27].** There is no public plugin registry or store submission flow. Store visibility is a hard-coded allowlist in Paperclip's repo (`CONNECTABLE_APP_SLUGS`); a curated listing means a PR to `paperclipai/paperclip` per `doc/connections/CONNECTOR-PLAYBOOK.md`, accepted at the maintainers' discretion. Plugins ship on npm (`paperclip-plugin-*`) with no signing and install only by instance admins. See Phase 4 spec.
- **R-4 — Tool classification [V, RESOLVED].** `classifyRisk` defaults to `read`; `readOnlyHint:false` or `destructiveHint:true` is required to classify `write`/`destructive`. AgentSentry emits no annotations today → WI-1 in the Phase 1 spec is blocking.

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
  └─ [Phase 3] AgentSentry plugin ──observes events──▶ fetch artifact → scan+score → blocker issue + comment
                                   (async hold — NOT a synchronous per-call veto; core owns hard gates)
```

AgentSentry runs as a long-lived HTTP service. Tool verdicts are written back via `capture_event` so they appear in both AgentSentry's hash-chained audit and Paperclip's Call Event log.

## 6. Phased plan

### Phase 0 — Confirm interfaces ✅ DONE (2026-10-26)
- Read `doc/plugins/PLUGIN_AUTHORING_GUIDE.md`, `packages/plugins/sdk/README.md`, `doc/plugins/PLUGIN_SPEC.md`.
- **Finding (R-2 resolved, negative):** no plugin pre-action/tool-call interception hook exists, and it is an explicit non-goal — Paperclip core owns approval/auth/budget enforcement. Hard gating therefore stays native (gateway `require_approval`/`block`/`trust_rule`); plugins can only observe events and react (blocker issues, policy/grant writes). See §3 R-2.
- Remaining Phase 0 item (do at the start of Phase 1): install Paperclip's bundled `safe-read-only-todo-kv` example and run its smoke to learn the install/profile API shape.

### Phase 1 — R1: AgentSentry as a governed Connection → [engineering spec](./paperclip-phase1-engineering-spec.md)
- Deploy AgentSentry HTTP service; set `AGENT_SENTRY_CORS_ORIGIN` to the Paperclip origin; issue a Bearer token stored as a Paperclip secret.
- Register via **Apps → Connect your own MCP server**; review Catalog, confirm classifications (**R-4**).
- Install application+connection+profile and run the smoke API.
- **Exit / acceptance:** read tools allowed; `capture_event`/`generate_handoff` agent-namespaced; every call recorded as a Paperclip Call Event; a denied write is blocked and audited.

### Phase 2 — Multi-tenant isolation (**R-1**) → [engineering spec](./paperclip-phase2-engineering-spec.md)
- Add `companyId`/`agentId` dimensions to event capture, `recall_context`, and `search_history`.
- Decide shared-store strategy: harden Supabase provider **or** front SQLite with a single-writer service.
- **Exit / acceptance:** two orgs' `recall_context`/`search_history` never cross; load test at target concurrency.

### Phase 3 — Safety plugin (observe + react; hard gate stays native) → [engineering spec](./paperclip-phase3-engineering-spec.md)
> Revised after Phase 0: a plugin cannot synchronously veto a call. Enforcement is composed, not plugin-owned.
- **Native hard gate (Phase 1 config, not plugin):** set gateway `require_approval`/`block` policy on write/destructive catalog entries so risky tools already route to an Action Request.
- **Plugin (`paperclipai plugin init`), capability-gated:**
  - Register AgentSentry tools via `agent.tools.register` so agents can/should call `scan_security` + `size_task` before risky work (advisory layer).
  - Subscribe (`events.on`) to `approval.created`/`approval.decided`/`cost_event.created`/`issue.*`; mirror verdicts to AgentSentry via `capture_event`.
  - **Two-step scan (see G-1):** plugin events carry only IDs + light metadata, not artifact content. To scan, the plugin must fetch the persisted artifact after the event (task document/comment via `ctx.issues`, or committed workspace files) and *then* run `scan_security`. This is strictly post-hoc and limited to Paperclip-persisted content.
  - On a secret-found or HIGH/CRITICAL signal, **react**: create a blocker issue / hold the task (`ctx.issues.relations.setBlockedBy`, `ctx.issues.requestWakeup`) and comment with redacted findings. (Escalating the tool to `require_approval` is **not** available to plugins — corrected 2026-10-27; it is an operator step.)
- Thresholds mirror AgentSentry enablement levels 3→5.
- **Exit / acceptance:** a write catalog entry with `require_approval` routes to human approval (native); a task where AgentSentry flags a secret is held by a blocker issue with the verdict attached; a LOW-risk clean change proceeds. *Note the residual gap: a non-compliant agent that skips the advisory check and calls only read-classified tools is not hard-blocked — document this limitation.*

### Phase 4 — Distribution → [engineering spec](./paperclip-phase4-engineering-spec.md)
- Three tracks: (A) npm plugin `paperclip-plugin-agentsentry`; (B) AppDefinition + connector-policy PR to `paperclipai/paperclip` per CONNECTOR-PLAYBOOK (**R-3** — maintainer acceptance is outside our control); (C) distribution-catalog bundle for self-hosted installs.
- **Exit:** Track A published and installable; Track B PR opened with full qualification evidence; store listing only if merged.

### Phase 5 — Depth → [engineering spec](./paperclip-phase5-engineering-spec.md)
- Task↔event schema bridge: attach `task_id`/`project_id`/`goal_id` to events (per `docs/memory-schema.md`); enable `search_history` filtering by Paperclip `task_id`.
- Routine continuity: `generate_handoff` on heartbeat end, `recall_context` on start.
- Risk-weighted budget gating: fuse `size_task` with Paperclip budget state read via `ctx.issues.summaries.getOrchestration`. Tool-access policies have **no budget condition** and budgets have no issue scope (verified 2026-10-27), so per-call budget gating needs an upstream Paperclip change; Phase 5 ships the advisory/hold version.

## 7. Dependencies

| Need | Source | Status |
| --- | --- | --- |
| Remote-HTTP MCP endpoint | AgentSentry `transport.ts` | ready **[V]** |
| Bearer auth | AgentSentry `auth.ts` | ready **[V]** |
| Plugin pre-action/gateway hook | Paperclip SDK | **confirmed absent — explicit non-goal [V]**; use native policy + observe/react |
| Native approval policy (hard gate) | Paperclip gateway | ready **[V]** (`require_approval`/`block`/`trust_rule`) |
| Plugin observe/react APIs | Paperclip SDK | ready **[V]** (`ctx.events.on`, `ctx.issues.relations`, `ctx.issues.requestWakeup`, `ctx.tools.register`); **no** tool-policy write API |
| Caller identity to AgentSentry | Paperclip gateway | opt-in unsigned `x-paperclip-*` headers via `connection.config.headerPolicy.metadata.forward` **[V]**; no signed identity |
| Shared multi-tenant store | AgentSentry Phase 2 | to build (per-instance isolation stays the default) |
| Store / curated listing | PR to `paperclipai/paperclip` | process **[V]**; no registry, no marketplace |

## 8. Decision checkpoints

1. ~~After Phase 0: does a hard-gate hook exist?~~ **Resolved: no.** Hard gating is native-policy-only; Phase 3 is observe+react, not a per-call veto. **Decided (2026-10-26):** launch with the advisory layer + async blocker-issue hold **and** apply native `require_approval`/`block` policy to the highest-risk (write/destructive) catalog entries; file a core change request to Paperclip for a content-gate hook in parallel. The residual gap (a non-compliant agent that skips the advisory check and uses only non-gated tools) is accepted for launch and documented.
2. After **Phase 1**: is single-tenant connection useful enough to ship for self-hosted users before Phase 2?
3. Before **Phase 4**: is store qualification worth the eval cost given adoption signal?

## 9. Open questions & gaps (third-party review, 2026-10-26)

Severity: **H** = resolve before Phase 1 · **M** = resolve during the relevant phase · **L** = process/hygiene.

- **G-1 (H) — Event payloads carry no content. [V, verified]** Confirmed in `server/src/services/plugin-event-bus.ts`: a `PluginEvent` is `{ id, companyId, entityId, entityType, payload }` and `payload` is light metadata (the file's own `issue.created` example is `{ title, projectId }`). **Impact:** Phase 3's reactive scan cannot read content from the event; it must do event → fetch persisted artifact (`ctx.issues` docs/comments, or workspace files) → `scan_security`, strictly post-hoc, only on Paperclip-persisted content. Pre-execution content scanning remains impossible (reinforces R-2). *Phase 3 updated accordingly.*
- **G-2 (H) — Cross-tenant auth, not just a data column. [open]** R-1 adds `companyId`/`agentId` as data fields, but a single shared Bearer token lets any caller assert any `companyId` and read another tenant's `recall_context`/`search_history`. Needs an identity model: per-company tokens, or Paperclip passing a signed caller identity AgentSentry validates. **Decide before Phase 2; affects Phase 1 token design.**
- **G-3 (H) — Fail-open vs. fail-closed. [open]** Undefined behavior when the AgentSentry service is down/slow: do read tools fail open (agent proceeds unscanned) or closed (agent blocked)? Core safety-product decision; must be explicit.
- **G-4 (M) — Endpoint threat model.** TLS not mandated (default `AGENT_SENTRY_CORS_ORIGIN` is `http://localhost`); no token rotation, network isolation (Paperclip-egress only), or rate-limiting/DoS posture for a security service exposed over HTTP.
- **G-5 (M) — Synchronous latency / scale.** Gateway tool calls are inline in the agent loop; no timeouts/size caps on `scan_security`/`size_task`. AgentSentry's O(n) linear vector search (~10k-event ceiling) is unaddressed for fleet-scale `recall_context`.
- **G-6 (M) — Residual-gap honesty.** The advisory layer relies on agent compliance — it is *not* enforcement against a buggy/adversarial agent. Needs an explicit "protects against / does NOT protect against" statement and an estimate of risk coverage from native-policy + async-hold.
- **G-7 (M) — Memory duplication.** R3/R5 (recall, handoff) may duplicate or conflict with Paperclip's own task/heartbeat/context model. Non-goal #2 covers audit duplication but not memory. Needs an overlap analysis.
- **G-8 (M) — Tool-contract churn.** Paperclip quarantines tools on catalog refresh; AgentSentry is fast-moving v0.6-beta (a 10-vs-11-tool drift already surfaced in review). Needs a version/compatibility contract to avoid constant re-review/re-binding.
- **G-9 (L) — Phase 0 not fully done.** The bundled-smoke step is deferred into Phase 1; status should read "mostly done."
- **G-10 (L) — Dangling external dependency.** The "core change request to Paperclip" (checkpoint 1) has no owner/tracking and may never land; don't plan around it.
- **G-11 (L) — No top-level success metrics / owner / effort / rollback.** Add initiative-level metrics (secrets caught, false-positive rate, adoption), an owner, rough effort, and a rollback story.
- **G-12 (L) — Moving target.** Paperclip's public-MCP/store path is itself "first-release in review"; this spec treats `master` as stable. Re-verify key interfaces at each phase start.

---

### References
- Paperclip: `doc/connections/GENERIC-REMOTE-MCP.md`, `doc/MCP-ACCESS-GOVERNANCE.md`, `.agents/skills/paperclip-create-plugin/SKILL.md`, `doc/plugins/PLUGIN_AUTHORING_GUIDE.md`, `packages/plugins/sdk/README.md`, `doc/plugins/PLUGIN_SPEC.md` (§4.73 governance ownership, §99 non-goals), `doc/plans/2026-09-30-paperclip-public-mcp-and-plugins.md`
- AgentSentry: `src/mcp/transport.ts`, `src/mcp/auth.ts`, `src/primitives/`, `src/enforcement/engine.ts`, `docs/memory-schema.md`, `docs/architecture/mcp-integration.md`
