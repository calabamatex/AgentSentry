# Engineering Spec — Phase 1: AgentSentry as a Governed Paperclip MCP Connection

| | |
| --- | --- |
| **Status** | Draft v2 — implementation-ready for Phase 1 |
| **Date** | 2026-10-26 |
| **Parent** | [paperclip-integration.md](./paperclip-integration.md) (strategy & phasing; this document implements its Phase 1) |
| **Owner** | _unassigned_ |
| **AgentSentry** | v0.6.0-beta.1 (`agent-sentry/`) |
| **Paperclip** | `paperclipai/paperclip@master`, read 2026-10-26 |

**Scope.** Expose AgentSentry's tools to the agents of one Paperclip company through Paperclip's governed MCP gateway, for a **single-company / self-hosted** deployment, with correct risk classification, policy, audit, failure behavior and tenant isolation.
**Out of scope.** Shared multi-tenant AgentSentry store (Phase 2), the observe-and-react safety plugin (Phase 3), store listing (Phase 4), task↔event schema bridge (Phase 5).

**Grounding legend.** **[V]** verified in source (AgentSentry `src/`, or Paperclip `packages/shared/src/validators/tool-access.ts`, `packages/shared/src/constants.ts`, `server/src/routes/tool-access.ts`, `server/src/routes/tool-gateway.ts`). **[V-doc]** stated in Paperclip's `doc/MCP-ACCESS-GOVERNANCE.md` but not yet confirmed in route source. **[I]** inference; must be validated by the test named next to it.

---

## 0. Discrepancy log (ops doc vs. source — source wins)

These were found by reading the validators and routes rather than the operator guide. Each would have broken a doc-driven implementation.

| # | Operator doc says | Source says | Consequence |
| --- | --- | --- | --- |
| X-1 | Connection `transport: "remote_http"` | `toolConnectionTransportSchema = z.enum(["mcp_remote","rest_api","local_stdio","chat_sdk","voice"])` **[V]** | Use `"mcp_remote"`. `remote_http` is rejected by validation. |
| X-2 | Application create body shown as `{name, applicationKey}` (inferred in v1 of this spec) | `createToolApplicationSchema` requires `type ∈ ["rest_api","mcp_http","mcp_stdio","paperclip_plugin","a2a","chat"]` **[V]** | Use `type: "mcp_http"`. Resolves former D-1. |
| X-3 | Health statuses `ok/unchecked/degraded/failed/error/missing_secret` | `TOOL_CONNECTION_HEALTH_STATUSES` also includes `unknown`, `healthy` **[V]** | Health checks must treat `healthy` and `ok` as success. |
| X-4 | Risk levels `read/write/destructive` | `TOOL_RISK_LEVELS = ["low","medium","high","critical","read","write","destructive"]` **[V]** — two taxonomies coexist | Profile/policy selectors for MCP-derived entries use the `read/write/destructive` family. See §8.4. |
| X-5 | Binding scopes `company/agent/project/routine/issue` | also `gateway` **[V]** | No impact on Phase 1; documented. |
| X-6 | `tools/call` body shown as `{tool, arguments}` in the approval example | handler reads `{tool, parameters, timeoutMs?, approvedActionRequestId?, idempotencyKey?}` **[V]** | Agents/adapters must send `parameters`; `timeoutMs` and `idempotencyKey` are available and used in §5/§6. |

---

## 1. Goals, non-goals, exit criteria

### 1.1 Goals
1. Any agent in the company can call AgentSentry's **read** tools through the gateway and receive a valid result.
2. The two **write** tools are callable only within the bound scope; out-of-scope calls are denied and audited.
3. Every gateway call produces a Paperclip **Call Event** (audit) **[V-doc]**.
4. Paperclip classifies 8 read tools as `read` and 2 as `write`, with **zero** unexpected quarantine (requires WI-1).
5. An AgentSentry outage degrades *advice* only; the native hard gate (`require_approval` on writes) keeps working (§5).
6. Data from two companies can never cross (§4; Phase-1 isolation is physical, per instance).

### 1.2 Non-goals (Phase 1)
- Pre-execution content gating (impossible by Paperclip design — see parent §3 R-2).
- A shared AgentSentry instance serving multiple companies (Phase 2; blocked on WI-6).
- Structured (non-text) tool outputs — AgentSentry returns MCP `content:[{type:"text"}]` blocks **[V]**; agents parse text. A `data` channel is a later enhancement (WI-8, optional).
- Store/curated listing.

### 1.3 Exit criteria → tests
Each goal above maps 1:1 to an acceptance test in §15.4 (A-1 … A-6). Phase 1 is complete when A-1…A-6 pass against a live Paperclip instance and WI-1…WI-5 are merged.

---

## 2. System context & topology

```
                 Company A (Paperclip)                         Company B (Paperclip)
 ┌───────────────────────────────────────────┐    ┌───────────────────────────────────────────┐
 │ Agent run ──(gateway session token)──▶    │    │ Agent run ──▶                              │
 │   Paperclip MCP Gateway                   │    │   Paperclip MCP Gateway                   │
 │   • profile → policy → decision           │    │                                           │
 │   • Call Event audit                      │    │                                           │
 │   • Action Request (409 approval)         │    │                                           │
 │         │ credentialRef: Bearer <KEY_A>   │    │         │ Bearer <KEY_B>                  │
 └─────────┼─────────────────────────────────┘    └─────────┼─────────────────────────────────┘
           ▼  https (TLS), private network                   ▼
 ┌───────────────────────────┐                     ┌───────────────────────────┐
 │ AgentSentry instance A    │                     │ AgentSentry instance B    │
 │ node dist/src/mcp/server  │                     │ (separate process,        │
 │ StreamableHTTP /mcp       │                     │  separate SQLite,         │
 │ SQLite: data/A.db         │                     │  separate KEY)            │
 └───────────────────────────┘                     └───────────────────────────┘
```

**Components**
- **Paperclip MCP Gateway** — the only caller of AgentSentry. Owns profile selection, policy evaluation, approval, rate limiting, redaction and audit **[V-doc]**. Agents never talk to AgentSentry directly.
- **AgentSentry service** — one long-lived process per company running the MCP server over `StreamableHTTPServerTransport` **[V]** (`src/mcp/transport.ts::createHttpTransport`). Single replica (SQLite is single-writer **[V]**).
- **Trust boundaries** — (1) agent ↔ gateway: short-lived scoped gateway session token **[V]** (`X-Paperclip-Tool-Gateway-Token`); (2) gateway ↔ AgentSentry: static per-company Bearer key held as a Paperclip secret and injected via `credentialRefs` **[V]**; (3) AgentSentry ↔ disk: local SQLite under the instance's data dir.

**Why one instance per company (not one shared instance).** See §4.2.

---

## 3. Sequence flows

### 3.1 Bootstrap / registration (operator, once per company)
```
Operator → Paperclip: store KEY as secret                → secretId
Operator → Paperclip: POST tools/applications {type:mcp_http}  → applicationId
Operator → Paperclip: POST tools/connections {transport:mcp_remote, authKind:api_key, enabled:false} → connectionId
Operator → Paperclip: POST tool-connections/:id/health-check    → healthStatus ∈ {healthy,ok}
Operator → Paperclip: POST tool-connections/:id/catalog/refresh → discoveredCount=10, quarantinedCount=0   (needs WI-1)
Operator → Paperclip: POST tools/profiles {defaultAction:deny, entries:[read, +2 writes]} → profileId
Operator → Paperclip: POST tools/profiles/:id/bind {targetType:company}
Operator → Paperclip: POST tools/policies {require_approval, selectors:{connectionId}, conditions:{risk:{isWrite:true}}}
Operator → Paperclip: POST tools/policy/test (dry-run)          → allow (read) / require_approval (write)
Operator → Paperclip: PATCH tool-connections/:id {enabled:true, status:active}
```

### 3.2 Read tool call (happy path)
```
Agent   → Gateway : POST /tool-gateway/tools/call {tool:"agent_sentry_scan_security", parameters:{content}, timeoutMs:15000}
Gateway           : catalog status active? → profile allows? → policies (none match) → decision=allow
Gateway → Sentry  : MCP tools/call (Authorization: Bearer KEY)
Sentry  → Gateway : {content:[{type:"text", text:"..."}]}
Gateway           : write Call Event {outcome:success, reasonCode:null}
Gateway → Agent   : result
```

### 3.3 Write tool call with approval (native hard gate)
```
Agent   → Gateway : tools/call {tool:"agent_sentry_capture_event", parameters:{...}, idempotencyKey:"<uuid>"}
Gateway           : policy require_approval matches (isWrite) → opens Action Request {status:pending, argsHash, expiry}
Gateway → Agent   : JSON-RPC error {code:-32000, data:{reasonCode:"approval_required", actionRequestId}}   (HTTP 409 [V-doc])
                    (agent run is paused on this call)
Board   → Gateway : POST /tool-gateway/action-requests/:id/approve {companyId, rememberAction?:true}
Agent   → Gateway : tools/call {same tool, same parameters, approvedActionRequestId, same idempotencyKey}
Gateway           : re-validates canonical args hash == Action Request hash → executes
Gateway → Sentry  : MCP tools/call
```
`idempotencyKey` **[V]** is carried on the retry so a duplicate `capture_event` row is not produced if the first attempt partially executed (see §6.9). `rememberAction:true` **[V]** promotes the approval to a `trust_rule` so identical safe repetitions stop prompting.

### 3.4 Catalog refresh / changed-tool quarantine
```
Operator/cron → Gateway : POST tool-connections/:id/catalog/refresh
Gateway → Sentry        : MCP tools/list
Gateway                 : infer risk from annotations; NEW write/destructive tool not in prior schema → status:quarantined [V-doc]
```
Any future AgentSentry release that adds a write tool will be quarantined until an operator reviews it — this is desired. Releases must therefore update §6 and the profile (WI-4 script is idempotent).

### 3.5 AgentSentry outage
```
Gateway health-check → failed/degraded; tools/call → upstream error → Call Event {outcome:failure}
Agent read/advisory calls fail (fail-open on advice, §5.1)
Policy evaluation for writes is Paperclip-side → require_approval still returned → gate intact (§5.1)
```

---

## 4. Authentication & tenancy (resolves G-2)

### 4.1 Hop 1 — Agent → Paperclip gateway **[V]**
- Agents authenticate to the gateway with a **gateway session token** (`X-Paperclip-Tool-Gateway-Token`); `tools/call` returns **401** `"Tool gateway session token is required"` without it. Sessions are created by Paperclip (`POST /tool-gateway/sessions`) and revocable. Paperclip writes adapter MCP config pointing at named gateway endpoints with short-lived scoped tokens **[V-doc]**. **AgentSentry is not involved in this hop.**

### 4.2 Hop 2 — Paperclip → AgentSentry **[V]**
- AgentSentry auth: a single process-wide `AGENT_SENTRY_ACCESS_KEY`, compared with `timingSafeEqual`, **reject-by-default** when unset; `AGENT_SENTRY_NO_AUTH=true` disables auth (local only) (`src/mcp/auth.ts`).
- Paperclip stores the key as a secret and injects it per request via `credentialRefs: [{ placement:"header", key:"Authorization", prefix:"Bearer ", secretId }]` **[V]**. Connection fields: `authKind:"api_key"`, `credentialPolicy:"shared"` (one credential for all callers of this connection) **[V]**.
- **Decision — tenancy is enforced by instance + credential, never by a caller-asserted `companyId`.** The connection presents one identity (the company's key). AgentSentry therefore cannot and must not distinguish tenants from tool arguments. Each company gets its own process, its own `data/` SQLite file, and its own key. Cross-tenant reads are impossible because no shared store exists.
- **WI-6 (Phase 2 prerequisite, recorded here):** a shared instance requires AgentSentry to receive a **signed caller identity** it validates (e.g., a Paperclip-issued JWT carrying `companyId`/`agentId` in a header, verified against a Paperclip public key) *before* scoping any read. Plain arguments are not acceptable. Do not run a shared instance until WI-6 exists.

### 4.3 Key lifecycle
- Generate: `openssl rand -base64 48` (≥32 bytes entropy). One key per company instance.
- Store: Paperclip secret (write-only; never echoed in config/logs/API **[V-doc]**). Also in the instance's secret store/env — never in the repo or image.
- Rotate: create new secret → `PATCH tool-connections/:id {credentialRefs:[new]}` → restart instance with the new key → revoke old secret. Rotation cadence: 90 days or on suspected exposure.
- CI gate (WI-7): fail any non-local deployment profile where `AGENT_SENTRY_NO_AUTH` is set or `AGENT_SENTRY_ACCESS_KEY` is absent.

### 4.4 Threat model (Phase 1)
| Threat | Control | Residual |
| --- | --- | --- |
| Key leak → anyone can call AgentSentry | Private network only (§10.4); TLS; rotation; reject-by-default auth | A leaked key + network access = full read of that company's memory. Mitigate via WI-6 identity binding in Phase 2. |
| Agent asserts another company's identity | Not possible: instance per company, no `companyId` trust | — |
| Header injection toward AgentSentry | Paperclip refuses managed/transport header names (`Host`, `Cookie`, `Proxy-*`, `Sec-*`…) and control chars **[V-doc]** | — |
| Upstream (AgentSentry) silently adds a destructive tool | Changed-tool quarantine **[V-doc]** | Operator must review |
| Secret in tool payload (e.g., `scan_security.content`) | Content is processed in memory; `capture_event` stores only `title/detail/affected_files/tags` the caller provides; policy: never pass raw secrets into `capture_event.detail` (§12.3) | Caller discipline |
| DoS via huge `content` | `MAX_SCAN_BYTES` cap + `timeoutMs` (§14) | — |

---

## 5. Failure semantics & error taxonomy (resolves G-3)

### 5.1 Principle
**Hard enforcement never depends on AgentSentry being up.** The hard gate is Paperclip-native policy (§9 step 8) evaluated inside Paperclip. AgentSentry supplies *advice* and *memory*. Consequently:

| Tool class | AgentSentry down / timeout | Rationale |
| --- | --- | --- |
| Advisory reads (`scan_security`, `size_task`, `check_rules`, `check_context`, `check_git`) | **Fail-open on advice**: the call errors; the agent continues without the verdict | Advice is not the enforcement boundary |
| Memory reads (`recall_context`, `search_history`, `health`) | Fail-open: error returned, agent continues | Non-safety |
| Memory writes (`capture_event`, `generate_handoff`) | Fail-open: error returned; AgentSentry's circuit breaker logs the miss **[V]** (`src/observability/`) | A lost audit row must not block work |
| Native `require_approval` on writes | **Unaffected** — decided by Paperclip before any upstream call | The property this design exists for |

(Phase 3, not built here: the reactive hold defaults **fail-closed** — if a post-hoc scan errors, create the blocker.)

### 5.2 Error taxonomy (what the agent/adapter will see)
| Layer | Condition | Signal | Agent action |
| --- | --- | --- | --- |
| Gateway HTTP | missing session token | `401 {error:"Tool gateway session token is required"}` **[V]** | re-establish session |
| Gateway HTTP | `tool` missing/not string | `400 {error:'"tool" is required and must be a string'}` **[V]** | fix call |
| Gateway policy | tool quarantined/disabled | decision `deny` **[V-doc]** | do not retry; surface to operator |
| Gateway policy | not in effective profile | `deny` | — |
| Gateway policy | `block` policy | `deny` (deny beats allow) **[V]** | — |
| Gateway policy | `require_approval` | JSON-RPC error `code:-32000`, `data.reasonCode:"approval_required"`, `data.actionRequestId` **[V]**; HTTP 409 **[V-doc]** | wait; retry with `approvedActionRequestId` + same `idempotencyKey` |
| Gateway policy | `rate_limit` exceeded | decision `rate_limited` **[V]** | back off |
| Gateway policy | runtime consult | `defer_runtime` **[V]** (slots) | gateway resolves; not agent-visible in P1 |
| Upstream | AgentSentry error/timeout | JSON-RPC `code:-32603` (5xx) or `-32000` with `reasonCode:"tool_error"` **[V]**; audit outcome `failure`/`timeout` **[V]** | per §5.1 |
| AgentSentry | bad args (zod) | MCP tool error text (zod message) **[V]** (`argsSchema.parse`) | fix call |
| AgentSentry | auth fail | 401/403 at transport before MCP | operator: check secret |

Action Request statuses **[V]**: `pending → approved → executing → executed | failed`, or `rejected | expired | cancelled`. Audit outcomes **[V]**: `pending, success, failure, denied, timeout, cancelled`.

### 5.3 Timeouts
`tools/call.timeoutMs` **[V]** is the agent-side budget; AgentSentry has no per-tool server timeout today (WI-3 adds one). Budgets in §14.

---

## 6. Tool contracts

Names at the MCP boundary are prefixed `agent_sentry_` **[V]**. Input schemas are **[V]** from `src/mcp/tools/*.ts` (`inputSchema` + `argsSchema`). All tools return MCP `content:[{type:"text", text}]` **[V]**; "Returns" below describes the text payload. "Risk" is the intended Paperclip classification once WI-1 ships. `risk_score` (11th tool, experimental Level 6) is **excluded** from Phase 1: leave it `disabled` in the catalog or omit it from `tools/list` behind a flag (WI-1 option).

### 6.1 `agent_sentry_health` — read
- Input: none. Returns: store stats, chain integrity, embedding state, enablement level.
- `timeoutMs`: 5 000. Idempotent.

### 6.2 `agent_sentry_scan_security` — read (advisory)
- Input **[V]**: `{ content: string (required), file_path?: string, probabilistic?: boolean }`.
- Returns: findings list; each finding `{ type, severity ∈ critical|high|medium|low, line?, adjusted_severity?: 0..1 }` where `adjusted_severity` appears when `probabilistic:true` (context-adjusted; test-file placeholders × 0.2) **[V]**.
- Example request: `{"content":"const k='AKIAIOSFODNN7EXAMPLE'","file_path":"src/aws.ts","probabilistic":true}`
- Limits: `content` ≤ `MAX_SCAN_BYTES` (default 1 MiB, WI-3). `timeoutMs`: 15 000. Idempotent.

### 6.3 `agent_sentry_size_task` — read (advisory)
- Input **[V]**: `{ task: string (required), files?: string[] }`.
- Returns **[V]**: `risk_level ∈ LOW|MEDIUM|HIGH|CRITICAL` (score ≤2 LOW, ≤5 MEDIUM, ≤8 HIGH, else CRITICAL), contributing factors, recommendation text.
- `timeoutMs`: 5 000. Idempotent.

### 6.4 `agent_sentry_check_rules` — read (advisory, **instance-scoped**)
- Input **[V]**: `{ file_path: string (required), change_description: string (required) }`.
- Returns **[V]**: `{ violations[], compliant: boolean, rules_checked: number }` (`src/mcp/tools/check-rules.ts`).
- **Scope [V]:** `validateRules()` resolves the rules root from the *server process's* `process.cwd()` (`src/primitives/rules-validation.ts:223`, `findProjectRoot`) and loads `CLAUDE.md`/`AGENTS.md` from there (`DEFAULT_RULES_FILES`, `:48`). It never sees the calling agent's workspace. With no rules files present it returns `compliant:true, rules_checked:0` (`:227-232`) — a vacuous pass.
- **Phase 1 contract (WI-2):** the container mounts a per-company rules directory and starts the server with `cwd` = that directory (`AGENT_SENTRY_RULES_DIR`, §10.2). The rules evaluated are the **company's** standing rules, not the agent's repo. `agentInstructions` (§8.2) and the tool `description` MUST state this, and callers MUST treat `rules_checked:0` as "no verdict", never as compliance. Per-repo rules (agent workspace) are a Phase 5 item alongside D-5.
- `timeoutMs`: 5 000. Idempotent.

### 6.5 `agent_sentry_check_context` — read
- Input: per tool file (context-window estimate inputs). Returns: usage estimate. `timeoutMs`: 5 000.

### 6.6 `agent_sentry_check_git` — read
- Input: per tool file. Returns: git status / hygiene. Note: operates on the **AgentSentry instance's** working directory, not the agent's workspace — in the gateway topology this is of limited use; **include but document** (D-5).

### 6.7 `agent_sentry_recall_context` — read (memory)
- Input **[V]**: `{ query: string (required), max_results?: number, lookback_days?: number }`.
- Returns **[V]**: `"Found N relevant session(s) for: <query>"` + per-session `Summary:` and `Key events:` sections, or `"No relevant prior context found for: …"`.
- `timeoutMs`: 10 000. Perf note: linear cosine scan, ~10k-event ceiling **[V]** (§14).

### 6.8 `agent_sentry_search_history` — read (memory)
- Input **[V]** (today): `{ query: string (required), limit?: number, event_type?: enum, severity?: enum, since?: string }`.
- Input **(after WI-3)**: adds `tag?: string` — exact-match against the event's `tags` array.
- **Why [V]:** with the Phase 1 default (`noop` embeddings) `MemoryStore.search()` falls through to `provider.textSearch()` (`src/memory/store.ts:175`), whose SQLite implementation matches `query` against **`title` and `detail` only** (`src/memory/providers/sqlite-provider.ts:342`). The provider already supports `QueryOptions.tag` via `json_each(tags)` (`sqlite-provider.ts:353`, `src/memory/schema.ts:47`), but neither `MemoryStore.search()` nor the tool forwards it. A query for `pc:run=<id>` therefore returns nothing unless the id also appears in `title`/`detail`. WI-3 wires `tag` through tool → store → `textSearch`/`query` (and `vectorSearch`, which must be checked for `tag` support when embeddings are enabled).
- Returns: matching audit events. `timeoutMs`: 10 000.

### 6.9 `agent_sentry_capture_event` — **write** (memory)
- Input **[V]**: `{ event_type: enum (required), severity: enum (required), skill: enum (required), title: string (required, ≤120), detail: string (required), affected_files?: string[], tags?: string[] }`. Enums are AgentSentry's `EVENT_TYPES`, `SEVERITIES`, `SKILLS` **[V]**.
- Returns: confirmation text with the event id (hash-chained row).
- **Idempotency (required for the 409 retry path, §3.3):** the agent sends `idempotencyKey` on `tools/call` **[V]**; Paperclip de-duplicates at the gateway. Additionally (WI-3) AgentSentry treats `tags` containing `idem:<key>` as a dedupe hint within 24 h. **[I — validate in A-2b]**
- Phase-1 correlation convention (§12.1): callers add tags `pc:company=<id>`, `pc:agent=<id>`, `pc:run=<id>`.
- `timeoutMs`: 5 000.

### 6.10 `agent_sentry_generate_handoff` — **write** (memory)
- Input: per tool file. Returns: structured handoff text; records a handoff event. `timeoutMs`: 10 000.

---

## 7. WI-1 — Emit MCP annotations (blocking)

**Problem [V].** `src/mcp/server.ts` registers tools as `{name, description, inputSchema}` and `tools/list` returns exactly those; `grep -rni annotation src/mcp/` is empty. Paperclip infers catalog risk from `annotations.readOnlyHint / writeHint / destructiveHint` **[V-doc]**; absent annotations fall to a schema heuristic that is unreliable and will treat ambiguous tools as `write` (approval/quarantine), breaking Goal 4.

**Change.**
1. `src/mcp/server.ts` — extend the `ToolDefinition` interface with `annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }` and include `annotations: tool.annotations` in the `tools/list` mapping.
2. Each tool module exports `annotations`:
   - read tools (§6.1–6.8): `{ readOnlyHint: true, idempotentHint: true }`
   - `capture_event`, `generate_handoff`: `{ readOnlyHint: false, destructiveHint: false }`
   - `risk_score`: omitted from `tools/list` unless `AGENT_SENTRY_EXPOSE_EXPERIMENTAL=true` (default off).
3. Backward compatibility: annotations are additive; stdio clients ignore them.

**Tests.** Unit: `tools/list` contains 10 entries; 8 with `readOnlyHint:true`, 2 with `readOnlyHint:false`, none with `destructiveHint:true`; `risk_score` absent by default. Contract: `tests/contracts/doc-contracts.test.ts` tool-count assertion still passes (10). Integration (A-4): Paperclip `catalog/refresh` → `discoveredCount:10, quarantinedCount:0`; `GET tool-connections/:id/catalog` shows 8×`read`, 2×`write`.

---

## 8. Paperclip resource model & payload contracts **[V]**

### 8.1 Application — `POST /api/companies/:companyId/tools/applications`
`createToolApplicationSchema`:
| field | type | req | value for AgentSentry |
| --- | --- | --- | --- |
| `name` | string 1–160 | ✓ | `"AgentSentry"` |
| `type` | `rest_api\|mcp_http\|mcp_stdio\|paperclip_plugin\|a2a\|chat` | ✓ | `"mcp_http"` |
| `applicationKey` | string 1–160, safe key pattern | – | `"agentsentry"` |
| `description` | ≤4000 | – | short blurb |
| `status` | `draft\|active\|disabled\|archived` | – | omit (default) |
| `pluginId`, `ownerAgentId`, `ownerUserId`, `metadata` | – | – | omit |

### 8.2 Connection — `POST /api/companies/:companyId/tools/connections`
`createToolConnectionSchema`:
| field | type | req | value |
| --- | --- | --- | --- |
| `applicationId` | guid | one of | from 8.1 |
| `name` | string | ✓ | `"AgentSentry (company <X>)"` |
| `connectionPurpose` | `tool\|channel` (default `tool`) | – | `"tool"` |
| `transport` | `mcp_remote\|rest_api\|local_stdio\|chat_sdk\|voice` | – | **`"mcp_remote"`** (X-1) |
| `authKind` | `oauth\|api_key\|none` (default `none`) | – | **`"api_key"`** |
| `credentialPolicy` | `shared\|per_user\|per_user_with_fallback\|per_agent` | – | `"shared"` |
| `ownership` | default `customer` | – | default |
| `connectionKind` | `managed` | – | default |
| `transportConfig` | record (sensitive keys rejected) | – | `{ "url": "https://<host>/mcp", "headers": [] }` |
| `credentialRefs[]` | `{name, secretId(guid), version?, placement: header\|env\|url, key, prefix?}` | – | `[{"name":"Authorization","secretId":"<id>","placement":"header","key":"Authorization","prefix":"Bearer "}]` |
| `enabled` | boolean | – | `false` at create |
| `agentInstructions` | nullable | – | optional usage hints shown to agents (recommended: when to call `scan_security`/`size_task`) |

Response projection (doc): `{id, name, transport, status, enabled, healthStatus}`. Statuses **[V]**: connection `draft|active|disabled|archived`; health `unknown|healthy|degraded|failed|unchecked|ok|error|missing_secret`.

Lifecycle routes **[V]**: `GET /tool-connections/:id`, `POST /tool-connections/:id/health-check` **[V-doc]**, `POST /tool-connections/:id/catalog/refresh`, `GET /tool-connections/:id/catalog`, `PATCH /tool-connections/:id` (`updateToolConnectionSchema`, partial), `GET/PUT /tool-connections/:id/grants`.

### 8.3 Profile (+entries) — `POST /api/companies/:companyId/tools/profiles` (`createToolProfileWithEntriesSchema`)
| field | type | value |
| --- | --- | --- |
| `profileKey` | safe key | `"agentsentry.default"` |
| `name` | string | `"AgentSentry default"` |
| `defaultAction` | `deny\|allow` (default `deny`) | `"deny"` |
| `status` | default `active` | – |
| `entries[]` | `{selectorType: application\|connection\|catalog_entry\|tool_name\|risk_level, effect: include\|exclude (default include), toolName?, riskLevel?, connectionId?, applicationId?, catalogEntryId?, conditions?}` | see §9 step 6 |

Binding — `POST /api/companies/:companyId/tools/profiles/:profileId/bind` **[V-doc]** with `createToolProfileBindingForProfileSchema` **[V]**: `{ targetType: company|agent|project|routine|issue|gateway, targetId: string, priority: 0..10000 (default 100), metadata? }`. Narrowest scope wins: `issue > routine > agent > project > company` **[V-doc]**. Effective preview: `GET /companies/:companyId/tools/profiles/effective/agents/:agentId` → `{profileIds, allowedToolNames}` **[V]**.

### 8.4 Policy — `POST /api/companies/:companyId/tools/policies` (`createToolPolicySchema`)
| field | type | notes |
| --- | --- | --- |
| `name` | string | |
| `policyType` | `allow\|block\|require_approval\|trust_rule\|rate_limit` | |
| `priority` | int 0..10000 (default 100) | lower evaluated first **[I — confirm ordering in test A-2]** |
| `enabled` | bool (default true) | |
| `selectors` | record | e.g. `{ "connectionId": "<id>" }`, `{ "toolName": "agent_sentry_capture_event" }` |
| `conditions` | strict object, ≥1 group | `risk: {levels?, max?, isWrite?, isDestructive?}`, `actor`, `args`, `context`, `trustBoundary: {remoteHttpOnly?, applicationKey?, …}`, `timeWindow`, `credentialScope` |
| `config` | record | rate-limit window etc. |

Evaluation order **[V-doc]**: catalog status → profile → policies by priority (`block` short-circuits; `require_approval` short-circuits to an Action Request; `rate_limit` counts) → `allow`. Decisions **[V]**: `allow|deny|require_approval|rate_limited|defer_runtime`.
Dry-run **[V]**: `POST /companies/:companyId/tools/policy/test` with `{companyId, actor:{actorType:"agent", actorId, agentId}, request:{toolName, arguments}}` → `.decision.decision`.
**Risk taxonomy note (X-4):** `riskLevel` accepts both `low|medium|high|critical` and `read|write|destructive`. MCP-discovered entries carry the latter; use `read|write|destructive` (or `conditions.risk.isWrite`) for this connection.

### 8.5 Gateway call & approval **[V]**
- `POST /tool-gateway/tools/call` body `{ tool: string, parameters?: object, timeoutMs?: number, approvedActionRequestId?: string, idempotencyKey?: string }`, header `X-Paperclip-Tool-Gateway-Token`.
- `POST /tool-gateway/action-requests/:id/approve` body `{ companyId: string (required), rememberAction?: boolean }` — board actor only; `/decline` likewise.
- `GET /companies/:companyId/tools/action-requests`, `GET /tool-gateway/audit` (filterable by `reasonCode`).

---

## 9. Registration runbook (idempotent; WI-4 ships this as a script)

Pre-set `PAPERCLIP_URL`, `BOARD_API_KEY`, `COMPANY_ID`, `SENTRY_URL` (e.g. `https://sentry-<company>.internal/mcp`). Every step asserts; re-running must be a no-op (look up by `applicationKey` / connection `name` / `profileKey` first).

```sh
H=(-H "Authorization: Bearer $BOARD_API_KEY" -H "Content-Type: application/json")

# 1. Secret (UI or secrets API) → SENTRY_SECRET_ID (guid). Value = the instance's AGENT_SENTRY_ACCESS_KEY.

# 2. Application (type REQUIRED — X-2)
APP=$(curl -fsS -X POST "${H[@]}" "$PAPERCLIP_URL/api/companies/$COMPANY_ID/tools/applications" -d '{
  "name":"AgentSentry","applicationKey":"agentsentry","type":"mcp_http",
  "description":"Content-aware safety + memory tools (secret scan, risk scoring, rules, recall)"}')
APPLICATION_ID=$(jq -r .id <<<"$APP")

# 3. Connection (transport mcp_remote — X-1; api_key auth; disabled at create)
CONN=$(curl -fsS -X POST "${H[@]}" "$PAPERCLIP_URL/api/companies/$COMPANY_ID/tools/connections" -d '{
  "applicationId":"'"$APPLICATION_ID"'","name":"AgentSentry (remote)",
  "transport":"mcp_remote","authKind":"api_key","credentialPolicy":"shared",
  "transportConfig":{"url":"'"$SENTRY_URL"'","headers":[]},
  "credentialRefs":[{"name":"Authorization","secretId":"'"$SENTRY_SECRET_ID"'","placement":"header","key":"Authorization","prefix":"Bearer "}],
  "enabled":false}')
CONNECTION_ID=$(jq -r .id <<<"$CONN")

# 4. Health — assert healthy|ok (X-3)
curl -fsS -X POST "${H[@]}" "$PAPERCLIP_URL/api/tool-connections/$CONNECTION_ID/health-check" -d '{}' \
 | jq -e '.connection.healthStatus|IN("healthy","ok")' >/dev/null

# 5. Catalog — assert 10 discovered, 0 quarantined (needs WI-1)
curl -fsS -X POST "${H[@]}" "$PAPERCLIP_URL/api/tool-connections/$CONNECTION_ID/catalog/refresh" -d '{}' \
 | jq -e '.discoveredCount==10 and .quarantinedCount==0' >/dev/null
curl -fsS "${H[@]}" "$PAPERCLIP_URL/api/tool-connections/$CONNECTION_ID/catalog" \
 | jq -e '[.[]|select(.riskLevel=="read")]|length==8' >/dev/null

# 6. Profile: default-deny; include all read entries on THIS connection + the two writes
PROF=$(curl -fsS -X POST "${H[@]}" "$PAPERCLIP_URL/api/companies/$COMPANY_ID/tools/profiles" -d '{
  "profileKey":"agentsentry.default","name":"AgentSentry default","defaultAction":"deny",
  "entries":[
    {"selectorType":"risk_level","riskLevel":"read","connectionId":"'"$CONNECTION_ID"'","effect":"include"},
    {"selectorType":"tool_name","toolName":"agent_sentry_capture_event","effect":"include"},
    {"selectorType":"tool_name","toolName":"agent_sentry_generate_handoff","effect":"include"}]}')
PROFILE_ID=$(jq -r .id <<<"$PROF")

# 7. Bind to the company (priority 10 → outranks default 100)
curl -fsS -X POST "${H[@]}" "$PAPERCLIP_URL/api/companies/$COMPANY_ID/tools/profiles/$PROFILE_ID/bind" \
 -d '{"targetType":"company","targetId":"'"$COMPANY_ID"'","priority":10}' >/dev/null

# 8. NATIVE HARD GATE — require approval for every write on this connection (D-3: ship in Phase 1)
curl -fsS -X POST "${H[@]}" "$PAPERCLIP_URL/api/companies/$COMPANY_ID/tools/policies" -d '{
  "name":"AgentSentry writes require approval","policyType":"require_approval","priority":50,
  "selectors":{"connectionId":"'"$CONNECTION_ID"'"},
  "conditions":{"risk":{"isWrite":true}}}' >/dev/null

# 9. Dry-run decisions (no real call)
T() { curl -fsS -X POST "${H[@]}" "$PAPERCLIP_URL/api/companies/$COMPANY_ID/tools/policy/test" -d '{
  "companyId":"'"$COMPANY_ID"'","actor":{"actorType":"agent","actorId":"'"$AGENT_ID"'","agentId":"'"$AGENT_ID"'"},
  "request":{"toolName":"'"$1"'","arguments":'"$2"'}}' | jq -r .decision.decision; }
[ "$(T agent_sentry_scan_security '{"content":"x"}')" = allow ]
[ "$(T agent_sentry_capture_event '{"event_type":"decision","severity":"low","skill":"save_points","title":"t","detail":"d"}')" = require_approval ]
[ "$(T agent_sentry_risk_score '{}')" = deny ]      # not in catalog / not in profile

# 10. Enable
curl -fsS -X PATCH "${H[@]}" "$PAPERCLIP_URL/api/tool-connections/$CONNECTION_ID" \
 -d '{"enabled":true,"status":"active"}' | jq -e '.enabled==true and .status=="active"' >/dev/null
```

Rollback (§16): step 10 with `{"enabled":false,"status":"disabled"}` — preserves audit history **[V-doc]**.

---

## 10. Deployment

### 10.1 Process
- Entrypoint: `node dist/src/mcp/server.js --transport http --port 8787` (flag names per current CLI; WI-2 confirms/adds). Transport: `createHttpTransport(port)` → `StreamableHTTPServerTransport`; `port 0` = random **[V]**; health endpoint returns `{status:"ok", transport:"http"}` **[V]**.
- One container per company. Image built from `agent-sentry/` (`npm ci && npm run build`), runtime deps only, non-root user, read-only FS except `data/`.
- Embeddings: default `noop` (text search) **[V]**; optional ONNX model dir or Ollama/OpenAI provider via `agent-sentry.config.json` **[V]**. Phase 1 default: noop.

### 10.2 Environment matrix
| Var | Dev | Staging / Prod | Source |
| --- | --- | --- | --- |
| `AGENT_SENTRY_ACCESS_KEY` | any | **required**, ≥32 B random, unique per company | `src/mcp/auth.ts` **[V]** |
| `AGENT_SENTRY_NO_AUTH` | `true` ok | **must be unset** (WI-7 gate) | **[V]** |
| `AGENT_SENTRY_CORS_ORIGIN` | `http://localhost` (default) | Paperclip origin | `transport.ts` **[V]** |
| `AGENT_SENTRY_EXPOSE_EXPERIMENTAL` | – | unset (hides `risk_score`) | WI-1 |
| `AGENT_SENTRY_MAX_SCAN_BYTES` | – | `1048576` | WI-3 |
| `AGENT_SENTRY_TOOL_TIMEOUT_MS` | – | `15000` | WI-3 |
| `AGENT_SENTRY_RULES_DIR` | – | `/rules` (mounted; holds the company's `CLAUDE.md`/`AGENTS.md`; server `cwd` set here) | WI-2, §6.4 |
| `agent-sentry.config.json` → `memory.max_events`, `max_age_days` | – | e.g. 50 000 / 90 | auto-prune **[V]** |

### 10.3 TLS & ingress
- Terminate TLS at a reverse proxy (nginx/Caddy/ingress) in front of `:8787`; Paperclip connects to `https://…/mcp`. Proxy forwards `Authorization` unchanged; strips hop-by-hop headers.
- Timeouts at proxy ≥ max `timeoutMs` (§14) to avoid proxy-side 504 masking.

### 10.4 Network policy
- Ingress allowed **only** from the Paperclip deployment's egress IPs / security group / service mesh identity. No public exposure. Egress from AgentSentry: none required (noop embeddings); allow only the embedding provider if configured.

### 10.5 Health & readiness
- Liveness: `GET /health` → 200 `{status:"ok"}` **[V]**. Readiness: same + SQLite open check (WI-2). Paperclip's `health-check` is the external probe.

### 10.6 Sizing (Phase 1 baseline)
- 1 vCPU / 512 MiB; SQLite on persistent volume; recall latency governed by event count (§14). Revisit at Phase 2.

### 10.7 Host/naming convention (D-2 — proposal)
- One hostname per company: `sentry-<companySlug>.<internal-domain>` → path `/mcp`. Keeps `transportConfig.url` stable across restarts and makes per-company network policy trivial.

---

## 11. Observability, audit & SLOs

- **Paperclip side [V]:** every call → Call Event with decision, matched policy ids, `reasonCode`, outcome (`success|failure|denied|timeout|cancelled`), args hash. Query via `GET /tool-gateway/audit` and `GET /companies/:id/tools/action-requests`.
- **AgentSentry side [V]:** structured logger (module/operation/error type), circuit breaker, health/metrics endpoints (`src/observability/`). WI-3 adds per-tool counters: calls, errors, p50/p95 latency, scan bytes, findings by severity.
- **Correlation:** Phase 1 uses tags on `capture_event` (§12.1). Phase 5 replaces with first-class fields.
- **SLOs (Phase 1):** advisory path availability ≥ 99.0 % monthly (fail-open, so this is a *quality* SLO, not a safety one); `scan_security` p95 ≤ 2 s at 256 KiB; `recall_context` p95 ≤ 1.5 s at ≤10k events; hard-gate correctness = 100 % (every write → `require_approval` in audit; alert on any write with outcome `success` and no approved Action Request).

---

## 12. Data contracts

### 12.1 Correlation convention (Phase 1)
`capture_event.tags` MUST include `pc:company=<companyId>`, `pc:agent=<agentId>`, and SHOULD include `pc:run=<runId>`, `pc:issue=<issueId>` when known.

**Retrieval:** correlation is by the `tag` filter on `search_history` (§6.8, shipped in WI-3), e.g. `{"query":"","tag":"pc:run=<runId>"}` — exact match on a tag value. Free-text `query` does **not** search tags **[V]** (`sqlite-provider.ts:342`), so until WI-3 lands there is no supported way to retrieve by correlation id; do not rely on it before U-5 passes. (Phase 5 promotes these to schema fields per `docs/memory-schema.md`.)

### 12.2 Storage
- Hash-chained event rows, incremental chain verification, auto-prune by `max_events`/`max_age_days` **[V]**. Retention default: 90 days or 50k events (configurable).
- Each company's DB is a separate file; backup = volume snapshot; no cross-DB joins exist.

### 12.3 Content policy
- `scan_security.content` is processed in memory and **not persisted**. Findings persisted via `capture_event` must contain **redacted** references (file + line + finding type), never the secret value. Enforced by caller guidance in `agentInstructions` (§8.2) and tested in A-1c.

---

## 13. Security hardening checklist (consolidates G-4)

- [ ] `AGENT_SENTRY_ACCESS_KEY` set, ≥32 B, unique per company; `AGENT_SENTRY_NO_AUTH` unset (CI gate WI-7).
- [ ] TLS in front; proxy forwards `Authorization`; HSTS.
- [ ] Ingress restricted to Paperclip egress; no public route.
- [ ] Container non-root, read-only FS except `data/`; image scanned; `npm audit --omit=dev --audit-level=high` green in CI (already enforced).
- [ ] `MAX_SCAN_BYTES` and per-tool timeout configured (WI-3).
- [ ] Key rotation runbook tested once (§4.3).
- [ ] Secret never appears in logs (grep CI logs for the key prefix during A-tests).
- [ ] Changed-tool quarantine verified by adding a dummy write tool in a test build (A-4b).

---

## 14. Performance budgets (resolves G-5)

| Tool | `timeoutMs` (agent) | Server cap (WI-3) | Payload cap | Note |
| --- | --- | --- | --- | --- |
| `health` | 5 000 | 4 000 | – | |
| `scan_security` | 15 000 | 12 000 | `MAX_SCAN_BYTES` 1 MiB | regex-based; linear in bytes |
| `size_task` | 5 000 | 4 000 | `task` ≤ 16 KiB | |
| `check_rules` | 5 000 | 4 000 | – | reads CLAUDE.md/AGENTS.md on instance |
| `recall_context` | 10 000 | 8 000 | – | O(n) cosine, ≤10k events **[V]**; enforce `max_events` |
| `search_history` | 10 000 | 8 000 | – | FTS |
| `capture_event` | 5 000 | 4 000 | `detail` ≤ 32 KiB | |
| `generate_handoff` | 10 000 | 8 000 | – | |

Proxy/ingress timeout ≥ 20 s. Gateway `timeoutMs` wins when smaller.

---

## 15. Test plan

### 15.1 Unit (AgentSentry repo, `tests/mcp/`)
- U-1 `tools/list` emits annotations per §7 (8 read / 2 write / 0 destructive); `risk_score` hidden by default, shown with `AGENT_SENTRY_EXPOSE_EXPERIMENTAL=true`.
- U-2 auth: no header → reject; wrong key → reject; right key → accept; `NO_AUTH=true` → accept + warning (existing tests extended).
- U-3 limits: `content` > `MAX_SCAN_BYTES` → structured error; tool exceeding server cap → timeout error.
- U-4 `capture_event` idempotency hint (`idem:<key>` within 24 h) → single row.
- U-5 `search_history` with `tag:"pc:run=r1"` returns only events tagged `pc:run=r1` (noop embeddings path); same query without `tag` and with the id only in `tags` returns nothing (documents §6.8).
- U-6 `check_rules` with an empty rules dir → `rules_checked:0`; with `AGENT_SENTRY_RULES_DIR` containing a `CLAUDE.md` rule → that rule is evaluated, not the repo's.

### 15.2 Contract
- C-1 `tests/contracts/doc-contracts.test.ts` tool count = 10 (unchanged).
- C-2 `tools/list` JSON shape snapshot (name, description, inputSchema, annotations) — guards accidental churn that would trigger Paperclip quarantine.

### 15.3 Integration (live Paperclip dev instance; harness = run Paperclip's bundled `safe-read-only-todo-kv` install+smoke first to validate the environment, then run §9)
- I-1 §9 steps 2–5 succeed; `discoveredCount==10 && quarantinedCount==0`; catalog shows 8 `read` / 2 `write`.
- I-2 effective profile for a test agent lists exactly the 10 tool names.
- I-3 dry-run: read → `allow`; `capture_event` → `require_approval`; `risk_score` → `deny`.

### 15.4 Acceptance (map to §1.1 goals)
- **A-1** (Goal 1) Agent calls each read tool via `tools/call` → text result; audit outcome `success`. **A-1c:** `scan_security` with fixture `AKIAIOSFODNN7EXAMPLE` returns a `critical` finding; nothing containing the literal is persisted.
- **A-1d** `capture_event` tagged `pc:run=<runId>` → `search_history {tag:"pc:run=<runId>"}` returns it through the gateway.
- **A-2** (Goal 2) `capture_event` → `approval_required` + `actionRequestId`; approve with `{companyId}`; retry with `approvedActionRequestId` + same `idempotencyKey` → `executed`; **A-2b** retry twice → exactly one event row; **A-2c** agent outside the bound scope → `deny` + audited.
- **A-3** (Goal 3) For every call in A-1/A-2 a Call Event exists in `GET /tool-gateway/audit` with the expected decision/outcome.
- **A-4** (Goal 4) Catalog classification 8/2/0. **A-4b** deploy a test build adding a dummy write tool → `catalog/refresh` quarantines it (`status:"quarantined"`).
- **A-5** (Goal 5) Stop the AgentSentry container → read call fails (audit `failure`/`timeout`); `capture_event` still yields `approval_required` (policy is Paperclip-side). Restart → recovers without operator action.
- **A-6** (Goal 6) Two companies, two instances: events captured in A never appear in B's `search_history`/`recall_context`; B's key rejected by A's instance.

### 15.5 Chaos / negative
- N-1 proxy timeout < `timeoutMs` → observe 504 masking; fix per §10.3.
- N-2 secret rotation mid-traffic → ≤1 failed window; no 5xx after restart.

---

## 16. Rollout & rollback

- **Staged enable:** bind profile to a single **test agent** first (`targetType:"agent"`, priority 5), run A-1…A-5, then bind company-wide.
- **Feature flags:** `AGENT_SENTRY_EXPOSE_EXPERIMENTAL` (risk_score), `enabled` on the connection.
- **Rollback:** `PATCH tool-connections/:id {enabled:false,status:"disabled"}` — agents lose the tools immediately; audit retained **[V-doc]**. Full removal: delete binding, profile, policy, connection, application. AgentSentry data untouched.

---

## 17. Work items

| WI | Description | Area | Depends on | Blocking P1? | Est. |
| --- | --- | --- | --- | --- | --- |
| WI-1 | Emit MCP annotations; hide `risk_score` by default; U-1, C-2 | `src/mcp/server.ts`, `src/mcp/tools/*` | – | **yes** | S |
| WI-2 | HTTP entrypoint flags, readiness probe, Dockerfile, non-root image, `AGENT_SENTRY_RULES_DIR` mount + `cwd` (§6.4); U-6 | `src/cli`, `deploy/` | – | yes | S |
| WI-3 | Server-side per-tool timeout, `MAX_SCAN_BYTES`, `capture_event` idempotency hint, **`search_history.tag` plumbing (tool → `MemoryStore.search` → provider)**, per-tool metrics; U-3, U-4, U-5 | `src/mcp/tools/*`, `src/memory/store.ts`, `src/observability/` | – | yes | M |
| WI-4 | Idempotent registration script implementing §9 (+ teardown) | `scripts/paperclip/` | WI-1 | yes | S |
| WI-5 | Integration + acceptance suite §15.3–15.5 against a Paperclip dev instance (docker) | `tests/e2e/paperclip/` | WI-1..4 | yes | M |
| WI-7 | CI gate: fail if `NO_AUTH` set / key absent in non-local profiles; secret-in-logs grep | `.github/workflows/ci.yml` | – | should | XS |
| WI-8 | (optional) structured `data` alongside text in tool results | `src/mcp/tools/*` | – | no | S |
| WI-6 | (Phase 2) signed caller-identity validation for a shared instance | `src/mcp/auth.ts` | Paperclip issuing identity | deferred | L |

Suggested order: WI-1 → WI-2 → WI-3 → WI-4 → WI-7 → WI-5.

---

## 18. Open decisions

| # | Decision | Recommendation | Closes when |
| --- | --- | --- | --- |
| D-2 | Per-company host/path convention | `sentry-<slug>.<internal>/mcp` (§10.7) | ops sign-off |
| D-3 | Ship `require_approval` on writes in Phase 1 | **Yes** — expressible cleanly via `conditions.risk.isWrite` + `selectors.connectionId`; it *is* the hard gate | accepted here |
| D-4 | Catalog risk inference mapping | Assumed `readOnlyHint→read`, `readOnlyHint:false/writeHint→write`, `destructiveHint→destructive` **[V-doc]**; the inference code was not located in source | I-1 / A-4 pass |
| D-5 | Include `check_git` / `check_context` / `check_rules` (instance-local semantics) | Include; `check_rules` evaluates the mounted company rules dir (§6.4), `check_git` the instance; all documented as instance-scoped; per-workspace semantics in Phase 5 | product call |
| D-6 | Policy `priority` ordering direction (lower first?) | assumed lower-first | A-2 / I-3 |

Former D-1 (application route body) is **resolved** by X-2.

---

## 19. References
- Paperclip **[V]**: `packages/shared/src/validators/tool-access.ts` (all request schemas), `packages/shared/src/constants.ts` (enums), `server/src/routes/tool-access.ts` (applications/connections/catalog/profiles/policies/policy-test routes), `server/src/routes/tool-gateway.ts` (`tools/call`, approve/decline, audit, sessions), `server/src/services/plugin-event-bus.ts` (Phase 3 payload shape). **[V-doc]**: `doc/MCP-ACCESS-GOVERNANCE.md`, `doc/connections/GENERIC-REMOTE-MCP.md`.
- AgentSentry **[V]**: `src/mcp/server.ts`, `src/mcp/transport.ts`, `src/mcp/auth.ts`, `src/mcp/tools/{scan-security,size-task,capture-event,recall-context,search-history,check-rules}.ts`, `src/observability/`, `README.md`, `docs/memory-schema.md`.
