# AgentSentry: Comprehensive Plan of Action

**Created**: 2026-03-21
**Status**: Draft — awaiting approval
**Scope**: All three phases from executive analysis review

---

## Phase 1: Stop the Bleeding

**Goal**: Eliminate every trust-destroying inconsistency. After this phase, what the project claims to be matches what it actually is.
**Timeline**: 1–2 weeks
**Success criteria**: A user can `npm install`, follow the docs, and encounter zero contradictions or silent failures.

---

### 1.1 — Fix Package Publishing Integrity

**Problem**: `package.json` ships only `dist/`. Scripts, dashboard, templates, plugins, and config assets are excluded. Anyone installing from npm gets a broken product.

**Files to change**:
- `agent-sentry/package.json`

**Tasks**:

| # | Task | Detail |
|---|------|--------|
| 1.1.1 | Expand `files` field | Add `"scripts/"`, `"templates/"`, `"plugins/"`, `"config/"`, `"dashboard/"` to the `files` array. Only include what's actually needed at runtime — audit each directory first. |
| 1.1.2 | Fix `repository.url` | Change from `https://github.com/ruvnet/agent-sentry.git` to the actual repo URL for this project. |
| 1.1.3 | Add tarball smoke test | Create `tests/contracts/package-contents.test.ts`. Run `npm pack`, extract the tarball, and assert every runtime-required file exists. This prevents future regression. |
| 1.1.4 | Add CI install test | Add a CI step (GitHub Actions or equivalent) that does: `npm pack` → `npm install ./agent-sentry-*.tgz` → `npx agent-sentry --help` → assert exit 0. |

**Verification**: `npm pack --dry-run` output includes all required assets. CI green.

---

### 1.2 — Eliminate Python3 as Silent Dependency

**Problem**: `post-write-checks.sh` (line 22) calls `python3 -c` to parse JSON. If python3 is absent, the hook silently does nothing. Docs say python3 is "optional."

**Files to change**:
- `agent-sentry/scripts/post-write-checks.sh`
- Any other scripts using `python3` (audit all 20 scripts)

**Tasks**:

| # | Task | Detail |
|---|------|--------|
| 1.2.1 | Audit all scripts for python3 usage | `grep -l 'python3' agent-sentry/scripts/*.sh` — identify every script. |
| 1.2.2 | Replace python3 JSON parsing with node | Replace `python3 -c "import json..."` with `node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); ..."` or use `jq` (which is already used in `session-start-checks.sh`). Node is a hard dependency already. |
| 1.2.3 | Remove python3 from docs as optional | If python3 is no longer used, remove all references. If it remains for any reason, mark it as required. |

**Verification**: Uninstall python3 from a test environment, run full hook suite, confirm no silent failures.

---

### 1.3 — Reconcile All Documentation

**Problem**: At least 4 documented contradictions identified. For a safety product, this is lethal.

**Files to change**:
- Root `README.md`
- `agent-sentry/README.md` (package README)
- `agent-sentry/docs/getting-started.md`
- `agent-sentry/docs/api-reference.md`
- `TASKS.md` / `CONTEXT.md` (if they exist at project root)

**Tasks**:

| # | Task | Detail |
|---|------|--------|
| 1.3.1 | Supabase: pick one truth | The SupabaseProvider exists in code (`src/memory/providers/supabase-provider.ts`) and has tests. Decision needed: is it `[beta]` or `[experimental]`? Update every doc that mentions Supabase to use the chosen label consistently. |
| 1.3.2 | Multi-tool scope: pick one truth | The product is Claude-first today. Say so. Rewrite the root README's tool-neutrality claims to: "Primary integration: Claude Code. MCP server enables integration with any MCP-compatible tool." Remove or qualify Cursor/Codex/ChatGPT/Copilot claims unless there are actual integration tests for each. |
| 1.3.3 | CLAUDE.md optionality: resolve contradiction | `session-start-checks.sh` line 44 treats missing CLAUDE.md as a CRITICAL finding. Docs say it's optional. Pick one: either the hook downgrades to WARNING, or docs say it's recommended/required. Recommendation: make it a WARNING, not CRITICAL. |
| 1.3.4 | Config key paths: fix docs | `api-reference.md` documents `rules_file.claude_md_max_lines` and `rules_file.agents_md_max_lines`. Actual code (line 13-14 of `session-start-checks.sh`) reads `.rules_file.max_lines` for both. Either fix the code to use separate keys or fix the docs to match. |
| 1.3.5 | TASKS.md: mark completed items | Supabase provider, coordination primitives, plugin registry, event streaming all exist in code. Mark them as done (with maturity labels) or add notes explaining why they're still "open" despite code existing. |
| 1.3.6 | Add capability matrix to README | Add a table to the package README: |

**Capability matrix to add**:

```
| Feature                  | Status        | Notes                                    |
|--------------------------|---------------|------------------------------------------|
| SQLite memory store      | Stable        | Default provider, hash-chained            |
| MCP server (8 tools)     | Stable        | stdio transport                           |
| Claude Code hooks        | Stable        | Session start, post-write, checkpoint     |
| Progressive enablement   | Stable        | 5 levels                                  |
| Supabase provider        | Beta          | Requires external Supabase instance       |
| Dashboard / streaming    | Beta          | Local SSE/WebSocket, in-process bus       |
| Plugin registry          | Experimental  | Local directory scanning only             |
| Multi-agent coordination | Experimental  | Event-sourced, single-machine only        |
| CLI                      | Beta          | 8 command groups                          |
```

**Verification**: Read every doc end-to-end. Zero uses of unqualified claims about features that aren't stable.

---

### 1.4 — Fix Hook Reliability

**Problem**: Hooks silently degrade, use inconsistent config parsing, and employ brittle regex for security scanning.

**Files to change**:
- `agent-sentry/scripts/post-write-checks.sh`
- `agent-sentry/scripts/session-start-checks.sh`
- `agent-sentry/scripts/session-checkpoint.sh`

**Tasks**:

| # | Task | Detail |
|---|------|--------|
| 1.4.1 | Add loud failure on missing dependencies | Each script should check for required tools (`jq`, `node`, `git`) at the top and print `[AgentSentry] CRITICAL: <tool> is required but not found` instead of silently exiting. |
| 1.4.2 | Standardize config key access | Decide on canonical config shape. Document it. Make all scripts read the same keys the same way. |
| 1.4.3 | Add hook contract tests | Create `tests/contracts/hook-contracts.test.ts` that invokes each shell script with known JSON payloads and asserts expected output patterns. This prevents hook/doc drift. |

**Verification**: Run hooks with missing python3, missing jq, missing git — each produces a visible error message, not silence.

---

## Phase 2: Define the Core

**Goal**: Draw a hard line around what the product IS. Make that core boringly reliable. Stop spreading effort across experimental features.
**Timeline**: 2–4 weeks (after Phase 1)
**Success criteria**: The core path (install → configure → run hooks → use MCP tools → query memory) works perfectly every time, with end-to-end test proof.

---

### 2.1 — End-to-End Truth Tests

**Problem**: 66 unit tests exist, but no test validates the actual user journey from install to operation.

**Files to create**:
- `agent-sentry/tests/e2e/install-and-run.test.ts`
- `agent-sentry/tests/e2e/hook-lifecycle.test.ts`
- `agent-sentry/tests/e2e/mcp-server.test.ts`
- `agent-sentry/tests/e2e/dashboard-startup.test.ts`

**Tasks**:

| # | Task | Detail |
|---|------|--------|
| 2.1.1 | Install-and-run test | `npm pack` → install from tarball → `npx agent-sentry health` → assert output contains expected fields. |
| 2.1.2 | Hook lifecycle test | Programmatically invoke `session-start-checks.sh` → simulate file write → invoke `post-write-checks.sh` with mock JSON → invoke `session-checkpoint.sh` → verify each produces expected output and exit codes. |
| 2.1.3 | MCP server test | Start MCP server → connect via stdio → call each of the 8 tools → verify responses match documented schemas. |
| 2.1.4 | Dashboard startup test | Start dashboard server → HTTP GET `/` → assert 200 → GET `/api/events` → assert valid JSON → shutdown cleanly. |
| 2.1.5 | Supabase smoke test (conditional) | If `SUPABASE_URL` env var is set, run basic store/retrieve/search cycle against Supabase provider. Skip otherwise. Mark as `[beta]`. |

**Verification**: All e2e tests pass in CI. These become the regression gate — no release ships if they fail.

---

### 2.2 — Migrate Critical Hooks to TypeScript

**Problem**: Shell scripts with inline python3/jq/grep are hard to test, hard to maintain, and brittle across platforms.

**Files to create**:
- `agent-sentry/src/cli/hooks/session-start.ts`
- `agent-sentry/src/cli/hooks/post-write.ts`
- `agent-sentry/src/cli/hooks/session-checkpoint.ts`

**Files to modify**:
- `agent-sentry/scripts/session-start-checks.sh` → thin wrapper
- `agent-sentry/scripts/post-write-checks.sh` → thin wrapper
- `agent-sentry/scripts/session-checkpoint.sh` → thin wrapper

**Tasks**:

| # | Task | Detail |
|---|------|--------|
| 2.2.1 | Create TypeScript hook implementations | Port the core logic from each shell script into TypeScript. Use `process.stdin` for JSON input. Use the existing `MemoryStore`, `RulesValidation`, and `SecretDetection` primitives instead of regex grep. |
| 2.2.2 | Convert shell scripts to thin wrappers | Each `.sh` file becomes ~5 lines: pipe stdin to `node dist/src/cli/hooks/<name>.js`, pass through exit code. This preserves backward compatibility with existing hook configurations. |
| 2.2.3 | Add TypeScript hook unit tests | Test each hook handler with various JSON payloads, edge cases (missing fields, empty input, malformed JSON). |
| 2.2.4 | Replace regex security scanning | `post-write-checks.sh` uses `grep` patterns for dangerous calls and PII. Replace with the existing `SecretDetection` primitive (`src/primitives/secret-detection.ts`) which is already tested and more reliable. |

**Verification**: Existing hook integration tests still pass. New TypeScript unit tests cover edge cases that shell scripts missed.

---

### 2.3 — Formalize the Product Positioning

**Problem**: The project tries to be everything to everyone. This dilutes credibility.

**Files to change**:
- Root `README.md`
- `agent-sentry/README.md`

**Tasks**:

| # | Task | Detail |
|---|------|--------|
| 2.3.1 | Write a one-sentence product definition | Proposal: "AgentSentry is a local-first memory and safety layer for AI coding sessions, with Claude Code as the primary integration and MCP as the interop standard." |
| 2.3.2 | Restructure README around core path | Lead with: install → configure hooks → progressive enablement → query memory. Move coordination, plugins, streaming, dashboard to a "Beta & Experimental" section below. |
| 2.3.3 | Remove or qualify multi-tool claims | Unless there are integration tests for Cursor/Codex/Copilot, replace "works with X" with "architecturally compatible via MCP" and be honest about what's been tested. |

**Verification**: A new user reading the README gets an accurate picture of what works today in under 60 seconds.

---

### 2.4 — Harden MemoryStore as the Core Product

**Problem**: MemoryStore is the strongest component and the most defensible moat. It should be treated as the product kernel.

**Files to change**:
- `agent-sentry/src/memory/store.ts`
- `agent-sentry/src/memory/providers/sqlite-provider.ts`

**Tasks**:

| # | Task | Detail |
|---|------|--------|
| 2.4.1 | Add performance benchmarks to CI | The `benchmark.ts` file exists. Wire it into CI so regressions in store/search/prune performance are caught automatically. |
| 2.4.2 | Document the memory schema publicly | The event schema in `schema.ts` is the contract. Extract it into a standalone doc that users can reference for building integrations. |
| 2.4.3 | Add cross-session query examples | Create practical examples: "find all errors from last 5 sessions", "show files I edited most often", "recall what I learned about auth patterns." These demonstrate the moat. |

**Verification**: Benchmarks run in CI with regression thresholds. Schema doc is accurate.

---

## Phase 3: Strengthen the Moat

**Goal**: Make the features that differentiate AgentSentry genuinely excellent. Explicitly defer or downscope features that aren't core.
**Timeline**: 4–8 weeks (after Phase 2)
**Success criteria**: Memory + enablement are best-in-class. Experimental features are honestly labeled and don't distract from the core.

---

### 3.1 — Elevate Progressive Enablement

**Problem**: This is one of the best product ideas in the repo but it's buried. It should be the headline adoption story.

**Files to change**:
- `agent-sentry/src/enablement/engine.ts`
- `agent-sentry/src/enablement/dashboard-adapter.ts`
- Docs

**Tasks**:

| # | Task | Detail |
|---|------|--------|
| 3.1.1 | Create enablement onboarding flow | `npx agent-sentry enable --level 1` should print what it enables, what it doesn't, and how to level up. Make this the recommended first command after install. |
| 3.1.2 | Add level-specific documentation | For each level (1-5), document: what skills activate, what hooks run, what the user will notice, and when to upgrade. |
| 3.1.3 | Add enablement telemetry | Track (locally, in MemoryStore) which level the user is at and how long they've been there. Use this to suggest leveling up. |
| 3.1.4 | Position in README | Move enablement to the second section of the README, right after install. Frame it as: "Start with Level 1. You'll get safety nets without complexity. Level up when ready." |

**Verification**: New user can go from zero to Level 1 in < 2 minutes with clear guidance.

---

### 3.2 — Invest in Cross-Session Intelligence

**Problem**: This is the real moat — not safety checks (copyable) but accumulated operational knowledge across sessions.

**Files to change**:
- `agent-sentry/src/memory/store.ts`
- `agent-sentry/src/memory/enrichment.ts`
- New: `agent-sentry/src/memory/intelligence.ts`

**Tasks**:

| # | Task | Detail |
|---|------|--------|
| 3.2.1 | Build session summary generation | At session end, auto-generate a structured summary: files touched, errors encountered, patterns used, decisions made. Store as a first-class memory event. |
| 3.2.2 | Add pattern detection | Identify recurring patterns across sessions: "you always forget to run tests after editing X", "auth changes tend to break Y". Surface these as suggestions. |
| 3.2.3 | Add "recall" MCP tool | New MCP tool: `recall-context` — given a task description, search memory for relevant prior session context and return it. This is the killer feature for cross-session continuity. |
| 3.2.4 | Add organization-level memory (design only) | Design doc for how multiple team members could share relevant memory (patterns, decisions, conventions) without leaking individual session details. Do not implement yet. |

**Verification**: After 5+ sessions, the system surfaces genuinely useful prior context when starting similar work.

---

### 3.3 — Scope Down Experimental Features

**Problem**: Coordination, marketplace, and streaming are marketed alongside stable features, creating false expectations.

**Tasks**:

| # | Task | Detail |
|---|------|--------|
| 3.3.1 | Rename plugin "marketplace" to "registry" | Change all references. `registry.ts` already uses the right name internally. Update docs and comments to say "local plugin registry." Remove "marketplace" language until remote discovery exists. |
| 3.3.2 | Label coordination as "experimental" | Add header comment to `coordinator.ts`. Add `[experimental]` to all docs. Clarify: "single-machine, event-sourced coordination primitives. Not a distributed system." |
| 3.3.3 | Label streaming as "beta" | Clarify in docs: "local event streaming via SSE/WebSocket. Not a cloud event platform." |
| 3.3.4 | Create explicit roadmap tiers | Write a `ROADMAP.md` with three tiers: **Now** (what's stable), **Next** (what's beta and being hardened), **Later** (what's experimental and aspirational). |

**Verification**: No user encounters a feature marketed as production-ready that is actually experimental.

---

### 3.4 — Decide the Future of Coordination

**Problem**: The coordination layer exists but makes no strong guarantees. It needs to either become serious or be explicitly scoped.

**Tasks**:

| # | Task | Detail |
|---|------|--------|
| 3.4.1 | Define coordination guarantees | Document: what consistency model? What happens on failure? What are the limits? Even "best-effort, single-machine, no durability guarantees" is fine — just say it. |
| 3.4.2 | Add lock expiry and cleanup | Current lock implementation stores locks as events but may not handle expiry robustly. Add TTL enforcement and stale-lock cleanup. |
| 3.4.3 | Add coordination integration test | Test: spawn 3 agents, acquire/release locks, send messages, verify no lost updates or deadlocks under concurrent access. |
| 3.4.4 | Decision gate | After 3.4.1–3.4.3, decide: invest further (real lease semantics, conflict resolution) or freeze scope and label as "lightweight local coordination." |

**Verification**: Coordination has documented guarantees that match its implementation, and tests that prove those guarantees hold.

---

### 3.5 — Streaming Architecture Decision

**Problem**: Streaming works locally but has no path to scale without architectural decisions.

**Tasks**:

| # | Task | Detail |
|---|------|--------|
| 3.5.1 | Write ADR for streaming future | Document the decision: stay local-only (simpler, reliable) or invest in durable transport (Redis Streams, NATS, etc.). Consider: who is the customer? What do they actually need? |
| 3.5.2 | If staying local | Add backpressure handling, connection limits, and reconnection logic. Label as "local development dashboard." |
| 3.5.3 | If going distributed | Design: transport layer, auth model, tenancy, replay from storage. This becomes its own project phase. |

**Verification**: Clear architectural decision recorded. Implementation matches the chosen direction.

---

## Execution Principles

1. **No new features until Phase 1 is complete.** Every hour spent on new capabilities before the trust surface is clean is wasted.

2. **Every change gets a test.** Not just a unit test — a test that validates the claim the docs make about the feature.

3. **Docs are code.** Treat documentation inconsistencies as bugs with the same severity as code defects.

4. **Scope is a feature.** Saying "we don't do X yet" builds more trust than claiming X works when it doesn't.

5. **Memory is the moat.** Every other feature is either a delivery mechanism for memory (hooks, MCP, CLI) or an experiment. Invest accordingly.

---

## Dependencies Between Phases

```
Phase 1 (trust) ──must complete before──▶ Phase 2 (core)
Phase 2 (core)  ──must complete before──▶ Phase 3 (moat)

Within Phase 1: tasks are independent, can be parallelized
Within Phase 2: 2.1 and 2.2 can run in parallel; 2.3 and 2.4 can run in parallel
Within Phase 3: 3.1 and 3.2 can run in parallel; 3.3 is independent; 3.4 and 3.5 are independent
```

---

## Estimated Effort

| Phase | Tasks | Estimated Effort | Risk |
|-------|-------|-----------------|------|
| Phase 1 | 1.1–1.4 (16 subtasks) | 5–8 working days | Low — all well-defined fixes |
| Phase 2 | 2.1–2.4 (14 subtasks) | 8–12 working days | Medium — hook migration requires care |
| Phase 3 | 3.1–3.5 (16 subtasks) | 15–25 working days | Medium-high — design decisions required |
| **Total** | **46 subtasks** | **28–45 working days** | |
