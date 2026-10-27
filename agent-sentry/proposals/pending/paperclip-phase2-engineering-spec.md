# Engineering Spec — Phase 2: Multi-tenant Isolation & Caller Attribution

| | |
| --- | --- |
| **Status** | Draft v1 — implementation-ready for Phase 2; written before Phase 1 is live, so every Paperclip-side assumption carries a validating test |
| **Date** | 2026-10-27 |
| **Parent** | [paperclip-integration.md](./paperclip-integration.md) §6 Phase 2; builds on [paperclip-phase1-engineering-spec.md](./paperclip-phase1-engineering-spec.md) v3 (cited as **P1 §n**) |
| **Owner** | _unassigned_ |
| **AgentSentry** | v0.6.0-beta.1 (`agent-sentry/`) |
| **Paperclip** | `paperclipai/paperclip@50b932a`, read 2026-10-27 |

**Scope.** Make AgentSentry *know* which Paperclip company, agent, run, issue and project each event belongs to; make that knowledge first-class in the schema and every query path; and define — behind an explicit flag — the rules under which one AgentSentry process may serve more than one company without any possibility of cross-tenant reads.
**Out of scope.** The observe-and-react plugin (Phase 3), store listing (Phase 4), task↔goal bridge, routine continuity and budget fusion (Phase 5). Supabase production hardening is specified here (§7) but gated separately (WI2-9) and is **not** required to exit Phase 2.

**Grounding legend.** **[V]** verified in source (AgentSentry `src/` at `agent-sentry/`; Paperclip at the commit above — `server/src/services/tool-gateway.ts`, `server/src/routes/authz.ts`, `server/src/middleware/auth.ts`, `packages/db/src/schema/tool_access.ts`, `packages/shared/src/validators/tool-access.ts`). **[V-doc]** stated in a Paperclip doc only. **[I]** inference; the test named beside it closes it.

---

## 0. Facts this phase rests on (source, not doc)

| # | Fact | Where | Consequence |
| --- | --- | --- | --- |
| F-1 | `OpsEvent` has `session_id`, `agent_id` and no tenant/task fields; `task_id`/`project_id`/`goal_id`/`company_id` appear nowhere in `src/` **[V]** | `src/memory/schema.ts:15-33` | Schema change (§5) is unavoidable for any per-tenant query. |
| F-2 | `capture_event` sets `session_id = AGENT_SENTRY_SESSION_ID ?? session-<now>`, `agent_id = AGENT_SENTRY_AGENT_ID ?? 'mcp-server'`, `metadata = {}` **[V]** | `src/mcp/tools/capture-event.ts:81-82, 90` | Attribution today is process-wide, not per call (P1 X-11). |
| F-3 | Auth is one process-wide key in header `x-agent-sentry-key`, `timingSafeEqual`, reject-by-default **[V]** | `src/mcp/transport.ts:84`, `src/mcp/auth.ts:22-64` | There is no per-caller principal; a shared instance needs one (§6). |
| F-4 | Supabase provider: no tenant column, no RLS policy, service-role key bypasses RLS; no `coordination_locks`, no `schema_version` column; retry only, no circuit breaker **[V]** | `src/memory/providers/supabase-provider.ts:150-155`, `migrations/supabase-migration.sql:8-24`, `supabase-base.ts` | Supabase is not a tenant boundary today (§7). |
| F-5 | `MemoryStore.capture` reads `getLatestHash()` then `insert()` as two calls, not one transaction **[V]** | `src/memory/store.ts:101-107, 134-140` | Two writers can fork the chain (§8). |
| F-6 | SQLite `coordination_locks(resource PK, holder, fencing_token, acquired_at, expires_at)` with `INSERT OR IGNORE` CAS exists; Supabase lacks it **[V]** | `src/memory/migrations/migration-v4.ts:10-19`, `sqlite-provider.ts:370-416` | Usable as the per-company write lock (§8). |
| F-7 | `vectorSearch` pre-filters in SQL on `since/event_type/severity/skill/session_id` only; caps at `MAX_VECTOR_SCAN = 10000` most-recent embeddings when `since` is absent **[V]** | `sqlite-provider.ts:150-174` | Tenant filter must enter the SQL pre-filter or the 10k window is shared across tenants (§9). |
| F-8 | Paperclip forwards caller identity to a remote MCP server **only** as opt-in, unsigned headers `x-paperclip-{company,agent,issue,project,run,gateway-session,correlation}-id`, enabled by `config.headerPolicy.metadata.forward: [...]` on the connection; nothing in `tools/call` `_meta`; `initialize.clientInfo = {name:"paperclip", version:"1"}` **[V]** | `tool-gateway.ts:3600-3601, 3634-3648, 3696-3718, 6339-6355`; `tool-access/mcp-http.ts:71` | Attribution is available but **unsigned**; it is trustworthy only because the gateway is the sole, key-authenticated caller. No Paperclip-issued signed identity exists for downstream servers → the Phase 1 WI-6 design (JWT verified against a Paperclip key) **cannot be built as written**; §6 replaces it. |
| F-9 | A tool Connection/Application is strictly company-scoped (`company_id NOT NULL`, composite FKs); it cannot be shared across companies **[V]** | `packages/db/src/schema/tool_access.ts:85-172` | One Paperclip company ⇒ one connection ⇒ one credential. A shared AgentSentry instance sees N connections, each with its own `credentialRefs` — the natural per-tenant principal (§6). |
| F-10 | Paperclip enforces company scope per route via `assertCompanyAccess`; agent actors carry `companyId` from their API key / run JWT (`HMAC(master, "jwt:<instance>:<company>")`, 48 h) **[V]** | `routes/authz.ts:75-121`, `middleware/auth.ts:314-464`, `agent-auth-jwt.ts:10-24, 52, 91-93` | Paperclip's own tenancy is sound; the gap is only the gateway→upstream hop. |
| F-11 | One `StreamableHTTPServerTransport` per process; second `initialize` → 400 **[V]** (P1 X-8) | `src/mcp/transport.ts:51-53` | Per-session transports (P1 WI-2) are a **prerequisite**: request context must be per request, not per process. |

---

## 1. Goals, non-goals, exit criteria

### 1.1 Goals
1. Every event captured through the gateway carries the Paperclip `company_id`, `agent_id`, `run_id` and, when present, `issue_id`, `project_id`, `correlation_id` as **first-class, indexed columns** — no tags, no `metadata` digging.
2. `search_history` and `recall_context` can filter on any of those fields, in both the text and vector paths, with the tenant filter applied **before** the 10k vector window.
3. In **single-tenant mode** (default; one instance per company) behaviour is unchanged except for the new columns.
4. In **shared mode** (flag-gated), a request authenticated with company A's key can never read, count, aggregate, recall or prune company B's rows — enforced inside `MemoryStore`/provider, not in tool handlers — and every such attempt is audited.
5. Concurrent captures within one company never fork the hash chain.
6. Legacy rows (schema v1) remain readable, verifiable and searchable after migration; chain verification passes across the v1→v2 boundary.

### 1.2 Non-goals (Phase 2)
- Trusting any identity asserted *by the agent* in tool arguments. Identity comes from the connection credential and gateway headers only.
- Signed identity from Paperclip: it does not exist for downstream MCP servers (F-8); not built here, tracked as an upstream request (D2-1).
- Production Supabase (WI2-9 is separately gated; §7).
- Horizontal scaling of one company across processes (SQLite remains single-writer; §8 serialises writers inside one process).

### 1.3 Exit criteria → tests
Goals map to A2-1 … A2-6 (§13.4). Phase 2 exits when A2-1…A2-6 pass against a live Paperclip instance with **two** companies and WI2-1…WI2-7 are merged. WI2-8/WI2-9 are optional for exit.

---

## 2. Decision: isolation primitive

**Keep one instance per company as the default and the only recommended production topology.** Shared mode is specified so it can be used deliberately (dev/eval clusters, very small tenants, cost-sensitive hosting), never by accident.

Why, from source:
- The only principal AgentSentry can authenticate is the connection credential (F-3, F-9). That is a strong, Paperclip-managed, per-company secret — good enough to *bind* a tenant, but it is one key per connection, so a shared instance must hold N keys and map each to exactly one company (§6).
- Identity headers are unsigned (F-8). They are safe to *use* only when the key already established the tenant and the header merely narrows attribution within it; they must never *widen* it (§6.3 rule R-3).
- Supabase cannot be the boundary today (F-4). The boundary has to be (a) a separate DB file per company, or (b) a mandatory `company_id` predicate injected by the store on every provider call (§6.4). Shared mode uses (b) over (a) because a single SQLite file per process is what the code supports; a DB-file-per-tenant in one process is D2-2.

```
single (default)                               shared (AGENT_SENTRY_TENANT_MODE=shared)
┌──────────────────────────┐                   ┌──────────────────────────────────────────┐
│ Paperclip company A      │                   │ Paperclip company A   company B   company C│
│  connection A ─ key A ──┼─▶ instance A      │  conn A key A ─┐  conn B key B ─┐ conn C key C│
│                          │   data/A.db       │                ▼                ▼          ▼ │
└──────────────────────────┘                   │        AgentSentry shared instance            │
┌──────────────────────────┐                   │  key→company map │ TenantContext per request   │
│ Paperclip company B      │                   │  MemoryStore enforces company_id on every call │
│  connection B ─ key B ──┼─▶ instance B      │  data/shared.db  (company_id column + index)    │
│                          │   data/B.db       └──────────────────────────────────────────────┘
└──────────────────────────┘
```

---

## 3. Sequence flows

### 3.1 Attributed capture (both modes)
```
Agent → Gateway        : tools/call {tool:"agent_sentry_capture_event", parameters:{...}}
Gateway → Sentry       : POST /mcp  x-agent-sentry-key: KEY
                                    x-paperclip-company-id, -agent-id, -run-id, [-issue-id, -project-id, -correlation-id]   [V] F-8
Sentry transport       : validateAccessKey → principal {companyId (from key map or single-mode config)}
Sentry transport       : parse x-paperclip-* → RequestContext; R-1..R-4 (§6.3)
Sentry tool handler    : args ⊕ RequestContext → OpsEventInput{company_id, agent_id, run_id, issue_id?, project_id?, correlation_id?}
MemoryStore.capture    : acquire write lock (company) → latestHash → insert → release     (§8)
```

### 3.2 Scoped read (shared mode)
```
Gateway → Sentry       : tools/call search_history {query, run_id?, issue_id?, ...}  + headers as above
Sentry store           : options.company_id := principal.companyId (forced; caller value ignored)   (§6.4)
Provider               : WHERE company_id = ? AND ...  (text path) / embeddings JOIN ... WHERE ev.company_id = ? (vector path, before LIMIT 10000)
```

### 3.3 Cross-tenant attempt (shared mode)
```
Key B + x-paperclip-company-id: A  → 403 {error:"tenant_mismatch"}  before MCP dispatch; audit row {principal:B, asserted:A}
Key B + search_history {company_id:"A"}  → tool input has no company_id field (rejected by zod as unknown key is NOT the control — the store ignores caller tenant entirely)
```

---

## 4. Request context & propagation

### 4.1 `RequestContext` (new, `src/mcp/request-context.ts`)
```ts
export interface RequestContext {
  principal: { companyId: string; keyId: string };           // from auth (§6.2); single mode: companyId = AGENT_SENTRY_COMPANY_ID
  paperclip?: {                                               // from x-paperclip-* headers, all optional
    companyId?: string; agentId?: string; runId?: string;
    issueId?: string; projectId?: string; gatewaySessionId?: string; correlationId?: string;
  };
  mcpSessionId?: string;                                      // Mcp-Session-Id (per-session transports, P1 WI-2)
  receivedAt: string;
}
```
- Transport: `transport.ts` builds the context after `validateAccessKey` and runs `mcpTransport.handleRequest` inside `requestContextStorage.run(ctx, …)` (`AsyncLocalStorage<RequestContext>`). Tool handlers call `getRequestContext()`; stdio transport provides a context with `principal.companyId = AGENT_SENTRY_COMPANY_ID ?? 'local'` and no `paperclip` block, so existing stdio behaviour is unchanged.
- Header parsing: names are case-insensitive; values trimmed; max 128 chars; must match `^[A-Za-z0-9._:-]+$`; anything else is dropped and counted (`sentry_request_header_rejected_total`). Multiple values → first.
- Why ALS and not a handler parameter: handlers are registered as `handler(args)` (`src/mcp/server.ts:49-61`) and tested with mocked stores; ALS keeps the 10 signatures intact. **[I — U2-2 covers isolation across concurrent requests.]**

### 4.2 Precedence for attribution fields (capture)
| Field | 1st | 2nd | 3rd | Default |
| --- | --- | --- | --- | --- |
| `company_id` | principal (key map / config) | — | — | required; capture fails `tenant_unresolved` if absent in shared mode |
| `agent_id` | tool arg `agent_id` | `x-paperclip-agent-id` | `AGENT_SENTRY_AGENT_ID` | `'mcp-server'` |
| `session_id` | tool arg `session_id` | `x-paperclip-run-id` | `AGENT_SENTRY_SESSION_ID` | `session-<now>` (unchanged **[V]**) |
| `run_id` | tool arg | header | — | null |
| `issue_id`, `project_id`, `correlation_id` | tool arg | header | — | null |

Header `x-paperclip-company-id` is **never** a source for `company_id`; it is only compared (R-3). Tool args win over headers so the plugin (Phase 3) can capture on behalf of a run it observed.

---

## 5. Schema change — `OpsEvent` v2

### 5.1 Type (`src/memory/schema.ts`)
```ts
export interface OpsEvent {
  /* v1 fields unchanged … */
  company_id: string;          // v2: required on write; '' for migrated v1 rows
  run_id?: string | null;      // v2
  issue_id?: string | null;    // v2
  project_id?: string | null;  // v2
  correlation_id?: string | null; // v2
  schema_version?: number;     // 1 | 2
}
export type OpsEventInput = Omit<OpsEvent, 'id'|'hash'|'prev_hash'|'embedding'|'schema_version'>;  // company_id now part of input
export interface QueryOptions { /* existing … */ company_id?: string; run_id?: string; issue_id?: string; project_id?: string; correlation_id?: string; }
export interface VectorSearchOptions { /* existing … */ company_id?: string; agent_id?: string; run_id?: string; issue_id?: string; project_id?: string; tag?: string; }
```
`validateEventInput` (`schema.ts:106-119`) adds: `company_id` required, ≤128 chars, charset as §4.1; optional ids same charset. `EVENT_TYPES` etc. unchanged.

### 5.2 Hash chain
- `computeHash` **[V]** (`schema.ts:87-104`) hashes a fixed field list that excludes `schema_version`. Rule: **v1 rows keep the v1 hash input; v2 rows include the new fields.** Implement `computeHash(event)` as: `event.schema_version >= 2 ? hashV2(event) : hashV1(event)`, where `hashV2` appends `company_id, run_id, issue_id, project_id, correlation_id` (nulls serialised as `null`) after `prev_hash`. `hashV1` is the current body, byte-identical.
- `verifyChain` **[V]** (`store.ts:235-338`) re-computes per row using the row's own `schema_version`, so a chain crossing the migration boundary verifies (U2-5). Checkpoints (`chain_checkpoints`) need no change.
- Migrated v1 rows get `company_id` **backfilled** (§5.3) but keep `schema_version = 1` and their original hash; the backfilled column is not in their hash input, by design. Tamper-evidence for tenant assignment on legacy rows is therefore weaker; the migration logs a per-row audit line and records `migration_v6_backfill` counts in `schema_version` metadata (D2-3 for whether to re-chain).

### 5.3 SQLite migration v6 (`src/memory/migrations/migration-v6.ts`, registered in `sqlite-migrations.ts` `MIGRATIONS` **[V]** `:14-86`)
```sql
ALTER TABLE ops_events ADD COLUMN company_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ops_events ADD COLUMN run_id TEXT;
ALTER TABLE ops_events ADD COLUMN issue_id TEXT;
ALTER TABLE ops_events ADD COLUMN project_id TEXT;
ALTER TABLE ops_events ADD COLUMN correlation_id TEXT;
CREATE INDEX IF NOT EXISTS idx_ops_events_company_ts ON ops_events(company_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ops_events_company_run ON ops_events(company_id, run_id);
CREATE INDEX IF NOT EXISTS idx_ops_events_company_issue ON ops_events(company_id, issue_id);
CREATE INDEX IF NOT EXISTS idx_ops_events_company_agent_ts ON ops_events(company_id, agent_id, timestamp DESC);
-- ops_embeddings: add company_id so the vector pre-filter and the 10k window are per tenant (F-7)
ALTER TABLE ops_embeddings ADD COLUMN company_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_ops_embeddings_company_ts ON ops_embeddings(company_id, timestamp DESC);
```
Backfill (TypeScript, same migration step, single transaction, chunked 1 000 rows):
1. `company_id` ← `metadata.paperclip.company_id` (P1 WI-3 stamps it) → else tag `pc:company=<id>` (P1 §12.1) → else `AGENT_SENTRY_COMPANY_ID` env at migration time → else `''`.
2. `run_id` ← `metadata.paperclip.run_id` → tag `pc:run=`; `issue_id` ← `…issue_id` → `pc:issue=`; `project_id` ← `…project_id`; `correlation_id` ← `…correlation_id`.
3. `ops_embeddings.company_id` ← join on `ops_events.id`.
4. Emit one `audit_finding` event per migration run (`agent_id:'migration'`, `title:'schema-v6-backfill'`, `metadata:{rows, resolved_by:{metadata,tag,env,none}}`) — captured *after* the DDL so it is a v2 row.
Rows left with `company_id = ''` are **unreachable in shared mode** (every query carries a non-empty `company_id`) and visible in single mode only when `AGENT_SENTRY_COMPANY_ID` is unset (treated as `''`). Operators migrating a single-mode instance set `AGENT_SENTRY_COMPANY_ID` first.

### 5.4 Supabase migration (`migrations/supabase-migration-v2.sql`, new; applies to F-4)
```sql
ALTER TABLE ops_events ADD COLUMN IF NOT EXISTS company_id text NOT NULL DEFAULT '';
ALTER TABLE ops_events ADD COLUMN IF NOT EXISTS run_id text, ADD COLUMN IF NOT EXISTS issue_id text,
  ADD COLUMN IF NOT EXISTS project_id text, ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1;   -- missing today [V]
CREATE INDEX IF NOT EXISTS ops_events_company_ts ON ops_events(company_id, occurred_at DESC);
CREATE TABLE IF NOT EXISTS coordination_locks (resource text PRIMARY KEY, holder text NOT NULL,
  fencing_token bigint NOT NULL DEFAULT 0, acquired_at timestamptz NOT NULL, expires_at timestamptz NOT NULL);
-- match_ops_events RPC gains p_company_id and filters before ORDER BY similarity
```
RLS (WI2-9 only): `ALTER TABLE ops_events ENABLE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON ops_events USING (company_id = current_setting('app.company_id', true));` plus a per-tenant **non-service** role; the provider sets `app.company_id` per request via `SET LOCAL` through an RPC. Until WI2-9, the Supabase provider stays **experimental** and shared mode refuses to start on it (§6.5).

### 5.5 Provider plumbing
- `StorageProvider` **[V]** (`providers/storage-provider.ts:14-50`): no signature change — the new fields ride on `QueryOptions`/`VectorSearchOptions`. Add optional `prune(options & { company_id? })` so retention runs per tenant.
- SQLite `query`/`count`/`aggregate`/`textSearch`/`getChain`/`prune`: add `company_id = ?`, `run_id = ?`, `issue_id = ?`, `project_id = ?`, `correlation_id = ?` conditions beside the existing ones (`sqlite-provider.ts:418-443`, `:340-362`). `vectorSearch`: add `ev.company_id = ?`, `ev.agent_id = ?`, `ev.run_id = ?`, `ev.issue_id = ?`, `ev.project_id = ?` and the `json_each(tags)` tag condition to the JOIN pre-filter (`:160-166`) so they apply **before** the `LIMIT 10000` subquery (`:172-174`).
- `MemoryStore.search` **[V]** (`store.ts:143-201`) forwards every new option to all three paths (vector, `textSearch`, JS fallback). `MemoryStore.list/stats/verifyChain/prune` forward `company_id`.
- `ContextRecaller.recall` (`intelligence.ts:394-438`) passes through `company_id` and the optional ids; grouping stays by `session_id` (= run id for gateway traffic).

### 5.6 Tool contract deltas (P1 §6 remains authoritative for everything not listed)
| Tool | Input delta | Output delta |
| --- | --- | --- |
| `capture_event` | `+ agent_id?, session_id?, run_id?, issue_id?, project_id?, correlation_id?, metadata?` (all optional; precedence §4.2). **No `company_id` input** — rejected as unknown key. | confirmation text includes `company_id` and `run_id` |
| `search_history` | `+ agent_id?, run_id?, issue_id?, project_id?, correlation_id?, tag?` | each result event includes the v2 fields |
| `recall_context` | `+ agent_id?, run_id?, issue_id?, project_id?` | unchanged format; sessions limited to tenant |
| `health` | – | `+ tenant_mode`, `+ tenants_loaded` (count only, never ids), `+ schema_version` |
| `generate_handoff` | `+ run_id?, issue_id?` (stamped on the `handoff` event P1 WI-3 adds) | – |
All additions are optional ⇒ `inputSchema` changes ⇒ `schemaHash` changes ⇒ changed-tool handling per P1 §3.4 (A2-7 confirms no quarantine / profile breakage). Annotations (P1 §7) unchanged.

---

## 6. Tenancy enforcement (shared mode)

### 6.1 Modes
| `AGENT_SENTRY_TENANT_MODE` | Principal source | Store filter | Default |
| --- | --- | --- | --- |
| `single` | `AGENT_SENTRY_COMPANY_ID` (string; `''` if unset) with the existing single `AGENT_SENTRY_ACCESS_KEY` | `company_id` stamped on write; reads unfiltered (one tenant per DB) | **yes** |
| `shared` | key map (§6.2); `AGENT_SENTRY_ACCESS_KEY` **must be unset** (startup error otherwise) | `company_id` forced on every read/write/prune/aggregate | no |

### 6.2 Key map
- `AGENT_SENTRY_TENANT_KEYS_FILE=/run/secrets/tenants.json` (preferred; mounted secret, mode 0400) or `AGENT_SENTRY_TENANT_KEYS` (inline JSON, dev only). Shape:
```json
{ "version": 1, "tenants": [
  { "company_id": "c_a", "key_id": "ka-2026-10", "key": "<≥32B random>", "status": "active" },
  { "company_id": "c_a", "key_id": "ka-2026-07", "key": "<old>",          "status": "retiring", "retire_after": "2026-11-15T00:00:00Z" },
  { "company_id": "c_b", "key_id": "kb-2026-10", "key": "<…>",            "status": "active" } ] }
```
- Lookup: constant-time over **all** entries (compare against every key, accumulate match; no early exit) to avoid leaking which tenant exists. Entries with `status:"retiring"` authenticate until `retire_after`. Duplicate keys across companies → startup error.
- Rotation per company = add `active`, flip old to `retiring`, update the Paperclip connection's `credentialRefs` (P1 §4.3), later delete. Hot reload on `SIGHUP` and on file mtime change (poll 30 s). Load failure keeps the last good map and raises `sentry_tenant_keymap_stale` (never fails open).

### 6.3 Request rules (evaluated in `transport.ts` before MCP dispatch)
| Rule | Condition | Action |
| --- | --- | --- |
| R-1 | key not in map | `401 unauthorized` (unchanged) |
| R-2 | shared mode and key resolves | `principal = {companyId, keyId}` |
| R-3 | `x-paperclip-company-id` present and ≠ `principal.companyId` | `403 {error:"tenant_mismatch"}`; audit event in the **principal's** tenant (`event_type:'violation'`, `title:'tenant_mismatch'`, `metadata:{asserted_company_hash}`) ; metric `sentry_tenant_mismatch_total{company}` |
| R-4 | header values failing §4.1 charset/length | dropped; metric; request continues |
| R-5 | single mode, `x-paperclip-company-id` present and `AGENT_SENTRY_COMPANY_ID` set and ≠ | `403 tenant_mismatch` (same as R-3) — protects a mis-wired connection |
The header is a *check*, never a *source* (§2). Header absence is allowed: Paperclip forwards nothing unless the connection opts in (F-8), so absence means "unattributed within the principal's tenant".

### 6.4 Store-level enforcement (the control that matters)
- `MemoryStore` gains a constructor option `tenant: { mode: 'single'|'shared' }` and every public method takes its `company_id` from `getRequestContext().principal.companyId` — **not** from its `options` argument. In shared mode, if no request context is present (CLI, tests, background jobs) the call throws `TenantContextMissing` unless invoked through `store.asTenant(companyId, fn)` (explicit, logged).
- Caller-supplied `options.company_id` is overwritten (not merged) in shared mode; in single mode it is ignored.
- Provider calls are wrapped by `assertTenantPredicate(sql)` in dev/test builds: any `ops_events` statement without `company_id = ?` in shared mode throws (U2-6 asserts this via the SQL trace hook `db.prepare` wrapper). This catches a forgotten branch, e.g. the JS-fallback path in `search` (`store.ts:187-200`).
- `verifyChain` in shared mode verifies **per tenant** (chain is per `company_id`, §8), and `getLatestHash` takes `company_id`.

### 6.5 Startup invariants (shared mode)
Refuse to start (exit 2, message on stderr like `auth.ts` does **[V]**) when: provider ≠ `sqlite` (until WI2-9); `AGENT_SENTRY_ACCESS_KEY` set; key map missing/invalid/empty; `AGENT_SENTRY_NO_AUTH` set; schema version < 6.

### 6.6 Threat model delta (extends P1 §4.4)
| Threat | Control | Residual |
| --- | --- | --- |
| Key A leaked | Only tenant A readable (store predicate); rotation (§6.2) | Full read of A — same as Phase 1 |
| Gateway misconfigured: connection B carries key A | R-3 denies when `x-paperclip-company-id` is forwarded; otherwise B's events land in A | **Require `headerPolicy.metadata.forward` to include `company_id` for shared-mode connections** (WI2-5 registration step; A2-4b verifies denial). Without the header there is no detection — documented limitation (D2-1). |
| Header spoofing by an agent | Impossible: gateway strips/never passes caller `x-paperclip-*` headers through passthrough (`tool-gateway.ts:579-585, 3625-3632`) **[V]**; agents never reach AgentSentry directly | — |
| Tenant enumeration via timing | Constant-time full-map compare (§6.2) | — |
| Tenant enumeration via `health` | Counts only, no ids | — |
| Noisy neighbour (one tenant floods) | Per-tenant rate limit (§10) and per-tenant `max_events` prune | — |
| Legacy `company_id=''` rows | Unreachable in shared mode (§5.3) | Operator must set `AGENT_SENTRY_COMPANY_ID` before migrating a single-mode DB that will later be merged |

---

## 7. Shared-store strategy (decision + recommendation)

| Option | What it is | Status in source | Verdict |
| --- | --- | --- | --- |
| **S-1 SQLite, one process per company** (Phase 1) | separate file, separate key | works **[V]** | **Default.** Isolation is physical. |
| **S-2 SQLite, one process, `company_id` predicate** (this phase's shared mode) | one file, store-enforced predicate, per-tenant chain | needs §5/§6 | **Supported, opt-in.** Single writer, so throughput is shared; fine for ≤ ~10 small tenants (§9). |
| **S-3 Supabase hardened** | Postgres, RLS, per-tenant role, locks, breaker | not production-ready **[V]** F-4 | **Deferred — WI2-9**, gated on D2-4. |
| S-4 Single-writer "memory service" fronting SQLite for N processes | new network service | nothing exists | Rejected for Phase 2: duplicates what the MCP server already is. |

**Recommendation:** ship S-1 as the product default and S-2 as the only shared mode; do S-3 only when a customer needs Postgres-class retention/concurrency, and do it as RLS-first (never service-role from the shared process).

WI2-9 (Supabase hardening) checklist: tenant column + `schema_version` (§5.4); RLS policy + per-tenant DB role; `coordination_locks` table + `atomicLock*` implementation (F-6 gap, currently makes `tests/memory/providers/supabase-integration.test.ts:94` meaningless **[V]**); wire `CircuitBreaker` (`src/observability/circuit-breaker.ts:66` **[V]**, unused by providers) around `request()`; make `pooled-supabase-provider` selectable from `createProvider` (`provider-factory.ts:53-75` **[V]**); IVFFlat index decision (`supabase-migration.sql:34` commented out **[V]**); remove "Experimental" from README only after I2-5 passes.

---

## 8. Concurrency: chain integrity under concurrent capture

Problem **[V]** (F-5): `capture` does `getLatestHash()` → compute → `insert()`; with per-session transports (P1 WI-2) two gateway sessions in one process can interleave, and in shared mode two tenants share the file. Two inserts with the same `prev_hash` fork the chain; `verifyChain` then fails for every row after the fork.

Design:
1. **Chain per tenant.** `prev_hash`/`getLatestHash(company_id)` are scoped to `company_id` (`ORDER BY timestamp DESC, rowid DESC` **[V]** `sqlite-provider.ts:366`, plus `WHERE company_id = ?`). The genesis hash `'0'.repeat(64)` **[V]** (`store.ts:36`) is per tenant. Migrated v1 rows form the head of their tenant's chain.
2. **Serialise writers per tenant.** In-process: `MemoryStore` keeps `Map<company_id, Promise>` and chains captures (`capture = queue.then(() => doCapture())`) — zero-cost, correct for one process. Cross-process (two processes on one file is unsupported but possible): take `coordination_locks` **[V]** (`resource = 'chain:<company_id>'`, `holder = <pid>:<uuid>`, `expires_at = now+5 s`, fencing token = monotonically increasing `Date.now()` as today `coordinator.ts:222-257` **[V]**) around read-hash+insert; on failure to acquire within 2 s return `chain_lock_timeout` (fail-open per P1 §5.1 — the event is lost and counted, the chain is not forked). `atomicLockAcquire` does not extend expiry on re-entry **[V]** (`sqlite-provider.ts:370-389`); the hold is short enough that this is acceptable.
3. **Transaction.** Within the lock, run `getLatestHash` + `insert` (+ embedding insert) inside one `BEGIN IMMEDIATE … COMMIT` on SQLite (busy_timeout 5000 **[V]** `:67-70`). Supabase has no multi-statement transaction over PostgREST → WI2-9 adds an `insert_ops_event_chained` RPC.
4. **Detection.** `verifyChain` reports `fork_detected` with the two row ids when two rows share a `prev_hash`; `health` surfaces `chain.forks` per tenant; alert on > 0.

---

## 9. Performance budgets (extends P1 §14)

| Item | Budget | Basis |
| --- | --- | --- |
| Vector window | 10 000 most-recent embeddings **per tenant** (pre-filter on `ops_embeddings.company_id`, §5.3) | F-7; without the column the window is shared and a busy tenant evicts a quiet one |
| `recall_context` p95 | ≤ 1.5 s at 10k tenant events (P1 §11 SLO retained) | cosine scan chunks of 1 000 **[V]** `sqlite-provider.ts:176-220` |
| `search_history` with `run_id`/`issue_id` | ≤ 50 ms at 1M rows | covered indexes `idx_ops_events_company_run/issue` |
| Capture under contention | p95 ≤ 25 ms, 200 captures/s per process aggregate | single-writer SQLite WAL; A2-5 load test |
| Shared-mode tenant count | guidance ≤ 10 tenants or ≤ 500k rows per file | beyond that, S-1 or WI2-9 |
| Per-tenant rate limit | 60 req/s per `company_id` (replaces the per-IP limiter for gateway traffic, P1 WI-2) | `transport.ts:49` **[V]** is per IP — the gateway is one IP |
| Retention | `max_events`/`auto_prune_days` applied per tenant (`prune({company_id})`) | `store.ts:78-88` prunes on every init **[V]** |

---

## 10. Failure semantics & error taxonomy (extends P1 §5)

| Layer | Condition | Signal | Agent action |
| --- | --- | --- | --- |
| Transport | key unknown / absent | `401` (unchanged **[V]**) | operator |
| Transport | `tenant_mismatch` (R-3/R-5) | `403 {error:"tenant_mismatch"}` → gateway audit outcome `failure` | do not retry; operator checks connection wiring |
| Transport | key map stale/unloadable | last good map used; `health.tenant_keymap:"stale"`; metric | operator |
| Store | `TenantContextMissing` | MCP tool error text `{"error":"tenant context missing"}`; never reachable via gateway | bug — alert |
| Store | `chain_lock_timeout` | tool error; event dropped; metric `sentry_capture_dropped_total{reason}` | retry with same `idempotencyKey` (P1 §6.9) |
| Store | `fork_detected` | `health` degraded; no request impact | operator runs `agentsentry memory verify --tenant` |
| Migration | v6 backfill partial | migration aborts, transaction rolled back, process exits 3 | operator; DB unchanged |

Principle unchanged from P1 §5.1: nothing here is on the hard-gate path; Paperclip's `require_approval` on writes is unaffected by any of it.

---

## 11. Observability (extends P1 §11)

- All counters/histograms gain a `company` label **hashed** (`sha256(company_id)[:12]`) so metrics never carry raw tenant ids; `health` reports counts, not ids.
- New: `sentry_tenant_mismatch_total`, `sentry_request_header_rejected_total{header}`, `sentry_capture_dropped_total{reason}`, `sentry_chain_forks{company}`, `sentry_tenant_keymap_age_seconds`.
- Logs: every request line carries `principal.keyId`, `paperclip.runId`, `paperclip.correlationId` when present — this is the join key to Paperclip's `tool_invocations`/`tool_call_events` rows (`packages/db/src/schema/tool_access.ts:747-893` **[V]**), which record `agentId, issueId, runId, toolName, argumentsHash` on the Paperclip side.
- Audit: R-3 denials are written as `violation` events in the principal's tenant (§6.3) so they are visible to that company via `search_history {event_type:"violation"}`.

---

## 12. Deployment deltas (extends P1 §10)

| Var | single | shared | Note |
| --- | --- | --- | --- |
| `AGENT_SENTRY_TENANT_MODE` | `single` (default) | `shared` | §6.1 |
| `AGENT_SENTRY_COMPANY_ID` | **set** (Paperclip company id) | unset | stamps writes; R-5 check; required before migrating |
| `AGENT_SENTRY_ACCESS_KEY` | required | **must be unset** | §6.5 |
| `AGENT_SENTRY_TENANT_KEYS_FILE` | – | required (0400 mount) | §6.2 |
| `AGENT_SENTRY_TENANT_RATE_LIMIT_RPS` | 60 | 60 | §9 |
| `AGENT_SENTRY_SESSION_IDLE_MS` | 300000 | 300000 | P1 WI-2 |
Paperclip connection (P1 §9 step 3) adds, for **every** connection in either mode:
```json
"config": { "headerPolicy": { "metadata": { "forward": ["company_id","agent_id","run_id","issue_id","project_id","correlation_id"] } } }
```
(read from `config.headerPolicy ?? transportConfig.headerPolicy` **[V]** `tool-gateway.ts:3600-3601`; keys filtered to the seven allowed names **[V]** `:3634-3648`). In shared mode this is **mandatory** (§6.6). Registration script (P1 WI-4) gains `--tenant-mode shared --key-id` and writes one connection per company pointing at the same `transportConfig.url`.

---

## 13. Test plan

### 13.1 Unit (`tests/mcp/`, `tests/memory/`)
- U2-1 `RequestContext` parser: all seven `x-paperclip-*` headers parsed; bad charset/length dropped and counted; case-insensitive names; first of multiple values.
- U2-2 ALS isolation: 50 concurrent fake requests with distinct contexts → each `capture_event` row carries its own `agent_id`/`run_id` (no bleed).
- U2-3 precedence table §4.2: arg > header > env > default for each field; `company_id` never taken from header or arg.
- U2-4 migration v6 on a fixture DB (v5 schema, 1 000 rows with mixed `metadata.paperclip`, `pc:*` tags, none): columns added, backfill resolution counts as expected, `ops_embeddings.company_id` populated, `schema_version` table = 6.
- U2-5 chain: v1 rows + v2 rows → `verifyChain` passes; mutate a v2 `run_id` → fails; mutate a backfilled v1 `company_id` → passes (documented weakness, D2-3).
- U2-6 SQL predicate guard: in shared mode every `ops_events`/`ops_embeddings` statement issued by `search/list/stats/recall/prune/verifyChain/getLatestHash` contains `company_id = ?` (trace-hook assertion); single mode unaffected.
- U2-7 key map: load/validate; duplicate key across tenants → error; `retiring` honoured until `retire_after`; hot reload; stale map on bad reload.
- U2-8 R-3/R-5: mismatch → 403 + violation row in principal tenant; absent header → allowed.
- U2-9 startup invariants §6.5 (each → exit 2).
- U2-10 chain lock: two in-process captures for one tenant interleaved via fake timers → sequential `prev_hash`; lock timeout → `chain_lock_timeout`, no row, metric incremented.
- U2-11 vector pre-filter: 12 000 embeddings across two tenants (8 000 A, 4 000 B); recall for B returns B's oldest rows (window is per tenant, not shared).
- U2-12 tool inputs: `capture_event {company_id:"x"}` rejected as unknown key; `search_history {run_id}` filters; `health` exposes counts not ids.

### 13.2 Contract
- C2-1 `tests/contracts/doc-contracts.test.ts` tool count still 10; config-key allow-list (`:157-180` **[V]**) extended with `tenant.*` keys.
- C2-2 `tools/list` snapshot updated once (schema change is intentional); assert annotations unchanged.
- C2-3 `docs/memory-schema.md` lists the v2 fields and the hash rule (§5.2) — doc/code drift test extended (the doc already drifts on `prev_hash` genesis **[V]**; fix in WI2-7).

### 13.3 Integration (live Paperclip dev instance, two companies A and B)
- I2-1 Connection A with `headerPolicy.metadata.forward` → `capture_event` row has `company_id = A`, `agent_id = <A agent>`, `run_id = <run>`; without `forward` → `agent_id` falls to default, `company_id` still A (principal).
- I2-2 Shared instance, connections A and B (two keys): A's agent `search_history` never returns B rows across text, vector (ONNX enabled), `recall_context`, `health` stats; B's key with A's `x-paperclip-company-id` (simulated by a test connection with a static header) → 403 and a `violation` row in B.
- I2-3 Rotation: add key A2, switch connection A `credentialRefs`, retire A1 → zero failed calls after switch; A1 rejected after `retire_after`.
- I2-4 Schema change → `catalog/refresh`: entries stay `active` (custom remote, P1 §3.4) and the profile still allows the 10 tools (A2-7).
- I2-5 (WI2-9 only) Supabase with RLS: service-role path refused in shared mode; per-tenant role path passes I2-2.

### 13.4 Acceptance (map to §1.1)
- **A2-1** (Goal 1) 100 gateway captures from 3 agents / 5 runs in company A → every row has the correct `company_id/agent_id/run_id/issue_id` as columns; `metadata`/tags no longer needed for correlation.
- **A2-2** (Goal 2) `search_history {run_id}` and `recall_context {issue_id}` return only matching rows in both text and vector paths; U2-11 window property holds live.
- **A2-3** (Goal 3) Single mode on the Phase 1 deployment after migration: P1 A-1…A-7 still pass unchanged.
- **A2-4** (Goal 4) = I2-2; **A2-4b** mis-wired connection (key A on company B's connection with `forward` set) → every call 403 `tenant_mismatch`, audited.
- **A2-5** (Goal 5) 4 gateway sessions × 50 concurrent captures per tenant, two tenants → `verifyChain` passes for both; zero `fork_detected`; p95 capture ≤ 25 ms.
- **A2-6** (Goal 6) Migrate a Phase 1 DB with 10k v1 rows → verify passes; old rows searchable; v6 backfill audit event present.
- **A2-7** Catalog unaffected by the input-schema change (I2-4).

### 13.5 Chaos / negative
- N2-1 Key-map file deleted at runtime → requests keep working on last good map; `health` degraded; restored file hot-reloads.
- N2-2 Kill the process mid-capture under load → on restart `verifyChain` passes (transaction atomicity, §8.3).
- N2-3 One tenant at 10× its rate limit → other tenant's p95 unaffected (±10 %).

---

## 14. Rollout & rollback

- **Order:** WI2-1 (schema + migration) ships first behind nothing — it is additive; then WI2-2/3 (context + attribution) — single mode gains attribution with no behaviour change; then WI2-4/5 (shared mode) — off by default.
- **Migration:** backup (volume snapshot) → set `AGENT_SENTRY_COMPANY_ID` → restart (migration runs on `initialize`, as today **[V]** `store.ts:47-89`) → `agentsentry memory verify`. Rollback: restore snapshot; v6 is forward-only (no down migration; the columns are harmless to a v5 binary except `schema_version` table value > 5, which a v5 binary should tolerate — **[I]** U2-4b tests the v5 binary opening a v6 file).
- **Shared mode enable:** register per-company connections (WI2-5) with `forward` set → start instance in shared mode → bind profiles to one test agent per company → A2-4 → widen.
- **Rollback from shared to single:** export per tenant (`agentsentry memory export --tenant`, WI2-6) into per-company files; start S-1 instances; delete the shared file.

---

## 15. Work items

| WI | Description | Area | Depends on | Blocking P2? | Est. |
| --- | --- | --- | --- | --- | --- |
| WI2-1 | Schema v2 types, `computeHash` v1/v2, SQLite migration v6 + backfill, provider conditions incl. vector pre-filter, `prune({company_id})`; U2-4, U2-5, U2-11 | `src/memory/schema.ts`, `migrations/migration-v6.ts`, `providers/sqlite-provider.ts`, `store.ts` | P1 WI-3 (tags/metadata stamping gives backfill sources) | **yes** | M |
| WI2-2 | `RequestContext` + ALS in transport; header parser; stdio default context; U2-1, U2-2 | `src/mcp/request-context.ts`, `transport.ts`, `server.ts` | P1 WI-2 (per-session transports) | yes | S |
| WI2-3 | Attribution precedence in `capture_event`/`generate_handoff`; new optional inputs on `search_history`/`recall_context`; `health` fields; U2-3, U2-12, C2-2 | `src/mcp/tools/*` | WI2-1, WI2-2 | yes | S |
| WI2-4 | Shared mode: key map loader + constant-time lookup + hot reload; R-1…R-5; startup invariants; store-level tenant enforcement + SQL predicate guard; per-tenant rate limit; U2-6…U2-9 | `src/mcp/auth.ts`, `transport.ts`, `store.ts`, `src/config/` | WI2-1…3 | yes | M |
| WI2-5 | Registration script: `headerPolicy.metadata.forward` on every connection; `--tenant-mode shared`; one connection per company; I2-1, I2-2 | `scripts/paperclip/` | P1 WI-4 | yes | S |
| WI2-6 | Per-tenant chain + write lock + `BEGIN IMMEDIATE`; `fork_detected`; CLI `memory verify --tenant`, `memory export --tenant`; U2-10, N2-2 | `store.ts`, `providers/sqlite-provider.ts`, `src/cli/commands/memory*` | WI2-1 | yes | M |
| WI2-7 | Docs: `docs/memory-schema.md` v2 fields + hash rule + fix `prev_hash` genesis drift; README tenancy section; C2-3 | `docs/` | WI2-1 | yes | XS |
| WI2-8 | Metrics with hashed `company` label; new counters; log fields; dashboards | `src/observability/` | WI2-2 | should | S |
| WI2-9 | Supabase hardening (§7 checklist): tenant column, `schema_version`, RLS + per-tenant role, locks, chained-insert RPC, circuit breaker, pooled provider selectable; I2-5 | `src/memory/providers/supabase*`, `migrations/supabase-migration-v2.sql` | D2-4 | **no** | L |
| WI-6 (from P1) | **Re-scoped**: "signed caller identity" is not available from Paperclip (F-8). Replaced by WI2-4 (credential-bound tenant) + WI2-5 (header forwarding as a cross-check). File an upstream request for signed `_meta`/header identity (D2-1). | – | – | closed by re-scope | – |

Suggested order: WI2-1 → WI2-2 → WI2-3 → WI2-6 → WI2-7 → WI2-4 → WI2-5 → WI2-8 → (WI2-9).

---

## 16. Open decisions

| # | Decision | Recommendation | Closes when |
| --- | --- | --- | --- |
| D2-1 | Upstream request to Paperclip: signed identity for remote MCP servers (HMAC of `x-paperclip-*` + timestamp under a per-connection secret, or `_meta` claims) | File the issue at Phase 2 start; design shared mode so it can verify a signature later without schema change (`RequestContext.paperclip.signature?`) | Paperclip response; not blocking |
| D2-2 | Shared mode storage: one file with predicate (S-2) vs. one SQLite file per tenant inside one process | S-2 (one file) for simplicity of chain/locks/backup; revisit if a tenant needs separate retention or export cadence | A2-5 passes at target load |
| D2-3 | Re-chain legacy v1 rows after backfill so `company_id` becomes tamper-evident | **No** for Phase 2 (preserves original hashes/checkpoints); offer `memory rechain --tenant` as an explicit operator command in Phase 5 | product call |
| D2-4 | Whether any customer needs Postgres-class storage in the Phase 2 window | Defer WI2-9 until a named requirement; keep Supabase "experimental" | product call |
| D2-5 | `session_id` semantics for gateway traffic: equal to `run_id` (recommended) vs. gateway session id | `run_id` — it is what `recall_context` groups by and what Paperclip's audit joins on | A2-2 |
| D2-6 | Hashed vs. raw `company` metric label | Hashed (§11) | security sign-off |

---

## 17. References

- AgentSentry **[V]**: `src/memory/schema.ts` (types, `computeHash`, `validateEventInput`), `src/memory/store.ts` (`capture`, `search`, `verifyChain`, prune-on-init), `src/memory/providers/storage-provider.ts`, `src/memory/providers/sqlite-provider.ts` (`vectorSearch` window, `textSearch`, `query`, locks, `getLatestHash`), `src/memory/migrations/{sqlite-migrations.ts, migration-v4.ts, supabase-migration.sql}`, `src/memory/providers/supabase-provider.ts`, `supabase-base.ts`, `pooled-supabase-provider.ts`, `provider-factory.ts`, `src/memory/intelligence.ts` (`ContextRecaller`), `src/mcp/transport.ts`, `src/mcp/auth.ts`, `src/mcp/server.ts`, `src/mcp/tools/{capture-event,search-history,recall-context,generate-handoff}.ts`, `src/coordination/coordinator.ts`, `src/observability/circuit-breaker.ts`, `tests/contracts/doc-contracts.test.ts`, `tests/memory/providers/supabase-integration.test.ts`.
- Paperclip **[V]** (`@50b932a`): `server/src/services/tool-gateway.ts` (`buildRemoteHeaders`, `metadataHeadersForSession`, outbound `tools/call`, passthrough deny-list), `server/src/services/tool-access/mcp-http.ts` (`clientInfo`), `packages/shared/src/validators/tool-access.ts` (`toolTransportConfigSchema`, `toolMcpGatewayHeaderPolicySchema`), `packages/db/src/schema/tool_access.ts` (company-scoped tables, `tool_invocations`, `tool_call_events`), `server/src/routes/authz.ts`, `server/src/middleware/auth.ts`, `server/src/agent-auth-jwt.ts`.
- Research notes (session-local, not in repo): `scratchpad/agentsentry-survey.md`, `scratchpad/paperclip-research.md`.
