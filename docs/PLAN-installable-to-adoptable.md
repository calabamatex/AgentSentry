# AgentOps: From Installable to Adoptable

## Plan of Action — Phase 1 & Phase 2

**Goal**: Close the gap between "works for the author" and "works for a new user."

**Current state verified against codebase on 2026-03-22.**

---

## Phase 1: Make It Installable

The objective is: a stranger runs `npm install agentops`, wires up the MCP server, and everything works without reading source code or cloning the repo.

### 1.1 — Fix Config Resolution (BLOCKING)

**Problem**: Config loading uses 5 different path strategies across the codebase. The primary one (`path.resolve('agent-sentry/agentops.config.json')`) assumes CWD is the repo root. An npm-installed user has the config at `node_modules/agent-sentry/agentops.config.json` — the CWD-relative path will fail silently and fall back to defaults, which may or may not be what the user expects.

**Affected files** (verified):
| File | Line | Strategy |
|------|------|----------|
| `src/memory/providers/provider-factory.ts` | 36 | `path.resolve('agent-sentry/agentops.config.json')` |
| `src/mcp/tools/health.ts` | 115 | `pathModule.resolve('agent-sentry/agentops.config.json')` |
| `src/cli/commands/config.ts` | 15 | `path.resolve('agent-sentry/agentops.config.json')` |
| `src/cli/commands/enable.ts` | 22 | `path.resolve('agent-sentry/agentops.config.json')` |
| `src/cli/hooks/session-start.ts` | 44 | `path.join(__dirname, '..', '..', '..', 'agentops.config.json')` |
| `src/cli/hooks/session-checkpoint.ts` | 21 | `path.join(__dirname, '..', '..', '..', 'agentops.config.json')` |
| `src/cli/hooks/post-write.ts` | 31 | `path.join(__dirname, '..', '..', '..', 'agentops.config.json')` |
| `src/memory/cli-capture.js` | 29 | `path.resolve(__dirname, '../../agentops.config.json')` |

**Solution**: Create a single `resolveConfigPath()` function with this resolution order:
1. Explicit `configPath` argument (already supported by `loadMemoryConfig`)
2. `AGENTOPS_CONFIG` environment variable
3. `./agentops.config.json` (CWD — for repo-clone users)
4. `./agent-sentry/agentops.config.json` (CWD/agentops — current behavior)
5. Package-relative fallback: `path.join(__dirname, '..', '..', 'agentops.config.json')` (from dist/src/)
6. Built-in defaults (current `DEFAULT_CONFIG` — already works)

**Implementation**:
- New file: `src/config/resolve.ts` (~40 lines)
- Replace all 8 hardcoded paths with `import { resolveConfigPath } from '../config/resolve'`
- Export from `src/index.ts`
- Test: unit test for each resolution step with mocked filesystem

**Estimated scope**: 1 new file, 8 file edits, 1 test file. Small.

---

### 1.2 — Fix the `database_path` Problem

**Problem**: `DEFAULT_CONFIG` sets `database_path: 'agent-sentry/data/ops.db'` — also CWD-relative. Even if config resolution is fixed, the database will be created at a path that doesn't exist for npm-install users.

**Solution**: Apply the same resolution strategy:
1. Explicit config value (if absolute path, use as-is)
2. If relative, resolve relative to the config file's directory (not CWD)
3. Fallback: `~/.agent-sentry/data/ops.db` (user home directory — standard for local-first tools)

**Implementation**: Add path resolution logic to `createProvider()` in `provider-factory.ts`. ~15 lines.

---

### 1.3 — Add `tsx` to devDependencies

**Problem**: `package.json` line 36 has `"benchmark": "tsx scripts/run-benchmark.ts"` but `tsx` is not in dependencies or devDependencies.

**Fix**: `npm install --save-dev tsx`

**Scope**: 1 line in package.json. Trivial.

---

### 1.4 — Clean the Root Directory

**Problem**: The repo root has 13+ markdown files that are planning artifacts, not user-facing docs. This signals "work in progress" to evaluators and makes the project look less mature than it is.

**Current root markdown files**:
- `README.md` — keep
- `CLAUDE.md` — keep (Claude Code config)
- `AGENTS.md` — keep (agent config)
- `CONTEXT.md` — move to `docs/planning/`
- `PLANNING.md` — move to `docs/planning/`
- `TASKS.md` — move to `docs/planning/`
- `WORKFLOW.md` — move to `docs/planning/`
- `IMPLEMENTATION-PLAN.md` — move to `docs/planning/`
- `Agent-Management-Implementation-Guide.md` — move to `docs/planning/`
- `AgentSentry-Architecture-Evolution.md` — move to `docs/planning/`
- `AgentSentry-OB1-Analysis.md` — move to `docs/planning/`
- `AgentSentry-OB1-Build-Plan.md` — move to `docs/planning/`
- `AgentSentry-Product-Spec.md` — move to `docs/planning/`
- `AgentSentry-Spec.md` — move to `docs/planning/`
- `AgentSentry-Synopsis.md` — move to `docs/planning/`
- `From-Vibe-Coding-to-Agent-Management.md` — move to `docs/planning/`
- `agent-management-guide.html` — move to `docs/planning/`
- `agentops-dashboard.html` — move to `docs/planning/`

**Also**:
- `ws-8.19.0.tgz` — delete or move to a `vendor/` directory. Tarballs in root are a red flag.

**Scope**: `git mv` operations + update any internal references. Medium.

---

### 1.5 — Fix the Broken Command Path in Docs

**Problem**: The root README references `agent-sentry/.claude/commands/agent-sentry/` for install instructions. This path does not exist.

**Solution**: Either:
- (a) Create the path and populate it with the actual command files, or
- (b) Remove/update the reference in README to match reality

**Decision needed**: Are Claude Code slash commands part of the distribution, or repo-only? If (a), add to `files` in package.json. If (b), just fix the docs.

---

### 1.6 — Add npm Install Smoke Test to CI

**Problem**: Nobody has tested the `npm pack` → `npm install` → `require('agentops')` path end-to-end.

**Implementation**: Add a CI job (GitHub Actions):
```yaml
smoke-test-install:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
    - run: cd agentops && npm ci && npm run build
    - run: cd agentops && npm pack
    - run: |
        mkdir /tmp/test-install
        cd /tmp/test-install
        npm init -y
        npm install $GITHUB_WORKSPACE/agent-sentry/agentops-*.tgz
        node -e "const a = require('agentops'); console.log('Import OK:', Object.keys(a).length, 'exports')"
    - run: |
        cd /tmp/test-install
        node -e "
          const { createMcpServer } = require('agentops');
          const server = createMcpServer();
          console.log('MCP server created OK');
          process.exit(0);
        "
```

**Scope**: 1 new CI file or addition to existing workflow. Small.

---

### 1.7 — Verify and Fix `files` Array in package.json

**Problem**: `"files": ["dist/", "scripts/", "agentops.config.json"]` — does this include everything needed?

**Checklist**:
- [ ] `dist/` includes compiled MCP server entry point (`dist/src/mcp/server.js`)
- [ ] `dist/` includes compiled CLI entry point (`dist/src/cli/index.js`)
- [ ] `agentops.config.json` is present and valid
- [ ] ONNX model files (if needed for auto embeddings) — currently `onnxruntime-node` is a dependency, but model files may need to be bundled or downloaded on first run
- [ ] `scripts/` contains only what's needed at runtime (not just dev scripts)
- [ ] No test files leak into the package

**Action**: Run `npm pack --dry-run` and audit the file list.

---

## Phase 1 Completion Criteria

All of these must pass before moving to Phase 2:

- [ ] `npm pack` in `agent-sentry/` produces a clean tarball
- [ ] Fresh `npm install <tarball>` in an empty directory succeeds
- [ ] `node -e "require('agentops')"` works without errors
- [ ] `node node_modules/agent-sentry/dist/src/mcp/server.js` starts the MCP server
- [ ] Config resolution finds the packaged config OR uses sensible defaults
- [ ] SQLite database is created at a writable location automatically
- [ ] Root directory contains only README.md, CLAUDE.md, AGENTS.md, agent-sentry/, docs/
- [ ] CI includes the install smoke test and it passes

---

## Phase 2: Make It Adoptable

The objective is: a new user understands why they should use AgentOps, sees value in their first session, and knows how to grow into deeper features.

### 2.1 — Rewrite the README Lead

**Current lead** (agent-sentry/README.md line 1-3):
> Memory-aware agent management for Claude Code. Captures every agent action as a hash-chained, searchable event — giving you a tamper-evident audit trail, risk scoring, and progressive safety controls.

**Problem**: This describes architecture ("hash-chained, searchable event"), not user value. A new user doesn't know why they want a "tamper-evident audit trail."

**Rewrite target** (concept — exact wording TBD):
> AgentOps watches your Claude Code sessions so you don't have to. It catches secrets before they're committed, warns when context is running low, scores the risk of proposed changes, and remembers what happened across sessions — all without any external services.
>
> Install in 60 seconds. Start at a safe default. Turn on more as you trust it.

**Key change**: Lead with the *problems solved*, not the *mechanisms used*. Move architecture details to a "How It Works" section lower down.

---

### 2.2 — Write a "First Session" Walkthrough

**What's missing**: After install, there is no guided experience. The user wires up MCP and then faces 9 tools with no context for when or why they'd be used.

**Deliverable**: A new section in the README (or a linked `docs/first-session.md`) that walks through:

1. **Before you start**: What happens automatically at level 3
   - Session start hook captures initial state
   - Context health monitoring begins
   - Rules validation is active

2. **Your first task**: Do something normal (edit a file, run tests)
   - Show what `agentops_check_context` returns mid-session
   - Show what `agentops_size_task` returns for a small change vs a large one
   - Show what `agentops_scan_security` catches if you accidentally add an API key

3. **End of session**: What got captured
   - Show the output of `agentops_search_history` for that session
   - Show the health dashboard output

4. **Next session**: Context recall in action
   - Show `agentops_recall_context` pulling in relevant context from the previous session
   - This is the "aha moment" — the reason the memory store exists

**Format**: Concrete terminal output examples, not abstract descriptions. Show real tool responses.

**Scope**: ~200 lines of markdown with example outputs. Medium.

---

### 2.3 — Add a "Disabling / Uninstalling" Section

**Why this matters**: Operational tooling adoption is blocked by exit anxiety. Users need to know they can back out cleanly.

**Content**:
```markdown
## Removing AgentOps

AgentOps is additive — it never modifies your code, your git history, or your Claude Code configuration beyond the MCP registration.

### Disable temporarily
Set `"enabled": false` in agentops.config.json. All hooks become no-ops.

### Remove completely
1. `claude mcp remove agentops`
2. `rm -rf agent-sentry/data/` (deletes the SQLite database)
3. Remove the agentops entry from your settings if added manually

Your code, git history, and Claude Code configuration are unchanged.
```

**Scope**: ~20 lines of markdown. Trivial.

---

### 2.4 — Resolve the Default Enablement Level Question

**Problem**: The enablement model describes a 1-to-5 progression, but the config ships at level 3. This means:
- Users never experience levels 1-2
- The "progressive" story is undercut — they start in the middle
- If level 3 is the right default, levels 1-2 are effectively just "disable features" toggles, not an onboarding ramp

**Decision tree**:

**Option A: Default stays at 3** (recommended if levels 1-2 aren't useful alone)
- Reframe the enablement model as "what's on, what you can turn on, what's experimental"
- Remove the "progression" language — it's really a feature-flag set, not a journey
- The walkthrough (2.2) should show level 3 behavior as the baseline

**Option B: Default moves to 1** (recommended if the progression is the real UX)
- First session walkthrough shows level 1 behavior
- End of walkthrough says "ready for more? `agentops enable 2`"
- Each level-up must deliver a clear, visible improvement

**My recommendation**: Option A. The progression narrative is appealing in docs but most users won't manually bump levels. Ship the useful default, document what each level adds, let power users customize.

---

### 2.5 — Write Architecture Docs for the Core Differentiators

**What to document** (moved from README lead to dedicated docs):

**`docs/architecture/memory-model.md`** (~150 lines)
- Hash-chained event storage: why it exists, what guarantees it provides
- Search fallback chain: vector → provider text → JS filter
- Pruning and chain verification with incremental checkpoints
- Provider abstraction: SQLite (local) → Supabase (team) → custom

**`docs/architecture/enablement-model.md`** (~100 lines)
- The 5 levels, what each activates
- How skills map to primitives
- How to customize beyond the preset levels

**`docs/architecture/mcp-integration.md`** (~100 lines)
- How the 9 tools map to the underlying primitives
- stdio vs HTTP transport: when to use which
- Auth and rate limiting (HTTP mode)

**Scope**: 3 new docs, ~350 lines total. Medium.

---

### 2.6 — Update Root README to Match Reality

**After Phase 1 cleanup and Phase 2 rewrites, the root README should**:

1. Lead with 1-2 sentences on what AgentOps does (user value)
2. Point to `agent-sentry/README.md` for install and usage
3. Point to `docs/` for architecture and planning
4. Remove duplicated feature tables (they belong in the package README)
5. Remove or update any references to paths/features that don't exist

**The root README should be <50 lines.** It's a signpost, not a product page.

---

### 2.7 — Add Doc Validation to CI

**Problem**: Docs will drift again without automated checks.

**Implementation**:
```yaml
doc-validation:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Check markdown links
      uses: gaurav-nelson/github-action-markdown-link-check@v1
    - name: Verify documented paths exist
      run: |
        # Extract file paths from README and verify they exist
        grep -oP '`[^`]+\.(ts|js|json)`' agent-sentry/README.md | tr -d '`' | while read f; do
          if [ ! -f "agent-sentry/$f" ] && [ ! -f "$f" ]; then
            echo "MISSING: $f referenced in README"
            exit 1
          fi
        done
```

**Scope**: Addition to CI workflow. Small.

---

## Phase 2 Completion Criteria

- [ ] README leads with user problems, not architecture
- [ ] A "first session" walkthrough exists with concrete terminal output examples
- [ ] A "disabling/uninstalling" section exists
- [ ] Enablement level default is documented and justified
- [ ] Architecture docs exist for memory model, enablement, and MCP integration
- [ ] Root README is <50 lines and points to the right places
- [ ] CI validates markdown links and documented paths

---

## Execution Order

```
Phase 1 (Make It Installable)          Phase 2 (Make It Adoptable)
─────────────────────────              ─────────────────────────
1.1 Config resolution        ──┐
1.2 Database path fix        ──┤
1.3 Add tsx to devDeps       ──┤
1.4 Clean root directory     ──┼──→  2.4 Decide enablement default
1.5 Fix broken command path  ──┤          │
1.6 Install smoke test CI   ──┤          ▼
1.7 Verify files array       ──┘     2.1 Rewrite README lead
                                      2.2 First session walkthrough
                                      2.3 Disabling/uninstalling section
                                      2.5 Architecture docs
                                      2.6 Update root README
                                      2.7 Doc validation CI
```

Phase 1 items are independent and can be parallelized.
Phase 2 items are sequential: 2.4 informs 2.1, which informs 2.2.

---

## What This Plan Does NOT Cover

- Supabase production hardening (valid but separate initiative)
- Multi-agent coordination improvements (experimental, not blocking adoption)
- Plugin registry maturity (experimental, not blocking adoption)
- Performance optimization (already has benchmarks, not blocking)
- New features of any kind

This plan is exclusively about making what already exists work for people who didn't build it.
