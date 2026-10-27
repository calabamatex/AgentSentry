# Engineering Spec — Phase 4: Distribution (App definition, plugin publishing, install experience)

| | |
| --- | --- |
| **Status** | Draft v1 — implementation-ready for Phase 4; Tracks B/C carry external dependencies flagged [I] |
| **Date** | 2026-10-27 |
| **Parent** | [paperclip-integration.md](./paperclip-integration.md) §6 Phase 4 (strategy); [paperclip-phase1-engineering-spec.md](./paperclip-phase1-engineering-spec.md) v3 (connection contract, header/auth facts, WI-1…WI-5); [paperclip-phase3-engineering-spec.md](./paperclip-phase3-engineering-spec.md) (the plugin this phase ships) |
| **Owner** | _unassigned_ |
| **AgentSentry** | v0.6.0-beta.1 (`agent-sentry/`) |
| **Paperclip** | `paperclipai/paperclip@50b932a` (master), read 2026-10-27 |

**Scope.** Make AgentSentry discoverable and installable by Paperclip operators with the least friction Paperclip's actual distribution surfaces allow: (A) the Phase 3 plugin published to npm; (B) a curated App definition submitted to Paperclip's catalog so AgentSentry appears in **Apps → Browse**; (C) a self-hosted distribution-catalog bundle for operators who build their own Paperclip image. Plus the AgentSentry-side packaging (container image, quick-start, compat matrix, supply-chain hygiene) that every track depends on.
**Out of scope.** The plugin's behaviour (Phase 3), multi-tenant store (Phase 2), task↔event bridge (Phase 5), any Paperclip-side feature work beyond the catalog data + connector policy entry that Track B requires.

**Grounding legend.** **[V]** verified in source (AgentSentry `src/`, repo `.github/workflows/`, or Paperclip at the commit above — paths relative to each repo root). **[V-doc]** stated in a Paperclip doc (`doc/connections/CONNECTOR-PLAYBOOK.md`, `doc/plugins/PLUGIN_SPEC.md`, `doc/plugins/DISTRIBUTION-PLUGINS.md`) but not confirmed in route/service code. **[I]** inference or external dependency; the test or sign-off that closes it is named alongside.

---

## 0. Reality check (what "distribution" means in Paperclip today — source wins)

| # | Common assumption | Source says | Consequence for AgentSentry |
| --- | --- | --- | --- |
| R-1 | Paperclip has a public plugin marketplace/registry | PLUGIN_SPEC explicitly excludes "a public marketplace" and "cloud/SaaS multi-tenancy" (`doc/plugins/PLUGIN_SPEC.md:61-62`) **[V-doc]**; the `doc/CLIPHUB.md` registry has **no server implementation** (NOT FOUND in `server/src`) **[V]**. | There is nothing to "list on". Plugin discovery is npm search + our own docs. |
| R-2 | Any MCP server can be added to the Apps store by its vendor | Store visibility is a hard-coded allowlist `CONNECTABLE_APP_SLUGS` (`packages/shared/src/app-definitions.ts:6-48`) minus `APP_STORE_HIDDEN_SLUGS` (`:60-81`) → `APP_STORE_DEFINITIONS` (`:83`) **[V]**; definitions are one JSON per provider under `packages/shared/src/app-definitions/` ingested by `scripts/ingest-app-definitions.mjs` **[V]**. Third parties land via **PR to `paperclipai/paperclip`** following `doc/connections/CONNECTOR-PLAYBOOK.md` ("adding a vendor to the Apps catalog as data, not as a plugin", `:19-23`) **[V-doc]**. | Store presence = a merged upstream PR. Acceptance and timing are **outside our control** ([I], D4-1). |
| R-3 | Plugins are installed by any company admin | `POST /api/plugins/install` is **instance-admin only** (`server/src/routes/plugins.ts:1178-1179`) **[V]**; plugin rows are instance-scoped, no `company_id` (`packages/db/src/schema/plugins.ts:23-45`) **[V]**; per-company on/off lives in `plugin_company_settings.enabled` **[V]**. | The install audience is the operator who runs the Paperclip instance, not each company. Docs target that persona. |
| R-4 | Cloud-hosted Paperclip can install our plugin from npm | Cloud-managed instances reject npm/registry installs with 403 and allow only paths inside the bundled catalog root (`routes/plugins.ts:1212-1240`; `server/src/services/plugin-install-guard.ts:1-24`) **[V]**. | On Paperclip Cloud, only Track B (App) or inclusion in Paperclip's own bundled catalog reaches users. Track A is self-hosted only. |
| R-5 | npm plugins are verified/signed by Paperclip | No signature or integrity verification on npm installs (grep of `plugin-install-guard.ts`, `plugin-registry.ts`, `plugin-loader.ts`) **[V]**; the only digest mechanism is the self-hosted `distribution/catalog.json` bundle hash, which "does not authenticate an untrusted image builder" (`doc/plugins/DISTRIBUTION-PLUGINS.md:40-42`) **[V-doc]**. | Supply-chain trust is **our** job: npm provenance, pinned deps, SBOM (§7). |
| R-6 | Store cards show categories/tags/risk tier | Browse renders logo, `name`, `description`, aggregator icons, Connect/Manage (`ui/src/pages/apps/Browse.tsx:1150-1166`) **[V]**; `featured`, `categories`, `tags`, `riskTier` are **not rendered** **[V]**. | Name + one-line description carry the whole pitch. |
| R-7 | "Connect your own MCP server" is second-class | It is a first-class guided path (**Apps → Connect an app → Connect your own MCP server**, `doc/connections/GENERIC-REMOTE-MCP.md:18`) **[V-doc]**, but creates the connection with `quarantineNewEntries:false, unverifiedServer:true` (`server/src/services/tool-access.ts:2128`) **[V]**. | This is Phase 1's path and remains the zero-dependency fallback ("Track 0"). Track B upgrades it to a reviewed connector with drift quarantine. |

**Recommendation.** Ship Track A and the packaging work (§6–§7) unconditionally — they are fully under our control and are prerequisites for everything else. Submit Track B as soon as Phase 1 acceptance (A-1…A-7) passes, because the playbook's live-proof evidence (§4.5) *is* Phase 1's acceptance run. Treat Track C as documentation-only until a customer builds their own image. Measure "visibility" by npm installs and opt-in telemetry, not by store presence, until the upstream PR merges.

---

## 1. Goals, non-goals, exit criteria

### 1.1 Goals
1. An operator of a self-hosted Paperclip can install the AgentSentry plugin from npm and connect a per-company AgentSentry instance in ≤ 15 minutes using only our docs (Track A + Track 0).
2. AgentSentry appears in Paperclip's **Apps → Browse** with a reviewed connector policy (`quarantineNewEntries: true`, explicit `classifyRisk`) so catalog drift is quarantined and write tools are ask-first by default (Track B).
3. Every published artifact (npm package, container image) is reproducible, provenance-attested, and pinned to a tested Paperclip host version range.
4. Install failures surface as actionable messages, never silent `deny_default`/401/`400 Server already initialized`.
5. We can count installs and active instances (opt-in) to judge the visibility bet.

### 1.2 Non-goals (Phase 4)
- Running AgentSentry as a Paperclip-hosted (`platform_provisioned`) service — `ownershipAvailability` default is `customer: true` only (`app-definitions.ts:86-90`) **[V]** and we have no hosted offering.
- OAuth/DCR auth for the MCP endpoint — AgentSentry auth is a static key (Phase 1 X-7) **[V]**; `auth:"api_key"` is the correct method.
- A Paperclip-side marketplace, registry, or signing scheme (R-1, R-5).
- Multi-instance cloud plugin distribution — PLUGIN_SPEC calls dynamic install "not yet cloud-ready" (`PLUGIN_SPEC.md:31`) **[V-doc]**.

### 1.3 Exit criteria → tests
Goal 1 → A4-1; Goal 2 → A4-2 (+ D4-1 sign-off); Goal 3 → C4-1, C4-2; Goal 4 → A4-3; Goal 5 → A4-4. Phase 4 is complete when A4-1, A4-3, A4-4 pass, Track B is **submitted** with the playbook evidence attached, and WI4-1…WI4-6 are merged. Track B *merge* is tracked as D4-1 and is not a gate.

---

## 2. Distribution tracks

```
                      ┌──────────────────────────────────────────────────────────────┐
  Operator persona    │ Track 0  Connect your own MCP server   (Phase 1, no deps)    │ self-hosted + Cloud
                      │ Track A  npm: paperclip-plugin-agentsentry (Phase 3 plugin)  │ self-hosted only (R-4)
                      │ Track B  Apps → Browse card "AgentSentry" (upstream PR)      │ self-hosted + Cloud
                      │ Track C  distribution/catalog.json bundle (custom images)     │ self-hosted images
                      └──────────────────────────────────────────────────────────────┘
  All tracks ──▶ per-company AgentSentry instance (container, §6.1) ◀── Phase 1 §10
```

| Track | Delivers | Depends on | Go when | No-go when |
| --- | --- | --- | --- | --- |
| 0 | Phase 1 runbook as operator docs | Phase 1 done | always | — |
| A | `paperclip-plugin-agentsentry@x.y.z` on npm + install docs | Phase 3 plugin passes its acceptance; WI4-1 | A4-1 passes against a clean self-hosted Paperclip at the pinned host version | plugin needs capabilities not yet approved by the host (`upgrade_pending`, §3.4) |
| B | `packages/shared/src/app-definitions/agentsentry.json` + connector policy + branding, merged upstream | Phase 1 A-1…A-7 evidence; WI4-4 | evidence matrix (§4.5) complete with no "fail"; maintainers accept | maintainers decline or require hosted ownership we cannot provide → fall back to Track 0 docs |
| C | `distribution/catalog.json` entry + bundle build script | Track A artefact | a customer builds their own Paperclip image | no such customer (keep as doc) |

---

## 3. Track A — npm plugin

### 3.1 Package identity **[V]**
- Discovery convention: `NPM_PLUGIN_PACKAGE_PREFIX = "paperclip-plugin-"` (`server/src/services/plugin-loader.ts:73`); scoped `@scope/plugin-*` also accepted (`:661`). PLUGIN_SPEC: `id` should equal the npm package name (`PLUGIN_SPEC.md:390`) **[V-doc]**, but the manifest `id` regex `^[a-z0-9][a-z0-9._-]*$` (`packages/shared/src/validators/plugin.ts:780-783`) **[V]** forbids `@` and `/`.
- **Decision:** unscoped package **`paperclip-plugin-agentsentry`**, manifest `id: "agentsentry"` (matches the application key used in Phase 1 §9 and the Track B slug), `displayName: "AgentSentry"`. Tools register as `agentsentry:<tool>` (`server/src/services/plugin-tool-registry.ts:39,245-247`) **[V]**.
- Publishing is to npm under the `@calabamatex` org account; package is unscoped by the rule above (D4-2 records the alternative `@calabamatex/paperclip-plugin-agentsentry`, which also satisfies `:661`).

### 3.2 Manifest resolution and package layout **[V]**
`package.json#paperclipPlugin.manifest` → `dist/manifest.js` → `manifest.js` (`plugin-loader.ts:960-990`); imported via `pathToFileURL` (`:1357`). Layout:
```
paperclip-plugin-agentsentry/
  package.json        { "name", "version", "paperclipPlugin": { "manifest": "dist/manifest.js", "worker": "dist/worker.js", "ui": "dist/ui.js" }, "files": ["dist/"] }
  dist/manifest.js    export default { id:"agentsentry", apiVersion:1, version, displayName, description, author, categories:["connector","automation"], minimumHostVersion:"<pinned>", capabilities:[…Phase 3 list…], entrypoints:{ worker:"dist/worker.js", ui?:"dist/ui.js" }, instanceConfigSchema, tools:[…], jobs?:[…] }
  dist/worker.js      definePlugin({ setup, onHealth, onConfigChanged, onValidateConfig, onShutdown })
  README.md           install + config + per-company enable (§8.2)
```
`categories` must be from `["connector","workspace","automation","ui"]` (`packages/shared/src/constants.ts:1304-1309`) **[V]**. `minimumHostVersion` is validated as semver (`validators/plugin.ts:793`) but its enforcement site was **NOT FOUND** **[V]** — we set it anyway for forward compatibility and enforce it ourselves in `setup` by comparing `instanceInfo.hostVersion` (`packages/plugins/sdk/src/protocol.ts:336-362`) **[V]** and reporting `onHealth → { status:"degraded", message }` when below floor.

### 3.3 Install path (operator) **[V]**
- CLI: `paperclipai plugin install paperclip-plugin-agentsentry [--version x.y.z]` (`cli/src/commands/client/plugin.ts:366-701`); API: `POST /api/plugins/install { packageName, version?, isLocalPath? }` (`routes/plugins.ts:1178`), instance-admin.
- Loader → `lifecycle.load` → `ready` when no new capability approval is needed (`:1247-1267`). Status machine `installed → ready → disabled → error → upgrade_pending → uninstalled` (`constants.ts:1288-1296`).
- Per-company: `plugin_company_settings.enabled` default `true` (`packages/db/src/schema/plugin_company_settings.ts:18-30`) **[V]**; config `POST /api/plugins/:pluginId/config` validated against `instanceConfigSchema`, `secret_ref` bindings synced (`routes/plugins.ts:2402-2424`) **[V]**.
- **Config contract (from Phase 3):** `instanceConfigSchema` requires `agentSentryUrl` (string, uri) and `accessKey` (`{type:"secret_ref", secretId}` binding, `packages/shared/src/types/secrets.ts:35-41`) **[V]**; `onValidateConfig` performs `GET {agentSentryUrl}/health` and a `tools/list` with the key, returning `{ ok:false, errors:[…] }` with the §8.4 messages.

### 3.4 Upgrades **[V]**
`POST /api/plugins/:pluginId/upgrade { version? }` (`routes/plugins.ts:2292-2325`) → `plugin-lifecycle.ts:629-642`. A version that **adds capabilities** lands in `upgrade_pending` until an operator enables it (`:612-613`). Rule: never add a capability in a patch release; batch capability additions into minor releases and call them out in the changelog header `## Requires operator approval`.

### 3.5 Deliverables
- WI4-1 publish pipeline (§7.2), WI4-2 README/install docs (§9), `CHANGELOG.md` with the approval marker above.

---

## 4. Track B — Curated App definition (upstream PR)

### 4.1 What the PR contains (required diff set) **[V-doc]**
Playbook Phase 11 lists the reviewed diff (`CONNECTOR-PLAYBOOK.md:1547-1553`): `scripts/ingest-app-definitions.mjs`, `packages/shared/src/app-definitions/` (our JSON), `packages/shared/src/app-definitions.generated.ts` (regenerated via `pnpm connections:ingest-app-definitions`, `:2416`), `ui/public/brands/apps/` (logo per `CONNECTOR-ICONS.md`), and — only if needed — `server/src/services/tool-access.ts` / `tool-gateway.ts`. For AgentSentry we additionally touch:
- `packages/shared/src/app-definitions.ts` — add `"agentsentry"` to `CONNECTABLE_APP_SLUGS` (`:6-48`) **[V]** (without it the definition is recognised but not browsable).
- `packages/shared/src/app-definitions.ts::recommendedDefaultsForApp` (`:266-294`) **[V]** — add a branch returning `askFirstRiskLevels: ["write","destructive"]` for `app.slug === "agentsentry"`, modelled on the `enterpret` branch (`:277-285`). This is the only mechanism by which a gallery connect yields ask-first policies by default (Phase 1 §0 X-… / research discrepancy 12).
- `server/src/services/connectors/tool-policy.ts` (`reviewedPolicies`, `:29-55`) **[V]** — add `{ sourceTemplateKey: "agentsentry", quarantineNewEntries: true, classifyRisk: agentsentryRisk, matchesConnection: c => c.transport === "mcp_remote" && /\/mcp$/.test(String(c.config.url ?? "")) && c.config.sourceTemplateKey === "agentsentry" }` plus `server/src/services/connectors/agentsentry/risk.ts` exporting `agentsentryRisk(tool) => tool.name === "agent_sentry_capture_event" || tool.name === "agent_sentry_generate_handoff" ? "write" : tool.name.startsWith("agent_sentry_") ? "read" : null`. Returning `null` for unknown names lets the generic classifier run (`descriptors.ts:120-121`) **[V]**, so a future tool is classified by its annotations and then quarantined by the flag.
- `pnpm-lock.yaml` is **not** committed ("GitHub Actions owns it", `:1562`) **[V-doc]**.

### 4.2 The `AppDefinition` literal
Validated against `AppDefinition`/`ConnectionMethodDef` (`packages/shared/src/types/app-definition.ts:2-6`) **[V]** and the ingest script's `validateApp` (`scripts/ingest-app-definitions.mjs:2054-2093`) **[V]**: `api_key` tool methods **require `keyPlacement`**; every `required` non-checkbox field needs a `placeholder`.

```json
{
  "schemaVersion": 1,
  "slug": "agentsentry",
  "name": "AgentSentry",
  "description": "Persistent memory, secret scanning, and task-risk checks for every agent, with a hash-chained audit trail.",
  "categories": ["ai", "developer"],
  "tags": ["memory", "safety", "audit", "secrets"],
  "featured": false,
  "branding": {
    "logoUrl": "/brands/apps/agentsentry.svg",
    "darkLogoUrl": "/brands/apps/agentsentry-dark.svg"
  },
  "urlPatterns": [],
  "docsUrl": "https://github.com/calabamatex/AgentSentry/blob/main/agent-sentry/docs/paperclip.md",
  "setupPrerequisite": {
    "title": "Run an AgentSentry instance for this company",
    "description": "AgentSentry is self-hosted. Start one instance per company and create its access key before connecting.",
    "steps": [
      "docker run -d -p 8787:8787 -e AGENT_SENTRY_ACCESS_KEY=<32+ random bytes> -v sentry-data:/data ghcr.io/calabamatex/agentsentry:0.7",
      "Confirm GET https://<your-host>/health returns {\"status\":\"ok\"}"
    ],
    "actionLabel": "Open the install guide",
    "actionUrl": "https://github.com/calabamatex/AgentSentry/blob/main/agent-sentry/docs/paperclip.md"
  },
  "methods": [
    {
      "key": "mcp-api-key",
      "label": "Connect your AgentSentry instance",
      "transport": "mcp_remote",
      "auth": "api_key",
      "ownershipModes": ["customer"],
      "whenToUse": "Connect a self-hosted AgentSentry instance dedicated to this company.",
      "defaults": {
        "serverUrlTemplate": "https://{sentryHost}/mcp",
        "mcpSessionRequired": true
      },
      "tenantFields": [
        {
          "key": "sentryHost",
          "label": "AgentSentry host",
          "type": "text",
          "required": true,
          "placeholder": "sentry-acme.internal.example.com",
          "helperMd": "Hostname of this company's AgentSentry instance, without https:// or path. One instance per company.",
          "validation": { "pattern": "^[A-Za-z0-9.-]+(:[0-9]{2,5})?$", "maxLength": 253 }
        }
      ],
      "credentialFields": [
        {
          "key": "accessKey",
          "label": "AgentSentry access key",
          "type": "password",
          "required": true,
          "secret": true,
          "placeholder": "Paste the AGENT_SENTRY_ACCESS_KEY value",
          "helperMd": "The value of AGENT_SENTRY_ACCESS_KEY on the instance. Stored as an encrypted secret and sent only to the host above."
        }
      ],
      "keyPlacement": { "location": "header", "name": "x-agent-sentry-key" },
      "guidanceMd": "Enter the host of the AgentSentry instance you run for this company and its access key. Paperclip discovers ten tools: eight read-only checks (security scan, task sizing, rules, context, git, recall, history search, health) and two writes that record to the company's audit memory. Writes are set to Ask first by default. Scanned content is processed in memory and never stored; recorded findings contain file, line and finding type only.",
      "warnings": [
        "Scanned content is sent to your AgentSentry instance. Do not point this connection at an instance you do not control.",
        "Use one instance and one key per company. Sharing an instance between companies mixes their audit memory.",
        "Tools run with the instance's own working directory: check_git and check_rules report on the instance, not on the agent's repository."
      ],
      "consoleLinks": {
        "docs": "https://github.com/calabamatex/AgentSentry/blob/main/agent-sentry/docs/paperclip.md",
        "keys": "https://github.com/calabamatex/AgentSentry/blob/main/agent-sentry/docs/paperclip.md#access-key"
      },
      "riskTier": "S2"
    }
  ],
  "agentInstructions": {
    "id": "agentsentry.usage",
    "version": 1,
    "text": "Before writing code that touches credentials, config, auth, migrations, or deployment, call agent_sentry_scan_security on the content and agent_sentry_size_task on the task. Treat HIGH/CRITICAL results as a reason to stop and ask. Use agent_sentry_recall_context at the start of a task that continues earlier work. Record decisions and incidents with agent_sentry_capture_event using redacted detail (file, line, finding type — never the secret value). agent_sentry_check_git and agent_sentry_check_rules describe the AgentSentry instance, not your workspace; treat rules_checked:0 as no verdict."
  }
}
```

Field-level justification **[V]** unless marked:
- `urlPatterns: []` — allowed (`api-key-generic.json` uses `[]`); self-hosted hosts cannot be enumerated. Consequence: Paperclip will not auto-suggest this app from a pasted URL (`suggestable` unset).
- `serverUrlTemplate` + `tenantFields` — the pattern Shopify uses (`app-definitions/shopify.json`, `"serverUrlTemplate": "https://{storeDomain}/api/ucp/mcp"` with a `storeDomain` tenant field) **[V]**; the method defaults type permits `serverUrlTemplate` (`app-definition.ts:5`) **[V]**. Whether the template resolver accepts a host with an optional port is **[I]** — I4-2 verifies; drop the port group if rejected.
- `keyPlacement.name: "x-agent-sentry-key"`, no `prefix` — matches Phase 1 X-7 (`src/mcp/transport.ts:84`) **[V]**; `prefix` is optional (`prefix?: string|null`) **[V]**.
- `defaults.mcpSessionRequired: true` — AgentSentry's transport is stateful (`Mcp-Session-Id`, Phase 1 X-8) **[V]**; the gateway honours `config.mcpSessionRequired` or `method.defaults.mcpSessionRequired` (`server/src/services/tool-gateway.ts:522,531`) **[V]**, and gallery remote-MCP connections set `mcpSessionRequired: true` at creation (`tool-access.ts:2108-2112`) **[V]**.
- `riskTier: "S2"` — playbook tiers: "S1 covers low-risk reads; S2 covers business data and narrow writes; S3 covers broad content or operational access; S4 covers payments, external sends, production changes, deletion, or tenant administration" (`CONNECTOR-PLAYBOOK.md:1773-1778`) **[V-doc]**. AgentSentry has 8 reads and 2 narrow, append-only writes to its own store, no external sends, no deletion → S2. It is *not* S1 because `scan_security` receives arbitrary content (data exposure) and `capture_event` persists company data. Reviewers may push to S3 on the content-exposure argument ([I], D4-3).
- `agentInstructions` — the `ConnectionInstructionTemplate {id, version, text}` shape is used by `cognee.json` **[V]**; `scripts/ingest-app-definitions.mjs` attaches it (`:2051-2052`) **[V]**. Text mirrors Phase 1 §8.2 `agentInstructions` and §6.4/§6.6 instance-scope caveats.
- `setupPrerequisite` — shape per `app-definition.ts:6` **[V]**; cognee uses it for a non-trivial prerequisite **[V]**. The image tag `0.7` assumes the Phase 1–3 work ships as 0.7.x (D4-4).

### 4.3 Recommended defaults we request **[V]**
`recommendedDefaultsForApp` returns `{ access:"all_agents", askFirstRiskLevels: [] }` for every app except gmail-archive and enterpret (`app-definitions.ts:266-294`). Our branch:
```ts
// AgentSentry's two writes append to the company's audit memory; keep them
// Ask first so a new connection never ships them as Allowed.
if (app.slug === "agentsentry") {
  return { access: "all_agents", askFirstRiskLevels: ["write", "destructive"] };
}
```
Effect at finish: managed `require_approval` policies, `priority: 50`, `selectors: {catalogEntryId}`, `config.source: "app_gallery_finish"` (`server/src/services/tool-access/connections/default-access.ts:283-300`) **[V]** for `capture_event` and `generate_handoff` — equivalent to Phase 1 §9 step 7 without the operator having to write it.

### 4.4 Connector policy entry → behaviour change vs Track 0 **[V]**
With `sourceTemplateKey: "agentsentry"` the connection is created through the gallery branch (`tool-access.ts:2095-2107`): `quarantineNewEntries` comes from `connectorToolPolicy("agentsentry").quarantineNewEntries` (`:2107`) → `true`; a later catalog refresh that adds or changes a tool quarantines it (`catalog/publication.ts:197-205`) — the behaviour Phase 1 §3.4 could only approximate. `classifyRisk` is consulted before the generic annotation path (`descriptors.ts:120-121`), so classification no longer depends on WI-1 annotations alone (defence in depth; WI-1 stays required for Track 0 users).

### 4.5 Evidence the PR must carry (Phase 9 live proof) **[V-doc]**
Run the exact lifecycle in `CONNECTOR-PLAYBOOK.md:1450-1486` against a disposable AgentSentry instance and record pass/fail/not-run per row of the evidence matrix (`:1977-2032`):

| Playbook step | Our evidence source | Maps to Phase 1 test |
| --- | --- | --- |
| 1 Preflight (public metadata only) | `GET /health` → `{status:"ok"}` | §10.5 |
| 2 Connect (enter credential) | gallery setup with `sentryHost` + key; connection `active`, health `healthy\|ok` (X-3) | I-1 |
| 3 Catalog | `discoveredCount:10`, 8 read / 2 write, schema hashes recorded | A-4 |
| 4 Safe read | `agent_sentry_health` via Test page | A-1 |
| 5 Write classification | `capture_event`/`generate_handoff` in the write group with Ask-first | A-4, I-3 |
| 6 Agent path | `tools/call` through a run-scoped gateway session | A-1, A-7 |
| 7 Refresh/reconnect | `catalog/refresh`, re-enter key, safe read again | N-2 |
| 8 Revoke/remove | rotate `AGENT_SENTRY_ACCESS_KEY` → 401; `DELETE /tool-connections/:id` → tools gone | A-5, N-2 |
| 9 Reconnect after removal | reconnect retains identity, no duplicate connection | I4-3 |
| 10 Secret inspection | grep evidence/logs for the canary key — absent | §13 hardening, WI-7 |

Evidence records **only** provider/method key, date, environment, endpoint origin/path, tool names/counts, schema hashes, policy/risk result, redacted codes, revoke/reconnect outcome (`:1467-1475`) — never key values or tenant content. Definition of Done checklist (`:1702-1728`) is copied into the PR verbatim with each box truthfully checked; "Chat channel" rows are marked not applicable.

### 4.6 PR body **[V-doc]**
Follow Phase 12 (`:1560-1600`): read `.github/PULL_REQUEST_TEMPLATE.md` first; fill **Thinking Path** (why a catalog entry: self-hosted MCP with static key, no lighter path because the custom-MCP branch cannot set `quarantineNewEntries` or ask-first defaults), **What Changed**, **Verification** (the suggested block: focused vitest, `pnpm check:token-gates`, `pnpm -r typecheck`, `pnpm test:run`, `pnpm build`, live proof line), **Risks** (content exposure, instance-scoped tools, catalog drift, rollback = remove slug from `CONNECTABLE_APP_SLUGS`), **Model Used**, **Checklist**. Do not merge ourselves (`:1587-1588`).

### 4.7 Timeline and risk **[I]**
Authoring + evidence: ~3 engineer-days once Phase 1 acceptance exists. Review latency and acceptance are the maintainers' call; the repo has an agent-executable playbook and 88 store definitions (`app-definitions.test.ts:899`) **[V]**, which suggests catalog PRs are routine, but nothing in source guarantees third-party acceptance. Mitigation: Track 0 docs stay primary until merge; the definition JSON is also shipped in our repo (`agent-sentry/deploy/paperclip/agentsentry.app.json`) so an operator can drop it into a fork.

---

## 5. Track C — Distribution catalog bundle (custom Paperclip images) **[V-doc]**

Applies only to operators who build their own Paperclip image (`doc/plugins/DISTRIBUTION-PLUGINS.md:1-6`). Contract (`:9-42`): `distribution/catalog.json` under `PAPERCLIP_BUNDLED_PLUGIN_ROOT` (default `/app/packages/plugins`) with entries `{ key, pluginKey, version, directory, digest: "sha256:<64hex>" }`; digest = sha256 of the UTF-8 JSON of a sorted depth-first inventory `[relativePosixPath, "sha256:"+sha256(bytes), permissionBits & 0777]`; limits 10 000 files / 256 MiB / 32 levels; runtime deps **bundled** ("startup never installs them"); manifest id/version must match the catalog; the server's `distributionBundleDigest` implements the hash (`server/src/services/distribution-plugin-catalog.ts:97-119`) **[V]**. Managed instances select entries via `plugins.autoInstall` (`:80-86`; `server/src/services/bundled-plugins.ts:10`) **[V]**; self-hosted catalogs do **not** auto-enable — operators install via the normal CLI (`:51-53`). Capability additions land in `upgrade_pending` even for same-version bundles (`:60-64`; activation guard `distribution-plugin-catalog.ts:74-91`) **[V]**.

Deliverable: `scripts/paperclip/build-distribution-bundle.ts` (WI4-6) that `npm pack`s Track A, extracts to `distribution/agentsentry/`, bundles deps (`npm ci --omit=dev` inside), computes the digest with the contract above, and emits a catalog fragment. Test C4-3 compares our digest with Paperclip's `distributionBundleDigest` on the same tree.

---

## 6. AgentSentry-side packaging

### 6.1 Container image (per-company instance)
Today: **no Dockerfile or compose anywhere in the repo** **[V]** (survey §11). Phase 1 WI-2 authors `agent-sentry/deploy/Dockerfile` (non-root, read-only FS except `/data`, per Phase 1 §10.1); Phase 4 **publishes** it.
- Registry: `ghcr.io/calabamatex/agentsentry`; tags `<semver>`, `<major.minor>`, `latest` (never `latest` in docs).
- Build: multi-stage from `node:22-slim`; `npm ci && npm run build` then copy `dist/src`, `package.json`, `agent-sentry.config.json` only (matches npm `files` **[V]** `package.json:24-27`); `onnxruntime-node` is optional **[V]** — default image excludes it (noop embeddings, Phase 1 §10.1), a `-embeddings` tag variant includes it (D4-5).
- Entrypoint: `node dist/src/mcp/server.js --http --port 8787` (Phase 1 X-9) **[V]**; `HEALTHCHECK` → `GET /health`.
- `deploy/docker-compose.paperclip.yml`: one service per company, env from `.env.<company>` (never committed), volume `sentry-<slug>-data:/data`, `AGENT_SENTRY_RULES_DIR=/rules` bind-mounted (Phase 1 §6.4).
- Image provenance: GHCR build attestations via `actions/attest-build-provenance` (§7.1).

### 6.2 `npx` quick-start
`package.json` exposes `bin: { agentsentry: ./dist/src/cli/index.js }` **[V]** but the MCP server has **no CLI subcommand** — it is started as `node dist/src/mcp/server.js` **[V]** (survey §5). WI4-3 adds `agentsentry serve --http --port <n> [--rules-dir <path>]` as a thin wrapper around `src/mcp/server.ts` `main()`, so the documented quick-start is:
```bash
AGENT_SENTRY_ACCESS_KEY=$(openssl rand -hex 32) npx @calabamatex/agentsentry@0.7 serve --http --port 8787
```
Contract test C4-4 asserts README snippet == `bin` behaviour (extends `tests/contracts/doc-contracts.test.ts`).

### 6.3 Version / compatibility matrix
| Artifact | Version source | Pinned against | Where recorded |
| --- | --- | --- | --- |
| `@calabamatex/agentsentry` (npm, image) | `package.json` **[V]** | MCP SDK `^1.27.1` (1.32.2 installed) **[V]** | `release-metadata.json` via `npm run sync-metadata` **[V]** |
| `paperclip-plugin-agentsentry` | its `package.json`; manifest `version` must equal it (Track C requires match **[V-doc]**) | Paperclip host version read at the SDK's `instanceInfo.hostVersion` **[V]**; `minimumHostVersion` set to the version containing commit `50b932a` (D4-6) | plugin `CHANGELOG.md` + `compat.json` `{ hostMin, hostTestedMax, sentryMin }` |
| App definition JSON | `schemaVersion: 1` **[V]** | Paperclip `AppDefinition` type at `50b932a` | upstream PR |

Rule: a plugin minor may require a newer AgentSentry minor, never vice versa; `onHealth` reports `degraded` when `GET /health` on the instance returns a version below `sentryMin` (WI4-3 adds `version` to the `/health` body — currently `{status, transport}` only **[V]**).

### 6.4 CI / release changes (`.github/workflows/publish.yml`) **[V]**
Current: on `release: published` → `npm ci`, `npm run build`, `npm test`, `npm publish` with `NPM_TOKEN`; `permissions: read-all` and job `contents: read`; no provenance, no image build. Changes (WI4-1):
1. Add `id-token: write` and publish with `npm publish --provenance --access public` (npm provenance attestation; requires the token to be a granular automation token or trusted publishing).
2. Add a `publish-plugin` job for `paperclip-plugin-agentsentry` (same flags), gated on the main package job.
3. Add `build-image` job: `docker/build-push-action` to GHCR with `provenance: true, sbom: true`, tags per §6.1; `packages: write`.
4. Add `attest` step (`actions/attest-build-provenance`) for the npm tarball and image digest.
5. Keep `npm test` **out** of the publish job's critical path memory-wise: CI already gates the full suite (`ci.yml:28-30`); publish runs `npm run test:contracts` + `test:unit` only (the full local suite is known to OOM, project memory).
6. Release checklist additions (docs/RELEASING or the existing `sync-metadata:check` step): `npm run sync-metadata:check` passes; `CHANGELOG` has the approval marker if capabilities changed; compat matrix updated; Track B JSON in `deploy/paperclip/` regenerated if tool list changed (tool count contract `tests/contracts/doc-contracts.test.ts:54-69` **[V]**).

---

## 7. Supply-chain hygiene (because Paperclip verifies nothing — R-5)

| Control | Mechanism | Verifies |
| --- | --- | --- |
| npm provenance | `--provenance` + `id-token: write` (§6.4) | consumers can `npm audit signatures`; our README tells them to |
| Pinned Actions | already SHA-pinned in `publish.yml` **[V]** (`actions/checkout@34e1148…`, `setup-node@49933ea…`) | keep; add Dependabot for actions |
| Lockfile + audit | `npm ci`; `npm audit --omit=dev --audit-level=high` in `ci.yml:53-55` **[V]** | no known high/critical at release |
| SBOM | CycloneDX via `@cyclonedx/cyclonedx-npm` attached to the GitHub release; image SBOM from buildx | downstream can diff |
| Plugin bundle size/content | `npm pack --dry-run` in CI; allowlist `dist/`, `README.md`, `LICENSE`, `package.json`; fail on `.env`, `*.db`, `data/` | nothing secret or runtime-generated ships |
| Reproducibility | `SOURCE_DATE_EPOCH` + pinned base image digest in the Dockerfile | identical rebuilds |
| Distribution bundle digest (Track C) | contract §5; C4-3 | integrity at Paperclip boot |

Explicitly **not** possible: Paperclip-side verification of any of the above; our docs must say "verify provenance with `npm audit signatures` before `plugin install`".

---

## 8. Install UX

### 8.1 Track 0 — Connect your own MCP server (operator, per company)
1. Start the instance (§6.1/§6.2), confirm `/health`.
2. Paperclip: **Apps → Connect an app → Connect your own MCP server** (`GENERIC-REMOTE-MCP.md:18`) **[V-doc]** → URL `https://<host>/mcp`, auth = API key, header name `x-agent-sentry-key`, paste key.
3. Review catalog (10 tools, 8 read / 2 write once WI-1 ships) and set **Ask first** on the two writes (not automatic on this path — research discrepancy 12).
4. Optional: `PATCH tool-connections/:id` with `config.headerPolicy.metadata.forward` (Phase 1 X-11) and `config.quarantineNewEntries: true` (Phase 1 §3.4, A-4b) — or run Phase 1's WI-4 script, which does all of the above idempotently.
5. First-run smoke: Test page → `agent_sentry_health`; then one agent run that calls `agent_sentry_scan_security`.

### 8.2 Track A — plugin (instance admin)
1. `npm audit signatures paperclip-plugin-agentsentry@x.y.z` (optional but documented).
2. `paperclipai plugin install paperclip-plugin-agentsentry@x.y.z` → status `ready` (or `installed` + capability review on a first install that the host flags).
3. Per company: Plugins → AgentSentry → Config: `agentSentryUrl`, `accessKey` (choose/create a company secret) → **Test** (`POST /plugins/:id/config/test` → `onValidateConfig`) **[V]** → Save.
4. Enable per company if the operator disabled it (`plugin_company_settings.enabled`).
5. Smoke: dashboard widget shows instance health (Phase 3 UI slot); an agent run lists `agentsentry:*` tools (gateway lists plugin tools only for sessions with `agentId`, `tool-gateway.ts:2960-2964`) **[V]**.

### 8.3 Track B — store card
1. **Apps → Browse → AgentSentry → Connect** → prerequisite card (§4.2 `setupPrerequisite`) → host + key → finish.
2. Catalog review shows 8 read / 2 write with writes **Ask first** preselected (§4.3).
3. Smoke as 8.1 step 5.

### 8.4 Failure modes → messages (plugin `onValidateConfig` / docs troubleshooting table)
| Symptom | Cause **[V]** | Message / fix |
| --- | --- | --- |
| Health `failed`/`error`, `401` | key mismatch or `Bearer ` prefix (Phase 1 X-7) | "AgentSentry rejected the key. Paste the raw `AGENT_SENTRY_ACCESS_KEY` value; do not add `Bearer`." |
| `400 Server already initialized` on second session | pre-WI-2 build (Phase 1 X-8) | "This AgentSentry build supports one MCP session. Upgrade to ≥ 0.7.0." |
| `discoveredCount:10` but all `read` | WI-1 annotations missing (Phase 1 §7) | "Catalog shows no write tools — upgrade AgentSentry to ≥ 0.7.0 so writes are governed." |
| Agent gets `deny_default` on every call | no profile include / no allow policy (`tool-access-policy.ts:1588`) | "No access policy grants these tools. Finish setup with Allow for reads, or run the Phase 1 registration script." |
| Plugin `upgrade_pending` after upgrade | new capability (`plugin-lifecycle.ts:612-613`) | "This version requests new permissions; review and Enable in Plugins." |
| Plugin install `403` on Cloud | install floor (`plugin-install-guard.ts`) | "Paperclip Cloud does not allow npm plugin installs. Use the AgentSentry app from Apps → Browse instead." |
| `rules_checked: 0` everywhere | rules dir not mounted (Phase 1 §6.4) | "Mount the company rules directory at `AGENT_SENTRY_RULES_DIR`." |
| Proxy `504` on scan | proxy timeout < `timeoutMs` (Phase 1 N-1) | "Raise the reverse-proxy timeout above 15 s." |

---

## 9. Documentation deliverables

| Doc | Location | Content |
| --- | --- | --- |
| Paperclip install guide | `agent-sentry/docs/paperclip.md` (linked from `docsUrl`, `consoleLinks.docs`) | Tracks 0/A/B/C steps (§8), troubleshooting (§8.4), access-key section (anchor `#access-key`), compat matrix (§6.3), provenance verification |
| README section | `agent-sentry/README.md` "Use with Paperclip" (additive — README changes need explicit approval per project memory; this adds a section, removes nothing) | 10-line summary + link |
| Website page | `website/src/app/paperclip/page.tsx` + `website/src/data/agentsentry.ts` entry (`installSnippets` gains a `paperclip` snippet **[V]** `:96-121`) | pitch, 3-step install, screenshot of the Browse card once merged |
| Plugin README | `paperclip-plugin-agentsentry/README.md` (npm landing page) | install, config schema, capabilities list with justification, approval-marker convention |
| Paperclip-side `guidanceMd`/`warnings` | in the App definition (§4.2) | kept ≤ 600 chars; rendered in setup (`ui/src/features/connections/ConnectionSetupFlow.tsx:2270-2272`) **[V]** |
| Drop-in definition | `agent-sentry/deploy/paperclip/agentsentry.app.json` | identical to the PR JSON; for forks |

---

## 10. Visibility metrics (honest version)

| Metric | Source | Caveat |
| --- | --- | --- |
| npm weekly downloads: `@calabamatex/agentsentry`, `paperclip-plugin-agentsentry` | npm registry API | counts CI/mirror fetches; trend, not users |
| GHCR image pulls | GHCR insights | same |
| Active instances (opt-in) | plugin `ctx.telemetry.track("agentsentry.heartbeat", { hostVersion, sentryVersion })` (`packages/plugins/sdk/src/types.ts:1169-1172`) **[V]** — emitted by a daily manifest `jobs[]` entry; **default off**, enabled by `instanceConfigSchema.telemetry: boolean` | we only see what Paperclip's telemetry pipeline forwards — where `telemetry.track` lands is **NOT verified** **[I]**; I4-4 inspects the sink. If it stays inside the operator's instance, fall back to an opt-in `GET https://telemetry.agentsentry.dev/ping` from `onHealth` (D4-7). |
| Store card impressions | none — Browse has no analytics hook we can read | unmeasurable |
| GitHub stars / referrers | GitHub insights | vanity |

Decision rule for the visibility bet (parent §8 checkpoint): if 90 days after Track A publish there are < 10 distinct opt-in instances **and** Track B is unmerged, visibility via Paperclip is not working and the next phase should weigh direct Claude Code/Cursor distribution instead.

---

## 11. Test plan

### 11.1 Unit (plugin repo + AgentSentry repo)
- U4-1 manifest validates against `pluginManifestV1Schema` (import from `@paperclipai/shared`): id regex, semver, categories enum, `tools ⇒ agent.tools.register`, `jobs ⇒ jobs.schedule` cross-field rules (`validators/plugin.ts:891-899, 970-978`) **[V]**.
- U4-2 `onValidateConfig` returns each §8.4 message for: 401, connection refused, `/health` non-200, version < `sentryMin`.
- U4-3 `agentsentry serve` CLI parses `--http --port --rules-dir`, sets `cwd` to rules dir, prints the bound port.
- U4-4 `/health` body includes `version` equal to `package.json`.

### 11.2 Contract
- C4-1 `npm pack --dry-run` file list == allowlist (§7); fails on `.env`, `*.db`, `data/`.
- C4-2 `release-metadata.json` version == `package.json` == image tag (extends `sync-metadata:check`).
- C4-3 Track C digest == Paperclip `distributionBundleDigest` for a fixture tree (run Paperclip's function from the clone in CI).
- C4-4 README quick-start snippet == `bin` name + flags (doc-contract style).
- C4-5 `deploy/paperclip/agentsentry.app.json` passes `validateApp` logic (port the 40-line function) and the tool names in `agentInstructions.text` ⊆ `tools/list`.

### 11.3 Integration (self-hosted Paperclip at the pinned host version, docker)
- I4-1 `paperclipai plugin install ./paperclip-plugin-agentsentry-x.y.z.tgz --local` → `ready`; config test → `ok:true`; agent session lists `agentsentry:*` tools.
- I4-2 Track B: apply the §4.1 diff to the Paperclip clone, `pnpm connections:ingest-app-definitions`, start the UI, connect via Browse with `sentryHost` incl. and excl. a port; assert connection `config.sourceTemplateKey==="agentsentry"`, `quarantineNewEntries===true`, `mcpSessionRequired===true`, and two `require_approval` policies with `config.source:"app_gallery_finish"`.
- I4-3 Remove connection → reconnect via Browse → one connection row, identity retained (playbook step 9).
- I4-4 Telemetry sink: with `telemetry:true`, locate where `ctx.telemetry.track` writes (`server/src/services/plugin-host-services.ts`) and record whether it leaves the instance.
- I4-5 Catalog drift on Track B: deploy a build with a renamed tool → refresh → entry `quarantined` (contrast Phase 1 A-4b on Track 0).

### 11.4 Acceptance (map to §1.1)
- **A4-1** (Goal 1) A tester with only `docs/paperclip.md` completes Track 0 + Track A on a fresh self-hosted Paperclip in ≤ 15 min; records time and every point of confusion.
- **A4-2** (Goal 2) I4-2 + I4-5 pass on our fork; PR opened upstream with the §4.5 evidence; D4-1 tracks merge.
- **A4-3** (Goal 4) Each §8.4 row reproduced; the documented message appears in the UI/CLI.
- **A4-4** (Goal 5) A heartbeat from an opt-in instance is observable at the sink identified in I4-4.

### 11.5 Negative
- N4-1 Install on a cloud-managed instance → 403 with the §8.4 message in our docs.
- N4-2 Plugin version bump that adds `issues.update` → `upgrade_pending`; README marker present.

---

## 12. Work items

| WI | Description | Area | Depends on | Blocking P4? | Est. |
| --- | --- | --- | --- | --- | --- |
| WI4-1 | Publish pipeline: npm `--provenance`, plugin publish job, GHCR image build + SBOM + attestations, release checklist; C4-1, C4-2 | `.github/workflows/publish.yml`, `agent-sentry/deploy/` | Phase 1 WI-2 (Dockerfile) | yes | M |
| WI4-2 | Operator docs: `docs/paperclip.md`, README section, website page, plugin README, troubleshooting table | `agent-sentry/docs/`, `website/` | WI4-3 | yes | M |
| WI4-3 | `agentsentry serve` subcommand; `/health` gains `version`; U4-3, U4-4, C4-4 | `src/cli/`, `src/mcp/transport.ts` | Phase 1 WI-2 | yes | S |
| WI4-4 | Track B authoring: `agentsentry.json`, `CONNECTABLE_APP_SLUGS`, `recommendedDefaultsForApp` branch, `connectors/tool-policy.ts` entry + `connectors/agentsentry/risk.ts`, branding SVGs (light/dark per CONNECTOR-ICONS), ingest, focused tests, evidence matrix, PR; I4-2, I4-3, I4-5 | Paperclip fork → upstream PR; `agent-sentry/deploy/paperclip/` | Phase 1 A-1…A-7 | should (submission), no (merge) | M |
| WI4-5 | Plugin packaging: manifest/package layout §3.2, `minimumHostVersion` + self-enforced floor, telemetry job (opt-in), CHANGELOG approval marker; U4-1, U4-2, I4-1 | `paperclip-plugin-agentsentry/` | Phase 3 plugin | yes | S |
| WI4-6 | Track C bundle script + catalog fragment; C4-3 | `scripts/paperclip/build-distribution-bundle.ts` | WI4-5 | no | S |
| WI4-7 | Supply-chain: Dependabot for actions, CycloneDX SBOM in release, pack allowlist test | `.github/`, `agent-sentry/scripts/` | – | should | XS |

Suggested order: WI4-3 → WI4-5 → WI4-1 → WI4-2 → WI4-7 → WI4-4 → WI4-6.

---

## 13. Open decisions

| # | Decision | Recommendation | Closes when |
| --- | --- | --- | --- |
| D4-1 | Upstream acceptance of the App definition | Submit after Phase 1 acceptance; keep Track 0 docs primary; no roadmap dependency on merge | PR merged or declined |
| D4-2 | Package name `paperclip-plugin-agentsentry` vs `@calabamatex/paperclip-plugin-agentsentry` | unscoped (discovery prefix `:73`; shorter install command); reserve the scoped name | npm publish |
| D4-3 | `riskTier` S2 vs S3 | S2 (§4.2 justification); accept S3 if reviewers require | PR review |
| D4-4 | AgentSentry version that carries Phases 1–3 | `0.7.0` (minor: new CLI subcommand, annotations, transport change) | release cut |
| D4-5 | Ship an `-embeddings` image variant with `onnxruntime-node` | yes, separate tag; default image stays noop | WI4-1 |
| D4-6 | `minimumHostVersion` value | the Paperclip release containing `50b932a`; read `package.json` version in the clone at WI4-5 time | WI4-5 |
| D4-7 | Telemetry sink if `ctx.telemetry.track` stays in-instance | opt-in HTTPS ping from `onHealth`, documented, default off | I4-4 |

---

## 14. Discrepancy log (distribution-relevant, source wins)

| # | Doc says | Source says | Consequence |
| --- | --- | --- | --- |
| X4-1 | `MCP-ACCESS-GOVERNANCE.md:218` "write requires approval by default" | no risk-based server default; ask-first comes from `askFirstCatalogEntryIds` at finish, and `recommendedDefaultsForApp` is `[]` for all but two apps (`app-definitions.ts:266-294`) **[V]** | Track B must add our branch (§4.3); Track 0 operators must set it by hand or run WI-4 |
| X4-2 | `MCP-ACCESS-GOVERNANCE.md:219,221` new write/destructive tools quarantined | only when `quarantineNewEntries` is true; custom MCP = `false` (`tool-access.ts:2128`) **[V]** | Track B's connector-policy entry is what buys drift protection |
| X4-3 | PLUGIN_SPEC §8.3 "display requested capabilities to the operator" at install (`PLUGIN_SPEC.md:263`) | install auto-loads to `ready` when no new approval is needed (`routes/plugins.ts:1254-1267`); review happens on capability additions at upgrade **[V]** | capability discipline in releases (§3.4) |
| X4-4 | PLUGIN_SPEC §13.2 host polls `onHealth` | no periodic health RPC caller found; `GET /plugins/:id/health` reads the DB row (`routes/plugins.ts:2162-2216`) **[V]** | our dashboard widget must call `ctx.data` itself; `onHealth` cannot be the sole liveness signal |
| X4-5 | `doc/CLIPHUB.md` describes a registry | no server implementation **[V]** | no "publish to CLIPHUB" step |
| X4-6 | `PLUGIN_SPEC.md:390` `id` = npm package name | `id` regex forbids `@`/`/` (`validators/plugin.ts:780-783`) **[V]** | `id:"agentsentry"`, package `paperclip-plugin-agentsentry` |

---

## 15. References
- Paperclip **[V]**: `packages/shared/src/app-definitions.ts`, `packages/shared/src/types/app-definition.ts`, `packages/shared/src/app-definitions/{api-key-generic,cognee,context7,shopify}.json`, `scripts/ingest-app-definitions.mjs`, `server/src/services/connectors/tool-policy.ts`, `server/src/services/tool-access.ts` (`:2095-2145`), `server/src/services/tool-access/catalog/{descriptors,publication}.ts`, `server/src/services/tool-access/connections/default-access.ts`, `server/src/services/tool-gateway.ts` (`:522,531,2960-2964`), `server/src/routes/plugins.ts`, `server/src/services/{plugin-loader,plugin-lifecycle,plugin-install-guard,distribution-plugin-catalog,bundled-plugins}.ts`, `packages/shared/src/validators/plugin.ts`, `packages/shared/src/constants.ts`, `packages/plugins/sdk/src/{protocol,types}.ts`, `ui/src/pages/apps/Browse.tsx`, `ui/src/features/connections/ConnectionSetupFlow.tsx`. **[V-doc]**: `doc/connections/CONNECTOR-PLAYBOOK.md`, `doc/connections/GENERIC-REMOTE-MCP.md`, `doc/plugins/PLUGIN_SPEC.md`, `doc/plugins/PLUGIN_AUTHORING_GUIDE.md`, `doc/plugins/DISTRIBUTION-PLUGINS.md`.
- AgentSentry **[V]**: `package.json`, `src/mcp/{server,transport,auth}.ts`, `src/cli/index.ts`, `tests/contracts/doc-contracts.test.ts`; repo `.github/workflows/{publish,ci}.yml`; `website/src/data/agentsentry.ts`.
- Research notes (session scratchpad): `paperclip-research.md` §1.8, §2, §6, §7; `agentsentry-survey.md` §5, §11.
