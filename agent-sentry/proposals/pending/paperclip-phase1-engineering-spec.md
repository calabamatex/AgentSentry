# Engineering Spec — Phase 1: AgentSentry as a governed Paperclip MCP Connection

- **Status:** Draft — implementation-ready for Phase 1 only
- **Date:** 2026-10-26
- **Parent:** [paperclip-integration.md](./paperclip-integration.md) (strategy spec; this doc implements its Phase 1)
- **Scope:** Stand up AgentSentry as a `remote_http` MCP connection governed by Paperclip, for a **single company / self-hosted** deployment. Out of scope: shared multi-tenant store (Phase 2), the safety plugin (Phase 3), store listing (Phase 4).

> Legend: **[V]** verified against source · **[I]** inferred/assumption to validate in implementation · **WI-n** work item.

---

## 1. Goal & exit criteria

Expose AgentSentry's 10 tools to a Paperclip company's agents through Paperclip's MCP gateway, with correct risk classification, policy, audit, and tenant isolation.

**Phase 1 is done when all hold (each maps to an acceptance test in §10):**
1. A Paperclip agent can call every AgentSentry **read** tool and receives a valid result.
2. `capture_event` / `generate_handoff` (writes) are allowed only for the bound agent scope; a call outside scope is denied and audited.
3. Every gateway call produces a **Call Event** in Paperclip's audit log.
4. Catalog classifies the 8 read tools as `read` and the 2 writes as `write` (requires WI-1).
5. AgentSentry downtime degrades **advice** only; it never disables Paperclip's native hard gate (§4).
6. Two companies' data never cross (§3; Phase-1 isolation is per-instance).

## 2. Topology & deployment

```
Company A                              Company B
Paperclip (gateway) ──┐                Paperclip (gateway) ──┐
                      ▼                                      ▼
  AgentSentry instance A                 AgentSentry instance B
  (own process, own SQLite,              (own process, own SQLite,
   own ACCESS_KEY)                        own ACCESS_KEY)
```

- AgentSentry runs as a long-lived HTTP service: `node dist/src/mcp/server.js` with `StreamableHTTPServerTransport` **[V]** (`src/mcp/transport.ts`).
- **One AgentSentry instance per Paperclip company** in Phase 1 (see §3). Container image; single replica acceptable for Phase 1 (store is single-writer SQLite **[V]**).
- Network: reachable **only** from the Paperclip deployment's egress (private network / security group), never public (G-4). TLS terminated in front of the service; Paperclip connects over `https`.

## 3. Auth & tenancy — resolves G-2

**Decision: isolate by instance + credential, not by caller-asserted `companyId`.**

Rationale **[V]**: Paperclip authenticates to an upstream MCP connection with one stored credential ref (`credentialRefs[].secretId`, `MCP-ACCESS-GOVERNANCE.md` §Create a connection) and connections are created under a specific company (`/api/companies/$COMPANY_ID/tools/connections`). AgentSentry's auth is a single global `AGENT_SENTRY_ACCESS_KEY`, reject-by-default **[V]** (`src/mcp/auth.ts`). Therefore AgentSentry cannot distinguish tenants from the connection alone, and **must not** trust a `companyId` passed in tool arguments for isolation.

**Phase 1 model:**
- Each company gets its own AgentSentry instance with a distinct `AGENT_SENTRY_ACCESS_KEY` and its own SQLite DB. Isolation is physical; no shared store, no cross-tenant query path exists.
- The key is stored as a Paperclip secret and referenced via `credentialRefs` (write-only in Paperclip **[V]**).
- **WI-6 (Phase 2 prerequisite, documented here):** a shared multi-tenant instance requires Paperclip to pass a signed caller identity (not a plain arg) that AgentSentry validates before scoping reads. Until that exists, do **not** run one instance for multiple companies.

**Token hygiene:** `AGENT_SENTRY_ACCESS_KEY` ≥ 32 bytes random; rotation = update the Paperclip secret + restart the instance; `AGENT_SENTRY_NO_AUTH` must be unset in all non-local environments (CI check — WI-7).

## 4. Failure semantics — resolves G-3

**Decision: keep hard enforcement off the AgentSentry availability path.**

- The **hard gate** is Paperclip-native policy (`require_approval`/`block` on write/destructive entries, §6). It is evaluated by Paperclip and is **independent of AgentSentry uptime** — if AgentSentry is down, risky tools still route to approval. This is the key design property: a safety outage cannot silently open the gate.
- **Advisory tools** (`scan_security`, `size_task`, `check_rules`): if AgentSentry is unreachable, Paperclip health-check marks the connection `degraded`/`failed` **[V]** and the call errors. The agent proceeds **without advice** (fail-open on advice) — acceptable because advice is not the enforcement boundary; enforcement is the native policy above.
- **Memory tools** (`recall_context`, `search_history`, `capture_event`, `generate_handoff`): fail-open; a missed `capture_event` is logged by AgentSentry's circuit breaker **[V]** (`src/observability/`) and does not block the agent.
- **Phase 3 note (not built here):** the reactive hold defaults **fail-closed** — if a scan errors, create the blocker anyway.

## 5. Tool contracts

Input schemas are **[V]** from `src/mcp/tools/*`. Tool names are prefixed `agent_sentry_` at the MCP boundary **[V]**. Risk = intended Paperclip classification (requires WI-1 annotations).

| Tool | Risk | Required input | Optional input | Returns |
| --- | --- | --- | --- | --- |
| `health` | read | — | — | store stats, chain integrity, enablement level |
| `scan_security` | read | `content: string` | `file_path: string`, `probabilistic: boolean` | `findings[]: {type, severity('critical'..'low'), line?, adjusted_severity?: 0..1}` |
| `size_task` | read | `task: string` | `files: string[]` | `{risk_level: LOW\|MEDIUM\|HIGH\|CRITICAL, score, factors[]}` (thresholds ≤2 LOW, ≤5 MED, ≤8 HIGH, else CRIT) |
| `check_rules` | read | `file_path: string`, `change_description: string` | — | rule violations vs CLAUDE.md/AGENTS.md |
| `check_context` | read | *(see tool)* | — | context-window usage estimate |
| `check_git` | read | *(see tool)* | — | git status / hygiene |
| `recall_context` | read | `query: string` | `max_results: number`, `lookback_days: number` | matching sessions/summaries/events |
| `search_history` | read | `query: string` | `limit: number`, `event_type`, `severity`, `since` | event audit matches |
| `capture_event` | **write** | `event_type`(enum), `severity`(enum), `skill`(enum), `title`, `detail` | `affected_files[]`, `tags[]` | event id (hash-chained) |
| `generate_handoff` | **write** | *(see tool)* | — | structured handoff text |

> `risk_score` (11th tool, experimental Level 6) is **excluded from Phase 1** — keep it out of the published catalog or leave it `disabled`.

**WI-1 (blocking) — emit MCP annotations.** **[V]** AgentSentry tool registration (`src/mcp/server.ts`) sends only `{name, description, inputSchema}` — **no `annotations`**. Without them Paperclip's catalog infers risk by heuristic and will treat ambiguous tools as `write` (approval/quarantine). Add to each tool def and the `tools/list` response:
- read tools → `annotations: { readOnlyHint: true }`
- `capture_event`, `generate_handoff` → `annotations: { readOnlyHint: false }`
Acceptance: a Paperclip catalog refresh classifies 8 `read` + 2 `write`, 0 `destructive`, 0 unexpected quarantine.

## 6. Paperclip registration runbook

All payloads **[V]** from `MCP-ACCESS-GOVERNANCE.md`. Run per company; `$BOARD_API_KEY`, `$COMPANY_ID`, `$PAPERCLIP_URL` preset.

```sh
# 0. Store the AgentSentry access key as a Paperclip secret → $SENTRY_SECRET_ID  (UI or secrets API)

# 1. Create application (logical grouping) → $APPLICATION_ID
#    POST /api/companies/$COMPANY_ID/tools/applications  { "name": "AgentSentry", "applicationKey": "agentsentry" }

# 2. Create connection (remote_http), enabled:false
curl -fsS -X POST -H "Authorization: Bearer $BOARD_API_KEY" -H "Content-Type: application/json" \
  "$PAPERCLIP_URL/api/companies/$COMPANY_ID/tools/connections" -d '{
    "applicationId": "'"$APPLICATION_ID"'",
    "name": "AgentSentry (remote)",
    "transport": "remote_http",
    "transportConfig": { "url": "https://<agentsentry-host>/mcp", "headers": [] },
    "credentialRefs": [
      { "name": "Authorization", "secretId": "'"$SENTRY_SECRET_ID"'", "placement": "header", "key": "Authorization", "prefix": "Bearer " }
    ],
    "enabled": false }' | jq '{id, status, healthStatus}'   # → $CONNECTION_ID

# 3. Health check + catalog refresh (must show 10 discovered, 0 quarantined after WI-1)
curl -fsS -X POST ... "/api/tool-connections/$CONNECTION_ID/health-check" -d '{}'
curl -fsS -X POST ... "/api/tool-connections/$CONNECTION_ID/catalog/refresh" -d '{}' | jq '{discoveredCount, quarantinedCount}'

# 4. Profile: allow read tools; bind to the company (or a project)
curl -fsS -X POST ... "/api/companies/$COMPANY_ID/tools/profiles" -d '{
    "profileKey": "agentsentry.default",
    "name": "AgentSentry default",
    "defaultAction": "deny",
    "entries": [
      { "selectorType": "risk_level", "selectorValue": "read", "effect": "include" },
      { "selectorType": "tool_name", "selectorValue": "agent_sentry_capture_event", "effect": "include" },
      { "selectorType": "tool_name", "selectorValue": "agent_sentry_generate_handoff", "effect": "include" }
    ] }' | jq '{id}'   # → $PROFILE_ID
curl -fsS -X POST ... "/api/companies/$COMPANY_ID/tools/profiles/$PROFILE_ID/bind" \
  -d '{ "targetType": "company", "targetId": "'"$COMPANY_ID"'", "priority": 10 }'

# 5. (Optional, Phase 3 seed) require_approval policy on the write tools — proves the native gate
#    POST /api/companies/$COMPANY_ID/tools/policy  { policyType: "require_approval", selectors: { toolName: ["agent_sentry_capture_event"] } }

# 6. Dry-run the decision (no real call)
curl -fsS -X POST ... "/api/companies/$COMPANY_ID/tools/policy/test" -d '{
    "companyId":"'"$COMPANY_ID"'",
    "actor":{"actorType":"agent","actorId":"'"$AGENT_ID"'","agentId":"'"$AGENT_ID"'"},
    "request":{"toolName":"agent_sentry_scan_security","arguments":{"content":"x"}} }' \
  | jq '{decision:.decision.decision, reasonCode:.decision.reasonCode}'   # expect "allow"

# 7. Enable
curl -fsS -X PATCH ... "/api/tool-connections/$CONNECTION_ID" -d '{"enabled": true, "status": "active"}'
```

Statuses **[V]**: connection `draft|active|disabled|archived`; health `ok|unchecked|degraded|failed|error|missing_secret`.

## 7. Config & environment matrix

| Var | Local dev | Staging/prod | Notes |
| --- | --- | --- | --- |
| `AGENT_SENTRY_ACCESS_KEY` | set (any) | **required**, ≥32B random, per-company | reject-by-default **[V]** |
| `AGENT_SENTRY_NO_AUTH` | `true` ok | **must be unset** | CI gate (WI-7) |
| `AGENT_SENTRY_CORS_ORIGIN` | `http://localhost` | the Paperclip origin **[V]** | |
| transport | stdio ok | **HTTP** (`createHttpTransport`) | port via arg; `0`=random **[V]** |
| embeddings | noop | noop or configured provider | semantic recall optional (ONNX/Ollama) **[V]** |

## 8. Observability & audit mapping

- Every gateway call → a Paperclip **Call Event** (`allow`/`deny`/`require_approval`/`rate_limited`, matched policy, args hash) **[V]**.
- AgentSentry-side: the service logs via its structured logger + circuit breaker **[V]**; `capture_event` writes a hash-chained row that AgentSentry can later surface. Phase-5 bridges Paperclip `task_id` into those rows — **not** Phase 1.
- Health endpoint: AgentSentry HTTP transport exposes `{status:'ok'}` **[V]**; Paperclip's `health-check` consumes it.

## 9. Rollback

- Non-destructive: `PATCH connection {enabled:false,status:"disabled"}` removes AgentSentry tools from agents while preserving audit history **[V]**. Full removal: delete profile binding + connection. No change to AgentSentry data.

## 10. Test plan

**Unit (AgentSentry repo):**
- WI-1: assert `tools/list` emits `readOnlyHint:true` for the 8 read tools and `false` for the 2 writes.
- Auth: request without/ with wrong Bearer → rejected; correct → accepted (extends existing `auth.ts` tests **[V]**).

**Integration (against a Paperclip dev instance):**
- Run steps §6.3 → assert `discoveredCount==10, quarantinedCount==0`.
- §6.6 dry-run → `scan_security` ⇒ `allow`; a non-included tool ⇒ `deny`.

**Acceptance (maps to §1):**
1. Agent calls each read tool ⇒ valid result + Call Event. 2. Out-of-scope `capture_event` ⇒ `deny` + audited. 3. Call Event present for every call. 4. Catalog = 8 read / 2 write. 5. Kill AgentSentry → a `require_approval` write still routes to approval (gate independent of uptime). 6. Company A's `search_history` never returns Company B rows (separate instances).

**Harness:** use Paperclip's bundled `safe-read-only-todo-kv` example first to learn the install/profile/smoke API shape (deferred from Phase 0), then substitute the AgentSentry connection.

## 11. Work items (in dependency order)

| WI | What | Where | Blocking? |
| --- | --- | --- | --- |
| WI-1 | Emit MCP `annotations` (readOnlyHint) on all tools | `src/mcp/server.ts`, `src/mcp/tools/*` | **yes** (classification) |
| WI-2 | Containerize + HTTP entrypoint + TLS front | deploy/ | yes |
| WI-3 | Per-company deploy + secret wiring runbook | ops | yes |
| WI-4 | Paperclip registration scripts (§6 as idempotent script) | scripts/ | yes |
| WI-5 | Integration + acceptance tests (§10) | tests/ | yes |
| WI-7 | CI gate: fail if `AGENT_SENTRY_NO_AUTH` set in a prod profile | ci | should |
| WI-6 | (Phase 2) signed caller-identity for shared multi-tenant store | src/mcp/auth.ts | deferred |

## 12. Open decisions remaining before coding

- **D-1:** Confirm Paperclip exposes an **application-create** route shape (§6 step 1 is **[I]** — the governance doc shows connection/profile/policy but not the application POST body). Validate against a live instance or `server/src/routes`.
- **D-2:** Port/host convention for the per-company AgentSentry instances (one host + path per company, or one host+port each).
- **D-3:** Whether to ship `require_approval` on writes in Phase 1 (§6 step 5) or defer to Phase 3.

---

### References
- Paperclip **[V]**: `doc/MCP-ACCESS-GOVERNANCE.md` (connection/profile/policy/approval payloads, risk classification, statuses), `server/src/services/plugin-event-bus.ts` (event payload shape, Phase 3).
- AgentSentry **[V]**: `src/mcp/transport.ts`, `src/mcp/auth.ts`, `src/mcp/server.ts`, `src/mcp/tools/*`, `src/observability/`.
