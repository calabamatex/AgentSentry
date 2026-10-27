# Engineering Spec — Phase 3: AgentSentry Safety Plugin for Paperclip (observe + react)

| | |
| --- | --- |
| **Status** | Draft v1 — implementation-ready for Phase 3 |
| **Date** | 2026-10-27 |
| **Parent** | [paperclip-integration.md](./paperclip-integration.md) (strategy, Phase 3) · [paperclip-phase1-engineering-spec.md](./paperclip-phase1-engineering-spec.md) v3 (governed connection; this phase depends on it) |
| **Owner** | _unassigned_ |
| **AgentSentry** | v0.6.0-beta.1 (`agent-sentry/`) |
| **Paperclip** | `paperclipai/paperclip@50b932a` (shallow clone, read 2026-10-27) |

**Scope.** A Paperclip **plugin** (`paperclip-plugin-agentsentry`) that (a) subscribes to Paperclip domain events, (b) fetches the persisted artifact the event points at, (c) runs AgentSentry's `scan_security` / `size_task` against it through the per-company AgentSentry instance from Phase 1, and (d) **reacts** inside Paperclip — blocker issue, redacted comment, wake-up, verdict mirrored to AgentSentry memory. It also registers two plugin agent tools (`agentsentry:scan`, `agentsentry:size`) so agents can ask for advice with first-class run attribution.
**Out of scope.** Synchronous pre-execution gating (does not exist in Paperclip — §1.2); multi-tenant AgentSentry store (Phase 2); store/catalog listing of the plugin (Phase 4); run-continuity, task↔event schema bridge, budget fusion (Phase 5).

**Grounding legend.** **[V]** verified in source — Paperclip clone (`packages/plugins/sdk/src/{types,define-plugin,protocol}.ts`, `packages/shared/src/{constants,validators/plugin}.ts`, `server/src/services/{activity-log,plugin-event-bus,plugin-tool-registry,plugin-loader,tool-gateway}.ts`, `server/src/routes/plugins.ts`) or AgentSentry `src/`. **[V-doc]** stated in `doc/plugins/PLUGIN_SPEC.md` / `PLUGIN_AUTHORING_GUIDE.md` but not confirmed in code. **[I]** inference; the test named next to it closes it.

---

## 0. Discrepancy log (plugin docs vs. source — source wins)

| # | Doc / strategy says | Source says | Consequence |
| --- | --- | --- | --- |
| P-1 | Strategy §6 Phase 3: plugin can "escalate the offending tool to `require_approval` (`authorization.policies.write`)" | `ctx.authorization.policies.*` operate on Paperclip **authorization** policies (`resourceType: company\|agent\|project\|issue`, `sdk/types.ts:1993-2029`); there is **no** `ctx` API for tool-access `tool_policies`/profiles/trust rules **[V]** | Plugin cannot change gateway policy. Escalation becomes an operator runbook via the board API (§5.5). |
| P-2 | `PLUGIN_SPEC.md:934`, SDK README:130 list `cost_event.created` | `cost.reported` activity maps to no plugin event (`activity-log.ts:19-47`); never emitted **[V]** | No cost signal for the plugin; budget signals come only from `budget.incident.*` (§4.2). |
| P-3 | `PLUGIN_SPEC.md:438` "By default, plugin tools are available to all agents" | Plugin tools pass the tool-access policy engine and end in `deny_default` absent profile/grant/allow (`tool-gateway.ts:11573-11637`; `tool-access-policy.ts:1569-1588`) **[V]** | §6.4 ships a profile include for `agentsentry:*`; I3-3 confirms. |
| P-4 | `PLUGIN_SPEC.md:550-557` host polls `onHealth` on an interval | `GET /plugins/:id/health` reads the DB row only (`routes/plugins.ts:2162-2216`); no poller found **[V]** | `onHealth` is implemented but treated as on-demand; the plugin also pushes health via `ctx.metrics.write` (§10). |
| P-5 | `PLUGIN_SPEC.md:263` capabilities shown to operator at install | Install auto-loads to `ready` when no new capability approval is needed (`routes/plugins.ts:1254-1267`); review only on capability additions at upgrade (`plugin-lifecycle.ts:612-613`) **[V]** | §9.3: keep the capability set minimal from v1; additions trigger `upgrade_pending`. |
| P-6 | `PLUGIN_SPEC.md:965` event namespace `plugin.@scope/name.event` | Manifest `id` regex `^[a-z0-9][a-z0-9._-]*$` (`validators/plugin.ts:780`); namespace is `plugin.<id>.<name>` **[V]** | Plugin id is `agentsentry`; emitted events are `plugin.agentsentry.<name>`. |
| P-7 | Strategy §6 Phase 3: "committed workspace files" are scannable | No `ctx` client for work products; `PLUGIN_DATABASE_CORE_READ_TABLES` excludes `work_products` and `tool_*` (`constants.ts:1444-1458`); commits/PRs are work products with metadata only (`types/work-product.ts:82-89`) **[V]** | Phase 3 scans **documents, comments, attachments** only. Repo content is D3-2. |
| P-8 | Strategy: "cost_event.created" subscription mirrors spend | see P-2 | Dropped. |

---

## 1. Goals, non-goals, exit criteria

### 1.1 Goals
1. Every **issue document** and **issue comment** written in a company with the plugin enabled is scanned by AgentSentry within 30 s of persistence (p95), and a `critical` secret finding **holds the task** via a blocker issue (§5.1).
2. Every issue that enters `in_progress` is **sized**; HIGH/CRITICAL sizing posts a decomposition recommendation as a comment and (configurable) a blocker (§5.2).
3. Agents can call `agentsentry:scan` / `agentsentry:size` as plugin tools, governed by the gateway, with `ToolRunContext` attribution (§6).
4. Every verdict is mirrored into the company's AgentSentry instance as a `capture_event` carrying Paperclip ids (§5.4), so Phase 5 can correlate.
5. AgentSentry outage degrades to **fail-open on advice**: no holds are placed, health reports `degraded`, nothing in Paperclip is blocked by the plugin's absence (§7.3).
6. The plugin never sees a secret it did not need: content is fetched, scanned, and discarded; only redacted findings are persisted anywhere (§8.2).

### 1.2 Non-goals (Phase 3)
- **Pre-execution veto.** No plugin hook can intercept a tool call or a run start: events are post-commit, fire-and-forget (`activity-log.ts:49-56`, `plugin-event-bus.ts:172-198`) **[V]**; `onAgentLifecycle` gates hire/pause/resume/terminate only (`types/agent-lifecycle.ts:2-6,20-33`) **[V]**; no `tool_call.*` event exists (`PLUGIN_EVENT_TYPES`, `constants.ts:1690-1724`) **[V]**; plugins cannot read `tool_invocations` (`constants.ts:1444-1458`) **[V]**. The hard gate remains Paperclip's native `require_approval` from Phase 1.
- Changing tool-access policy from the plugin (P-1).
- Scanning repository content / diffs (P-7; D3-2).
- UI beyond one issue tab and one dashboard widget.

### 1.3 Exit criteria → tests
Goals 1–6 map to acceptance tests A3-1…A3-6 (§11.4). Phase 3 is complete when they pass against a Paperclip dev instance with the Phase 1 connection live, and WI3-1…WI3-6 are merged.

---

## 2. System context

```
 Paperclip host (one instance, N companies)                         AgentSentry (one instance per company, Phase 1)
 ┌──────────────────────────────────────────────────────────┐        ┌──────────────────────────────┐
 │ activity log ──▶ plugin event bus ──onEvent RPC──▶        │        │ instance A  /mcp  (KEY_A)    │
 │                                   ┌─────────────────────┐ │ https  │ instance B  /mcp  (KEY_B)    │
 │ agent run ──tools/call──▶ gateway │ worker process      │─┼───────▶│ (StreamableHTTP, x-agent-    │
 │   (policy engine)   ──executeTool─▶ paperclip-plugin-   │ │        │  sentry-key, §P1 4.2)        │
 │                                   │ agentsentry         │ │        └──────────────────────────────┘
 │ board API ◀──ctx.issues/state/…───│ (multiCompanyConfig)│ │
 │ UI slots  ◀──bridge/data,action───└─────────────────────┘ │
 └──────────────────────────────────────────────────────────┘
```

**Components**
- **Plugin worker** — one Node process per plugin per host (`plugins` table is instance-scoped, no `company_id`, `packages/db/src/schema/plugins.ts:23-45`) **[V]**. Must declare `multiCompanyConfig: true` or the host fails closed with `CROSS_TENANT_CONFIG` on the second company's config (`define-plugin.ts:264-271`) **[V]**. Per-company config lives in `plugin_config {plugin_id, company_id, config_json}` **[V]**.
- **Event bus** — events derived from the activity log; payload = redacted activity `details` + `{agentId, runId, responsibleUserId}`; `entityId/entityType` from the activity row (`activity-log.ts:200-218`) **[V]**. Handlers run concurrently; errors are logged, never retried (`plugin-event-bus.ts:172-198`) **[V]** → the plugin owns retries (§5.6).
- **Tool dispatcher** — plugin tools are namespaced `<pluginKey>:<toolName>` (`plugin-tool-registry.ts:39,245-247`), listed to gateway sessions that carry an `agentId`, executed only with `agentId && runId` (`tool-gateway.ts:2960-2964, 11209-11218`) **[V]**; governed by the same policy engine as MCP tools (`tool-gateway.ts:11573-11701`) **[V]**.
- **AgentSentry instance** — unchanged Phase 1 service; the plugin is a second, key-authenticated caller next to the gateway (§8.4).

**Trust boundaries.** (1) host ↔ worker: JSON-RPC over the host-managed channel, every invocation scoped by `PluginInvocationContext { scope: { companyId } }` (`protocol.ts:290-310`) **[V]**; (2) worker ↔ AgentSentry: `x-agent-sentry-key` per company resolved from a `secret_ref` at call time (§8.1); (3) worker ↔ Paperclip data: capability-scoped `ctx` bridge; no raw DB except the plugin namespace (§2.1).

### 2.1 Capability set (minimal, each justified) **[V]** (`constants.ts:1322-1426`)

| Capability | Why |
| --- | --- |
| `events.subscribe` | `ctx.events.on` for issue/document/comment/run/approval/budget events. |
| `issues.read`, `issue.comments.read`, `issue.documents.read`, `issue.attachments.read` | fetch the artifact named by the event (§5.0). |
| `issues.create`, `issue.relations.write`, `issue.comments.create`, `issues.wakeup` | reactions: blocker issue, `addBlockers`, redacted comment, `requestWakeup` (§5). |
| `issues.update` | clear the hold when the finding is resolved (§5.1 step 7). |
| `secrets.read-ref` | `ctx.secrets.resolve` for the per-company access key. |
| `http.outbound` | `ctx.http.fetch` to the AgentSentry instance. |
| `plugin.state.read`, `plugin.state.write` | idempotency + hold bookkeeping in `ctx.state`. |
| `agent.tools.register` | `agentsentry:scan`, `agentsentry:size` (manifest `tools[]` requires it, `validators/plugin.ts:891-899`). |
| `jobs.schedule` | hourly reconciliation job (§5.6). |
| `activity.log.write`, `metrics.write` | audit + health (§10). |
| `entrypoints.ui` | one `detailTab`, one `dashboardWidget` (required by `ui.slots`, `validators/plugin.ts:859-867`). |

Deliberately **not** requested: `approvals.respond` (plugin never decides approvals), `authorization.*` (useless for tool policy, P-1), `database.namespace.*` (no own tables in v1), `agents.pause` (a hold is a blocker, not a pause; D3-3), `issue.comments.create_human_attributed`.

---

## 3. Package & manifest

### 3.1 Package **[V]**
- npm name `paperclip-plugin-agentsentry` (discovery prefix `NPM_PLUGIN_PACKAGE_PREFIX = "paperclip-plugin-"`, `plugin-loader.ts:73`). Manifest resolved from `package.json#paperclipPlugin.manifest` → `dist/manifest.js` → `manifest.js` (`plugin-loader.ts:960-990`); worker/ui from `entrypoints`.
- Location (D3-1, recommended): `agent-sentry/packages/paperclip-plugin/` inside this repo as a second workspace package. Justification: the plugin's scanner/sizer are thin proxies, but its **contracts** (tool names, event payloads, redaction rules) must move in lock-step with `src/mcp/tools/*` and the Phase 1 annotations; a monorepo lets the C3 contract tests import both sides. It is published separately (own `package.json`, own semver), so Phase 4 distribution is unaffected.
- `package.json` (plugin):
```json
{
  "name": "paperclip-plugin-agentsentry",
  "version": "0.1.0",
  "type": "module",
  "paperclipPlugin": { "manifest": "dist/manifest.js", "worker": "dist/worker.js", "ui": "dist/ui.js" },
  "peerDependencies": { "@paperclipai/plugin-sdk": "^1" },
  "files": ["dist/"]
}
```

### 3.2 Manifest literal (`src/manifest.ts`) — validated by `pluginManifestV1Schema` (`validators/plugin.ts:779-1245`) **[V]**
```ts
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agentsentry",                       // = application key (P1 §9) and Track B slug (P4); regex ^[a-z0-9][a-z0-9._-]*$  (:780)
  apiVersion: 1,
  version: "0.1.0",
  displayName: "AgentSentry Safety",
  description: "Scans task documents and comments for leaked secrets, sizes tasks for risk, holds unsafe work with blocker issues, and mirrors verdicts to AgentSentry memory.",
  author: "calabamatex",
  categories: ["automation"],              // PLUGIN_CATEGORIES (constants.ts:1304-1309)
  minimumHostVersion: "0.0.0",             // D3-4: pin once the dev instance version is known; enforcement site NOT FOUND [V]
  capabilities: [
    "events.subscribe",
    "issues.read", "issue.comments.read", "issue.documents.read", "issue.attachments.read",
    "issues.create", "issues.update", "issue.relations.write", "issue.comments.create", "issues.wakeup",
    "secrets.read-ref", "http.outbound",
    "plugin.state.read", "plugin.state.write",
    "agent.tools.register", "jobs.schedule",
    "activity.log.write", "metrics.write",
    "ui.detailTab.register", "ui.dashboardWidget.register",   // slot capabilities; the manifest validator only checks entrypoints.ui is set when ui.slots exist (validators/plugin.ts:858-866) — host-side enforcement of per-slot capabilities NOT FOUND [I — C3 manifest validation + I3 install prove the set]
  ],
  entrypoints: { worker: "dist/worker.js", ui: "dist/ui.js" },
  instanceConfigSchema: {                   // JSON Schema; validated on POST /plugins/:id/config (routes/plugins.ts:2402-2424)
    type: "object",
    required: ["agentSentryUrl", "accessKey"],
    additionalProperties: false,
    properties: {
      agentSentryUrl: { type: "string", format: "uri", description: "https://sentry-<slug>.<internal>/mcp (Phase 1 §10.7)" },
      accessKey: {                          // secret_ref binding (types/secrets.ts:35-41); legacy string refs fail closed
        type: "object", required: ["type", "secretId"],
        properties: { type: { const: "secret_ref" }, secretId: { type: "string" }, version: {} },
      },
      holdOnSeverity: { type: "string", enum: ["critical", "high"], default: "critical" },
      sizeHoldLevel:  { type: "string", enum: ["CRITICAL", "HIGH", "off"], default: "CRITICAL" },
      scanDocuments:  { type: "boolean", default: true },
      scanComments:   { type: "boolean", default: true },
      scanAttachments:{ type: "boolean", default: false },
      maxScanBytes:   { type: "integer", minimum: 1024, maximum: 1048576, default: 1048576 },
      requestTimeoutMs: { type: "integer", minimum: 1000, maximum: 30000, default: 15000 },
    },
  },
  tools: [                                  // requires agent.tools.register (validators/plugin.ts:891-899)
    { name: "scan", displayName: "AgentSentry: scan content", description: "Scan text for leaked secrets and dangerous patterns before you commit or post it.",
      parametersSchema: { type: "object", required: ["content"], properties: { content: { type: "string" }, file_path: { type: "string" } } } },
    { name: "size", displayName: "AgentSentry: size task", description: "Risk-score a task description; returns LOW/MEDIUM/HIGH/CRITICAL and a decomposition recommendation.",
      parametersSchema: { type: "object", required: ["task"], properties: { task: { type: "string" }, files: { type: "array", items: { type: "string" } } } } },
  ],
  jobs: [                                   // requires jobs.schedule (:970-978); 5-field cron
    { jobKey: "reconcile-holds", displayName: "Reconcile AgentSentry holds", description: "Re-scan held issues and release holds whose findings are gone.", schedule: "17 * * * *" },
  ],
  ui: {
    slots: [
      { type: "detailTab", id: "agentsentry-issue", displayName: "Safety", exportName: "IssueSafetyTab", entityTypes: ["issue"], order: 50 },
      { type: "dashboardWidget", id: "agentsentry-overview", displayName: "AgentSentry", exportName: "OverviewWidget", order: 50 },
    ],
  },
};
export default manifest;
```
Verb-list note: plugin tool risk is inferred **by name only** via `inferToolRisk` (`tool-gateway.ts:808-825`: destructive `delete|destroy|remove|drop|truncate|wipe|purge`; write `create|update|write|edit|patch|post|send|publish|merge|commit|apply`) **[V]**. `scan` and `size` match neither → `read`. **Never** rename them to e.g. `post-findings`.

---

## 4. Events consumed

### 4.1 Subscriptions **[V]** (`PLUGIN_EVENT_TYPES`, `constants.ts:1690-1724`; payload shapes `paperclip-research.md §1.6`)

| Event | `entityType` / ids used | Payload fields used | Handler |
| --- | --- | --- | --- |
| `issue.document.created`, `issue.document.updated` | `entityId` = issue id; `details` from activity `issue_document_*` | `payload.key` (document key) **[I — U3-2 pins the field name from a captured event]**, `payload.agentId`, `payload.runId` | `scanDocument` (§5.0) |
| `issue.comment.created` | `entityId` = issue id | `payload.commentId`, `payload.identifier`, `payload.agentId`, `payload.runId` **[V]** (`routes/issues.ts:18430-18434`) | `scanComment` |
| `issue.updated` | `entityId` = issue id | `payload.changes` / `payload.status` **[V]** (`routes/issues.ts:15057-15089`) — act only when status becomes `in_progress` | `sizeIssue` (§5.2) |
| `issue.checked_out` | `entityId` = issue id | `payload.agentId`, `payload.status` **[V]** | alternative trigger for `sizeIssue` (whichever arrives first; idempotent by `ctx.state`) |
| `agent.run.started`, `agent.run.finished`, `agent.run.failed` | `entityType:"heartbeat_run"`; `payload.{runId, agentId, issueId, status, error, errorCode}` **[V]** (`run-lifecycle.ts:1347-1381`) | | §6.3 light hooks; Phase 5 owns continuity |
| `approval.decided` | `payload.type`, `payload.requestedByAgentId`, `payload.linkedIssueIds` (approve only) **[V]** | | mirror to AgentSentry as `decision` event (§5.4) |
| `budget.incident.opened`, `budget.incident.resolved` | `entityType:"budget_incident"`; `payload.{scopeType, scopeId, amountObserved, amountLimit, approvalId?}` **[V]** | | mirror as `incident` (§5.4) — the **only** cost signal available (P-2) |

Filters: `ctx.events.on(name, fn, { companyId })` evaluates only `projectId/companyId/agentId` (`plugin-event-bus.ts:89-113`) **[V]**; wildcards are trailing `.*` only (`:56-66`). The worker subscribes once per enabled company (keyed map, §5.7), never with a bare wildcard.

### 4.2 What is **not** available **[V]**
`cost_event.created` (P-2), `activity.logged` (websocket only, `activity-log.ts:154-158`), budget approvals bypass `approval.*` (`budgets.ts:456-468`), any tool-call event (§1.2). Design must not depend on them.

---

## 5. Pipeline: fetch → scan → verdict → react

### 5.0 Fetch (two-step; events carry ids, not content — parent G-1)
```ts
// documents  (ctx.issues.documents.get(issueId, key, companyId): IssueDocument|null, sdk/types.ts:1201-1257)
const doc = await ctx.issues.documents.get(issueId, key, companyId);
const text = doc?.latestBody ?? doc?.body;      // [I — U3-2 asserts which field the SDK returns]
// comments   (ctx.issues.listComments(issueId, companyId): IssueComment[], :1582)
const comment = (await ctx.issues.listComments(issueId, companyId)).find(c => c.id === commentId);
// attachments (optional; getAttachmentContent(attachmentId, companyId, {maxBytes}): base64 bytes | null, :1654-1658)
const att = await ctx.issues.getAttachmentContent(attachmentId, companyId, { maxBytes: cfg.maxScanBytes });
```
Rules: skip `comment.authorAgentId === null && comment.authorType === "user"` unless `scanHumanComments` (D3-5); skip documents with `sourceTrust` indicating external untrusted content **only for sizing**, never for secret scanning; truncate to `maxScanBytes` and record `truncated:true` in the verdict; attachments only when `contentType` starts with `text/` or is `application/json`.

### 5.1 Secret scan → hold
```
Agent run ──▶ PUT /issues/:id/documents/plan ──▶ activity issue.document_updated ──▶ event bus
                                                                                     │ onEvent
 worker: key=state{issue,"scan:<docKey>:<revision>"} exists? ──yes──▶ drop (idempotent)
         │ no
         ├─ ctx.issues.documents.get ──▶ text
         ├─ POST <agentSentryUrl> tools/call agent_sentry_scan_security {content:text, file_path:"<identifier>/<key>", probabilistic:true}
         │        (x-agent-sentry-key; Mcp-Session-Id per company, §8.4)
         ├─ findings = parse(content[0].text)          // Phase 1 §6.2 shape
         ├─ severity ≥ cfg.holdOnSeverity ?
         │     yes ─▶ blocker = ctx.issues.create({companyId, projectId, parentId: issueId,
         │               title:"[AgentSentry] Secret detected in <identifier>/<key>",
         │               description: redactedReport,                      // §8.2
         │               priority:"critical", status:"todo",
         │               originKind:"plugin" [I — enum value NOT FOUND; U3-4 pins it], originId:"agentsentry",
         │               actor:{ pluginKey } })
         │            ctx.issues.relations.addBlockers(issueId, [blocker.id], companyId)   // :1273-1297
         │            ctx.issues.createComment(issueId, holdComment, companyId)             // :1582-1587
         │            ctx.state.set({scopeKind:"issue", scopeId:issueId, stateKey:"hold"}, {blockerId, findings:redacted, at})
         │            ctx.issues.requestWakeup(issueId, companyId, {reason:"agentsentry_hold", idempotencyKey})  // :1545-1553
         │     no  ─▶ (clean) nothing posted; verdict mirrored (§5.4) at `low`
         └─ ctx.state.set(scanKey, {verdict, at})
```
Why a blocker holds work **[V]**: checkout of a blocked issue → 422 (`services/issues.ts:11872-11889`); enqueue waits `issue_dependencies_blocked` (`heartbeat/queue.ts:3669-3725`); claim cancels a queued run (`queue.ts:1117-1138`); only `done` blockers release (`:2735-2758`). Note `requestWakeup` on a blocked issue **throws** (`plugin-host-services.ts:2370-2375`) **[V]** → the wake-up targets the **blocker** issue's assignee (the responsible human / a review agent, D3-3), not the held issue.

Release (step 7): operator marks the blocker `done` (or the reconcile job finds the secret gone on re-scan and sets `status:"done"` via `ctx.issues.update`) → readiness recomputed by Paperclip; plugin deletes `state.hold` and posts a release comment.

### 5.2 Sizing → recommendation / hold
Trigger: `issue.updated` with status → `in_progress`, or `issue.checked_out`. `task = title + "\n" + description` (+ plan document body if present) → `agent_sentry_size_task {task, files: affected_files-from-plan}` → `risk_level ∈ LOW|MEDIUM|HIGH|CRITICAL` (Phase 1 §6.3). Reaction: `MEDIUM+` → comment with factors + recommendation; `≥ cfg.sizeHoldLevel` → blocker as in §5.1 titled `[AgentSentry] Oversized task — decompose before proceeding`. Idempotency key `size:<issueId>:<updatedAt>`.

### 5.3 Approvals and budgets (mirror only)
`approval.decided` → `capture_event {event_type:"decision", severity:"low", skill:"proactive_safety", title:"Paperclip approval <type> <decision>", tags:[pc:company=,pc:agent=<requestedByAgentId>,pc:issue=…]}`; `budget.incident.opened` → `event_type:"incident", severity: thresholdType==="hard"?"high":"medium"`. No reaction inside Paperclip.

### 5.4 Mirror to AgentSentry memory
Every verdict (clean or not) → `tools/call agent_sentry_capture_event` with: `event_type: violation|decision|incident`, `severity` (max finding), `skill: proactive_safety` (scan) / `small_bets` (size), `title ≤120`, `detail` = redacted report, `affected_files: ["<identifier>/<key>"]`, `tags: ["pc:company=<id>","pc:agent=<agentId>","pc:run=<runId>","pc:issue=<issueId>","pc:project=<projectId>","src:paperclip-plugin"]`, and (after Phase 1 WI-3) `agent_id`, `session_id: runId`, `metadata.paperclip.{…}`. Never include the matched secret value (§8.2).

### 5.5 What the plugin cannot do, and the substitute
- **Cannot** escalate a gateway tool to `require_approval` (P-1). Substitute (operator runbook, WI3-7, **[I]** until I3-5): on a `critical` hold the plugin writes `ctx.activity.log({message:"AgentSentry recommends require_approval for <tool>", metadata})` and the issue tab shows a one-click **copy** of the board-API call `POST /api/companies/:companyId/tools/policies {type:"require_approval", selectors:{catalogEntryId}, priority:40}` (Phase 1 §8.4 shape). A human runs it. No plugin credential ever holds a board key.
- **Cannot** pause the agent without `agents.pause` — intentionally not requested (D3-3).
- **Cannot** scan repo content (P-7).

### 5.6 Reliability
- Event delivery is at-most-once from the plugin's perspective (errors logged, no retry, `plugin-event-bus.ts:172-198`) **[V]**. The worker therefore: (a) wraps each handler in its own retry (3 attempts, 1 s/4 s/16 s) for AgentSentry HTTP errors; (b) persists `pending:<key>` in `ctx.state` before the call and clears it after; (c) the `reconcile-holds` job (hourly) re-scans issues with `pending:*` older than 10 min and every `hold` whose blocker is not `done`.
- Concurrency: per-company semaphore of 4 in-flight AgentSentry calls (Phase 1 §14 budgets; SQLite single writer).
- Backpressure: if the per-company queue exceeds 200 pending events, drop **sizing** events (advisory) first, never secret scans; emit `agentsentry.dropped` metric.

### 5.7 Multi-company worker state
```ts
type CompanyRuntime = { cfg: PluginConfig; unsubscribe: Array<() => void>; mcpSessionId?: string; sem: Semaphore; breaker: CircuitBreaker };
const companies = new Map<string, CompanyRuntime>();
```
`onConfigChanged(newConfig, { companyId })` (`define-plugin.ts:287-290`) **[V]**: `companyId === null` → ignore (instance-level save); otherwise tear down and rebuild that company's `CompanyRuntime`. `setup(ctx)` builds nothing until the first config arrives (configs are delivered per company at `initialize`/`configChanged`; **[I]** whether all enabled companies' configs are delivered at startup — U3-6 against the SDK test harness).

---

## 6. Plugin agent tools

### 6.1 Registration **[V]** (`ctx.tools.register(name, {displayName, description, parametersSchema}, fn)`, `sdk/types.ts:1053-1057`)
```ts
ctx.tools.register("scan", decl.scan, async (params, run) => proxy(run.companyId, "agent_sentry_scan_security", { ...params, probabilistic: true }, run));
ctx.tools.register("size", decl.size, async (params, run) => proxy(run.companyId, "agent_sentry_size_task", params, run));
```
`ToolRunContext { agentId; runId; companyId; projectId }` (`:266-275`) **[V]**; `ToolResult { content?: string; data?: unknown; error?: string }` (`:282-289`) **[V]**. `proxy` returns `content` = AgentSentry's text block and `data` = parsed JSON, and mirrors the call via §5.4 with `pc:agent=run.agentId`, `pc:run=run.runId`.

### 6.2 Why these beat the Phase 1 path for attribution
Phase 1 gateway identity headers are opt-in, unsigned strings (`tool-gateway.ts:3634-3648`) and absent by default. A plugin tool receives `ToolRunContext` **from the host**, derived from the gateway session that already passed `deny_missing_agent`/`deny_run_context_mismatch` (`tool-access-policy.ts:1427-1589`) **[V]** — attribution is host-asserted, not header-asserted. Agents should prefer `agentsentry:scan`/`agentsentry:size` for advice; the Phase 1 connection remains for memory tools (`recall_context`, `search_history`, `capture_event`) and as the fallback when the plugin is disabled.

### 6.3 Governance of plugin tools **[V]**
Namespaced `agentsentry:scan` / `:size` (`plugin-tool-registry.ts:245-247`); `providerType:"paperclip_plugin"`, risk by name → `read` (§3.2 note); executed only with `session.agentId && session.runId` else 403 `agent_context_required` (`tool-gateway.ts:11209-11218`); policy evaluation identical to MCP tools, including prompt-injection result validation in `block` mode (`:11573-11701`). They have no `connectionId`/`catalogEntryId`, so the Phase 1 profile's `risk_level` entry does not cover them: WI3-5 adds two `tool_name` includes (`agentsentry:scan`, `:size`) to profile `agentsentry.default` (Phase 1 §9 step 6). Whether a default-allow profile exists out of the box is NOT FOUND (P-3) → I3-3.

### 6.4 Run-lifecycle hooks (light)
`agent.run.started {runId, agentId, issueId}` → nothing in v1 except a metric. `agent.run.finished|failed {status, error, errorCode}` → mirror as `decision`/`incident` (§5.4) so `recall_context` can surface prior failures for the same issue. Recall-on-start and handoff-on-end are Phase 5.

---

## 7. Sequence flows

### 7.1 Secret in a plan document
```
Agent ──PUT /issues/I/documents/plan (body contains AKIA…)──▶ Paperclip ──commit──▶ activity issue.document_updated
Paperclip ──onEvent {eventType:"issue.document.updated", entityId:I, payload:{key:"plan", agentId:A, runId:R}}──▶ worker
worker ──ctx.state.get(scan:plan:<rev>)──▶ null
worker ──ctx.issues.documents.get(I,"plan",C)──▶ body
worker ──POST sentry-c/mcp tools/call scan_security──▶ {findings:[{type:"aws_key",severity:"critical",line:12}]}
worker ──ctx.issues.create(blocker B, parentId:I)──▶ B
worker ──ctx.issues.relations.addBlockers(I,[B],C)──▶ activity issue.blockers_updated (→ event issue.relations.updated; worker ignores its own)
worker ──ctx.issues.createComment(I, "🔒 AgentSentry hold: 1 critical finding (aws_key, line 12). Rotate the credential, remove it from the document, then close B.")
worker ──ctx.state.set(hold)──▶ ok ; ──tools/call capture_event (redacted)──▶ event id
Agent (next wake) ──POST /issues/I/checkout──▶ 422 "Issue is blocked by unresolved blockers"   [V services/issues.ts:11872-11889]
```

### 7.2 HIGH-risk task
```
Board ──PATCH /issues/I {status:"in_progress"}──▶ event issue.updated {changes:{status}}
worker ──size_task {task:title+description}──▶ {risk_level:"HIGH", factors:[…], recommendation:"split into ≤5-file increments"}
worker ──createComment(I, "⚖ AgentSentry sizing: HIGH (score 7). Recommend: …")   (cfg.sizeHoldLevel="CRITICAL" → no blocker)
worker ──capture_event {event_type:"decision", skill:"small_bets", severity:"medium"}
```

### 7.3 AgentSentry down
```
worker ──POST sentry-c/mcp──▶ ECONNREFUSED ×3 (retry) ──▶ breaker(C) OPEN for 60 s
worker ──ctx.state.set(pending:scan:…)──▶ (reconcile job retries hourly)
worker ──ctx.metrics.write("agentsentry.upstream_down",1,{companyId})──▶
onHealth() ──▶ {status:"degraded", message:"AgentSentry unreachable for company C", details:{openBreakers:[C]}}
Nothing is held; Paperclip continues; the Phase 1 native require_approval on writes is unaffected (parent §5.1).
```

---

## 8. Security

### 8.1 Secrets
- The access key is referenced from config as `{type:"secret_ref", secretId, version?}` (`types/secrets.ts:35-41`) **[V]** and resolved per call with `ctx.secrets.resolve(cfg.accessKey, { companyId })` (`sdk/types.ts:716-719`) **[V]**; legacy string refs fail closed (`plugin-secrets-handler.ts:55-61`) **[V]**. The resolved value is held only in the request scope — never in `ctx.state`, logs, metrics, comments, or activity metadata.
- Config POST is instance-admin only (`routes/plugins.ts:2374-2485`) **[V]**; the secret belongs to the company (`:2402-2424`).

### 8.2 Redaction (applies to comments, blocker descriptions, `capture_event.detail`, activity log, metrics tags)
Report lines are `<finding.type> at line <n> (severity <s>)`. The matched text is **never** reproduced; AgentSentry's finding object carries no value (Phase 1 §6.2 shape) — C3-2 snapshot-tests the plugin's formatter against a fixture containing `AKIAIOSFODNN7EXAMPLE` and asserts the literal is absent from every outbound string.

### 8.3 Threat model
| Threat | Control |
| --- | --- |
| Prompt injection in a document/comment steering the plugin | Plugin executes no instructions from content; content goes only to `scan_security` as data; reactions are fixed templates. |
| Malicious agent spamming documents to DoS AgentSentry | per-company semaphore + breaker (§5.6); AgentSentry rate limit (Phase 1 §10.1). |
| Cross-company leakage inside one worker | `multiCompanyConfig:true` with state keyed by `companyId`; every `ctx.*` call passes the event's `companyId`; host also scopes by `PluginInvocationContext.scope.companyId` **[V]**. U3-5. |
| Plugin credential misuse | Only `secrets.read-ref` for the one key; no board key, no `approvals.respond`, no `agents.pause`. |
| Stale hold blocking work forever | reconcile job + operator can close the blocker; hold TTL metric alerts at 24 h. |
| Supply chain (npm install has no signature check, `plugin-install-guard.ts`) **[V]** | pin exact version in install runbook; publish with npm provenance; Phase 4 covers distribution catalog digest. |

### 8.4 Worker ↔ AgentSentry transport
MCP over HTTP, JSON-RPC `tools/call {name, arguments}` (same shape the gateway sends, `tool-gateway.ts:6339-6355`) **[V]**, header `x-agent-sentry-key` (Phase 1 X-7), one `Mcp-Session-Id` per company kept in `CompanyRuntime` and re-initialized on `404`/`400 Server already initialized` (Phase 1 X-8 — requires WI-2 per-session transports, else the plugin and the gateway cannot both hold sessions **[V]**). TLS via the Phase 1 ingress; the plugin's egress must be allowed by Phase 1 §10.4 network policy (**the plugin host is a second permitted source**).

---

## 9. Config, install, lifecycle

### 9.1 Install (instance admin) **[V]**
```bash
paperclipai plugin install paperclip-plugin-agentsentry --version 0.1.0     # cli/src/commands/client/plugin.ts:366-701
# or POST /api/plugins/install {"packageName":"paperclip-plugin-agentsentry","version":"0.1.0"}   (routes/plugins.ts:1178-1267)
```
Cloud-managed instances reject npm installs (403) and accept only bundled catalog paths (`:1212-1240`) **[V]** → Phase 4.

### 9.2 Per-company config
```bash
POST /api/plugins/<pluginId>/config  {"companyId":"<C>","configJson":{"agentSentryUrl":"https://sentry-acme.internal/mcp","accessKey":{"type":"secret_ref","secretId":"<SENTRY_SECRET_ID>"},"holdOnSeverity":"critical","sizeHoldLevel":"CRITICAL"}}
POST /api/plugins/<pluginId>/config/test   → worker onValidateConfig → {ok, warnings, errors}   (routes/plugins.ts:2507-2513)
```
`onValidateConfig` performs a live `GET <agentSentryUrl>/health` and a `tools/list` and returns `errors` if the 10 Phase 1 tools are not present. Enable/disable per company via `plugin_company_settings.enabled` **[V]**.

### 9.3 Upgrade
`POST /api/plugins/:id/upgrade {version}` → `upgrade_pending` when capabilities grew; operator `enable` approves (`plugin-lifecycle.ts:612-613`) **[V]**. Keep the §2.1 set stable; any addition is a minor version with a changelog line naming the capability.

### 9.4 Environment
| Var / config | Dev | Prod |
| --- | --- | --- |
| `agentSentryUrl` | `http://localhost:8787/mcp` | `https://sentry-<slug>.<internal>/mcp` |
| `accessKey` | secret_ref to dev key | secret_ref, rotated with Phase 1 §4.3 (two-key overlap) |
| `requestTimeoutMs` | 15000 | 15000 (≤ Phase 1 §14 tool budget) |
| `AGENT_SENTRY_PLUGIN_LOG_LEVEL` | debug | info |

---

## 10. Observability & SLOs
- Metrics (`ctx.metrics.write(name, value, tags)`, `sdk/types.ts:1150`) **[V]**: `agentsentry.scan.count{companyId,kind,verdict}`, `agentsentry.scan.latency_ms`, `agentsentry.hold.placed`, `agentsentry.hold.released`, `agentsentry.hold.age_hours` (gauge, max), `agentsentry.upstream_down`, `agentsentry.dropped{reason}`.
- Activity (`ctx.activity.log`, `:727-757`) **[V]**: one line per hold placed/released and per runbook recommendation (§5.5), `entityType:"issue"`.
- Logs: `ctx.logger` structured `{companyId, issueId, eventId, kind}`; never content.
- Health: `onHealth` → `ok` (all breakers closed) / `degraded` (any open) / `error` (no company configured).
- SLOs: scan p95 ≤ 30 s from event `occurredAt`; false-hold rate (holds released as not-a-secret) ≤ 2 %/month; plugin-caused Paperclip errors = 0.

---

## 11. Test plan

### 11.1 Unit (`agent-sentry/packages/paperclip-plugin/tests/`)
- U3-1 manifest validates against `pluginManifestV1Schema` (import from `@paperclipai/shared`); capability ↔ declaration cross-rules satisfied.
- U3-2 event → fetch mapping: captured fixtures of `issue.document.updated` / `issue.comment.created` (recorded from the dev instance, checked in) produce the right `documents.get`/`listComments` calls; pins the document `key` field name and the returned body field.
- U3-3 redaction: formatter never emits the fixture literal (C3-2 pair).
- U3-4 blocker creation payload matches `ctx.issues.create` input type (compile-time) and uses the pinned `originKind`.
- U3-5 two companies' events interleaved → calls use the right URL/key per company; no cross-talk (mock `ctx`).
- U3-6 `onConfigChanged` rebuilds exactly one company's runtime; `companyId:null` ignored.
- U3-7 breaker: 3 failures → open; events during open → `pending:*` state, no reactions.

### 11.2 Contract
- C3-1 plugin tool `parametersSchema` ⊆ AgentSentry `inputSchema` for `scan_security`/`size_task` (import both; fail on drift).
- C3-2 redaction snapshot (shared fixture with Phase 1 A-1c).
- C3-3 event-name list in `src/events.ts` ⊆ `PLUGIN_EVENT_TYPES` from the pinned Paperclip version.

### 11.3 Integration (Paperclip dev instance + Phase 1 instance)
- I3-1 install → `ready`; config/test → `ok`.
- I3-2 write a document containing `AKIAIOSFODNN7EXAMPLE` → within 30 s: blocker issue exists, `addBlockers` applied, comment posted, `capture_event` row in AgentSentry with no literal.
- I3-3 agent session lists `agentsentry:scan`; call without profile include → `deny_default`; with include → result (closes P-3).
- I3-4 AgentSentry stopped → document write → no blocker; health `degraded`; restart → reconcile job scans the pending item.
- I3-5 runbook recommendation appears in activity log; copied policy call creates a `require_approval` policy (operator action).

### 11.4 Acceptance (map to §1.1)
- **A3-1** (Goal 1) = I3-2 + checkout of the held issue returns 422.
- **A3-2** (Goal 2) issue with a 12-file migration description → `in_progress` → HIGH comment; with `sizeHoldLevel:"HIGH"` → blocker.
- **A3-3** (Goal 3) agent calls `agentsentry:size` → `ToolResult.data.risk_level`; gateway audit row has `agentId/runId`; mirrored event tagged `pc:run=<runId>`.
- **A3-4** (Goal 4) every verdict from A3-1..3 retrievable via `search_history {tag:"pc:issue=<id>"}` (Phase 1 WI-3).
- **A3-5** (Goal 5) = I3-4.
- **A3-6** (Goal 6) grep of Paperclip DB (`issue_comments`, `issues.description`, `activity_log`) and AgentSentry DB for the fixture literal → 0 rows.
- **A3-7 residual gap (documented, expected to FAIL-OPEN):** an agent that never writes a document/comment and never calls the plugin tools can run a secret-bearing command unobserved. Test asserts the limitation is stated in the plugin README and the issue tab.

---

## 12. Work items

| WI | Description | Area | Depends on | Blocking P3? | Est. |
| --- | --- | --- | --- | --- | --- |
| WI3-1 | Package scaffold (`paperclipai plugin init` template `default`), manifest §3.2, build to `dist/`, U3-1 | `agent-sentry/packages/paperclip-plugin/` | – | yes | S |
| WI3-2 | Worker core: multi-company runtime, MCP HTTP client (session handling, retry, breaker), config validation | same | Phase 1 WI-2 (per-session transport) | yes | M |
| WI3-3 | Handlers: document/comment scan, sizing, approval/budget mirror; redaction formatter; U3-2..7, C3-2 | same | WI3-2 | yes | M |
| WI3-4 | Reactions: blocker issue, relations, comment, wakeup, state, reconcile job | same | WI3-3 | yes | M |
| WI3-5 | Plugin tools `scan`/`size` + profile include runbook addition to Phase 1 WI-4 script; C3-1, I3-3 | same + `scripts/paperclip/` | Phase 1 WI-4 | yes | S |
| WI3-6 | UI: `IssueSafetyTab` (hold status, findings, runbook copy button via `usePluginData`/`usePluginAction`), `OverviewWidget` (counts, upstream health) | `packages/paperclip-plugin/src/ui/` | WI3-4 | should | M |
| WI3-7 | Operator runbook: escalation policy call (§5.5), install/config/rotate, hold triage | `agent-sentry/docs/paperclip-plugin.md` | – | should | XS |
| WI3-8 | Integration/acceptance suite I3/A3 in `tests/e2e/paperclip-plugin/` (docker Paperclip + Phase 1 instance) | tests | WI3-1..5 | yes | M |

Order: WI3-1 → WI3-2 → WI3-3 → WI3-4 → WI3-5 → WI3-8 → WI3-6/7.

---

## 13. Open decisions

| # | Decision | Recommendation | Closes when |
| --- | --- | --- | --- |
| D3-1 | Plugin location | in-repo package `agent-sentry/packages/paperclip-plugin/` (§3.1) | accepted here |
| D3-2 | Scan repository content (commits/PRs) | Defer. Work products expose metadata only (P-7); fetching a PR diff needs GitHub credentials the plugin should not hold. Revisit when Paperclip exposes a work-product content bridge. | Phase 5 or Paperclip change |
| D3-3 | Hold mechanism | Blocker issue, **not** `agents.pause`: scoped to one task, visible, self-documenting, releasable by closing the blocker; pause would stop unrelated work | accepted here |
| D3-4 | `minimumHostVersion` value | pin to the dev-instance version at I3-1; enforcement site NOT FOUND | I3-1 |
| D3-5 | Scan human-authored comments | default **on** (secrets pasted by humans are the common case); config `scanHumanComments` | product call |
| D3-6 | `originKind` enum value for plugin-created issues | `PluginIssueOriginKind` type exists (`sdk/types.ts:1479-1504`); literal values to be read from `constants.ts` at WI3-4 | U3-4 |
| D3-7 | Startup config delivery semantics (§5.7) | assume per-company `configChanged` after `initialize`; else enumerate via `ctx.companies.list` | U3-6 |

---

## 14. References
- Paperclip **[V]**: `packages/plugins/sdk/src/types.ts` (ctx, events, issues, state, tools), `define-plugin.ts` (hooks), `protocol.ts` (RPC), `packages/shared/src/validators/plugin.ts` (manifest), `packages/shared/src/constants.ts` (capabilities, events, categories), `server/src/services/activity-log.ts` + `plugin-event-bus.ts` (event derivation/delivery), `plugin-tool-registry.ts` + `tool-gateway.ts:11209-11701` (plugin tool governance), `routes/plugins.ts` (install/config/health), `services/issues.ts` + `heartbeat/queue.ts` (blocker semantics). **[V-doc]**: `doc/plugins/PLUGIN_SPEC.md`, `PLUGIN_AUTHORING_GUIDE.md`.
- AgentSentry **[V]**: `src/mcp/tools/{scan-security,size-task,capture-event}.ts`, Phase 1 spec §6 contracts, §12 tags.
- Research notes: `scratchpad/paperclip-research.md`, `scratchpad/agentsentry-survey.md` (2026-10-27).
