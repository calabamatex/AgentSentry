# AgentOps for RuFlo: Agent Management Oversight System

## Specification Document for Claude Code Implementation

**Version:** 3.0 — Full Architecture with Future-Proofing
**Date:** March 19, 2026
**Target Repo:** https://github.com/ruvnet/ruflo/tree/main
**Mode:** Dual-mode (real-time session monitor + on-demand project audit)
**Platform:** Multi-tool compatible (Claude Code primary, Codex via `.agents/`, universal via AGENTS.md)
**Enforcement:** Guardrails — warns and takes preventive action where safe; never silently blocks

---

## 1. System Overview

### 1.1 Purpose

AgentOps is an oversight layer that integrates into the existing RuFlo multi-agent orchestration platform. RuFlo already deploys 60+ specialized agents in coordinated swarms — AgentOps adds a management and safety plane on top, monitoring the orchestration itself for version control discipline, context health, rules compliance, task sizing, and proactive safety checks.

This is not a replacement for RuFlo's existing monitoring (`/swarm-monitor`, `/agent-metrics`, `/real-time-view`). Those monitor agent *performance*. AgentOps monitors agent *management hygiene* — the practices that prevent data loss, context drift, blast radius problems, and security gaps.

### 1.2 RuFlo Context

RuFlo (formerly Claude Flow) is a production-ready enterprise AI agent orchestration framework:

- **Tech Stack:** TypeScript/Node.js 20+, WebAssembly (Rust WASM kernels), PostgreSQL + RuVector, SQLite with WAL, ONNX Runtime
- **Agent System:** 60+ specialized agents (coder, tester, reviewer, architect, security, etc.) with queen-led hierarchical coordination
- **Swarm Topologies:** Mesh, hierarchical, ring, star with Raft/BFT/Gossip/CRDT consensus
- **Memory System:** HNSW vector database, ReasoningBank, knowledge graphs with PageRank, 8 memory types
- **Intelligence Layer:** SONA self-optimization, EWC++ forgetting prevention, Flash Attention, MoE routing with 8 experts
- **Existing Infrastructure:** 38 skills in `.claude/skills/`, 6 agent categories in `.claude/agents/`, 18+ command directories in `.claude/commands/`, hooks system in `.claude/commands/hooks/`, monitoring in `.claude/commands/monitoring/`

### 1.3 Design Philosophy

AgentOps treats the human operator as the general contractor managing RuFlo's agent swarms. The system:

- Catches problems that neither individual agents nor swarm coordination will raise
- Enforces version control and checkpoint discipline across multi-agent modifications
- Monitors context window health across both single-agent and swarm sessions
- Validates that RuFlo's existing CLAUDE.md and AGENTS.md rules are being followed
- Applies blast radius analysis before large swarm deployments
- Audits the security posture of the platform and any applications built on it

### 1.4 Integration Architecture

AgentOps integrates into RuFlo's existing directory structure rather than creating a parallel one:

```
ruflo/                           # Existing repo root
├── AGENTS.md                    # EXISTING — extend with AgentOps universal rules
├── CLAUDE.md                    # EXISTING — extend with AgentOps Claude rules
├── .claude/
│   ├── settings.json            # EXISTING — add AgentOps hook entries
│   ├── agents/
│   │   ├── [existing agents]    # 34+ existing agent definitions
│   │   ├── agentops-monitor.md  # NEW — real-time session monitor subagent
│   │   ├── agentops-auditor.md  # NEW — on-demand project auditor subagent
│   │   └── agentops-scaffold.md # NEW — scaffold document manager subagent
│   ├── commands/
│   │   ├── hooks/               # EXISTING — contains pre-task, post-task, etc.
│   │   ├── monitoring/          # EXISTING — contains swarm-monitor, agent-metrics
│   │   ├── verify/              # EXISTING — contains check.md, start.md
│   │   └── agentops/            # NEW — AgentOps command directory
│   │       ├── check.md         # NEW — /agentops-check quick health check
│   │       ├── audit.md         # NEW — /agentops-audit full project audit
│   │       ├── scaffold.md      # NEW — /agentops-scaffold doc management
│   │       └── README.md        # NEW — AgentOps commands overview
│   └── skills/
│       ├── [38 existing skills] # hooks-automation, verification-quality, etc.
│       └── agentops/            # NEW — AgentOps skill directory
│           └── SKILL.md         # NEW — AgentOps skill definition
├── .agents/
│   ├── config.toml              # EXISTING — Codex CLI config
│   └── skills/
│       └── agentops/            # NEW — Codex-compatible AgentOps skill
│           └── SKILL.md
├── .githooks/                   # NEW — universal git hooks
│   ├── pre-commit
│   └── post-commit
├── agentops/                    # NEW — AgentOps core module
│   ├── scripts/
│   │   ├── git-hygiene-check.sh
│   │   ├── scaffold-validator.sh
│   │   ├── security-audit.sh
│   │   ├── rules-file-linter.sh
│   │   ├── context-estimator.sh
│   │   ├── task-sizer.sh
│   │   ├── secret-scanner.sh
│   │   ├── swarm-blast-radius.sh   # RuFlo-specific: analyzes multi-agent task scope
│   │   └── agent-drift-detector.sh # RuFlo-specific: checks for anti-drift violations
│   ├── templates/
│   │   ├── PLANNING.md.template
│   │   ├── TASKS.md.template
│   │   ├── CONTEXT.md.template
│   │   ├── WORKFLOW.md.template
│   │   ├── rules-file-starter.md
│   │   └── handoff-message.md
│   └── agentops.config.json     # Configurable thresholds
├── PLANNING.md                  # NEW — scaffold doc (project root)
├── TASKS.md                     # NEW — scaffold doc (project root)
├── CONTEXT.md                   # NEW — scaffold doc (project root)
└── WORKFLOW.md                  # NEW — scaffold doc (project root)
```

### 1.5 Key Integration Principles

1. **Extend, don't duplicate.** RuFlo already has hooks (`pre-task`, `post-task`, `pre-edit`, `post-edit`, `session-end`), monitoring (`swarm-monitor`, `agent-metrics`), and verification (`check`, `start`). AgentOps adds new concerns to existing hook points and creates parallel commands only where no existing command covers the need.

2. **Respect the swarm.** RuFlo's agents operate in coordinated swarms with queen-led hierarchies. AgentOps must be swarm-aware — a single agent modifying 3 files is different from a swarm of 8 agents each modifying 3 files (that's a 24-file blast radius).

3. **Leverage existing skills.** RuFlo has `hooks-automation`, `verification-quality`, `v3-security-overhaul`, and `performance-analysis` skills. AgentOps should compose with these, not replace them.

4. **Multi-tool parity.** Rules and scaffold documents work via AGENTS.md (universal), CLAUDE.md (Claude Code), and `.agents/config.toml` (Codex CLI). Git hooks work with any tool.

---

## 2. Skill 1 — Save Points (Version Control Enforcement)

### 2.1 What This Module Does

Ensures the RuFlo project always has recoverable save points, especially critical given that swarm operations can modify dozens of files simultaneously.

### 2.2 Real-Time Monitors

#### 2.2.1 Integration with Existing `pre-edit` Hook

RuFlo already has `.claude/commands/hooks/pre-edit.md`. AgentOps adds an additional check layer:

**Event:** `PreToolUse` — triggers before `Write`, `Edit`, `Bash` (file-modifying commands)
**Logic:**

```
IF git not initialized:
  BLOCK (exit 2): "No git repository. Run 'git init' and commit before proceeding."

IF uncommitted_changes > 5 files OR last_commit_age > 30 minutes:
  WARN: "Significant uncommitted work detected ({n} files, {t} minutes)."
  ACTION: Auto-commit with "[agentops] auto-save before modification"
  LOG: Append to WORKFLOW.md

IF current_branch = "main" AND risk_score >= 7 (see §5.2):
  WARN: "High-risk change on main branch."
  ACTION: Create branch "agentops/auto-branch-{timestamp}"
```

#### 2.2.2 Swarm-Aware Commit Strategy

When RuFlo deploys a swarm (detected via swarm coordination commands or queen agent activation):

```
PRE-SWARM:
  ACTION: Auto-commit with "[agentops] pre-swarm checkpoint — {swarm_topology} deploy"
  ACTION: Create branch "swarm/{swarm_id}-{timestamp}" if on main

POST-SWARM:
  IF swarm succeeded:
    NOTIFY: "Swarm completed. {n} files modified. Review with 'git diff' before committing."
  IF swarm failed or partially failed:
    WARN: "Swarm had failures. {n} files modified, {m} agents reported errors."
    RECOMMEND: "Review changes carefully. Consider 'git checkout .' to revert all swarm changes."
```

#### 2.2.3 Integration with Existing `post-edit` Hook

Extend RuFlo's `post-edit` hook with blast radius tracking:

```
AFTER each file modification:
  Increment files_modified_this_session counter
  Append file path to session modification log

  IF files_modified_this_session > 8 AND no commit since session start:
    WARN: "8+ files modified without a checkpoint. Auto-saving."
    ACTION: Auto-commit "[agentops] mid-session checkpoint"
```

#### 2.2.4 Integration with Existing `session-end` Hook

Extend RuFlo's `session-end` hook:

```
ON session end:
  IF uncommitted_changes exist:
    ACTION: Auto-commit "[agentops] session-end checkpoint — {summary}"
  ACTION: Update WORKFLOW.md with session summary
  ACTION: Update CONTEXT.md with current state
```

### 2.3 Audit Checks

| Check | Pass Criteria | Severity | RuFlo Context |
|---|---|---|---|
| Git initialized | `.git/` directory exists | Critical | — |
| .gitignore covers secrets | `.env`, `.env.local`, `*.key`, `*.pem` | Critical | Check ruflo/.env.example alignment |
| .gitignore covers build output | `node_modules/`, `dist/`, `.wasm` output | Warning | TypeScript + WASM build artifacts |
| Recent commits | ≥1 commit per 24hr active period | Warning | — |
| Commit frequency | Average gap < 45min during active work | Advisory | Swarm runs may need shorter intervals |
| Swarm checkpoints | Pre/post commit for every swarm deploy | Warning | RuFlo-specific |
| Branch usage for swarms | Swarm deploys not on main | Advisory | RuFlo-specific |

---

## 3. Skill 2 — Context Health Monitoring

### 3.1 What This Module Does

Monitors context window health for both single-agent sessions and multi-agent swarm coordination. RuFlo's queen agents and swarm coordinators are especially vulnerable to context degradation because they track the state of many sub-agents.

### 3.2 Real-Time Monitors

#### 3.2.1 Context Usage Estimator

**Event:** `PostToolUse` — after every tool use
**Logic:**

```
context_estimate = sum of:
  - All user messages (char count)
  - All agent responses (char count)
  - All files read into context (char count)
  - CLAUDE.md content (~varies, RuFlo's is substantial)
  - AGENTS.md content
  - Active skill SKILL.md content
  - Swarm state overhead (if swarm active): agent_count * ~2000 tokens

token_estimate = context_estimate / 4

# Standard thresholds
IF token_estimate > 60% of model_context_limit:
  NOTIFY: "Context at ~60%. Consider wrapping up current task."

IF token_estimate > 80%:
  WARN: "Context critically full (~80%). Early instructions being lost."
  ACTION: Invoke agentops-scaffold subagent to update scaffold docs
  RECOMMEND: "Start fresh session using handoff message."

# Swarm-specific thresholds (lower because swarm state consumes extra context)
IF swarm_active AND token_estimate > 50%:
  WARN: "Context at ~50% with active swarm. Queen agent may lose coordination state."
  RECOMMEND: "Consider checkpointing swarm state and restarting with fresh context."
```

#### 3.2.2 Behavior Degradation Detector

Tracks degradation signals specific to RuFlo's architecture:

```
degradation_signals = {
  instruction_violations: 0,     # Agent violates CLAUDE.md / AGENTS.md rules
  file_rewrites: 0,              # Agent modifies a file marked complete in TASKS.md
  repeated_errors: 0,            # Same error recurs after "fix"
  contradictions: 0,             # Agent proposes previously rejected approach
  swarm_drift: 0,                # Agent output diverges from original goal
                                 # (leverages RuFlo's anti-drift coordinator)
  consensus_failures: 0,         # Swarm consensus breaks down
}

IF sum(degradation_signals) >= 3:
  WARN: "Context degradation detected ({details})."
  ACTION: Update scaffold docs → generate handoff message
  RECOMMEND: "Start fresh session."
```

#### 3.2.3 Integration with RuFlo's Anti-Drift System

RuFlo already has anti-drift safeguards via its hierarchical coordinator. AgentOps hooks into this:

```
IF ruflo_drift_coordinator reports drift_detected:
  INCREMENT degradation_signals.swarm_drift
  LOG: "Drift event detected by RuFlo coordinator. Agent: {agent_id}, Task: {task_id}"
  IF swarm_drift > 2:
    ESCALATE: "Multiple drift events. Swarm may be operating on stale context."
```

### 3.3 Scaffold Document Manager (Subagent)

**Subagent Definition (`.claude/agents/agentops-scaffold.md`):**

```yaml
---
name: agentops-scaffold
description: >
  Manages RuFlo project scaffold documents (PLANNING.md, TASKS.md, CONTEXT.md,
  WORKFLOW.md). Creates missing documents from templates, updates existing ones
  by analyzing the TypeScript/WASM codebase, agent definitions, and swarm state.
  Generates handoff messages for fresh sessions. Invoke when starting a session,
  when context degrades, or at session end.
model: sonnet
tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
maxTurns: 20
---
```

**On invocation:**

1. Check which scaffold docs exist in repo root
2. For missing docs, create from `agentops/templates/` with RuFlo-specific content:
   - PLANNING.md: Pre-populate tech stack (TS, WASM, PostgreSQL, SQLite, ONNX), architecture layers, swarm topologies, agent categories
   - TASKS.md: Scan `.claude/commands/`, `.claude/skills/`, and `ruflo/src/` for feature areas
   - CONTEXT.md: Summarize current branch, recent commits, active swarm state
   - WORKFLOW.md: Append session entry
3. For existing docs, update based on current state:
   - Cross-reference TASKS.md against git log and file modifications
   - Update CONTEXT.md with today's session
4. Generate handoff message incorporating RuFlo-specific context (active swarm topology, queen agent state, memory system status)

### 3.4 RuFlo-Specific Handoff Message Template

```
I'm continuing work on the RuFlo orchestration platform. Here's where we are:

PROJECT: RuFlo — enterprise multi-agent AI orchestration
TECH STACK: TypeScript/Node.js 20+, WASM (Rust), PostgreSQL + RuVector,
            SQLite/WAL, ONNX Runtime, MCP integration
ACTIVE BRANCH: {branch_name}
LAST COMMIT: {commit_hash} — {commit_message}

WHAT'S DONE: [from TASKS.md completed section]
WHAT'S NEXT: [from TASKS.md in-progress section]

SWARM STATE:
- Last active topology: {mesh|hierarchical|ring|star}
- Queen type in use: {Strategic|Tactical|Adaptive}
- Active worker agents: {list}

KEY DECISIONS ALREADY MADE:
- [from CONTEXT.md]

KNOWN ISSUES:
- [from TASKS.md known bugs]

DO NOT CHANGE:
- Core consensus algorithms (ruflo/src/)
- MCP bridge configuration (.claude/mcp.json)
- Existing agent definitions unless explicitly asked
- [from CONTEXT.md]

READ THESE FILES FIRST:
1. PLANNING.md — architecture and tech stack
2. TASKS.md — what's done and what's next
3. CONTEXT.md — current state summary
4. WORKFLOW.md — recent session logs
```

### 3.5 Audit Checks

| Check | Pass Criteria | Severity | RuFlo Context |
|---|---|---|---|
| PLANNING.md exists | File present, has tech stack section | Warning | Should list TS, WASM, PG, SQLite, ONNX |
| TASKS.md exists | File present with ≥1 task | Warning | Should reference agent/skill/command areas |
| CONTEXT.md current | Updated within 7 days of last commit | Warning | Should include swarm state |
| WORKFLOW.md exists | File present | Advisory | — |
| Handoff message available | CONTEXT.md has "Last Session" section | Advisory | Should include swarm topology |

---

## 4. Skill 3 — Standing Orders (Rules File Compliance)

### 4.1 What This Module Does

Validates that RuFlo's existing CLAUDE.md and AGENTS.md are well-structured, within size limits, and being followed. Adds AgentOps-specific rules to the existing files.

### 4.2 Integration with Existing Rules Files

RuFlo already has both CLAUDE.md and AGENTS.md at the repo root. AgentOps **appends** to these rather than replacing them.

**Additions to CLAUDE.md:**

```markdown
## AgentOps Management Rules

### Version Control
- Commit before and after every swarm deployment
- Never make high-risk changes directly on main — branch first
- Auto-save checkpoints every 30 minutes of active work

### Context Health
- Monitor for degradation signals after 20+ messages
- Update scaffold docs (PLANNING, TASKS, CONTEXT, WORKFLOW) at session end
- Start fresh when context degrades — don't try to push through

### Task Sizing
- Before any task, assess blast radius: how many files, which systems, database changes?
- Swarm deploys that touch 9+ files require decomposition into sub-tasks
- Validate and commit between each sub-task

### Error Handling (for apps built on RuFlo)
- Every MCP bridge call must have error handling with user-friendly messages
- Every agent-to-agent message must handle timeout and failure gracefully
- Never show blank screens — always show fallback UI state
- Log errors to console, never expose stack traces to end users

### Security (Non-Negotiable)
- NEVER hardcode API keys, LLM provider tokens, or database credentials
- NEVER log PII (emails, names, payment data) in agent output or console
- All database queries involving user data must use row-level security
- Validate and sanitize all input before passing to agents
- MCP server connections must use authenticated channels

### Swarm Safety
- Always checkpoint before deploying swarms to production
- Monitor agent drift — if 2+ drift events occur, pause and review
- Queen agents must validate outputs against original task goals
- Consensus failures must be logged and escalated
```

**Additions to AGENTS.md:**

```markdown
## AgentOps Universal Rules (All Tools)

### Before starting any task:
1. Check git status — commit if uncommitted changes exist
2. Read TASKS.md and CONTEXT.md for current project state
3. Confirm your plan before writing code
4. Assess blast radius: how many files will this touch?

### After completing any task:
1. Summarize what changed and which files were modified
2. List what to test
3. Wait for operator approval before starting next task
4. Update TASKS.md with completion status

### Security:
- Never hardcode secrets — use environment variables (see ruflo/.env.example)
- Never log PII in any agent output
- Row-level security on all user data tables
- Validate all user input before agent processing

### Error Handling:
- Every API/MCP call needs try/catch with user-friendly message
- Never show blank screens — always show fallback state
- Agent failures must be caught and reported, not silently swallowed
```

### 4.3 Real-Time Monitors

#### 4.3.1 Session Start Validation

**Event:** `SessionStart`
**Logic:**

```
# Check existing rules files
IF CLAUDE.md missing:
  CRITICAL: "No CLAUDE.md found. RuFlo requires this for agent configuration."

IF AGENTS.md missing:
  WARN: "No AGENTS.md found. Cross-tool agent rules are not configured."

# Validate content
rules_content = read(CLAUDE.md)

IF "AgentOps" not in rules_content:
  NOTIFY: "CLAUDE.md exists but has no AgentOps rules. Run /agentops-scaffold to add them."

IF line_count(CLAUDE.md) > 300:
  WARN: "CLAUDE.md is {n} lines. RuFlo's rules file is large — consider pruning.
         AgentOps recommends <200 lines. Currently {n} lines may consume significant context."

# Check for required sections
required_sections = ["security", "error handling"]
FOR each section in required_sections:
  IF section not found (case-insensitive) in rules_content:
    WARN: "CLAUDE.md missing '{section}' section."
```

#### 4.3.2 Rules Violation Detector

**Event:** `PostToolUse` — after `Write` and `Edit`
**Logic:**

```
Parse CLAUDE.md for prohibitions (NEVER, DO NOT, STOP, always)
Extract rule statements

After each file write/edit, check diff against rules:
  - Hardcoded secrets (API keys, tokens, connection strings)
  - PII in logging statements
  - Missing error handling on MCP bridge calls
  - Missing auth checks on protected routes
  - New dependencies installed without approval

IF violation_detected:
  WARN: "Possible standing order violation: '{rule}' in {file}:{line}"
  SHOW: The specific code and the rule it violates
```

### 4.4 Rules File Linter (`rules-file-linter.sh`)

Adapted for RuFlo's dual-file setup:

```
Checks on CLAUDE.md:
  1. STRUCTURE: Has Identity, Security, Error Handling, Swarm Safety sections
  2. SIZE: Under 300 lines (higher threshold for RuFlo's complexity)
  3. CONTRADICTIONS: No opposing rules across CLAUDE.md and AGENTS.md
  4. RUFLO COVERAGE: Mentions MCP, swarm, agent, consensus, vector/memory
  5. CLARITY: Flag vague language, recommend absolute directives

Checks on AGENTS.md:
  1. Cross-tool compatibility: No Claude-specific syntax
  2. Consistent with CLAUDE.md security rules
  3. Under 150 lines (universal rules should be concise)
```

### 4.5 Codex CLI Sync (`.agents/config.toml`)

When CLAUDE.md or AGENTS.md is updated, AgentOps generates equivalent instructions for Codex:

```
IF CLAUDE.md or AGENTS.md modified:
  Extract universal rules (security, error handling, task sizing)
  Update .agents/skills/agentops/SKILL.md with equivalent instructions
  LOG: "Synced AgentOps rules to Codex CLI format"
```

### 4.6 Audit Checks

| Check | Pass Criteria | Severity | RuFlo Context |
|---|---|---|---|
| CLAUDE.md exists | Present, non-empty | Critical | RuFlo already has this |
| AGENTS.md exists | Present, non-empty | Critical | RuFlo already has this |
| Has security section | Both files cover secrets, PII, auth | Critical | Must mention MCP, agent tokens |
| Has error handling | Covers try/catch, user messages | Warning | Must cover MCP bridge errors |
| Has swarm safety rules | CLAUDE.md covers swarm checkpoints, drift | Warning | RuFlo-specific |
| Under size limit | CLAUDE.md < 300 lines, AGENTS.md < 150 | Warning | — |
| No contradictions | Linter finds no opposing rules across files | Warning | — |
| Codex CLI in sync | `.agents/skills/agentops/` matches rules | Advisory | Multi-tool parity |

---

## 5. Skill 4 — Small Bets (Task Sizing and Blast Radius)

### 5.1 What This Module Does

Intercepts large or risky tasks before execution. Critically important for RuFlo because swarm deployments can modify dozens of files across multiple systems simultaneously.

### 5.2 Risk Scoring Model (RuFlo-Adapted)

```
risk_score = 0

# File count estimate
estimated_files = analyze task prompt for scope
IF estimated_files <= 3:  risk_score += 1   # Small
IF estimated_files 4-8:   risk_score += 3   # Medium
IF estimated_files >= 9:  risk_score += 5   # Large

# Database changes
IF task mentions "database", "table", "schema", "migration", "ruvector", "vector":
  IF new tables/columns:     risk_score += 2
  IF modifying existing:     risk_score += 4
  IF deleting/dropping:      risk_score += 5

# RuFlo-specific multipliers
IF task mentions "swarm", "deploy swarm", "queen", "topology":
  risk_score += 3  # Swarm deploys have inherently wide blast radius

IF task mentions "consensus", "raft", "bft", "gossip", "crdt":
  risk_score += 4  # Consensus algorithm changes affect entire system

IF task mentions "mcp", "mcp-bridge", "model context protocol":
  risk_score += 3  # MCP changes affect all agent communication

IF task mentions "sona", "ewc", "routing", "moe", "reinforcement":
  risk_score += 4  # Intelligence layer changes propagate everywhere

IF task mentions "wasm", "kernel", "rust":
  risk_score += 3  # WASM kernel changes require rebuild and have wide impact

# Shared code modifications
IF task mentions "auth", "security", "encryption", "aidefence":
  risk_score += 4

IF task mentions "refactor", "redesign", "rewrite", "migrate":
  risk_score += 4

IF task mentions "all", "every", "entire", "whole":
  risk_score += 3

# Risk levels
LOW:    risk_score 1-3   → Proceed normally
MEDIUM: risk_score 4-7   → Require plan before execution, auto-commit checkpoint
HIGH:   risk_score 8-12  → Require decomposition into sub-tasks
CRITICAL: risk_score 13+ → Require branch, decomposition, and operator review at each step
```

### 5.3 Real-Time Monitors

#### 5.3.1 Task Sizing Gate

**Event:** `UserPromptSubmit`
**Logic:**

```
Calculate risk_score per §5.2

IF risk_score >= 13 (CRITICAL):
  WARN: "Critical-risk task (score: {score}). This touches core RuFlo systems."
  ACTION: Create branch, require decomposition, enforce step-by-step approval
  REQUIRE: Operator confirms plan AND reviews each sub-task result

IF risk_score 8-12 (HIGH):
  WARN: "High-risk task (score: {score}). Decompose before starting."
  ACTION: Auto-commit checkpoint, invoke decomposition prompt
  REQUIRE: Operator confirms plan before agent proceeds

IF risk_score 4-7 (MEDIUM):
  NOTIFY: "Medium-risk task. Committing checkpoint first."
  ACTION: Auto-commit if uncommitted changes exist
  RECOMMEND: "Ask agent to present plan before starting."

IF risk_score 1-3 (LOW):
  PASS: No intervention
```

#### 5.3.2 Swarm Blast Radius Monitor (`swarm-blast-radius.sh`)

RuFlo-specific script that analyzes multi-agent operations:

```
WHEN swarm deployment detected:
  Track each agent's file modifications separately
  Compute total_blast_radius = union of all agent modifications

  IF total_blast_radius > 15 files:
    WARN: "Swarm has modified {n} files across {m} agents. This is a wide blast radius."
    RECOMMEND: "Pause swarm, review changes with 'git diff', commit checkpoint."

  IF any single agent modified > 8 files:
    WARN: "Agent {agent_id} has modified {n} files — more than expected for a focused task."
    RECOMMEND: "Check if this agent's scope is too broad. Consider decomposing."

  IF agents modified overlapping files:
    WARN: "Conflict detected: agents {a} and {b} both modified {file}."
    RECOMMEND: "Review for merge conflicts or contradictory changes."
```

#### 5.3.3 Multi-Step Verification

```
IF agent or swarm signals "task complete":
  CHECK: Was testing performed?
    - Scan Bash history for test commands (npm test, jest, vitest, cargo test)
    - Check if RuFlo's verification-quality skill was invoked
    - Look for /verify commands in session

  IF no testing detected:
    NOTIFY: "Task marked complete but no testing found."
    RECOMMEND: "Run tests. For RuFlo core: 'npm test'. For WASM: 'cargo test'."
```

### 5.4 Decomposition Prompts (RuFlo-Adapted)

**For planning:**
```
I want to [task]. Before writing any code, break this down into the
smallest independent sub-tasks. Consider:
- Which RuFlo layers are affected (CLI, routing, swarm, memory, intelligence)?
- Will this require WASM kernel changes (requires Rust rebuild)?
- Does this affect MCP bridge communication?
- Will this change agent definitions or skill configurations?
- Does this require database schema changes (PostgreSQL or SQLite)?

Each sub-task should touch ≤5 files and be testable on its own.
Present the plan and wait for my approval.
```

**For swarm tasks:**
```
This task involves swarm coordination. Before deploying:
1. Which agents will be involved and what is each agent's scope?
2. Which files will each agent likely modify?
3. Are there any shared files that multiple agents might touch?
4. What is the total blast radius across all agents?
5. What checkpoints should we create between phases?

Present the plan with agent assignments and file boundaries.
```

### 5.5 Audit Checks

| Check | Pass Criteria | Severity | RuFlo Context |
|---|---|---|---|
| Average commit size | Median < 8 files per commit | Warning | Swarm commits may be larger |
| Swarm checkpoints | Pre/post commit for swarm deploys | Warning | RuFlo-specific |
| No mega-commits | No single commit touching 20+ files | Warning | Flag potential swarm without checkpoint |
| Branch usage | Core system changes on branches | Advisory | consensus/, mcp-bridge/, sona/ |
| Test execution | Tests run before marking tasks complete | Advisory | npm test, cargo test |

---

## 6. Skill 5 — Proactive Safety Checks

### 6.1 What This Module Does

Audits for issues that neither individual agents nor swarm coordination will raise: secrets exposure, missing error handling, PII leakage, unsafe MCP configurations, and scalability concerns specific to RuFlo's enterprise architecture.

### 6.2 Real-Time Monitors

#### 6.2.1 Secret Exposure Scanner

**Event:** `PreToolUse` — before `Write` and `Edit` (BLOCKS if detected)
**Logic:**

```
Scan content for:
  # Standard patterns
  - API keys: sk_live_*, sk_test_*, AKIA*, ghp_*, glpat-*
  - Generic: strings labeled key, secret, token, password, credential
  - Connection strings: postgresql://, mongodb://, redis://, sqlite:///
  - JWT tokens: eyJ*
  - Private keys: -----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----

  # RuFlo-specific patterns
  - LLM provider keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY,
    COHERE_API_KEY, OLLAMA_* credentials
  - RuVector connection strings
  - MCP server tokens/secrets
  - ONNX model authentication tokens
  - Stripe/payment provider keys (if payment agents active)

IF secret_detected:
  BLOCK (exit 2): "Secret detected in file content: {pattern_type}"
  SHOW: Redacted match location
  ACTION: "Use environment variables. Reference ruflo/.env.example for the correct pattern."
```

#### 6.2.2 Error Handling Enforcer

**Event:** `PostToolUse` — after `Write` and `Edit`
**Logic:**

```
Scan new/modified code for:
  # Standard API calls
  - fetch(), axios, $http, database queries

  # RuFlo-specific calls
  - MCP bridge calls (mcp-bridge/*)
  - Agent-to-agent messages (swarm coordination)
  - RuVector queries (vector search, embedding operations)
  - ONNX Runtime inference calls
  - LLM provider API calls (Claude, GPT, Gemini, Cohere)
  - Consensus protocol messages (Raft, BFT, Gossip)

FOR each detected call:
  IF no try/catch or .catch() or error boundary:
    WARN: "Unhandled call in {file}:{line}. Type: {call_type}"
    RECOMMEND: "Add error handling with graceful fallback."

  IF call is to LLM provider AND no timeout configured:
    WARN: "LLM API call without timeout. Provider outages will hang the system."
    RECOMMEND: "Add timeout and fallback to alternative provider (RuFlo supports failover)."
```

#### 6.2.3 Agent Drift Detector (`agent-drift-detector.sh`)

RuFlo-specific script that validates agent outputs against original goals:

```
WHEN agent produces output:
  Compare output against:
    - Original task description from user prompt
    - Task scope from TASKS.md
    - Agent's defined role from .claude/agents/{agent}.md or .yaml

  FLAG if:
    - Agent modifies files outside its defined scope
    - Agent installs dependencies not related to its task
    - Agent creates new agent definitions or modifies existing ones without approval
    - Agent changes swarm topology or consensus parameters
    - Agent modifies MCP configuration

  ESCALATE: "Agent {agent_id} is operating outside its defined scope."
```

#### 6.2.4 PII Logging Scanner

```
Scan for logging of:
  # Standard PII
  - console.log/warn/error with email, password, card, ssn, phone
  - Logger calls with user PII fields

  # RuFlo-specific
  - Agent memory writes containing user PII (ReasoningBank, knowledge graph)
  - Vector embeddings of user PII (RuVector stores)
  - Swarm message passing with unmasked user data
  - MCP message logs containing user information

IF pii_detected:
  WARN: "PII in {context}: {field_name} in {file}:{line}"
  RECOMMEND: "Remove PII. Log only IDs and non-sensitive metadata."
```

### 6.3 Security Audit Script (`security-audit.sh` — RuFlo-Adapted)

```
Checks:

1. SECRETS IN CODE
   - Scan all TypeScript/JavaScript files for hardcoded keys
   - Check ruflo/.env.example for placeholder patterns, verify no real values
   - Verify .env and .env.local in .gitignore
   - Scan git history for accidentally committed secrets
   - Check .claude/mcp.json for hardcoded tokens

2. LLM PROVIDER SECURITY
   - Verify all provider API keys use environment variables
   - Check failover configuration doesn't expose keys in error messages
   - Verify ONNX model files don't contain embedded credentials
   - Check that cost optimization routing doesn't log full API responses

3. MCP BRIDGE SECURITY
   - Verify MCP server connections use authenticated channels
   - Check for prompt injection vulnerabilities in agent input parsing
   - Validate AIDefence module is active and configured
   - Check that MCP message passing doesn't expose internal state

4. SWARM SECURITY
   - Verify queen-to-worker communication is authenticated
   - Check that agent definitions can't be modified by other agents at runtime
   - Validate consensus messages are integrity-checked
   - Verify swarm topology changes require operator approval

5. DATABASE SECURITY
   - Check PostgreSQL connections for SSL/TLS
   - Verify RuVector access controls
   - Check SQLite WAL files aren't world-readable
   - Validate row-level security on user data tables

6. INPUT VALIDATION
   - Check all user-facing inputs for validation/sanitization
   - Verify agent inputs are sanitized before LLM calls
   - Check for path traversal prevention (RuFlo already has this — verify active)
   - Validate WASM kernel inputs are bounds-checked

7. DEPENDENCY AUDIT
   - Run npm audit for known vulnerabilities
   - Check Rust/WASM dependencies with cargo audit
   - Flag outdated dependencies with security patches available
```

### 6.4 Scale Analysis (RuFlo-Adapted)

```
Inputs: Current agent count, expected agent count, concurrent user projection, swarm size

Checks:

1. SWARM SCALABILITY
   - Can the current topology handle projected agent count?
   - Is consensus algorithm appropriate for cluster size?
     (Raft: up to ~7 nodes optimal; BFT: handles Byzantine faults but heavier;
      Gossip: scales better for large clusters; CRDT: best for eventual consistency)
   - Are swarm message queues bounded to prevent memory exhaustion?

2. VECTOR DATABASE
   - Is HNSW index size manageable for projected embedding count?
   - Are vector search queries optimized (sub-millisecond at current scale)?
   - Is RuVector configured for the projected data volume?

3. LLM COST OPTIMIZATION
   - Is the MoE routing configured for cost efficiency at scale?
   - Is WASM being used for simple tasks (352x faster than LLM)?
   - Is token caching effective (30-50% reduction target)?
   - What is projected monthly LLM spend at target scale?

4. DATABASE
   - PostgreSQL: indexes on frequently queried columns?
   - SQLite: WAL mode configured? Appropriate for projected write volume?
   - Connection pooling configured for concurrent agent access?

5. MEMORY SYSTEM
   - Are the 8 memory types properly partitioned?
   - Is ReasoningBank growth bounded?
   - Is knowledge graph PageRank computation efficient at projected size?
   - Is EWC++ preventing catastrophic forgetting effectively?

Output: Risk report prioritized by likelihood of failure at target scale.
```

### 6.5 Audit Checks

| Check | Pass Criteria | Severity | RuFlo Context |
|---|---|---|---|
| No hardcoded secrets | Zero in source + git history | Critical | Check all LLM provider keys |
| .env in .gitignore | .env, .env.local covered | Critical | ruflo/.env.example exists |
| MCP auth configured | MCP connections authenticated | Critical | .claude/mcp.json |
| AIDefence active | Prompt injection blocking enabled | Critical | RuFlo's security module |
| Error handling coverage | ≥80% of API/MCP calls handled | Warning | Include LLM provider calls |
| No PII in logs/memory | Zero PII in logs, agent memory | Warning | Check ReasoningBank, vectors |
| Input validation | All inputs sanitized | Warning | Including agent inputs |
| WASM inputs bounded | WASM kernels validate inputs | Warning | Rust safety |
| LLM timeout configured | All provider calls have timeouts | Warning | Failover depends on this |
| Scale expectations set | Rules file includes growth targets | Advisory | Agent count + user count |

---

## 7. Slash Commands

### 7.1 `/agentops check` — Quick Session Health Check

**File:** `.claude/commands/agentops/check.md`

```yaml
---
name: agentops-check
description: >
  Quick health check for the current RuFlo session. Reports git status,
  context usage, rules compliance, blast radius, swarm state, and active warnings.
  Use at any time during a session.
---
```

**Output format:**

```
AgentOps Session Health — RuFlo
───────────────────────────────────────────────
◉ Save Points      Last commit: 12 min ago (3 files uncommitted)
◉ Context Health    ~45% capacity, 18 messages, no degradation
◉ Standing Orders   CLAUDE.md: 142 lines, 0 violations this session
◉ Blast Radius      Current task: 2 files modified (LOW risk)
◉ Safety Checks     No new warnings
◉ Swarm State       No active swarm | Last: hierarchical/3 agents
───────────────────────────────────────────────
▲ 1 advisory: CONTEXT.md last updated 3 days ago.
```

### 7.2 `/agentops audit` — Full Project Audit

**File:** `.claude/commands/agentops/audit.md`

Runs all audit checks from §2.3, §3.5, §4.6, §5.5, §6.5. Output grouped by severity. Includes RuFlo-specific checks: MCP security, swarm safety, LLM provider configuration, WASM kernel validation, vector database health.

### 7.3 `/agentops scaffold` — Create/Update Scaffold Documents

**File:** `.claude/commands/agentops/scaffold.md`

Invokes the agentops-scaffold subagent. Creates or updates PLANNING.md, TASKS.md, CONTEXT.md, WORKFLOW.md with RuFlo-specific content. Generates handoff messages that include swarm state, active topology, and agent inventory.

---

## 8. Hook Configuration

### 8.1 Additions to `.claude/settings.json`

These entries are **added** to RuFlo's existing settings.json, not replacing existing hooks:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "bash agentops/scripts/secret-scanner.sh",
        "description": "[AgentOps] Scan for hardcoded secrets before file writes"
      },
      {
        "matcher": "Write|Edit|Bash",
        "command": "bash agentops/scripts/git-hygiene-check.sh --pre-write",
        "description": "[AgentOps] Check git state before modifications"
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "bash agentops/scripts/post-write-checks.sh",
        "description": "[AgentOps] Error handling, PII, blast radius checks"
      },
      {
        "matcher": "Bash",
        "command": "bash agentops/scripts/swarm-blast-radius.sh",
        "description": "[AgentOps] Monitor swarm file modification scope"
      }
    ],
    "UserPromptSubmit": [
      {
        "command": "bash agentops/scripts/task-sizer.sh",
        "description": "[AgentOps] Analyze task risk score"
      },
      {
        "command": "bash agentops/scripts/context-estimator.sh",
        "description": "[AgentOps] Update context usage estimate"
      }
    ],
    "Stop": [
      {
        "command": "bash agentops/scripts/session-checkpoint.sh",
        "description": "[AgentOps] Auto-commit and scaffold update if needed"
      }
    ],
    "SessionStart": [
      {
        "command": "bash agentops/scripts/session-start-checks.sh",
        "description": "[AgentOps] Validate rules files, scaffold docs, git state"
      }
    ]
  }
}
```

### 8.2 Git Hooks (`.githooks/`)

**pre-commit:**
```bash
#!/bin/bash
# [AgentOps] Pre-commit checks
# 1. Secret scanner on staged files (all LLM provider key patterns)
# 2. PII logging check on staged TypeScript/JavaScript files
# 3. Verify .env not being committed
# 4. Verify .claude/mcp.json doesn't contain real tokens
# 5. Check WASM build output isn't being committed
# Exit 1 to block commit if critical issues found
```

**post-commit:**
```bash
#!/bin/bash
# [AgentOps] Post-commit actions
# 1. Update WORKFLOW.md with commit summary
# 2. Reset blast radius counter
# 3. Log commit metadata to agentops session log
# 4. If swarm was active, log swarm state at commit time
```

Setup: `git config core.hooksPath .githooks`

---

## 9. Integration with Existing RuFlo Systems

### 9.1 Composing with Existing Skills

| Existing RuFlo Skill | How AgentOps Interacts |
|---|---|
| `hooks-automation` | AgentOps registers its hooks alongside existing ones |
| `verification-quality` | AgentOps recommends invoking this after task completion |
| `v3-security-overhaul` | AgentOps security audit delegates deep scanning to this skill |
| `performance-analysis` | AgentOps scale analysis leverages this for detailed profiling |
| `swarm-orchestration` | AgentOps monitors swarm blast radius during orchestration |
| `swarm-advanced` | AgentOps hooks into advanced swarm metrics for drift detection |

### 9.2 Composing with Existing Commands

| Existing Command | How AgentOps Interacts |
|---|---|
| `/hooks pre-task` | AgentOps extends with risk scoring and auto-checkpoint |
| `/hooks post-task` | AgentOps extends with blast radius logging and test verification |
| `/hooks session-end` | AgentOps extends with scaffold doc updates |
| `/monitoring swarm-monitor` | AgentOps reads swarm state for context health and drift detection |
| `/monitoring agent-metrics` | AgentOps reads agent metrics for degradation signals |
| `/verify check` | AgentOps recommends running after each sub-task completion |

### 9.3 Composing with Existing Agents

| Existing Agent Category | How AgentOps Interacts |
|---|---|
| `security-auditor.yaml` | AgentOps invokes for deep security scans during `/agentops-audit` |
| `project-coordinator.yaml` | AgentOps reads coordination state for context and task tracking |
| Agent drift detection | AgentOps hooks into RuFlo's hierarchical coordinator for drift signals |

---

## 10. Dashboard (Web-Based Health Monitor)

### 10.1 Overview

AgentOps includes a local HTML dashboard (`agentops-dashboard.html`) that provides a visual interface for monitoring all five skills, historical trends, and RuFlo swarm agent state. It runs in any browser with zero dependencies — no server, no build step, no npm install.

### 10.2 Architecture

```
agentops/
├── dashboard/
│   ├── agentops-dashboard.html    # Main dashboard (single file, self-contained)
│   ├── data/                      # Log files written by hooks and scripts
│   │   ├── session-log.json       # Current session events
│   │   ├── audit-results.json     # Last /agentops-audit output
│   │   ├── health-history.json    # Daily health scores (rolling 90 days)
│   │   ├── commit-history.json    # Commit frequency data
│   │   └── swarm-state.json       # Current RuFlo agent roster and topology
│   └── README.md
```

**Data flow:** AgentOps hooks and scripts write JSON to `agentops/dashboard/data/`. The HTML dashboard reads these files via `fetch()` on load and on a configurable auto-refresh interval (default: 30 seconds). No server required — the browser reads directly from the local filesystem when opened as a file, or scripts can serve it via `npx serve agentops/dashboard`.

### 10.3 Pages

#### 10.3.1 Overview Dashboard (Primary Audience: Vibe Coders)

The main landing page shows:

- **Overall health score** (0-100) as a ring gauge, computed as weighted average of all five skill scores
- **5 KPI cards:** Commits today, context usage %, blast radius (files), violations count, last scan time
- **Skills health panel:** Each of the 5 skills with a score bar, current status, and one-line description
- **Recent events log:** Chronological feed from all hooks (commits, warnings, blocks, scaffold updates)
- **Trend charts:** Commit frequency and health score over 7/30 days with stacked bars
- **Time range selector:** 24h / 7d / 30d toggle

#### 10.3.2 Skill Detail Pages (5 pages, one per skill)

Each skill has a dedicated drill-down page with:

- **Skill 1 (Save Points):** Last commit time, current branch, auto-saves count, commit timeline chart, uncommitted files warning
- **Skill 2 (Context Health):** Context usage gauge with token estimate, message count, degradation signal counts, scaffold document freshness table
- **Skill 3 (Standing Orders):** CLAUDE.md and AGENTS.md line counts, required section coverage matrix, violation history, rules file linter results
- **Skill 4 (Small Bets):** Current task risk score with level indicator, blast radius gauge, median commit size, task size distribution chart (last 20 commits)
- **Skill 5 (Safety Checks):** Secrets blocked count, error handling coverage %, PII warnings, full security audit results table

#### 10.3.3 Audit Report Page

Shows the full `/agentops-audit` results in a sortable table: check name, severity (Critical/Warning/Advisory/Pass), and detail. Summary cards at top show counts per severity level.

#### 10.3.4 Trends Page (Historical)

Time-series visualizations:

- Overall health score over 30 days (line/bar chart)
- Violations per week broken down by type (rules, blast radius, context restarts)
- Commit frequency trend over 30 days
- Most violated rules table with improvement/decline arrows

#### 10.3.5 RuFlo Swarm Agents Page (Separate, for Development)

A dedicated page for monitoring RuFlo's agent orchestration during development:

- **KPI cards:** Active agent count (of 60+), queen status and type, consensus algorithm in use, drift events, memory usage %
- **Active agent roster table:** Agent name, type (queen/worker), status (active/idle/error), files modified, current task, drift status
- **Swarm topology diagram:** ASCII visualization of current hierarchical/mesh/ring/star topology showing agent relationships
- **Memory system table:** Health of each of the 8 memory types (HNSW, ReasoningBank, knowledge graph, episodic, working, EWC++, etc.) with entry counts

### 10.4 Data Format

All log files use newline-delimited JSON (NDJSON) for append-friendly writes:

**session-log.json:**
```json
{"ts":"2026-03-19T14:32:00Z","type":"commit","msg":"Auto-commit checkpoint","src":"session-end hook","sev":"info"}
{"ts":"2026-03-19T14:28:00Z","type":"warn","msg":"Context at 47%","src":"context-estimator","sev":"warning"}
{"ts":"2026-03-19T14:15:00Z","type":"complete","msg":"Task completed: MoE router optimization","src":"post-task hook","sev":"info"}
```

**health-history.json:**
```json
{"date":"2026-03-19","overall":85,"s1":98,"s2":85,"s3":72,"s4":90,"s5":78,"commits":14,"violations":0}
{"date":"2026-03-18","overall":82,"s1":95,"s2":80,"s3":70,"s4":88,"s5":76,"commits":10,"violations":1}
```

**swarm-state.json:**
```json
{"ts":"2026-03-19T14:30:00Z","topology":"hierarchical","queen":"tactical","agents":[{"id":"coder-ts-01","type":"worker","status":"active","files":3,"task":"MoE router optimization","drift":false}]}
```

### 10.5 Hook Integration for Data Writes

Each AgentOps hook appends to the appropriate data file:

| Hook | Writes To |
|---|---|
| `session-start-checks.sh` | session-log.json |
| `secret-scanner.sh` | session-log.json |
| `post-write-checks.sh` | session-log.json |
| `context-estimator.sh` | session-log.json |
| `task-sizer.sh` | session-log.json |
| `session-checkpoint.sh` | session-log.json, health-history.json |
| `swarm-blast-radius.sh` | session-log.json, swarm-state.json |
| `/agentops audit` | audit-results.json |
| `.githooks/post-commit` | commit-history.json |

### 10.6 Implementation

The dashboard is a single self-contained HTML file with inline CSS and JavaScript. No build tools, no React, no npm. It uses:

- CSS custom properties for theming
- Vanilla JS for rendering and navigation
- CSS Grid for responsive layout
- Inline SVG for the health score ring gauge
- DOM-based bar charts (no chart library dependency)

This keeps it zero-dependency and instantly usable by opening the file in any browser.

---

## 11. Implementation Phases

### Phase 1: Foundation (Week 1)

| Component | Priority | Effort | Notes |
|---|---|---|---|
| `secret-scanner.sh` (with RuFlo patterns) | P0 | 3h | All LLM provider key patterns |
| `git-hygiene-check.sh` | P0 | 2h | — |
| Session start validation hook | P0 | 2h | Check CLAUDE.md, AGENTS.md, git |
| CLAUDE.md AgentOps section additions | P0 | 1h | Append, don't replace |
| AGENTS.md AgentOps section additions | P0 | 1h | Universal rules |
| `.githooks/pre-commit` | P0 | 2h | Secrets, .env, mcp.json |
| `/agentops check` (basic) | P1 | 2h | Git status + rules status only |

### Phase 2: Monitoring (Week 2)

| Component | Priority | Effort | Notes |
|---|---|---|---|
| `context-estimator.sh` | P0 | 3h | Include swarm overhead calculation |
| `task-sizer.sh` with RuFlo risk scoring | P0 | 4h | MCP, swarm, WASM, consensus multipliers |
| `swarm-blast-radius.sh` | P0 | 4h | Multi-agent file tracking |
| Blast radius PostToolUse hook | P1 | 3h | — |
| Message count tracker | P1 | 1h | Lower thresholds during swarm |
| Auto-commit on session end | P1 | 2h | Integrate with existing session-end hook |
| `/agentops check` full dashboard | P1 | 3h | Include swarm state |

### Phase 3: Scaffold System (Week 3)

| Component | Priority | Effort | Notes |
|---|---|---|---|
| Scaffold templates (RuFlo-specific) | P0 | 3h | Pre-populate tech stack, agent inventory |
| `agentops-scaffold` subagent | P0 | 4h | Understands RuFlo directory structure |
| `/agentops scaffold` command | P0 | 2h | — |
| `scaffold-validator.sh` | P1 | 2h | — |
| Handoff message generator | P1 | 2h | Include swarm topology, queen state |
| Auto-scaffold on context degradation | P1 | 3h | Compose with context estimator |

### Phase 4: Deep Auditing (Week 4)

| Component | Priority | Effort | Notes |
|---|---|---|---|
| `security-audit.sh` (full, RuFlo-adapted) | P0 | 8h | MCP, swarm, WASM, vector DB, LLM providers |
| Error handling audit | P1 | 4h | Include MCP bridge, consensus, LLM calls |
| `rules-file-linter.sh` | P1 | 3h | Dual-file (CLAUDE.md + AGENTS.md) |
| `agent-drift-detector.sh` | P1 | 4h | Hook into RuFlo coordinator |
| Scale analysis module | P2 | 5h | Swarm scaling, vector DB, LLM costs |
| `/agentops audit` full report | P1 | 4h | All checks, grouped by severity |

### Phase 5: Hardening (Ongoing)

| Component | Priority | Effort | Notes |
|---|---|---|---|
| Behavior degradation detector | P1 | 6h | RuFlo-specific signals (swarm drift, consensus) |
| Rules violation detector (diff comparison) | P1 | 5h | — |
| False positive tuning | P1 | Ongoing | Especially swarm blast radius thresholds |
| Codex CLI sync automation | P2 | 3h | `.agents/` ↔ `.claude/` parity |
| Integration tests with existing skills | P2 | 4h | hooks-automation, verification-quality |

### Phase 6: Dashboard (Week 5-6)

| Component | Priority | Effort | Notes |
|---|---|---|---|
| Dashboard HTML shell (layout, navigation, sidebar) | P0 | 4h | Zero-dependency single file |
| Overview page (KPIs, skill health, event log) | P0 | 4h | Reads session-log.json |
| Hook data writers (JSON output from all scripts) | P0 | 4h | NDJSON append to data/ files |
| 5 Skill detail pages | P1 | 6h | One page per skill |
| Audit report page | P1 | 3h | Reads audit-results.json |
| Trends page (historical charts) | P1 | 4h | Reads health-history.json |
| RuFlo Swarm Agents page | P2 | 5h | Reads swarm-state.json |
| Auto-refresh and live data loading | P2 | 3h | fetch() on interval |

---

## 12. Configuration

### 12.1 `agentops/agentops.config.json`

```json
{
  "save_points": {
    "auto_commit_after_minutes": 30,
    "auto_branch_on_risk_score": 8,
    "max_uncommitted_files_warning": 5,
    "swarm_pre_commit": true,
    "swarm_post_commit": true
  },
  "context_health": {
    "message_count_warning": 20,
    "message_count_critical": 30,
    "context_percent_warning": 60,
    "context_percent_critical": 80,
    "swarm_context_percent_warning": 50,
    "swarm_overhead_tokens_per_agent": 2000
  },
  "rules_file": {
    "claude_md_max_lines": 300,
    "agents_md_max_lines": 150,
    "required_sections": ["security", "error handling", "swarm safety"],
    "sync_to_codex": true
  },
  "task_sizing": {
    "medium_risk_threshold": 4,
    "high_risk_threshold": 8,
    "critical_risk_threshold": 13,
    "max_files_per_task_warning": 5,
    "max_files_per_task_critical": 8,
    "swarm_max_total_files_warning": 15,
    "swarm_overlap_detection": true
  },
  "security": {
    "block_on_secret_detection": true,
    "scan_git_history": false,
    "require_rls_check": true,
    "scan_mcp_config": true,
    "check_llm_provider_keys": true,
    "secret_patterns_extra": []
  },
  "ruflo_integration": {
    "compose_with_hooks_automation": true,
    "compose_with_verification_quality": true,
    "compose_with_security_overhaul": true,
    "use_existing_monitoring": true,
    "drift_detection_threshold": 2
  },
  "notifications": {
    "verbose": false,
    "suppress_advisory": false,
    "prefix_all_messages": "[AgentOps]"
  }
}
```

### 12.2 Severity Levels

| Severity | Behavior | Example |
|---|---|---|
| **Critical** | Blocks action (exit 2). Requires resolution. | Hardcoded LLM API key in source |
| **Warning** | Takes preventive action + notifies. | Auto-commit before swarm deploy |
| **Advisory** | Notifies with recommendation. No action. | CONTEXT.md slightly stale |

---

## 13. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Reverts per session | < 1 | Count `git checkout .` / `git reset` |
| Commit frequency | Every 20-30 min active work | Git log analysis |
| Swarm checkpoint compliance | 100% pre/post commits | Git log around swarm deploys |
| Security audit pass rate | 100% critical, >90% warning | `/agentops audit` results |
| Scaffold freshness | Updated within 24h of last session | File timestamps |
| Blast radius per task | ≤ 5 files median (single), ≤ 15 (swarm) | Git commit analysis |
| Drift events per swarm | < 2 | Agent drift detector log |
| Secret exposure incidents | 0 | Pre-commit hook + scanner blocks |
| Context restarts per session | ≤ 1 | Session start count |
| Permission violations | 0 critical | Permission enforcer audit log |
| Session cost vs. budget | ≤ 90% of budget | Cost tracker log |
| Monthly LLM spend | Within budget | Cost dashboard |
| Provider failover rate | < 5% of calls | Provider health monitor |
| Audit trail integrity | 100% hash chain valid | Integrity verifier |
| Eval pass rate | ≥ 95% on golden datasets | run-evals.sh output |
| Delegation scope violations | 0 | Token validator log |
| Agent lifecycle clean exits | ≥ 95% graceful | Lifecycle manager log |

---

## 14. Observability & Distributed Tracing

### 14.1 Purpose

The current event logging (NDJSON to dashboard data files) handles single-operator, single-session monitoring. It cannot trace a task through a chain of agents in a swarm. When queen-tactical-01 decomposes a task and delegates to 4 workers, there is no way to see the full execution path, identify bottlenecks, or attribute costs per step.

### 14.2 Tracing Architecture

AgentOps adopts the OpenTelemetry AI Agent Semantic Convention. Every agent action gets a trace ID and span:

```
Trace: "Add customer reviews feature" (traceId: abc123)
├── Span: queen-tactical-01 → decompose task (12ms, 0 tokens)
├── Span: coder-ts-01 → create database table (4.2s, 1847 tokens, $0.003)
│   ├── Span: tool:Write → reviews.sql (230ms)
│   └── Span: tool:Bash → run migration (1.1s)
├── Span: coder-ts-02 → build API route (6.8s, 3201 tokens, $0.005)
├── Span: tester-01 → run integration tests (8.3s, 0 tokens)
│   └── Span: tool:Bash → npm test (7.9s)
└── Span: reviewer-01 → code review (3.1s, 1402 tokens, $0.002)
```

### 14.3 Span Record Format

```json
{
  "traceId": "abc123",
  "spanId": "span-456",
  "parentSpanId": "span-123",
  "agentId": "coder-ts-01",
  "operation": "tool:Write",
  "target": "ruflo/src/reviews.sql",
  "input_tokens": 412,
  "output_tokens": 1435,
  "latency_ms": 4200,
  "cost_usd": 0.0034,
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "status": "ok",
  "ts": "2026-03-19T14:15:00Z"
}
```

### 14.4 Implementation Components

| Component | Purpose | Priority |
|---|---|---|
| `agentops/tracing/trace-context.ts` | Trace ID generation and propagation across agent boundaries | P0 |
| `agentops/tracing/span-logger.ts` | Structured span logging (OpenTelemetry-compatible) | P0 |
| Hook: inject trace context into swarm deploys | Every swarm agent inherits the parent trace ID | P0 |
| Dashboard: Trace Viewer page | Visual trace waterfall with search and filter | P1 |
| `agentops/dashboard/data/traces.json` | Trace data file (NDJSON) | P0 |

### 14.5 Integration with RuFlo

- Swarm coordinator passes trace ID to every worker via agent context
- Queen agent spans are the root; worker spans are children
- MCP bridge calls get their own sub-spans with provider attribution
- WASM kernel invocations logged as zero-cost spans for comparison
- RuFlo's existing `/monitoring agent-metrics` feeds latency data into span records

---

## 15. Agent Identity, Permissions & Capability Model

### 15.1 Purpose

Currently all agents have equal access — a coder agent can modify security configs, a tester can delete production data. If any agent's context gets polluted via prompt injection from a malicious file, there are no permission boundaries limiting the damage.

### 15.2 Three-Layer Permission Model

**Layer 1 — Agent Identity Registry**

Every agent gets a formal identity with declared capabilities. Extend existing agent YAML definitions in `.claude/agents/`:

```yaml
# .claude/agents/coder-ts-01.md (extend existing)
---
name: coder-ts-01
identity:
  role: worker
  specialization: typescript-development
permissions:
  files:
    read: ["ruflo/src/**", "ruflo/docs/**", "package.json", "tsconfig.json"]
    write: ["ruflo/src/**"]
    deny: [".env*", ".claude/settings.json", ".claude/mcp.json", "*.key"]
  tools:
    allow: [Read, Write, Edit, Bash, Grep, Glob]
    deny: [Agent]
  bash:
    allow: ["npm test", "npm run build", "tsc", "eslint"]
    deny: ["rm -rf", "git push", "curl", "wget"]
  escalation: queen-tactical-01
---
```

**Layer 2 — Runtime Permission Enforcement**

A PreToolUse hook validates every tool call:

```
ON PreToolUse:
  agent = get_current_agent()
  tool = get_pending_tool()
  target = get_tool_target()

  IF NOT agent.permissions.allows(tool, target):
    BLOCK (exit 2): "Agent {agent.id} denied: {tool}:{target}"
    LOG: Permission violation to audit trail
    ESCALATE: Notify queen or operator
```

**Layer 3 — Delegation Scope Narrowing**

When a queen delegates to a worker, the delegation token narrows permissions:

```
Queen (broad scope) → Delegation token → Worker (narrow scope)
- Queen can read/write all of ruflo/src/
- Delegation scopes worker to ruflo/src/routing/ only
- Worker cannot exceed delegation scope, even if base permissions are broader
```

### 15.3 Implementation Components

| Component | Purpose | Priority |
|---|---|---|
| Permission schema in agent YAML definitions | Formal per-agent permissions | P0 |
| `agentops/scripts/permission-enforcer.sh` | PreToolUse hook validating permissions | P0 |
| Permission audit trail | Append-only log of every allow/deny decision | P0 |
| Dashboard: Agent Identity Registry page | All agents, roles, permissions, violation history | P1 |
| Delegation token format and validator | Scope narrowing for queen → worker | P1 |

---

## 16. Cost Management & Token Budgeting

### 16.1 Purpose

RuFlo supports Claude, GPT, Gemini, Cohere, and Ollama — each with different pricing. A swarm of 12 agents can burn $20-50/hour. Agentic overhead (retry loops, self-correction, context reloading) amplifies costs 3-5x. The current spec has zero cost awareness.

### 16.2 Hierarchical Budget System

```
Budget Hierarchy:
├── Monthly budget: $500.00 (organizational cap)
│   └── Session budget: $10.00 (per session)
│       ├── Swarm budget: $7.00
│       │   ├── queen-tactical-01: $1.00
│       │   ├── coder-ts-01: $2.00
│       │   ├── coder-ts-02: $2.00
│       │   └── tester-01: $1.00
│       └── Interactive budget: $3.00 (direct chat)
```

### 16.3 Per-Agent Token Metering

Every LLM call is tracked:

```json
{
  "agentId": "coder-ts-01",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "input_tokens": 4521,
  "output_tokens": 1847,
  "cost_usd": 0.0089,
  "cumulative_session_cost": 1.47,
  "budget_remaining": 0.53,
  "retry_count": 0,
  "ts": "2026-03-19T14:15:00Z"
}
```

### 16.4 Budget Enforcement

```
AFTER each LLM call:
  Update agent cumulative cost

  IF agent_cost > agent_budget * 0.80:
    WARN: "Agent {id} at 80% of budget (${spent}/${budget})"

  IF agent_cost > agent_budget:
    ACTION: Downgrade model (sonnet → haiku) or pause agent
    NOTIFY: "Agent {id} exceeded budget. Downgraded to cheaper model."

  IF session_cost > session_budget * 0.90:
    WARN: "Session at 90% of budget."

  IF session_cost > session_budget:
    BLOCK: Halt non-essential operations
    NOTIFY: "Session budget exceeded. Only critical operations allowed."
```

### 16.5 Cost-Aware Routing Integration

Feed cost data into RuFlo's MoE routing:

```
IF simple code transform AND WASM can handle → WASM ($0.00, <1ms)
IF classification/simple AND budget tight → Haiku/GPT-3.5 (~$0.001)
IF complex reasoning required → Opus/Sonnet (~$0.01-0.03)
```

### 16.6 Implementation Components

| Component | Purpose | Priority |
|---|---|---|
| `agentops.config.json` → budget section | Per-agent, session, monthly budgets | P0 |
| `agentops/scripts/cost-tracker.sh` | PostToolUse hook logging tokens and cost | P0 |
| Budget enforcement in PreToolUse | Block or downgrade when exceeded | P1 |
| Dashboard: Cost page | Spend per agent, session, provider, with trends | P1 |
| MoE cost feedback loop | Feed cost data into RuFlo routing | P2 |
| `agentops/dashboard/data/cost-log.json` | Cost data file (NDJSON) | P0 |

---

## 17. Agent Lifecycle Management

### 17.1 Purpose

No formal model exists for agent state. Agents are "running" or "not." This fails for queen agents coordinating workers, agents paused for human approval, and swarms needing graceful shutdown.

### 17.2 State Machine

```
                    ┌──────────┐
                    │ CREATED  │
                    └────┬─────┘
                         │ start
                         ▼
                    ┌──────────┐
              ┌────▶│  ACTIVE  │◀────┐
              │     └────┬─────┘     │
              │          │           │
          resume    pause│     resume│
              │          ▼           │
              │     ┌──────────┐    │
              └─────│ AWAITING │────┘
                    └────┬─────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        ┌──────────┐         ┌──────────┐
        │COMPLETED │         │  FAILED  │
        └──────────┘         └──────────┘
              ▲
        ┌──────────┐
        │CANCELLED │
        └──────────┘
```

| State | Meaning | Transitions |
|---|---|---|
| CREATED | Instantiated, not yet started | → ACTIVE |
| ACTIVE | Executing, consuming tokens | → AWAITING, COMPLETED, FAILED, CANCELLED |
| AWAITING | Paused for input (human approval, sub-agent result, API callback) | → ACTIVE, CANCELLED |
| COMPLETED | Task finished, result returned | Terminal |
| FAILED | Unrecoverable error | Terminal |
| CANCELLED | Gracefully terminated by operator or budget enforcement | Terminal |

### 17.3 Graceful Shutdown Protocol

```
ON cancel request:
  1. Set state to CANCELLING
  2. Agent finishes current tool call (never interrupt mid-write)
  3. Agent saves progress to WORKFLOW.md
  4. Agent commits with "[agentops] cancelled — checkpoint"
  5. Agent returns partial results to parent
  6. Set state to CANCELLED
  7. Clean up: kill child processes, release file locks
```

### 17.4 Implementation Components

| Component | Purpose | Priority |
|---|---|---|
| Agent state field in agent definitions | Formal lifecycle states | P0 |
| `agentops/scripts/lifecycle-manager.sh` | State tracking, shutdown, cleanup | P0 |
| Timeout enforcement | Auto-cancel agents exceeding max duration | P1 |
| Resource cleanup on termination | Kill children, release locks, commit checkpoint | P0 |
| Dashboard: Agent Lifecycle view | Visual state per agent with transition history | P1 |
| `agentops/dashboard/data/lifecycle.json` | Lifecycle event data (NDJSON) | P0 |

---

## 18. Multi-Provider Orchestration Awareness

### 18.1 Purpose

RuFlo supports 5+ LLM providers. AgentOps must be provider-aware for cost tracking, error attribution, failover auditing, and health monitoring across Claude, GPT, Gemini, Cohere, and Ollama.

### 18.2 Provider Health Monitoring

Track per-provider:

```
Per provider:
  - Availability: % of calls that succeed
  - Latency: p50, p95, p99
  - Error rate by type: rate limit, timeout, server error
  - Cost per 1K tokens (input/output)
  - Current rate limit headroom
```

### 18.3 Failover Audit Trail

Every provider switch is logged:

```json
{
  "agentId": "coder-ts-02",
  "provider": "openai",
  "model": "gpt-4o",
  "fallback_used": true,
  "original_provider": "anthropic",
  "failover_reason": "rate_limited",
  "latency_increase_ms": 340,
  "cost_difference_usd": 0.002,
  "ts": "2026-03-19T14:22:00Z"
}
```

### 18.4 Implementation Components

| Component | Purpose | Priority |
|---|---|---|
| Provider field in all trace/cost records | Attribution by provider | P0 |
| `agentops/scripts/provider-health.sh` | Track availability, latency, errors per provider | P1 |
| Failover event in session-log.json | Log every provider switch with reason | P0 |
| Dashboard: Provider Health page | Visual comparison across all providers | P1 |

---

## 19. Testing & Evaluation Framework

### 19.1 Purpose

When a skill definition, rules file, or agent prompt changes, there is no way to verify the change didn't break behavior. AgentOps needs a testing layer that catches regressions before they reach production.

### 19.2 Three-Tier Evaluation System

**Tier 1 — Golden Datasets (per module)**

Each AgentOps script and each RuFlo agent skill gets test cases:

```yaml
# agentops/evals/secret-scanner/cases.yaml
- name: "Detects hardcoded Anthropic key"
  input_file: "fixtures/hardcoded-anthropic-key.ts"
  expected: { blocked: true, pattern: "ANTHROPIC_API_KEY" }

- name: "Allows environment variable reference"
  input_file: "fixtures/env-var-reference.ts"
  expected: { blocked: false }

- name: "Detects JWT in MCP config"
  input_file: "fixtures/mcp-config-with-jwt.json"
  expected: { blocked: true, pattern: "JWT" }
```

**Tier 2 — Regression Suite**

Production bugs become test cases. Run the full regression suite on every rules or agent definition change:

```bash
# agentops/scripts/run-evals.sh
# Runs all golden datasets, reports pass/fail, blocks merge on regressions
```

**Tier 3 — Behavioral Benchmarks**

Periodic full-system tests:

- Does the task sizer correctly score known high-risk tasks?
- Does context degradation detector fire at correct message count?
- Does the rules violation detector catch known patterns?
- Does the scaffold subagent produce valid documents?

### 19.3 Implementation Components

| Component | Purpose | Priority |
|---|---|---|
| `agentops/evals/` directory structure | Test fixtures and expected results per module | P1 |
| `agentops/scripts/run-evals.sh` | Run all modules against golden datasets | P1 |
| CI integration (GitHub Actions) | Run evals on every PR touching agentops/ | P2 |
| Dashboard: Eval Results page | Pass/fail rates, regression trends | P2 |

---

## 20. Compliance & Immutable Audit Trail

### 20.1 Purpose

Current logging is operational, not compliance-grade. The EU AI Act becomes fully enforceable August 2, 2026. Any system deploying autonomous agents in the EU market requires immutable, complete, attributable audit records per Article 12.

### 20.2 Audit Record Format

Every agent action produces an immutable record:

```json
{
  "eventId": "evt-789",
  "traceId": "abc123",
  "ts": "2026-03-19T14:15:00.000Z",
  "actor": {
    "type": "agent",
    "id": "coder-ts-01",
    "model": "claude-sonnet-4-6",
    "provider": "anthropic"
  },
  "delegatedBy": {
    "type": "agent",
    "id": "queen-tactical-01"
  },
  "originalUser": "operator@example.com",
  "action": "tool:Write",
  "target": "ruflo/src/routing/moe-router.ts",
  "input_summary": "Modified expert selection algorithm",
  "output_summary": "47 lines changed",
  "permissionCheck": "ALLOWED",
  "status": "success",
  "tokens": { "input": 412, "output": 1435 },
  "cost_usd": 0.0034,
  "riskScore": 4,
  "hash": "<SHA-256 of this record + previous record hash>"
}
```

### 20.3 Compliance Properties

| Property | Implementation |
|---|---|
| **Append-only** | Records never modified or deleted |
| **Complete** | Every action logged, not samples |
| **Attributable** | Full chain: user → queen → worker → tool |
| **Timestamped** | Millisecond precision |
| **Integrity-checked** | SHA-256 hash chain — tampering breaks all subsequent hashes |

### 20.4 Hash Chain for Tamper Detection

```
Record N:   hash = SHA256(record_content + hash_of_record_N-1)
Record N+1: hash = SHA256(record_content + hash_of_record_N)
...
If any record is modified, all subsequent hashes break.
```

### 20.5 Implementation Components

| Component | Purpose | Priority |
|---|---|---|
| `agentops/audit/audit-logger.ts` | Append-only, hash-chained audit logging | P0 (EU market) |
| `agentops/audit/integrity-verifier.sh` | Verify hash chain integrity | P1 |
| `agentops/audit/audit-trail.jsonl` | Immutable audit log file | P0 |
| Dashboard: Audit Trail page | Searchable, filterable audit log viewer | P1 |
| Compliance report generator | EU AI Act Article 12-compliant documentation | P2 |
| Data retention policy enforcement | Auto-archive beyond retention period | P2 |

---

## 21. Agent-to-Agent Trust & Delegation

### 21.1 Purpose

RuFlo's queen agents delegate to workers, but without formal trust boundaries. A worker compromised by prompt injection could escalate permissions, modify other agents, or exfiltrate data.

### 21.2 Delegation Token System

When a queen delegates to a worker, it issues a scoped token:

```json
{
  "issuer": "queen-tactical-01",
  "delegate": "coder-ts-01",
  "original_user": "operator@example.com",
  "task": "Fix MoE expert selection",
  "scope": {
    "files": ["ruflo/src/routing/**"],
    "tools": ["Read", "Write", "Edit", "Bash:npm test"],
    "max_tokens": 50000,
    "max_duration": "30m",
    "can_delegate": false
  },
  "issued_at": "2026-03-19T14:00:00Z",
  "expires_at": "2026-03-19T14:30:00Z",
  "signature": "<cryptographic-signature>"
}
```

### 21.3 Enforcement Rules

- Delegation tokens can only **narrow** scope, never widen
- Workers cannot further delegate unless `can_delegate: true`
- Tokens expire — no indefinite delegation
- Every permission check logs the full delegation chain
- Queen can revoke a worker's token immediately (mid-task cancellation)

### 21.4 Output Validation on Return

```
ON worker_result received by queen:
  Validate result structure (prevent injection)
  Check files modified are within delegation scope
  Verify no permission violations occurred during execution
  Log complete delegation chain in audit trail

  IF out_of_scope_modifications:
    REJECT result
    REVERT worker changes (git checkout)
    ALERT operator
```

### 21.5 Implementation Components

| Component | Purpose | Priority |
|---|---|---|
| Delegation token schema | Formal scoped delegation format | P1 |
| Token validator in PreToolUse | Enforce delegation scope on every tool call | P1 |
| Output validator for delegation returns | Verify worker stayed in scope | P1 |
| Dashboard: Delegation chain visualization | Who delegated to whom, with what scope | P2 |

---

## 22. Self-Improvement, Plugin Architecture & Event Bus

### 22.1 Self-Improvement with Guardrails

RuFlo's SONA and EWC++ enable agents to learn. As agents identify failure patterns, they'll want to update their own rules. The framework must support this without agents weakening their own guardrails.

**Propose-Review-Apply pattern:**

```
1. Agent detects repeated failure pattern
2. Agent proposes a rules file addition:
     PROPOSED: "When importing routing utilities, always use
     '@ruflo/routing' — the alias is configured in tsconfig.json."
3. Proposal stored in agentops/proposals/pending/ (NOT applied)
4. Operator reviews in dashboard: evidence, frequency, context impact
5. On approval: rule appended to CLAUDE.md, logged to audit trail
6. On rejection: proposal archived with reason

CRITICAL: Agents can only ADD rules, never REMOVE.
Only operators can remove rules.
```

| Component | Purpose | Priority |
|---|---|---|
| `agentops/proposals/` directory (pending, approved, rejected) | Rule proposal queue | P2 |
| Proposal submission mechanism | Agents propose via structured format | P2 |
| Dashboard: Proposals Review page | Review queue with evidence and impact | P2 |
| Append-only enforcement | Block agent-initiated rule removal | P1 |

### 22.2 Plugin Architecture

The current monolithic script set doesn't allow extension without forking. A plugin system enables community and team-specific checks.

**Plugin directory structure:**

```
agentops/
├── plugins/
│   ├── registry.json              # Installed plugins
│   ├── core/                      # Built-in (current scripts become plugins)
│   │   ├── secret-scanner/
│   │   │   ├── plugin.json
│   │   │   └── check.sh
│   │   ├── blast-radius/
│   │   ├── context-health/
│   │   └── ...
│   └── community/                 # User-installed plugins
│       ├── k8s-deploy-check/
│       │   ├── plugin.json
│       │   └── check.sh
│       └── graphql-schema-lint/
```

**Plugin manifest:**

```json
{
  "name": "k8s-deploy-check",
  "version": "1.0.0",
  "description": "Validates Kubernetes manifests before deployment",
  "hooks": {
    "PreToolUse": { "matcher": "Bash", "filter": "kubectl apply" }
  },
  "config_schema": {
    "namespace_allowlist": { "type": "array" },
    "require_resource_limits": { "type": "boolean", "default": true }
  },
  "dashboard_panel": { "title": "K8s Deployments", "type": "audit-table" }
}
```

| Component | Purpose | Priority |
|---|---|---|
| Plugin manifest schema | Standardized plugin format | P2 |
| Plugin loader and registry | Discover, install, enable/disable plugins | P2 |
| Core plugins (refactor existing scripts) | Current scripts become first-party plugins | P2 |
| Integration with RuFlo's plugin SDK and IPFS marketplace | Shared distribution channel | P3 |

### 22.3 Event Bus (Architectural Foundation)

The structural enabler for all extensions above. Currently scripts run independently with no shared state. An event bus centralizes communication.

```
                     ┌───────────────────────┐
                     │    AgentOps Event Bus   │
                     │  (in-process pub/sub)   │
                     └─────────┬───────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
     ┌─────▼─────┐     ┌──────▼──────┐    ┌──────▼──────┐
     │  Hooks     │     │  Plugins    │    │  Dashboard  │
     │ (emit      │     │ (subscribe  │    │ (subscribe  │
     │  events)   │     │  & react)   │    │  & render)  │
     └───────────┘     └─────────────┘    └─────────────┘
           │                   │                   │
     ┌─────▼─────┐     ┌──────▼──────┐    ┌──────▼──────┐
     │ Tracing    │     │ Cost Meter  │    │ Audit Log   │
     │ (spans)    │     │ (tokens)    │    │ (everything)│
     └───────────┘     └─────────────┘    └─────────────┘
```

Every hook emits a typed event. Plugins subscribe to events they care about. The audit log subscribes to everything. The cost meter subscribes to LLM call events. New capabilities are added by subscribing to existing events.

**Implementation:** Lightweight TypeScript event emitter running as a local process or within Claude Code's Node.js runtime. Events also persist to NDJSON for the dashboard.

| Component | Purpose | Priority |
|---|---|---|
| `agentops/core/event-bus.ts` | Central pub/sub event emitter | P0 (v3.0) |
| Event type definitions | Typed events for all hook types | P0 |
| Persistence layer | NDJSON write for all events | P0 |
| Plugin subscription API | Plugins register event handlers | P2 |

---

## 23. Architectural Principles

These principles govern all design decisions as AgentOps evolves:

| # | Principle | Rationale |
|---|---|---|
| 1 | **Append-only by default** | Logs, audit trails, rules changes, and proposals are append-only. Nothing is deleted by agents. Provides compliance, debuggability, and guardrail protection. |
| 2 | **Event-driven, not script-driven** | The event bus is the spine. New capabilities subscribe to existing events, not modify existing scripts. |
| 3 | **Provider-agnostic** | Every data structure includes provider field. Every cost calculation is provider-aware. Works as the LLM landscape fragments. |
| 4 | **Scope narrows, never widens** | Delegation tokens, permission overrides, and budget allocations can only narrow from what the parent granted. No agent can grant itself more access. |
| 5 | **Human-in-the-loop at trust boundaries** | Agents propose, operators approve. Applies to rules changes, permission escalations, budget increases, and production deployments. |
| 6 | **Test what you ship** | Every check, hook, and detection pattern has a golden dataset. If you can't write a test case for it, you can't trust it in production. |
| 7 | **Dashboard is the contract** | If it's not visible in the dashboard, it doesn't exist for the operator. Every new capability must have a dashboard view. |

---

## 24. Framework Evolution Roadmap

### Current → v3.0 → v4.0

```
CURRENT (v2.0)              v3.0 (Next 8 Weeks)        v4.0 (Post-Stabilization)
─────────────────           ─────────────────           ─────────────────
5 Core Skills               + Event Bus Core            + Plugin Marketplace
Shell Scripts               + Tracing (OTEL)            + Self-Improvement
NDJSON Logs                 + Cost Metering             + Delegation Tokens
HTML Dashboard              + Agent Identity             + Compliance Reports
RuFlo Integration           + Lifecycle States           + Community Plugins
                            + Provider Health            + Behavioral Evals
                            + Audit Trail (hash-chain)   + Multi-Org Federation
                            + Testing Framework
```

### v3.0 Priority Stack (8 Weeks)

| Week | Component | Depends On |
|---|---|---|
| 1 | Event bus core | Nothing — foundational |
| 2 | Agent identity + permissions | Event bus |
| 3 | Distributed tracing | Event bus + identity |
| 4 | Cost metering + budgets | Event bus + tracing |
| 5 | Lifecycle state machine | Event bus + identity |
| 6 | Append-only audit trail | Event bus (EU deadline Aug 2026) |
| 7 | Provider health monitoring | Tracing + cost metering |
| 8 | Eval framework (golden datasets) | All modules stable enough to test |

### v4.0 Components (After v3.0 Stabilizes)

| Component | Prerequisite |
|---|---|
| Plugin architecture | Event bus + stable API |
| Self-improvement proposals | Audit trail + rules system |
| Delegation tokens | Identity + permissions |
| Compliance report generator | Audit trail |
| Multi-org federation | All of the above |

---

## Appendix A: RuFlo-Specific Glossary

| Term | Definition |
|---|---|
| **Queen agent** | Hierarchical coordinator that manages worker agents (Strategic, Tactical, Adaptive types) |
| **Swarm topology** | Network structure for agent communication (mesh, hierarchical, ring, star) |
| **SONA** | Self-Optimizing Neural Architecture — RuFlo's self-improvement layer |
| **EWC++** | Elastic Weight Consolidation — prevents catastrophic forgetting in learned patterns |
| **MoE routing** | Mixture of Experts — routes tasks to the most appropriate of 8 expert models |
| **RuVector** | RuFlo's vector database for embedding storage and HNSW search |
| **ReasoningBank** | Pattern storage for successful agent reasoning strategies |
| **AIDefence** | RuFlo's security module for prompt injection blocking and CVE hardening |
| **MCP bridge** | Model Context Protocol connection layer for Claude Code integration |
| **WASM kernel** | WebAssembly modules (compiled from Rust) for high-speed simple operations |
| **Anti-drift coordinator** | RuFlo's built-in system that validates agent outputs against original goals |
| **Blast radius** | Total file/system impact of a change (amplified in swarm operations) |
| **Scaffold documents** | PLANNING, TASKS, CONTEXT, WORKFLOW — state files surviving across sessions |
| **Trace ID** | Unique identifier that follows a task through all agents and tool calls in its execution chain |
| **Span** | A single unit of work within a trace (one tool call, one LLM request, one agent action) |
| **Delegation token** | Scoped, time-limited credential issued by a queen agent to a worker, narrowing permissions |
| **Event bus** | Central pub/sub system where hooks emit events and plugins/dashboard subscribe |
| **Golden dataset** | Curated set of (input, expected output) pairs for testing agent behavior |
| **Hash chain** | SHA-256 linked records where each hash includes the previous record's hash — tampering detection |
| **RBAC** | Role-Based Access Control — permission model where agents operate under assigned roles |
| **OTEL** | OpenTelemetry — emerging standard for agent observability with traces, metrics, and logs |
| **Append-only** | Data structure where records can only be added, never modified or deleted |
| **Provider failover** | Automatic switch to backup LLM provider when primary fails or is rate-limited |

---

## Appendix B: Files Created vs. Modified

### New Files (AgentOps Creates)

| File | Purpose |
|---|---|
| `agentops/scripts/*.sh` | All monitoring and audit scripts |
| `agentops/templates/*.md` | Scaffold document templates |
| `agentops/agentops.config.json` | Configuration thresholds |
| `.claude/agents/agentops-monitor.md` | Real-time monitor subagent |
| `.claude/agents/agentops-auditor.md` | Project auditor subagent |
| `.claude/agents/agentops-scaffold.md` | Scaffold manager subagent |
| `.claude/commands/agentops/*.md` | Slash commands |
| `.claude/skills/agentops/SKILL.md` | AgentOps skill definition |
| `.agents/skills/agentops/SKILL.md` | Codex-compatible skill |
| `.githooks/pre-commit` | Universal git pre-commit hook |
| `.githooks/post-commit` | Universal git post-commit hook |
| `agentops/dashboard/agentops-dashboard.html` | Web-based health dashboard |
| `agentops/dashboard/data/*.json` | Dashboard data files (written by hooks) |
| `agentops/tracing/trace-context.ts` | Trace ID generation and propagation |
| `agentops/tracing/span-logger.ts` | OpenTelemetry-compatible span logging |
| `agentops/dashboard/data/traces.json` | Distributed trace data (NDJSON) |
| `agentops/dashboard/data/cost-log.json` | Token usage and cost data (NDJSON) |
| `agentops/dashboard/data/lifecycle.json` | Agent lifecycle events (NDJSON) |
| `agentops/audit/audit-logger.ts` | Append-only hash-chained audit logging |
| `agentops/audit/audit-trail.jsonl` | Immutable audit log (hash-chained) |
| `agentops/audit/integrity-verifier.sh` | Hash chain tamper verification |
| `agentops/core/event-bus.ts` | Central pub/sub event emitter |
| `agentops/evals/` | Test fixtures and golden datasets per module |
| `agentops/evals/run-evals.sh` | Run all modules against golden datasets |
| `agentops/proposals/` | Agent self-improvement proposals (pending/approved/rejected) |
| `agentops/plugins/registry.json` | Installed plugin registry |
| `agentops/plugins/core/` | Built-in plugins (refactored from scripts) |
| `agentops/plugins/community/` | User-installed community plugins |
| `PLANNING.md` | Scaffold document |
| `TASKS.md` | Scaffold document |
| `CONTEXT.md` | Scaffold document |
| `WORKFLOW.md` | Scaffold document |

### Existing Files (AgentOps Modifies by Appending)

| File | What Gets Added |
|---|---|
| `CLAUDE.md` | AgentOps Management Rules section |
| `AGENTS.md` | AgentOps Universal Rules section |
| `.claude/settings.json` | Hook entries (prefixed `[AgentOps]`) |
| `.gitignore` | Ensure .env patterns are covered |

### Existing Files (AgentOps Reads but Never Modifies)

| File | Why It's Read |
|---|---|
| `.claude/agents/*.yaml` | Agent scope validation for drift detection |
| `.claude/commands/hooks/*.md` | Understand existing hook behavior |
| `.claude/commands/monitoring/*.md` | Read swarm/agent metrics |
| `.claude/mcp.json` | Security audit of MCP configuration |
| `.claude/skills/*/SKILL.md` | Understand existing skill capabilities |
| `ruflo/.env.example` | Validate environment variable patterns |
| `ruflo/src/**` | Security and error handling audits |
| `package.json` | Dependency audit |
