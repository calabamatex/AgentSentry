# Engineering Spec — Phase 5: Depth (Task↔Event Bridge, Routine Continuity, Risk-Weighted Budget Gating, Per-Workspace Rules)

| | |
| --- | --- |
| **Status** | Draft v1 — implementation-ready for Phase 5, conditional on Phases 1–3 exit criteria |
| **Date** | 2026-10-27 |
| **Parent** | [paperclip-integration.md](./paperclip-integration.md) §6 Phase 5 (strategy & phasing) |
| **Depends on** | [paperclip-phase1-engineering-spec.md](./paperclip-phase1-engineering-spec.md) v3 (governed Connection, identity headers, WI-3 tool fixes); [paperclip-phase2-engineering-spec.md](./paperclip-phase2-engineering-spec.md) (first-class `company_id/project_id/issue_id/run_id` columns and query filters); [paperclip-phase3-engineering-spec.md](./paperclip-phase3-engineering-spec.md) (the AgentSentry Paperclip plugin: worker, event subscriptions, blocker-issue reaction) |
| **Owner** | _unassigned_ |
| **AgentSentry** | v0.6.0-beta.1 (`agent-sentry/`) |
| **Paperclip** | `paperclipai/paperclip@50b932a`, read 2026-10-27 |

**Scope.** Make AgentSentry's memory *task-aware* inside Paperclip: (1) every event carries Paperclip identifiers and can be retrieved by them; (2) routine-driven issues get prior context on each run and a handoff at the end of each run; (3) a risk-weighted budget verdict that fuses Paperclip's cost/incident state with AgentSentry's task-risk scoring, with reactions limited to what Paperclip actually permits; (4) `check_rules` evaluates the calling issue's *workspace* rules, closing Phase 1 D-5.
**Out of scope.** Pre-execution gating of tool calls or runs (impossible by Paperclip design — parent §3 R-2; confirmed again in §0 below). Issue-scoped budgets and budget-conditioned tool policies (not in Paperclip; filed upstream, §17). Store listing (Phase 4).

**Grounding legend.** **[V]** verified in source — AgentSentry `src/` (per the 2026-10-27 survey) or Paperclip `packages/plugins/sdk/src/types.ts`, `packages/shared/src/constants.ts`, `packages/shared/src/validators/issue.ts`, `server/src/services/heartbeat/*`, `server/src/services/issue-continuation-summary.ts`, `server/src/services/budgets.ts`, `server/src/services/activity-log.ts`. **[V-doc]** stated in Paperclip docs but not confirmed in route/service code. **[I]** inference; must be validated by the test named next to it.

---

## 0. Grounding log (what Phase 5 can and cannot build on)

| # | Strategy doc / earlier assumption | Source says | Consequence |
| --- | --- | --- | --- |
| G5-1 | "Attach `task_id`/`project_id`/`goal_id` to events per `docs/memory-schema.md`" | `docs/memory-schema.md` documents only the current fields; **no planned fields exist** **[V]**. `OpsEvent` has `session_id`, `agent_id` only (`src/memory/schema.ts:15-33`) **[V]**. | The column contract is defined in Phase 2 and consumed here (§4). Paperclip's identifier is `issueId`, not `task_id`; this spec uses Paperclip's names. |
| G5-2 | Plugins can subscribe to cost events | `cost_event.created` is in `PLUGIN_EVENT_TYPES` but **never emitted**: the only cost activity is `cost.reported` (`server/src/services/costs.ts:159-165`), which maps to no plugin event (`activity-log.ts:19-47`) **[V]**. | Budget gating polls `ctx.issues.summaries.getOrchestration` (§6) and reacts to `budget.incident.opened/resolved`; it cannot react per cost event. Upstream request U-2. |
| G5-3 | "Fuse `size_task` with Paperclip budget hard-stops" at the tool-call boundary | `ToolPolicyConditions` is a closed `.strict()` set `arguments\|args\|actor\|context\|risk\|credentialScope\|trustBoundary\|timeWindow` (`validators/tool-access.ts:839-862`); **no budget condition**; the gateway never calls `budgets.getInvocationBlock` **[V]**. Budget scopes are `company\|agent\|project` only (`constants.ts:875`) — **no issue scope** **[V]**. | Gating is *reactive and coarse* (§6): advisory comment → blocker issue → `ctx.agents.pause`. Upstream request U-1. |
| G5-4 | `generate_handoff` records a handoff event | MCP tool is git-only, touches no store (`src/mcp/tools/generate-handoff.ts`), `git log` call broken (`:67`) **[V]**; `HandoffGenerator` (`src/memory/handoff.ts`) is exported but unused **[V]**. | Phase 1 WI-3 fixes the tool; Phase 5 builds on the fixed contract (§9.4). |
| G5-5 | Inject prior context by writing the `continuation-summary` document | `continuation-summary` is a **system key** (`SYSTEM_ISSUE_DOCUMENT_KEYS`, `constants.ts:440`), read into the run prompt (`heartbeat/task-context.ts:58-59`, cap `ISSUE_CONTINUATION_SUMMARY_MAX_BODY_CHARS = 8_000`, `issue-continuation-summary.ts:10`) and **rewritten by the host** (`refreshIssueContinuationSummary`, called from `heartbeat/run-lifecycle.ts`) **[V]**. No write guard against plugins was found **[V]**, but any plugin write is clobbered on the next host refresh. | Do **not** write the system key. Use plugin-owned keys `agentsentry-context` / `agentsentry-handoff` (§5). Whether non-system documents are surfaced in the agent prompt is **[I]** → A5-3. |
| G5-6 | Routine runs are distinguishable | Routine dispatch creates the issue with `originKind:"routine_execution"`, `originId: routine.id`, `originRunId: run.id` (`server/src/services/routines.ts:1884-1899`) **[V]**; `ISSUE_ORIGIN_KINDS` includes it (`constants.ts:357-359`) **[V]**. `agent.run.*` payload carries `issueId` but not `originKind` (`run-lifecycle.ts:1347-1381`) **[V]**. | Plugin resolves `originKind` with `ctx.issues.get(issueId, companyId)` (§5.2). |
| G5-7 | Run start can be delayed until context is injected | No run-admission hook for plugins; events are post-commit, fire-and-forget (`activity-log.ts:49-56`) **[V]**. | Context written on `agent.run.started` is visible to the **next** run, not the current one. The current run gets context only by calling `recall_context` itself (advisory layer, Phase 1 §8.2 `agentInstructions`). §5.1 designs for this. |
| G5-8 | Workspace rules readable by the plugin | `ctx.projects.getWorkspaceForIssue(issueId, companyId): PluginWorkspace \| null` with `path`, `repoUrl`, `repoRef`, `defaultRef` (`sdk/types.ts:374-394`) and `ctx.executionWorkspaces.get(workspaceId, companyId)` with `cwd`, `repoUrl`, `baseRef`, `branchName` (`:406-424`) **[V]**. `ctx.projects.resolveGitCredential(projectId, workspaceId, companyId)` **[V]**. | §7 fetches rules from the repo over HTTPS; local `path` is usable only when the plugin worker shares the host filesystem **[I]** → I5-4. |

---

## 1. Goals, non-goals, exit criteria

### 1.1 Goals
1. Every event captured through the gateway or written by the plugin carries `company_id`, `agent_id`, `run_id`, and when known `issue_id`, `project_id`, `goal_id`; `search_history` and `recall_context` filter on them exactly.
2. A routine-originated issue receives, before each run after its first, an `agentsentry-context` document with recalled context, and after each run an `agentsentry-handoff` document and a `handoff` event — exactly once per run.
3. A budget verdict (`ok | warn | hold`) is computed per run from Paperclip cost/incident state and AgentSentry task risk, recorded as an event, and acted on only within operator-enabled reactions.
4. `check_rules` evaluates the rules of the issue's workspace repository, reporting which rules source was used; `rules_checked:0` is never reported as compliance.
5. All of the above degrade to "no verdict / no context" on AgentSentry or plugin failure; no run is blocked by Phase 5 code paths unless the operator enabled `hold` reactions.

### 1.2 Non-goals (Phase 5)
- Per-tool-call budget denial, issue-scoped budgets, or any synchronous veto (§0 G5-3, G5-7).
- Replacing Paperclip's continuation summary (§0 G5-5).
- Vector/HNSW retrieval improvements (recall stays linear-scan with the Phase 1 §14 ceiling; Phase 2 may change the store).
- Cross-company recall (tenancy fixed by Phase 2).

### 1.3 Exit criteria → tests
Goals 1–5 map to A5-1…A5-5 (§14.4). Phase 5 is complete when A5-1…A5-5 pass against a live Paperclip dev instance with the Phase 3 plugin installed, and WI5-1…WI5-7 are merged.

---

## 2. System context

```
Paperclip (company C)                                   AgentSentry instance C
┌────────────────────────────────────────────────┐      ┌──────────────────────────────┐
│ Agent run ──MCP gateway──▶ tools/call ─────────┼─────▶│ capture/search/recall/handoff │
│      (x-paperclip-{agent,run,issue,project}-id)│      │ check_rules(rules_content)    │
│                                                │      │ SQLite C (Phase 2 columns)    │
│ Activity log ──▶ plugin event bus              │      └───────────▲──────────────────┘
│      agent.run.started/finished/failed         │                  │ x-agent-sentry-key
│      issue.* , approval.*, budget.incident.*   │                  │ (plugin → instance, HTTPS)
│                 │                              │                  │
│   AgentSentry plugin worker (Phase 3)          │                  │
│   • ctx.issues.{get,documents,createComment}   ├──────────────────┘
│   • ctx.issues.summaries.getOrchestration      │
│   • ctx.state (scope run / issue)              │
│   • ctx.agents.pause (opt-in)                  │
│   • ctx.projects.getWorkspaceForIssue          │
└────────────────────────────────────────────────┘
```

**Components (delta vs. Phases 1–3).**
- **Plugin worker** gains four jobs: `bridge` (event → event-store mirror, §4.4), `continuity` (§5), `budget-verdict` (§6), `rules-resolver` (§7). All run inside the existing Phase 3 worker; no new process.
- **AgentSentry instance** gains: filters on the Phase 2 columns (§9.2–9.3), `rules_content` input on `check_rules` (§9.5), `generate_handoff` memory-backed (§9.4), `size_task` config thresholds (§9.6).
- **Trust boundaries** unchanged from Phase 1 §2; the plugin authenticates to the instance with the same per-company key (Phase 3).

---

## 3. Sequence flows

### 3.1 Routine run (happy path)
```
Routine trigger → dispatch issue {originKind:"routine_execution", originRunId}   [V routines.ts:1884-1899]
Queue → claim → run status running → plugin event agent.run.started {runId, agentId, issueId}  [V run-lifecycle.ts:1347-1381]
Plugin: ctx.state.get({scopeKind:"run", scopeId:runId, stateKey:"continuity"}) → none
Plugin: ctx.issues.get(issueId) → originKind == routine_execution → continuity enabled
Plugin: → AgentSentry recall_context {query:<issue title+description>, issue_id, project_id, lookback_days}
Plugin: ctx.issues.documents.upsert {key:"agentsentry-context", body:<recall text ≤ 8 000 chars>}
Plugin: ctx.state.set(run/continuity = {contextWrittenAt})
… agent works; may itself call recall_context (advisory) …
Run ends → agent.run.finished|failed {runId, status, error}
Plugin: → AgentSentry generate_handoff {session_id:runId, issue_id, project_id, session_summary:<from run payload>}
Plugin: ctx.issues.documents.upsert {key:"agentsentry-handoff", body:<handoff text>}
Plugin: ctx.state.set(run/continuity.handoffWrittenAt)
Next run of the same issue (routine re-trigger, retry, wake): agent reads agentsentry-context (A5-3 decides how)
```

### 3.2 Budget verdict
```
agent.run.started {runId, agentId, issueId}
Plugin: ctx.issues.summaries.getOrchestration({issueId, companyId, includeSubtree:true})
        → costs{costCents,…}, openBudgetIncidents[], invocationBlocks[], runs[]      [V sdk/types.ts:1374-1384]
Plugin: → AgentSentry size_task {task:<issue title+description>, files:<from work products if any>}
Plugin: verdict = fuse(costs, incidents, risk_level, config)   (§6.2)
Plugin: → AgentSentry capture_event {event_type:"decision"|"violation", skill:"small_bets", tags:[...], metadata.paperclip{…}, metadata.budget{…}}
Plugin: reaction per config: none | comment | blocker | pause            (§6.3)
```

### 3.3 Workspace-aware `check_rules`
```
Agent → gateway → AgentSentry check_rules {file_path, change_description}   (no rules_content)
AgentSentry: rules_source = AGENT_SENTRY_RULES_DIR (Phase 1 §6.4)           → verdict A (company rules)
Agent → gateway → AgentSentry check_rules {…, rules_content:<fetched by agent>}  → verdict B (workspace rules)
Plugin job rules-resolver (on issue.checked_out): ctx.projects.getWorkspaceForIssue → repoUrl/ref
        → fetch CLAUDE.md/AGENTS.md → ctx.state.set(issue/rules = {content, sha256, fetchedAt})
        → ctx.issues.documents.upsert {key:"agentsentry-rules", body:<content>}   (agent can read it)
```
Agents are instructed (Phase 1 §8.2 `agentInstructions`, updated in WI5-7) to pass the `agentsentry-rules` document body as `rules_content`. The plugin never calls `check_rules` on the agent's behalf for a change it cannot see.

### 3.4 Failure
```
AgentSentry down → recall/handoff/size_task error → plugin logs, ctx.metrics.write("agentsentry.phase5.skipped"), no document written, no verdict event
Plugin down → nothing happens; runs proceed (events are fire-and-forget [V activity-log.ts:49-56])
```

---

## 4. Task↔event bridge

### 4.1 Identifier columns (consumed from Phase 2)
Phase 2 adds to `OpsEvent` and the SQLite/Supabase schemas: `company_id` (NOT NULL), `project_id`, `issue_id`, `run_id`, `goal_id` (nullable), indexed `(company_id, issue_id, timestamp)`, `(company_id, run_id)`, `(company_id, project_id, timestamp)`. Phase 5 requires **`goal_id`** be included in that migration (decision D5-1 below, resolved: include — Paperclip issues carry `goalId` **[V]** `types/issue.ts:845-959`, and goal-level recall is the natural scope for routines sharing a goal).

Phase 5 does **not** add columns. If Phase 2 ships without `goal_id`, WI5-1 adds it.

### 4.2 `metadata.paperclip` contract (event-level, all sources)
Stored verbatim in `metadata` (hashed, `src/memory/schema.ts:87-104` **[V]**), so it is tamper-evident once written:
```json
"paperclip": {
  "company_id": "<guid>", "agent_id": "<guid>", "run_id": "<guid>",
  "issue_id": "<guid>|null", "project_id": "<guid>|null", "goal_id": "<guid>|null",
  "issue_identifier": "ACME-123|null",
  "origin_kind": "routine_execution|…|null", "origin_id": "<routine id>|null",
  "invocation_source": "timer|assignment|on_demand|automation|null",
  "event_source": "gateway_headers|plugin_event|tool_input",
  "correlation_id": "<x-paperclip-correlation-id>|null"
}
```
- `event_source` records provenance: gateway headers (Phase 1 X-11/U-9), plugin bridge (§4.4), or explicit tool input. Explicit tool input never overrides a gateway header for `company_id` (tenancy) — it may only *add* `issue_id`/`project_id`/`goal_id`; conflicts are logged and the header wins (U5-1).
- `invocation_source` values are Paperclip's `HEARTBEAT_INVOCATION_SOURCES` **[V]** (`constants.ts:896-901`).

### 4.3 Event taxonomy for Paperclip-originated events
AgentSentry `EVENT_TYPES = decision|violation|incident|pattern|handoff|audit_finding`, `SKILLS = save_points|context_health|standing_orders|small_bets|proactive_safety|system` **[V]** (`schema.ts:7-9`). The `capture_event` tool's zod enums reject custom values (`capture-event.ts:62-64`) **[V]**, so the mapping must stay within these sets:

| Paperclip happening (plugin event) | `event_type` | `skill` | `severity` | `title` | tags |
| --- | --- | --- | --- | --- | --- |
| `agent.run.started` | `decision` | `system` | low | `run-start:<identifier>` | `pc:run`, `pc:origin=<originKind>` |
| `agent.run.finished` | `handoff` (via `generate_handoff`) | `context_health` | low | `handoff:<runId>` | `pc:run` |
| `agent.run.failed` (`failed\|timed_out`) | `incident` | `system` | high (timed_out: medium) | `run-failed:<identifier>` | `pc:run`, `pc:error_code=<errorCode>` |
| `agent.run.cancelled` | `decision` | `system` | low | `run-cancelled:<identifier>` | `pc:run` |
| `issue.updated` with `status→blocked` | `incident` | `small_bets` | medium | `issue-blocked:<identifier>` | `pc:issue` |
| `issue.updated` with `status→done` | `decision` | `small_bets` | low | `issue-done:<identifier>` | `pc:issue` |
| `issue.relations.updated` (blocker added by us) | `violation` | `proactive_safety` | high | `hold:<identifier>` | `pc:issue`, `agentsentry:hold` |
| `approval.created` (`type`, `issueIds`) | `decision` | `standing_orders` | medium | `approval-requested:<type>` | `pc:approval` |
| `approval.decided` | `decision` | `standing_orders` | low | `approval-<approved\|rejected\|revision_requested>:<type>` | `pc:approval` |
| `budget.incident.opened` (soft/hard) | `incident` | `small_bets` | soft: medium, hard: critical | `budget-<soft\|hard>:<scopeType>` | `pc:budget` |
| `budget.incident.resolved` | `decision` | `small_bets` | low | `budget-resolved:<action>` | `pc:budget` |
| Budget verdict (§6) | `decision` (ok/warn) / `violation` (hold) | `small_bets` | ok: low, warn: medium, hold: high | `budget-verdict:<verdict>:<identifier>` | `pc:run`, `agentsentry:budget` |
| Rules verdict (§7) with violations | `violation` | `standing_orders` | max violation severity | `rules:<identifier>` | `pc:issue`, `agentsentry:rules` |

Payload fields per event are those verified in Paperclip (`issue.updated`: `changes`, `status`; `agent.run.*`: `runId, agentId, status, invocationSource, triggerDetail, error, errorCode, issueId, startedAt, finishedAt`; `approval.created`: `{type, issueIds}`; `budget.incident.opened`: `{scopeType, scopeId, amountObserved, amountLimit, approvalId?}`) **[V]** — see `paperclip-research.md` §1.6. `detail` is a JSON-safe rendering of the payload **minus** any free text longer than 2 000 chars (truncated with `…[truncated]`); `affected_files` is empty unless the issue's work products expose `changedFiles` (commit/PR metadata **[V]** `types/work-product.ts:68-89` — counts only, not paths; so empty).

**Not mirrored:** `issue.comment.created` (body not in payload — only `{commentId, identifier}` **[V]**; fetching every comment is Phase 3's two-step scan, not a bridge concern), `issue.document.*`, `activity.logged` (not delivered to plugins **[V]**), `cost_event.created` (never emitted **[V]**).

### 4.4 Bridge job (plugin)
- Subscribes with `ctx.events.on(name, fn, {companyId})` for the rows in §4.3 **[V]** (`sdk/types.ts:563-573`).
- Writes via AgentSentry `capture_event` with explicit `session_id = runId` (or `issue_id` when no run), `agent_id = payload.agentId ?? "paperclip"`, `metadata.paperclip` per §4.2, `event_source:"plugin_event"`.
- Idempotency: `idempotencyKey = sha256(eventId)` on the gateway call? **No** — the plugin calls the instance directly (Phase 3), not through the gateway. Use the AgentSentry-side hint `tags: ["idem:<eventId>"]` (Phase 1 WI-3, 24 h window) **[V-Phase1]**; U5-2 proves one row per Paperclip event.
- Ordering: events may arrive out of order and concurrently (`plugin-event-bus.ts:172-198` **[V]**); the bridge never depends on order.
- Backpressure: a bounded in-memory queue (1 000) with drop-oldest and a `agentsentry.bridge.dropped` metric; no retry beyond one immediate retry on network error (§10).

### 4.5 Retrieval contracts (consumed by §5–§7 and by agents)
- `search_history` gains `issue_id?`, `project_id?`, `run_id?`, `goal_id?`, `agent_id?` exact filters (Phase 2 provides `agent_id`; Phase 5 adds the rest, §9.2) and keeps `tag`. Filters AND together with `query` (empty `query` allowed when at least one filter is present — change from Phase 1 §6.8 where `query` is required; U5-3).
- `recall_context` gains `issue_id?`, `project_id?`, `goal_id?`, and `scope: "issue"|"project"|"goal"|"company"` (default `"project"` when `project_id` is known, else `"company"`). Grouping stays by `session_id` (= run id for gateway/plugin-origin events) — `ContextRecaller.recall` groups by `event.session_id` **[V]** (`intelligence.ts:394-438`). Lookback default stays 90 days.

---

## 5. Routine continuity

### 5.1 Design decision — where context lands
Options evaluated:
| Option | Verified behaviour | Decision |
| --- | --- | --- |
| Write `continuation-summary` | Host-owned system key, rewritten by `refreshIssueContinuationSummary` **[V]** | **Rejected** (clobbered; also would be mistaken for Paperclip's own summary). |
| Post an issue comment and request a wake | `createComment` + `requestWakeup` are available **[V]**; wake comments reach the prompt as `wakeCommentContext` **[V]** (`task-context.ts:153-160`) | **Rejected for routine runs** — it creates an *extra* run per routine trigger and interleaves with human comments. Kept as an **opt-in** for `on_demand`/`assignment` issues (D5-3). |
| Plugin-owned document `agentsentry-context` + agent reads it / calls `recall_context` | `documents.upsert` with any key matching `^[a-z0-9][a-z0-9_-]*$` ≤64 **[V]** (`validators/issue.ts:1228-1236`); body ≤ 524 288 chars **[V]** (`:2266-2272`); whether the agent prompt lists non-system documents is **[I]** (`documentSummaries?` exists on `Issue`, `types/issue.ts:939-945` **[V]**, but its inclusion in the task prompt was not located) | **Chosen.** A5-3 measures whether the agent reads it unprompted; if not, `agentInstructions` (WI5-7) tell the agent to `GET /issues/:id/documents/agentsentry-context` or call `recall_context` first. |

### 5.2 Continuity job — contract
- **Trigger:** `agent.run.started` with `payload.issueId != null`.
- **Eligibility:** `ctx.issues.get(issueId, companyId).originKind === "routine_execution"` **[V]** OR plugin config `continuity.alsoFor: ("assignment"|"on_demand"|"timer"|"automation")[]` matches `payload.invocationSource`. Default: routines only.
- **Idempotency:** `ctx.state` scope `run` **[V]** (`PLUGIN_STATE_SCOPE_KINDS` includes `run`, `constants.ts:1637-1646`), key `continuity`, value `{contextWrittenAt?, handoffWrittenAt?, attempts}`; the job exits if the relevant timestamp is set. Duplicate deliveries are possible (bus is at-least-once by construction) → U5-4.
- **Recall request** to AgentSentry: `recall_context { query: <issue.title + "\n" + issue.description[0:2000]>, issue_id, project_id, goal_id, scope: "project", max_results: 5, lookback_days: config.continuity.lookbackDays (default 30) }`. Timeout 10 000 ms (Phase 1 §6.7 budget).
- **Document write:** `ctx.issues.documents.upsert({ issueId, key: "agentsentry-context", companyId, title: "AgentSentry — prior context", format: "markdown", body, changeSummary: "run <runId>" })`. `body` = recall text truncated to **8 000 chars** (mirrors `ISSUE_CONTINUATION_SUMMARY_MAX_BODY_CHARS` **[V]** so a future host-side inclusion stays within prompt budget), prefixed by a one-line provenance header `<!-- agentsentry:context run=<runId> at=<iso> events=<n> -->`.
- **Empty recall:** write nothing (do not create an empty document); record `agentsentry.continuity.empty` metric.
- **Handoff on `agent.run.finished|failed`:** call `generate_handoff { session_id: runId, issue_id, project_id, goal_id, remaining_work: <derived: "run failed: <errorCode>" | null>, session_summary: <JSON of payload {status, invocationSource, error?} > }` (contract after Phase 1 WI-3 + §9.4). Write `agentsentry-handoff` (same cap 8 000 chars, same header). On `cancelled`: no handoff (nothing to hand off), state marked to avoid retries.
- **Mutual exclusion with Paperclip's summary:** the handoff document never duplicates `continuation-summary`; it carries AgentSentry's view (events, violations, prior-session links). Agents are told the difference in `agentInstructions`.

### 5.3 Routine-level recall (goal scope)
Routines sharing a `goalId` (routine `goalId` **[V]** `types/routine.ts:72-104`) benefit from `scope:"goal"`. Config `continuity.scope` default `"project"`; `"goal"` opt-in (D5-2).

### 5.4 What the agent sees (A5-3 outcomes)
- **If** the prompt lists `documentSummaries` → agent sees `agentsentry-context` title; instructions tell it to open it.
- **Else** → instructions tell it to call `recall_context` with the issue id it already has. Either way Goal 2's document write is still the durable artefact (visible in the UI, searchable — non-system keys *are* included in company search, `company-search.ts:922` excludes only system keys **[V]**).

---

## 6. Risk-weighted budget gating

### 6.1 What Paperclip provides (and does not)
- Read surface: `ctx.issues.summaries.getOrchestration({issueId, companyId, includeSubtree?, billingCode?})` → `costs{costCents,inputTokens,cachedInputTokens,outputTokens,billingCode}`, `openBudgetIncidents[{scopeType,scopeId,thresholdType,amountLimit,amountObserved,status,approvalId}]`, `invocationBlocks[{scopeType,scopeId,reason}]`, `runs[]` **[V]** (`sdk/types.ts:1340-1384`). This is the **only** cost/budget read for plugins **[V]**.
- Events: `budget.incident.opened` (soft/hard), `budget.incident.resolved` **[V]**; budget-generated approvals (`budget_override_required`) are inserted without activity → **no** `approval.created` for them **[V]** (`budgets.ts:456-468`).
- Native hard stop already exists: hard incident → scope paused + runs cancelled **[V]** (`budgets.ts:665-684`, `run-control.ts:1639-1700`). Phase 5 **never** re-implements it.
- Reactions available to a plugin: `ctx.issues.createComment` (`issue.comments.create`), `ctx.issues.create` + `relations.addBlockers` (`issues.create`, `issue.relations.write`), `ctx.agents.pause(agentId, companyId)` (`agents.pause`) **[V]** (`sdk/types.ts:1744`). There is **no** per-run cancel in `ctx` (board API only) — not used.

### 6.2 Verdict function (plugin, pure)
Inputs: `o = getOrchestration`, `r = size_task.risk_level ∈ LOW|MEDIUM|HIGH|CRITICAL` (thresholds ≤2/≤5/≤8 **[V]** `size-task.ts:59-64`), plugin config `budget`:
```json
"budget": {
  "mode": "off|advise|hold|pause",              // default "advise"
  "issueSoftCents": 500,                       // AgentSentry-side per-issue soft line (Paperclip has none)
  "issueHardCents": 2000,
  "riskMultiplier": {"LOW":1.0,"MEDIUM":0.75,"HIGH":0.5,"CRITICAL":0.25},
  "respectPaperclipIncidents": true
}
```
```
effectiveSoft = issueSoftCents * riskMultiplier[r]
effectiveHard = issueHardCents * riskMultiplier[r]
spend = o.costs.costCents (subtree if includeSubtree)
if respectPaperclipIncidents and any(o.openBudgetIncidents.thresholdType == "hard") → "hold"   // native pause is already in force; mirror it
elif spend ≥ effectiveHard or (r == CRITICAL and any soft incident)                       → "hold"
elif spend ≥ effectiveSoft or any soft incident or o.invocationBlocks.length > 0             → "warn"
else                                                                                          → "ok"
```
Deterministic, unit-tested (U5-5) with a fixture table. The multiplier is the "risk-weighting": a CRITICAL task is held at 25 % of the issue budget.

### 6.3 Reactions (gated by `mode`, all idempotent per `(issueId, verdict)` via `ctx.state` scope `issue`)
| mode | ok | warn | hold |
| --- | --- | --- | --- |
| `off` | – | – | – |
| `advise` (default) | capture event | capture + comment `AgentSentry budget: warn (spend X / soft Y, risk R)` | capture + comment |
| `hold` | capture | capture + comment | capture + comment + **blocker issue** titled `Budget hold: <identifier>` assigned to the issue's `responsibleUserId`, `relations.addBlockers(issueId, [blockerId])` — checkout of the held issue then 422s and queued runs wait **[V]** (`services/issues.ts:11872-11889`, `heartbeat/queue.ts:3669-3725`) |
| `pause` | capture | as `hold` | as `hold` + `ctx.agents.pause(agentId)` |

- A blocker is released (`removeBlockers`) when a later verdict is `ok`/`warn` **and** the blocker issue is `done`, or when a human closes the blocker. `cancelled` blockers do **not** unblock in Paperclip **[V]** (`services/issues.ts:2735-2758`) → the plugin marks its own blocker `done`, never `cancelled`.
- `pause` requires the `agents.pause` capability in the manifest (Phase 3 manifest gains it only when `mode:"pause"` is a supported config; capability additions trigger operator re-approval on upgrade **[V]** `plugin-lifecycle.ts:612-613`).
- Comments are posted with `authorAgentId` unset and `metadata.source:"agentsentry"`; they must not request a wake (no `reopen/resume/interrupt`), so they do not spawn runs.

### 6.4 Timing
Verdict runs on `agent.run.started` (pre-work, but the run is already live — G5-7) and on `budget.incident.opened`. A `hold` reached mid-run therefore blocks the **next** checkout, not the current run; that is the honest limit until U-1 lands.

---

## 7. Per-workspace `check_rules`

### 7.1 Problem (Phase 1 D-5)
`validateRules()` reads rules from the server process cwd **[V]** (`src/primitives/rules-validation.ts:223`); Phase 1 mounts a company rules dir. Agents working in different repos get the company's rules, not the repo's.

### 7.2 Rules resolver (plugin job)
- **Trigger:** `issue.checked_out` (payload `{agentId, status}` **[V]**) and `agent.run.started`; idempotent per `(issueId, repoUrl, ref)` via `ctx.state` scope `issue`, key `rules`.
- **Locate repo:** `ws = ctx.projects.getWorkspaceForIssue(issueId, companyId)` **[V]** → `{path, repoUrl, repoRef, defaultRef}`; if the issue has an execution workspace, `ctx.executionWorkspaces.get(issue.executionWorkspaceId, companyId)` **[V]** → `{repoUrl, baseRef, branchName, cwd}` wins (branch-specific rules).
- **Fetch:** for `repoUrl` on github.com: `ctx.http.fetch("https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<file>")` for each of `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, with `Authorization: Bearer <token>` where `token = ctx.projects.resolveGitCredential(projectId, ws.id, companyId)` **[V]** (null → unauthenticated; private repo 404 → "no rules, source unavailable"). Other hosts: GitLab raw (`/-/raw/<ref>/<file>`) **[I]**; otherwise skip. Cap 256 KiB per file, 3 files.
- **Local path:** if `ws.path` (or `cwd`) is readable from the worker process, read files directly — only true when the plugin worker runs on the Paperclip host with local workspaces **[I]** → I5-4 decides whether to keep this branch.
- **Publish:** `ctx.state.set(issue/rules = {content, sha256, source: {repoUrl, ref, files[]}, fetchedAt})` and `ctx.issues.documents.upsert({key:"agentsentry-rules", title:"AgentSentry — workspace rules", body: content})` so the agent (and humans) can see exactly which rules apply.

### 7.3 `check_rules` contract change (AgentSentry, WI5-5)
- Input: `{ file_path, change_description, rules_content?: string (≤ 256 KiB), rules_source?: string }`.
- Behaviour: if `rules_content` present → `validateRules(file_path, change_description, rulesContent=rules_content)` (new overload that bypasses `loadRulesContent`, `rules-validation.ts:61-70` **[V]**); else current behaviour (Phase 1 §6.4).
- Output adds `rules_source: "instance:<dir>" | "caller:<rules_source|'inline'>"` and `rules_checked`. `compliant:true` with `rules_checked:0` additionally sets `verdict:"no_rules"` so callers cannot misread it (C5-1 snapshot).
- Agents pass `rules_content` from the `agentsentry-rules` document (instruction in WI5-7). The gateway forwards tool arguments unchanged **[V]** (`tool-gateway.ts:6339-6355` sends `{name, arguments: parameters}`), so a 256 KiB argument is fine for Paperclip but is subject to the gateway's argument-hash/summary logic — size tested in I5-3.

### 7.4 Simpler alternative (if I5-4 shows the worker shares the host FS)
Mount nothing; the resolver reads `ws.path/CLAUDE.md` directly. Same publish step. Keep the HTTPS fetch as fallback.

---

## 8. Enablement-level mapping (AgentSentry levels → plugin config)
AgentSentry levels **[V]** (`src/enablement/engine.ts:35-42, 84-138`): 3 House Rules (standing_orders basic + directive_compliance), 4 Right Size (standing_orders full + small_bets basic), 5 Full Guard (small_bets full + proactive_safety), 6 Risk Watch (risk_scoring). Only `risk_score` checks the level at runtime **[V]** (`risk-score.ts:88`).

| Plugin `enablementLevel` | continuity | budget.mode | rules resolver | Phase 3 hold-on-secret |
| --- | --- | --- | --- | --- |
| 3 | on (routines) | `advise` | on | advisory comment only |
| 4 | on | `advise`; `hold` allowed if operator sets `budget.mode` | on | blocker (Phase 3 default) |
| 5 | on (+ `alsoFor` assignment) | `hold` default; `pause` allowed | on | blocker + `pause` allowed |
| 6 | as 5 | as 5 | as 5 | + `risk_score` exposed (`AGENT_SENTRY_EXPOSE_EXPERIMENTAL`, Phase 1 §7) |

`instanceConfigSchema` (Phase 3 manifest) gains `enablementLevel: integer 3..6` and the `continuity`/`budget`/`rules` objects; `onValidateConfig` rejects `budget.mode:"pause"` below level 5 (U5-6).

---

## 9. Tool contract changes (AgentSentry instance)

### 9.1 `capture_event` (delta)
- Inputs **added**: `issue_id?`, `project_id?`, `goal_id?`, `run_id?` (strings); `metadata?` already from Phase 1 WI-3. Header-derived values (Phase 1 U-9) take precedence for `company_id`; for the rest, explicit input wins over header (an agent may capture about a different issue than the one it runs on — rare; logged).
- Writes the Phase 2 columns and `metadata.paperclip` (§4.2). `event_source` set by the server, never by the caller.

### 9.2 `search_history` (delta)
- Inputs **added**: `issue_id?`, `project_id?`, `run_id?`, `goal_id?`, `agent_id?`; `query` becomes optional when any filter or `tag` is present.
- `MemoryStore.search()` forwards them to `provider.textSearch`/`query`/`vectorSearch` (`VectorSearchOptions` currently lacks `agent_id/tag/until` **[V]** `schema.ts:50-58` → extended in WI5-2).

### 9.3 `recall_context` (delta)
- Inputs **added**: `issue_id?`, `project_id?`, `goal_id?`, `scope?`. `ContextRecaller.recall` passes the filters into `store.search` (`intelligence.ts:394-438` **[V]** today passes only `limit`/`since`).
- Output unchanged in shape (`--- Session: <id> …`), plus a first line `Scope: <scope> (<id>) — <n> sessions`.

### 9.4 `generate_handoff` (delta on the Phase 1 WI-3 contract)
- Inputs **added**: `issue_id?`, `project_id?`, `goal_id?`. `session_id` is the run id when called by the plugin.
- Behaviour: Phase 1 WI-3 makes the tool capture a `handoff` event; Phase 5 makes it **memory-backed**: it calls `SessionSummarizer.summarize(sessionId)` (`intelligence.ts:68-135` **[V]**) for the run's events and merges the git section (when the instance has a repo — in the gateway topology it does not; the git section is then omitted, not errored). The result is the text in §5.2's document.
- Deprecates the CLI's unfiltered "last 50 events" summary for MCP callers (CLI untouched).

### 9.5 `check_rules` — §7.3.

### 9.6 `size_task` (decision D5-4, resolved: **yes**)
`size_task` ignores `task_sizing` config **[V]** (`size-task.ts` reads no config; thresholds hard-coded `:59-64`; config has `medium_risk_threshold:4, high_risk_threshold:8, critical_risk_threshold:13` **[V]** `agent-sentry.config.json:23-29`). WI5-6 makes the tool read `task_sizing.*` with the hard-coded values as defaults **and** keeps the current defaults in the shipped config file so behaviour is unchanged unless an operator edits it. Contract test (`tests/contracts/doc-contracts.test.ts:157-180` config allow-list) already lists `task_sizing`; no new key.

### 9.7 Annotations (Phase 1 §7) — unchanged: the added inputs do not change read/write classification. `descriptorHash` **does** change for every tool whose `inputSchema` changes **[V]** (`tool-catalog-hash.ts:25-37`), which invalidates trust rules (`tool-access-policy.ts:275-286` **[V]**) and, if `quarantineNewEntries:true` was set (Phase 1 §3.4), quarantines the changed tools. **Release note + WI-4 re-run are mandatory** for the Phase 5 AgentSentry release (R5-1).

---

## 10. Failure semantics
| Failure | Behaviour | Test |
| --- | --- | --- |
| AgentSentry unreachable during continuity | no document; state not set (so a later duplicate delivery retries once); metric `agentsentry.continuity.failed` | N5-1 |
| `documents.upsert` fails (e.g., body > 524 288 or issue archived) | logged; event still captured in AgentSentry; no retry | N5-2 |
| `getOrchestration` fails | verdict `unknown`; no reaction; capture `decision` with `metadata.budget.verdict:"unknown"` | N5-3 |
| Rules fetch 404/403 | `agentsentry-rules` document **not** written; `ctx.state` records `source.unavailable:true`; `check_rules` without `rules_content` → instance rules with `rules_source:"instance:…"` | N5-4 |
| Duplicate plugin event | idempotent via `ctx.state` (run/issue scope) and AgentSentry `idem:` tag | U5-4, U5-2 |
| Plugin worker restart mid-job | `ctx.state` is host-persisted **[V]** (`plugin_state` table); job resumes from the recorded step | N5-5 |
| Blocker created but AgentSentry capture fails | blocker stands (safety first); a `agentsentry.hold.unrecorded` metric fires; the next verdict run captures retroactively | N5-6 |

Nothing in Phase 5 can fail a run except an operator-enabled `hold`/`pause` reaction (§6.3).

---

## 11. Performance budgets
| Path | Budget | Basis |
| --- | --- | --- |
| Continuity per run | ≤ 1 recall (10 s) + 1 upsert; ≤ 2 s typical | Phase 1 §14 `recall_context` 10 000 ms; SQLite linear scan `MAX_VECTOR_SCAN = 10000` **[V]** (`sqlite-provider.ts:154`) |
| Handoff per run | ≤ 1 `generate_handoff` (10 s) + 1 upsert | `SessionSummarizer` reads ≤ 10 000 events of the session **[V]** (`intelligence.ts:68-135`) |
| Budget verdict | 1 `getOrchestration` (+ subtree) + 1 `size_task` (5 s) | — |
| Rules resolver | ≤ 3 HTTPS fetches, 256 KiB each, cached per `(issue, repo, ref)` | — |
| Document sizes | context/handoff ≤ 8 000 chars; rules ≤ 256 KiB; all ≤ Paperclip's 524 288 **[V]** | `validators/issue.ts:2266-2272` |
| Event volume | bridge ≤ 1 event per Paperclip event; at 1 000 runs/day ≈ 5 000 events/day → 90-day retention ≈ 450 k rows: **exceeds** the Phase 1 recall ceiling; Phase 5 therefore sets `since` (lookback) on every recall so the 10 k cap applies only to the window **[V]** (`sqlite-provider.ts:172-174`) and relies on Phase 2's indexed filters | A5-1 includes a 100 k-row dataset |

---

## 12. Observability
- Plugin metrics via `ctx.metrics.write(name, value, tags)` **[V]**: `agentsentry.bridge.events{type}`, `agentsentry.bridge.dropped`, `agentsentry.continuity.{written,empty,failed}`, `agentsentry.handoff.{written,failed}`, `agentsentry.budget.verdict{verdict}`, `agentsentry.hold.{created,released}`, `agentsentry.rules.{fetched,unavailable}`.
- Every reaction logs `ctx.activity.log({companyId, message, entityType:"issue", entityId})` **[V]** so it appears in Paperclip's activity feed (and therefore in the audit humans read).
- AgentSentry side: Phase 1 §11 per-tool metrics gain labels `event_source` and `scope`.
- Tracing: `ctx.tracer.startSpan` is a no-op by default **[V]**; `traceparent` on invocations is propagated to AgentSentry as `x-agentsentry-traceparent` (Phase 3 client) — no OTel exporter exists in AgentSentry **[V]**; out of scope.

---

## 13. Security & privacy
- The plugin's writes to Paperclip are limited to: documents with keys `agentsentry-*`, comments, blocker issues, `agents.pause` (opt-in). Manifest capabilities (Phase 3 list +): `issue.documents.write`, `issue.comments.create`, `issues.create`, `issue.relations.write`, `issues.read`, `projects.read`, `projects.git-credentials` (for `resolveGitCredential`), `execution.workspaces.read`, `http.outbound`, `plugin.state.read/write`, `events.subscribe`, `metrics.write`, `activity.log.write`, and `agents.pause` only when `budget.mode:"pause"` is enabled.
- Git credentials: obtained per call via `ctx.projects.resolveGitCredential` **[V]**, never stored in `ctx.state`, never sent to AgentSentry. Rules content is public-ish repo metadata; still redacted through `scan_security` before being written as a document (a `CLAUDE.md` can contain secrets).
- Recall text written into `agentsentry-context` is sourced from AgentSentry events of the **same company** (Phase 2 tenancy) and passes Paperclip's source-trust handling like any document (`sourceTrust` on documents **[V]** `schema/documents.ts`).
- No new inbound surface on AgentSentry; the new inputs are validated with zod (`issue_id` etc. are `z.string().uuid()`-ish: Paperclip ids are guids **[V]**).

---

## 14. Test plan

### 14.1 Unit (AgentSentry `tests/mcp/`, `tests/memory/`; plugin `tests/`)
- U5-1 header/input precedence: header `company_id` wins; explicit `issue_id` accepted; conflict logged.
- U5-2 bridge idempotency: same `eventId` delivered twice → one row (`idem:` tag).
- U5-3 `search_history` with `issue_id` only (no `query`) → exact rows; with `query` + `run_id` → intersection.
- U5-4 continuity idempotency: two `agent.run.started` for one run → one recall, one upsert.
- U5-5 verdict table: 12 fixtures across modes/risks/incidents; `hard` incident → `hold` regardless of spend.
- U5-6 `onValidateConfig`: `budget.mode:"pause"` at level 4 → error; at 5 → ok.
- U5-7 `check_rules` with `rules_content` ignores the instance dir; `rules_checked` counts parsed rules; `verdict:"no_rules"` when zero.
- U5-8 `generate_handoff` memory-backed: session with 3 events → text contains their titles; no repo → no git section, no error.
- U5-9 `size_task` reads `task_sizing` thresholds; default config reproduces current LOW/MEDIUM/HIGH/CRITICAL boundaries.

### 14.2 Contract
- C5-1 `tools/list` snapshot (Phase 1 C-2) updated once for the new inputs; tool count still 10; classification 8/2/0 unchanged.
- C5-2 Phase 2 migration includes `goal_id` (or WI5-1 adds it) and the three composite indexes.

### 14.3 Integration (live Paperclip dev instance + Phase 3 plugin)
- I5-1 routine with cron every minute → by run 2, `agentsentry-context` exists and references run 1's `handoff` event.
- I5-2 `getOrchestration` on an issue with a hard budget incident → verdict `hold`; blocker created; checkout returns 422 **[V]**.
- I5-3 `check_rules` via gateway with a 200 KiB `rules_content` → success; argument summary/hash recorded in `tool_invocations`.
- I5-4 worker FS access: `fs.access(ws.path)` from the plugin worker — determines §7.4.
- I5-5 Phase 5 AgentSentry release against an existing connection: `catalog/refresh` → changed tools re-approved via WI-4; trust rules re-created.

### 14.4 Acceptance (→ Goals)
- **A5-1** (Goal 1) 100 k events across 3 issues/2 projects; `search_history {issue_id}` and `recall_context {project_id}` return only matching rows; p95 < 2 s.
- **A5-2** (Goal 2) Routine issue, 3 runs: exactly 2 context documents (runs 2–3) and 3 handoff documents; 3 `handoff` events; no duplicates after forcing a redelivery.
- **A5-3** (Goal 2, measurement) With no special instruction, does the agent open `agentsentry-context`? Record yes/no; if no, enable the WI5-7 instruction and re-run → agent calls `recall_context` or reads the document.
- **A5-4** (Goal 3) Spend crosses `effectiveSoft` → `warn` comment; crosses `effectiveHard` in `hold` mode → blocker; human marks blocker `done` → next verdict `ok` → `removeBlockers` → checkout succeeds.
- **A5-5** (Goal 4) Two issues in different repos with different `CLAUDE.md` → `check_rules` with each `agentsentry-rules` body reports repo-specific violations; `rules_source` names the repo/ref.
- **A5-6** (Goal 5) Stop AgentSentry; trigger a routine → run executes normally; no documents; metrics show `failed`; restart → next run recovers.

### 14.5 Negative
- N5-1…N5-6 per §10.

---

## 15. Work items

| WI | Description | Area | Depends on | Est. |
| --- | --- | --- | --- | --- |
| WI5-1 | `goal_id` column + indexes if absent from Phase 2; `metadata.paperclip` writer; `event_source` | `src/memory/schema.ts`, `src/memory/migrations/`, `src/mcp/tools/capture-event.ts` | Phase 2 | S |
| WI5-2 | Filters (`issue_id/project_id/run_id/goal_id/agent_id`) through `MemoryStore.search/list`, `VectorSearchOptions`, both providers; `query` optional | `src/memory/store.ts`, `src/memory/providers/*`, `src/mcp/tools/search-history.ts` | WI5-1 | M |
| WI5-3 | `recall_context` scope/filters; `ContextRecaller` passes filters; scope line in output | `src/memory/intelligence.ts`, `src/mcp/tools/recall-context.ts` | WI5-2 | S |
| WI5-4 | `generate_handoff` memory-backed (`SessionSummarizer`), optional git section, new ids | `src/mcp/tools/generate-handoff.ts`, `src/memory/handoff.ts` | Phase 1 WI-3 | S |
| WI5-5 | `check_rules` `rules_content`/`rules_source`/`verdict:"no_rules"`; `validateRules` overload | `src/mcp/tools/check-rules.ts`, `src/primitives/rules-validation.ts` | – | S |
| WI5-6 | `size_task` reads `task_sizing` | `src/mcp/tools/size-task.ts` | – | XS |
| WI5-7 | Plugin: bridge, continuity, budget-verdict, rules-resolver jobs; config schema + `onValidateConfig`; capabilities; `agentInstructions` text for the Connection (`recall_context` first; `agentsentry-rules` → `rules_content`) | plugin repo (Phase 3), Phase 1 §8.2 `agentInstructions` | Phase 3, WI5-1..5 | L |
| WI5-8 | Phase 5 release procedure: C5-1 snapshot, WI-4 re-run (changed descriptors), trust-rule re-creation note | `scripts/paperclip/`, release notes | WI5-1..6 | XS |
| WI5-9 | Integration/acceptance suite I5/A5/N5 | `tests/e2e/paperclip/` | all | M |

Order: WI5-1 → WI5-2 → WI5-3/4/5/6 (parallel) → WI5-8 → WI5-7 → WI5-9.

---

## 16. Open decisions

| # | Decision | Recommendation | Closes when |
| --- | --- | --- | --- |
| D5-1 | Add `goal_id` to the event schema | **Yes** (in Phase 2 migration, else WI5-1) | C5-2 |
| D5-2 | Default recall scope for routines | `project`; `goal` opt-in | A5-2 review |
| D5-3 | Comment-and-wake injection for non-routine issues | Opt-in only (`continuity.wakeComment:true`); never for routines | product call |
| D5-4 | `size_task` reads `task_sizing` config | **Yes**, defaults preserved | U5-9 |
| D5-5 | Keep local-FS rules branch (§7.4) | Decide from I5-4 | I5-4 |
| D5-6 | Hold reaction default at level 5 | `hold` (blocker), not `pause` | operator sign-off |
| D5-7 | Mirror `issue.comment.created` into events (count only, no body) | No — noise; Phase 3's scan already captures findings | — |

---

## 17. Upstream requests to Paperclip (tracked; none block Phase 5)

| # | Request | Why | Workaround in this spec |
| --- | --- | --- | --- |
| U-1 | Tool-policy condition `budget: { scope, remainingCentsLt \| percentUsedGt }` or a `policyService.decide` hook | Only path to per-call budget gating; conditions are a closed set **[V]** | §6 reactive verdict |
| U-2 | Emit `cost_event.created` (map `cost.reported` in `ACTIVITY_ACTION_TO_PLUGIN_EVENT`) | Declared but never emitted **[V]** | poll `getOrchestration` on run start |
| U-3 | `tool_call.*` plugin events or `tool_invocations` in `PLUGIN_DATABASE_CORE_READ_TABLES` | Lets the plugin correlate gateway calls with events without relying on identity headers | identity headers (Phase 1 X-11) |
| U-4 | Issue-scoped budgets (`BUDGET_SCOPE_TYPES` + `issue`) | Per-task spend lines without plugin bookkeeping | `issueSoftCents/HardCents` in plugin config |
| U-5 | Plugin-contributed sections in the run prompt (or a documented flag that non-system documents are listed) | Removes the A5-3 uncertainty | `agentInstructions` |
| U-6 | Emit `approval.created` for `budget_override_required` approvals | Currently bypasses activity **[V]** (`budgets.ts:456-468`) | subscribe to `budget.incident.opened` instead |

Filed as issues against `paperclipai/paperclip` at Phase 5 kickoff; link ids here when opened.

---

## 18. References
- AgentSentry **[V]**: `src/memory/schema.ts`, `src/memory/store.ts`, `src/memory/intelligence.ts`, `src/memory/handoff.ts`, `src/memory/providers/sqlite-provider.ts`, `src/mcp/tools/{capture-event,search-history,recall-context,generate-handoff,check-rules,size-task}.ts`, `src/primitives/rules-validation.ts`, `src/enablement/engine.ts`, `agent-sentry.config.json`.
- Paperclip **[V]** (`50b932a`): `packages/plugins/sdk/src/types.ts` (ctx: `issues`, `issues.documents`, `issues.relations`, `issues.summaries.getOrchestration`, `agents.pause`, `projects.getWorkspaceForIssue`, `projects.resolveGitCredential`, `executionWorkspaces.get`, `state`, `events`, `metrics`, `activity`), `packages/shared/src/constants.ts` (`SYSTEM_ISSUE_DOCUMENT_KEYS`, `ISSUE_ORIGIN_KINDS`, `PLUGIN_STATE_SCOPE_KINDS`, `BUDGET_SCOPE_TYPES`, `HEARTBEAT_INVOCATION_SOURCES`, `PLUGIN_EVENT_TYPES`), `packages/shared/src/validators/issue.ts` (document key regex, `upsertIssueDocumentSchema`), `packages/shared/src/validators/tool-access.ts` (`ToolPolicyConditions`), `server/src/services/activity-log.ts`, `server/src/services/heartbeat/run-lifecycle.ts`, `server/src/services/heartbeat/task-context.ts`, `server/src/services/issue-continuation-summary.ts`, `server/src/services/routines.ts`, `server/src/services/budgets.ts`, `server/src/services/issues.ts` (blocker readiness, checkout 422), `server/src/services/heartbeat/queue.ts`, `server/src/services/tool-catalog-hash.ts`.
- Research notes (this repo's scratch, not committed): `paperclip-research.md`, `agentsentry-survey.md` (2026-10-27).
