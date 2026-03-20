# AgentOps: Standalone Agent Management System

## Product Specification — Installable Framework

**Version:** 4.0 — Generic Product Specification
**Date:** March 20, 2026
**Mode:** Dual-mode (real-time session monitor + on-demand project audit)
**Platform:** Multi-tool compatible (Claude Code, Cursor, Copilot, Codex, and others)
**Enforcement:** Guardrails — warns and takes preventive action where safe; never silently blocks

---

## 1. System Overview

### 1.1 Purpose

AgentOps is a standalone management and safety framework that any agentic developer installs into their project to monitor their AI agents. While your agents execute tasks autonomously, AgentOps runs parallel to them—tracking version control discipline, context health, rules compliance, task sizing, and proactive safety checks. It enforces best practices without getting in the way.

AgentOps maintains persistent, searchable memory of all agent operations across sessions, enabling pattern detection, root cause analysis, and semantic search over your project's operational history.

AgentOps is not a replacement for LLM provider dashboards or agent monitoring tools. Those track agent *performance*. AgentOps tracks agent *management hygiene*—the practices that prevent data loss, context drift, blast radius problems, and security gaps.

### 1.2 What AgentOps Is Not

- **Not tied to RuFlo or any specific framework.** It works on any project—React apps, Python backends, mobile apps, SaaS platforms.
- **Not mandatory project infrastructure.** You choose which AI tools to use: Claude Code, Cursor, Codex, Copilot, or others. AgentOps works across all of them.
- **Not an IDE extension.** It runs as shell scripts, configuration files, and an optional dashboard.
- **Not a replacement for your agents.** AgentOps watches and guards; your agents do the work.

### 1.3 Design Philosophy

AgentOps treats the human developer (you) as the general contractor responsible for your agents. The system:

- Catches problems that neither individual agents nor LLM providers will raise
- Enforces version control and checkpoint discipline across multi-agent work
- Monitors context window health within your development sessions
- Validates that your project's rules (AGENTS.md, CLAUDE.md) are being followed
- Applies blast radius analysis before large or risky tasks
- Audits security posture of agent deployments

### 1.4 Installation Architecture

AgentOps is installed as a directory in your project root. Your project stays yours—AgentOps adds guardrails without requiring you to rewrite anything:

```
your-project/
├── agentops/                  # ← AgentOps installation
│   ├── scripts/
│   │   ├── git-hygiene-check.sh
│   │   ├── scaffold-validator.sh
│   │   ├── security-audit.sh
│   │   ├── rules-file-linter.sh
│   │   ├── context-estimator.sh
│   │   ├── task-sizer.sh
│   │   ├── secret-scanner.sh
│   │   └── ... (more scripts)
│   ├── templates/
│   ├── dashboard/
│   ├── tracing/
│   ├── audit/
│   ├── evals/
│   ├── plugins/
│   ├── src/
│   │   ├── memory/          # Persistent memory store with hash-chained events
│   │   ├── mcp/             # MCP server interface (8 tools, stdio+HTTP)
│   │   ├── primitives/      # Composable TypeScript primitives (7 modules)
│   │   └── enablement/      # Progressive skill enablement engine
│   ├── models/              # Embedding models (auto-downloaded)
│   └── agentops.config.json
├── .claude/                   # Your Claude Code config (AgentOps adds hooks)
├── .cursorrules              # Your Cursor rules (AgentOps can sync)
├── .agents/                   # Your Codex/other tool config
├── AGENTS.md                  # Universal agent rules (AgentOps creates/extends)
├── CLAUDE.md                  # Claude-specific rules (AgentOps creates/extends)
├── PLANNING.md                # Scaffold doc (AgentOps creates)
├── TASKS.md                   # Scaffold doc (AgentOps creates)
├── CONTEXT.md                 # Scaffold doc (AgentOps creates)
├── WORKFLOW.md                # Scaffold doc (AgentOps creates)
└── [your project files]
```

### 1.5 Key Design Principles

1. **Extend, don't replace.** Your existing agent definitions, rules, and configs stay. AgentOps adds new concerns to existing hook points and creates new files only where needed.

2. **Multi-tool parity.** Rules and scaffold documents work via AGENTS.md (universal), CLAUDE.md (Claude Code), and `.agents/config.toml` (Codex). Git hooks work with any tool.

3. **Generic, not opinionated.** AgentOps knows nothing about your tech stack, agent architecture, or deployment model. It watches for universal safety issues.

4. **Installable, not magical.** Install AgentOps from an npm package, a GitHub release, or a simple copy-paste. Remove it by deleting the `agentops/` directory and the appended rules sections. No permanent magic.

5. **Memory-aware** — every agent event is captured, indexed, and searchable by meaning. Events form a hash chain for tamper detection.

---

## 2. Skill 1 — Save Points (Version Control Enforcement)

### 2.1 What This Module Does

Ensures your project always has recoverable save points, especially critical since multiple agents modifying files simultaneously can create chaotic commit histories.

### 2.2 Real-Time Monitors

#### 2.2.1 Pre-Modification Check

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

#### 2.2.2 Multi-Agent Commit Strategy

When multiple agents coordinate or execute in parallel:

```
PRE-DEPLOYMENT:
  ACTION: Auto-commit with "[agentops] pre-deployment checkpoint"
  ACTION: Create branch if on main

POST-DEPLOYMENT:
  IF succeeded:
    NOTIFY: "{n} files modified. Review with 'git diff' before committing."
  IF failed or partially failed:
    WARN: "{n} files modified, {m} agents reported errors."
    RECOMMEND: "Review changes carefully. Consider 'git checkout .' to revert."
```

#### 2.2.3 Post-Edit Tracking

Extend your tool's post-edit hook:

```
AFTER each file modification:
  Increment files_modified_this_session counter
  Append file path to session modification log

  IF files_modified_this_session > 8 AND no commit since session start:
    WARN: "8+ files modified without a checkpoint. Auto-saving."
    ACTION: Auto-commit "[agentops] mid-session checkpoint"
```

#### 2.2.4 Session End Checkpoint

On session completion:

```
ON session end:
  IF uncommitted_changes exist:
    ACTION: Auto-commit "[agentops] session-end checkpoint — {summary}"
  ACTION: Update WORKFLOW.md with session summary
  ACTION: Update CONTEXT.md with current state
```

### 2.3 Audit Checks

| Check | Pass Criteria | Severity |
|---|---|---|
| Git initialized | `.git/` directory exists | Critical |
| .gitignore covers secrets | `.env`, `.env.local`, `*.key`, `*.pem` | Critical |
| .gitignore covers build output | `node_modules/`, `dist/`, compiled artifacts | Warning |
| Recent commits | ≥1 commit per 24hr active period | Warning |
| Commit frequency | Average gap < 45min during active work | Advisory |
| Branch usage | High-risk changes not on main | Advisory |

---

## 3. Skill 2 — Context Health Monitoring

### 3.1 What This Module Does

Monitors context window health within a single agent session or across multiple agents working in parallel. Context degradation happens when instructions and state accumulate to the point where early system instructions get lost.

### 3.2 Real-Time Monitors

#### 3.2.1 Context Usage Estimator

**Event:** `PostToolUse` — after every tool use
**Logic:**

```
context_estimate = sum of:
  - All user messages (char count)
  - All agent responses (char count)
  - All files read into context (char count)
  - AGENTS.md content
  - CLAUDE.md content (or tool-specific rules)
  - Active agent prompts and system instructions

token_estimate = context_estimate / 4

# Standard thresholds
IF token_estimate > 60% of model_context_limit:
  NOTIFY: "Context at ~60%. Consider wrapping up current task."

IF token_estimate > 80%:
  WARN: "Context critically full (~80%). Early instructions being lost."
  ACTION: Invoke scaffold update
  RECOMMEND: "Start fresh session using handoff message."
```

#### 3.2.2 Behavior Degradation Detector

Tracks signs that an agent is losing coherence:

```
degradation_signals = {
  instruction_violations: 0,     # Agent violates stated rules
  file_rewrites: 0,              # Agent modifies file marked complete
  repeated_errors: 0,            # Same error recurs after "fix"
  contradictions: 0,             # Agent proposes previously rejected approach
  drift: 0,                       # Agent output diverges from original goal
}

IF sum(degradation_signals) >= 3:
  WARN: "Context degradation detected ({details})."
  ACTION: Update scaffold docs → generate handoff message
  RECOMMEND: "Start fresh session."
```

### 3.3 Scaffold Document Manager

AgentOps manages four documents that survive across sessions:

- **PLANNING.md:** Architecture, tech stack, design decisions
- **TASKS.md:** Feature list, status (done/in-progress/blocked), known bugs
- **CONTEXT.md:** Current branch, last commits, active goals, "do not change" notes
- **WORKFLOW.md:** Session log — each session gets an entry

On invocation (at session start, when context degrades, at session end):

1. Check which scaffold docs exist
2. For missing docs, create from templates
3. For existing docs, update with current state
4. Generate handoff message for fresh sessions

### 3.4 Handoff Message Template

```
I'm continuing work on {project}. Here's where we are:

PROJECT: {project name}
TECH STACK: {languages, frameworks}
ACTIVE BRANCH: {branch_name}
LAST COMMIT: {commit_hash} — {commit_message}

WHAT'S DONE: [from TASKS.md completed section]
WHAT'S NEXT: [from TASKS.md in-progress section]

AGENTS IN USE:
- {agent/tool name}: {purpose}

KEY DECISIONS ALREADY MADE:
- [from CONTEXT.md]

KNOWN ISSUES:
- [from TASKS.md known bugs]

DO NOT CHANGE:
- [from CONTEXT.md]

READ THESE FILES FIRST:
1. PLANNING.md — architecture and tech stack
2. TASKS.md — what's done and what's next
3. CONTEXT.md — current state summary
4. WORKFLOW.md — recent session logs
```

### 3.5 Audit Checks

| Check | Pass Criteria | Severity |
|---|---|---|
| PLANNING.md exists | File present, has tech stack section | Warning |
| TASKS.md exists | File present with ≥1 task | Warning |
| CONTEXT.md current | Updated within 7 days of last commit | Warning |
| WORKFLOW.md exists | File present | Advisory |
| Handoff message available | CONTEXT.md has "Last Session" section | Advisory |

---

## 4. Skill 3 — Standing Orders (Rules File Compliance)

### 4.1 What This Module Does

Validates that your project's rules files are well-structured, within reasonable size limits, and actually being followed by agents.

### 4.2 Integration with Existing Rules Files

AgentOps **appends** to your existing CLAUDE.md and AGENTS.md files rather than replacing them.

**Additions to CLAUDE.md (Claude Code specific):**

```markdown
## AgentOps Management Rules

### Version Control
- Commit before and after agent deployments
- Never make high-risk changes directly on main — branch first
- Auto-save checkpoints every 30 minutes of active work

### Context Health
- Monitor for degradation signals after 20+ messages
- Update scaffold docs (PLANNING, TASKS, CONTEXT, WORKFLOW) at session end
- Start fresh when context degrades — don't try to push through

### Task Sizing
- Before any task, assess blast radius: how many files, which systems?
- Large tasks (9+ files) require decomposition into sub-tasks
- Validate and commit between each sub-task

### Error Handling
- Every API/agent call must have error handling with user-friendly messages
- Never show blank screens — always show fallback state
- Log errors to console, never expose stack traces to users

### Security (Non-Negotiable)
- NEVER hardcode API keys, tokens, or credentials
- NEVER log PII (emails, names, payment data) in output
- Validate and sanitize all input before agent processing
- Use environment variables for secrets (see .env.example)
```

**Additions to AGENTS.md (universal, all tools):**

```markdown
## AgentOps Universal Rules (All Tools)

### Before starting any task:
1. Check git status — commit if uncommitted changes exist
2. Read TASKS.md and CONTEXT.md for current state
3. Confirm your plan before writing code
4. Assess blast radius: how many files will this touch?

### After completing any task:
1. Summarize what changed and which files were modified
2. List what to test
3. Wait for approval before starting next task
4. Update TASKS.md with completion status

### Security:
- Never hardcode secrets — use environment variables
- Never log PII in any output
- Validate all user input before processing

### Error Handling:
- Every API/tool call needs try/catch with user-friendly message
- Never show blank screens — always show fallback state
- Agent failures must be caught and reported, not swallowed
```

### 4.3 Real-Time Monitors

#### 4.3.1 Session Start Validation

**Event:** `SessionStart`

```
# Check existing rules files
IF CLAUDE.md missing (for Claude Code):
  WARN: "No CLAUDE.md found. Create one to establish project rules."

IF AGENTS.md missing:
  WARN: "No AGENTS.md found. Universal agent rules are not configured."

# Validate content
rules_content = read(CLAUDE.md) or read(AGENTS.md)

IF "AgentOps" not in rules_content:
  NOTIFY: "Rules file exists but has no AgentOps section. Consider running /agentops scaffold."

IF line_count > 300:
  WARN: "Rules file is {n} lines. AgentOps recommends <200 lines
         to keep rules concise and avoid context bloat."

# Check for required sections
required_sections = ["security", "error handling"]
FOR each section in required_sections:
  IF section not found in rules_content:
    WARN: "Rules file missing '{section}' section."
```

#### 4.3.2 Rules Violation Detector

**Event:** `PostToolUse` — after `Write` and `Edit`

```
Parse rules files for prohibitions (NEVER, DO NOT, STOP, always)

After each file write/edit, check diff against rules:
  - Hardcoded secrets (API keys, tokens)
  - PII in logging statements
  - Missing error handling on external API calls
  - Missing auth checks on protected operations

IF violation_detected:
  WARN: "Possible rules violation: '{rule}' in {file}:{line}"
  SHOW: The specific code and the rule it violates
```

### 4.4 Rules File Linter

Checks on your rules files:

```
1. STRUCTURE: Has security and error handling sections
2. SIZE: Under 300 lines (keeps rules usable)
3. CONTRADICTIONS: No opposing rules across files
4. CLARITY: Flag vague language, recommend absolute directives
5. COMPLETENESS: Covers common risks for your tech stack
```

### 4.5 Audit Checks

| Check | Pass Criteria | Severity |
|---|---|---|
| Rules file exists | AGENTS.md present, non-empty | Warning |
| Tool-specific rules | CLAUDE.md or equivalent present | Warning |
| Security section | Both files cover secrets, PII, auth | Critical |
| Error handling | Both files cover try/catch, fallback states | Warning |
| Under size limit | < 300 lines combined | Warning |
| No contradictions | Linter finds no opposing rules | Warning |

---

## 5. Skill 4 — Small Bets (Task Sizing and Blast Radius)

### 5.1 What This Module Does

Intercepts large or risky tasks before execution. Prevents scenarios where agents execute across your entire codebase without checkpoints.

### 5.2 Risk Scoring Model

```
risk_score = 0

# File count estimate
estimated_files = analyze task prompt for scope
IF estimated_files <= 3:  risk_score += 1   # Small
IF estimated_files 4-8:   risk_score += 3   # Medium
IF estimated_files >= 9:  risk_score += 5   # Large

# Database/infrastructure changes
IF task mentions "database", "table", "schema", "migration":
  IF new tables/columns:     risk_score += 2
  IF modifying existing:     risk_score += 4
  IF deleting/dropping:      risk_score += 5

# Shared code modifications
IF task mentions "auth", "security", "encryption", "validation":
  risk_score += 4

IF task mentions "refactor", "redesign", "rewrite", "migrate":
  risk_score += 4

IF task mentions "all", "every", "entire", "whole":
  risk_score += 3

# Risk levels
LOW:       risk_score 1-3   → Proceed normally
MEDIUM:    risk_score 4-7   → Require plan before execution, auto-commit checkpoint
HIGH:      risk_score 8-12  → Require decomposition into sub-tasks
CRITICAL:  risk_score 13+   → Require branch, decomposition, and step-by-step approval
```

### 5.3 Real-Time Monitors

#### 5.3.1 Task Sizing Gate

**Event:** `UserPromptSubmit`

```
Calculate risk_score per §5.2

IF risk_score >= 13 (CRITICAL):
  WARN: "Critical-risk task (score: {score})."
  ACTION: Create branch, require decomposition, enforce step-by-step approval
  REQUIRE: Operator confirms plan AND reviews each result

IF risk_score 8-12 (HIGH):
  WARN: "High-risk task (score: {score}). Decompose before starting."
  ACTION: Auto-commit checkpoint, invoke decomposition prompt
  REQUIRE: Operator confirms plan before agent proceeds

IF risk_score 4-7 (MEDIUM):
  NOTIFY: "Medium-risk task. Committing checkpoint first."
  ACTION: Auto-commit if uncommitted changes exist

IF risk_score 1-3 (LOW):
  PASS: No intervention
```

#### 5.3.2 Multi-Step Verification

```
IF agent signals "task complete":
  CHECK: Was testing performed?
    - Scan for test commands (npm test, pytest, go test)
    - Check for verification steps in logs

  IF no testing detected:
    NOTIFY: "Task marked complete but no testing found."
    RECOMMEND: "Run tests to verify the changes."
```

### 5.4 Decomposition Prompts

**For planning:**

```
I want to [task]. Before writing any code, break this down into the
smallest independent sub-tasks. Consider:
- Which parts of the system are affected?
- Will this require database changes?
- Are there any cross-cutting concerns (auth, security, validation)?
- Which files will each sub-task touch?

Each sub-task should touch ≤5 files and be testable independently.
Present the plan and wait for my approval.
```

**For large tasks:**

```
This is a large task affecting multiple areas. Before proceeding:
1. Which components/modules are involved?
2. Which files will likely be modified?
3. Are there any shared files that multiple changes might touch?
4. What is the total blast radius across all changes?
5. What checkpoints should we create between phases?

Present the plan with file boundaries.
```

### 5.5 Audit Checks

| Check | Pass Criteria | Severity |
|---|---|---|
| Average commit size | Median < 8 files per commit | Warning |
| No mega-commits | No single commit touching 20+ files | Warning |
| Branch usage | Core system changes on branches | Advisory |
| Test execution | Tests run before marking tasks complete | Advisory |

---

## 6. Skill 5 — Proactive Safety Checks

### 6.1 What This Module Does

Audits for security, privacy, and reliability issues that agents might overlook: secrets exposure, missing error handling, PII leakage, unsafe API usage, and scalability concerns.

### 6.2 Real-Time Monitors

#### 6.2.1 Secret Exposure Scanner

**Event:** `PreToolUse` — before `Write` and `Edit` (BLOCKS if detected)

```
Scan content for patterns:
  # Standard
  - API keys: sk_live_*, sk_test_*, AKIA*, ghp_*, glpat-*
  - Generic: strings labeled key, secret, token, password, credential
  - Connection strings: postgresql://, mongodb://, redis://, sqlite:///
  - JWT tokens: eyJ*
  - Private keys: -----BEGIN ... PRIVATE KEY-----

  # Common provider patterns
  - ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY
  - AWS_SECRET_ACCESS_KEY, STRIPE_SECRET_KEY
  - GITHUB_TOKEN, GITLAB_TOKEN, BITBUCKET_TOKEN
  - DATABASE_URL, MONGODB_URI, REDIS_URL

IF secret_detected:
  BLOCK (exit 2): "Secret detected: {pattern_type}"
  SHOW: Redacted match location
  ACTION: "Use environment variables instead. See .env.example for patterns."
```

#### 6.2.2 Error Handling Enforcer

**Event:** `PostToolUse` — after `Write` and `Edit`

```
Scan new/modified code for:
  - fetch(), axios, HTTP requests
  - Database queries
  - External API calls
  - File system operations

FOR each detected call:
  IF no try/catch or .catch() or error boundary:
    WARN: "Unhandled call in {file}:{line}. Type: {call_type}"
    RECOMMEND: "Add error handling with graceful fallback."
```

#### 6.2.3 PII Logging Scanner

```
Scan for logging of:
  - console.log/warn/error with email, password, card, ssn, phone
  - Logger calls with sensitive fields
  - User data in error messages or agent output

IF pii_detected:
  WARN: "PII in {context}: {field_name} in {file}:{line}"
  RECOMMEND: "Remove PII. Log only IDs and non-sensitive metadata."
```

### 6.3 Security Audit Script

Run a full project security scan:

```
Checks:

1. SECRETS IN CODE
   - Scan all source files for hardcoded keys
   - Check .env.example for placeholder patterns
   - Verify .env and .env.local in .gitignore
   - Scan git history for accidentally committed secrets

2. API KEY SECURITY
   - Verify all provider keys use environment variables
   - Check error messages don't expose keys
   - Verify API calls have timeouts

3. INPUT VALIDATION
   - Check all user-facing inputs for validation
   - Verify agent inputs are sanitized
   - Check for path traversal prevention

4. ERROR HANDLING
   - Check critical operations have try/catch
   - Verify errors logged without PII
   - Check fallback states exist

5. DEPENDENCY AUDIT
   - Run npm audit / pip audit / cargo audit
   - Flag outdated packages with security patches
   - Check package lock files are committed

6. DATABASE SECURITY (if applicable)
   - Check connections use SSL/TLS
   - Verify row-level security where needed
   - Check credentials aren't hardcoded
```

### 6.4 Audit Checks

| Check | Pass Criteria | Severity |
|---|---|---|
| No hardcoded secrets | Zero in source + git history | Critical |
| .env in .gitignore | .env, .env.local covered | Critical |
| Error handling coverage | ≥80% of API calls handled | Warning |
| No PII in logs | Zero PII in agent output | Warning |
| Input validation | All inputs sanitized | Warning |
| Dependencies healthy | npm/pip/cargo audit passes | Warning |

---

## 7. Slash Commands

### 7.1 `/agentops check` — Quick Session Health Check

**Purpose:** Quick snapshot of your session's health.

**Output format:**

```
AgentOps Session Health
───────────────────────────────────────────────
◉ Save Points      Last commit: 12 min ago (3 files uncommitted)
◉ Context Health    ~45% capacity, 18 messages, no degradation
◉ Standing Orders   AGENTS.md: 95 lines, 0 violations this session
◉ Blast Radius      Current task: 2 files modified (LOW risk)
◉ Safety Checks     No new warnings
───────────────────────────────────────────────
▲ 1 advisory: CONTEXT.md last updated 3 days ago.
```

### 7.2 `/agentops audit` — Full Project Audit

Runs all audit checks from §2.3, §3.5, §4.5, §5.5, §6.4. Output grouped by severity level (Critical, Warning, Advisory, Pass).

### 7.3 `/agentops scaffold` — Create/Update Scaffold Documents

Creates or updates PLANNING.md, TASKS.md, CONTEXT.md, WORKFLOW.md with current project state. Generates handoff messages for starting fresh sessions.

---

## 8. Hook Configuration

### 8.1 Additions to Your Tool's Configuration

AgentOps integrates with your AI tool's hook system by adding entries to your existing configuration (`.claude/settings.json` for Claude Code, `.cursorrules` for Cursor, etc.).

**Example for Claude Code (.claude/settings.json):**

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
# 1. Secret scanner on staged files
# 2. PII logging check on staged files
# 3. Verify .env not being committed
# 4. Check credentials aren't in committed config
# Exit 1 to block commit if critical issues found
```

**post-commit:**

```bash
#!/bin/bash
# [AgentOps] Post-commit actions
# 1. Update WORKFLOW.md with commit summary
# 2. Reset blast radius counter
# 3. Log commit metadata to session log
```

Setup: `git config core.hooksPath .githooks`

---

## 9. Dashboard (Web-Based Health Monitor)

### 9.1 Overview

AgentOps includes a local HTML dashboard (`agentops-dashboard.html`) that provides visual monitoring. It runs in any browser with zero dependencies—no server, no build step.

### 9.2 Architecture

```
agentops/
├── dashboard/
│   ├── agentops-dashboard.html    # Main dashboard (single file, self-contained)
│   ├── data/                      # Log files written by hooks and scripts
│   │   ├── session-log.json       # Current session events
│   │   ├── audit-results.json     # Last /agentops-audit output
│   │   ├── health-history.json    # Daily health scores (rolling 90 days)
│   │   └── commit-history.json    # Commit frequency data
│   └── README.md
```

**Data flow:** AgentOps hooks write JSON to `agentops/dashboard/data/`. The HTML dashboard reads these files via `fetch()` on load. No server required.

### 9.3 Pages

#### 9.3.1 Overview Dashboard

Main landing page showing:

- **Overall health score** (0-100) as a gauge
- **5 KPI cards:** Commits today, context usage %, blast radius, violations, last scan
- **Skills health panel:** Each of the 5 skills with status
- **Recent events log:** Chronological feed from all hooks
- **Trend charts:** Commit frequency and health over 7/30 days

#### 9.3.2 Skill Detail Pages

Five pages—one per skill. Each shows:

- **Skill 1 (Save Points):** Commit history, current branch, uncommitted files
- **Skill 2 (Context Health):** Context usage gauge, degradation signals, scaffold freshness
- **Skill 3 (Standing Orders):** Rules file stats, required sections, violation history
- **Skill 4 (Small Bets):** Task risk scores, blast radius, commit size distribution
- **Skill 5 (Safety Checks):** Secrets blocked, error handling coverage, warnings

#### 9.3.3 Audit Report Page

Full `/agentops-audit` results in sortable table format.

#### 9.3.4 Trends Page

Time-series visualizations of health, violations, and commit patterns over 30 days.

### 9.4 Data Format

All log files use newline-delimited JSON (NDJSON) for append-friendly writes:

**session-log.json:**

```json
{"ts":"2026-03-19T14:32:00Z","type":"commit","msg":"Auto-commit checkpoint","src":"session-end hook","sev":"info"}
{"ts":"2026-03-19T14:28:00Z","type":"warn","msg":"Context at 47%","src":"context-estimator","sev":"warning"}
```

**health-history.json:**

```json
{"date":"2026-03-19","overall":85,"s1":98,"s2":85,"s3":72,"s4":90,"s5":78,"commits":14,"violations":0}
```

### 9.5 Implementation

Single self-contained HTML file with inline CSS and JavaScript. Uses:

- CSS custom properties for theming
- Vanilla JS for rendering
- CSS Grid for responsive layout
- DOM-based charts (no dependencies)

---

## 10. Implementation Phases

### Phase 1: Foundation (Week 1)

| Component | Priority | Effort |
|---|---|---|
| `secret-scanner.sh` | P0 | 3h |
| `git-hygiene-check.sh` | P0 | 2h |
| Session start validation hook | P0 | 2h |
| AGENTS.md rules template | P0 | 1h |
| `.githooks/pre-commit` | P0 | 2h |
| `/agentops check` (basic) | P1 | 2h |

### Phase 2: Monitoring (Week 2)

| Component | Priority | Effort |
|---|---|---|
| `context-estimator.sh` | P0 | 3h |
| `task-sizer.sh` | P0 | 4h |
| Blast radius PostToolUse hook | P1 | 3h |
| Auto-commit on session end | P1 | 2h |
| `/agentops check` full version | P1 | 3h |

### Phase 3: Scaffold System (Week 3)

| Component | Priority | Effort |
|---|---|---|
| Scaffold templates | P0 | 3h |
| `/agentops scaffold` command | P0 | 2h |
| `scaffold-validator.sh` | P1 | 2h |
| Handoff message generator | P1 | 2h |

### Phase 4: Deep Auditing (Week 4)

| Component | Priority | Effort |
|---|---|---|
| `security-audit.sh` (full) | P0 | 8h |
| Error handling audit | P1 | 4h |
| `rules-file-linter.sh` | P1 | 3h |
| `/agentops audit` full report | P1 | 4h |

### Phase 5: Dashboard (Week 5-6)

| Component | Priority | Effort |
|---|---|---|
| Dashboard HTML shell | P0 | 4h |
| Overview page | P0 | 4h |
| Hook data writers | P0 | 4h |
| 5 Skill detail pages | P1 | 6h |
| Audit report page | P1 | 3h |

---

## 11. Configuration

### 11.1 `agentops/agentops.config.json`

```json
{
  "save_points": {
    "auto_commit_after_minutes": 30,
    "auto_branch_on_risk_score": 8,
    "max_uncommitted_files_warning": 5
  },
  "context_health": {
    "message_count_warning": 20,
    "message_count_critical": 30,
    "context_percent_warning": 60,
    "context_percent_critical": 80
  },
  "rules_file": {
    "max_lines": 300,
    "required_sections": ["security", "error handling"]
  },
  "task_sizing": {
    "medium_risk_threshold": 4,
    "high_risk_threshold": 8,
    "critical_risk_threshold": 13,
    "max_files_per_task_warning": 5,
    "max_files_per_task_critical": 8
  },
  "security": {
    "block_on_secret_detection": true,
    "scan_git_history": false,
    "check_common_provider_keys": true
  },
  "notifications": {
    "verbose": false,
    "prefix_all_messages": "[AgentOps]"
  }
}
```

### 11.2 Severity Levels

| Severity | Behavior | Example |
|---|---|---|
| **Critical** | Blocks action (exit 2). Requires resolution. | Hardcoded API key |
| **Warning** | Takes preventive action + notifies. | Auto-commit before risky task |
| **Advisory** | Notifies with recommendation. No action. | Scaffold slightly stale |

---

## 12. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Reverts per session | < 1 | Count `git checkout .` / `git reset` |
| Commit frequency | Every 20-30 min active work | Git log analysis |
| Blast radius per task | ≤ 5 files median | Git commit analysis |
| Secret exposure incidents | 0 | Pre-commit hook + scanner blocks |
| Context restarts per session | ≤ 1 | Session start count |
| Security audit pass rate | >90% warning+ | `/agentops audit` results |
| Scaffold freshness | Updated within 24h of last session | File timestamps |

---

## 13. Observability & Distributed Tracing

### 13.1 Purpose

When multiple agents coordinate or execute in sequence, there is no way to trace a task through all of them. Every agent action gets a trace ID and span for end-to-end visibility.

### 13.2 Tracing Architecture

AgentOps adopts OpenTelemetry AI Agent Semantic Convention. Every significant action gets traced:

```
Trace: "Implement user auth" (traceId: abc123)
├── Span: Agent1 → plan task (12ms, 0 tokens)
├── Span: Agent2 → create database schema (4.2s, 1847 tokens)
│   ├── Span: tool:Write → schema.sql (230ms)
│   └── Span: tool:Bash → run migration (1.1s)
├── Span: Agent3 → build API route (6.8s, 3201 tokens)
└── Span: Agent4 → run tests (8.3s, 0 tokens)
```

### 13.3 Span Record Format

```json
{
  "traceId": "abc123",
  "spanId": "span-456",
  "parentSpanId": "span-123",
  "agentId": "agent-name",
  "operation": "tool:Write",
  "target": "src/auth.ts",
  "input_tokens": 412,
  "output_tokens": 1435,
  "latency_ms": 4200,
  "status": "ok",
  "ts": "2026-03-19T14:15:00Z"
}
```

### 13.4 Implementation Components

| Component | Priority |
|---|---|
| Trace ID generation and propagation | P0 |
| Span logging (OpenTelemetry-compatible) | P0 |
| Hook: inject trace context | P0 |
| Dashboard: Trace Viewer page | P1 |

---

## 14. Agent Identity & Permissions Model

### 14.1 Purpose

Currently all agents have equal access. If any agent context gets compromised via injection, there are no permission boundaries. A formal identity and permission system limits damage.

### 14.2 Three-Layer Permission Model

**Layer 1 — Agent Identity Registry**

Every agent gets a formal identity with declared capabilities:

```yaml
---
name: my-agent
identity:
  role: worker
  specialization: typescript-development
permissions:
  files:
    read: ["src/**", "docs/**", "package.json"]
    write: ["src/**"]
    deny: [".env*", ".github/**", "*.key"]
  tools:
    allow: [Read, Write, Edit, Bash, Grep]
    deny: [Agent]
  bash:
    allow: ["npm test", "npm run build", "tsc"]
    deny: ["rm -rf", "git push"]
---
```

**Layer 2 — Runtime Permission Enforcement**

PreToolUse hook validates every tool call:

```
ON PreToolUse:
  agent = get_current_agent()
  tool = get_pending_tool()
  target = get_tool_target()

  IF NOT agent.permissions.allows(tool, target):
    BLOCK (exit 2): "Agent {agent.id} denied: {tool}:{target}"
    LOG: Permission violation to audit trail
```

**Layer 3 — Delegation Scope Narrowing**

When one agent delegates to another, permissions narrow:

```
Parent (broad scope) → Delegation token → Child (narrow scope)
- Parent can read/write all of src/
- Delegation scopes child to src/auth/ only
- Child cannot exceed delegation scope
```

### 14.3 Implementation Components

| Component | Priority |
|---|---|
| Permission schema in agent definitions | P0 |
| `permission-enforcer.sh` hook | P0 |
| Permission audit trail | P0 |
| Dashboard: Agent Identity page | P1 |

---

## 15. Cost Management & Token Budgeting

### 15.1 Purpose

Multiple agents using multiple LLM providers can burn budget quickly. AgentOps provides per-agent, per-session, and monthly budget tracking.

### 15.2 Hierarchical Budget System

```
Budget Hierarchy:
├── Monthly budget: $500.00
│   └── Session budget: $10.00
│       ├── Agent1: $3.00
│       ├── Agent2: $4.00
│       └── Interactive: $3.00
```

### 15.3 Per-Call Metering

Every LLM call is tracked:

```json
{
  "agentId": "agent-name",
  "model": "claude-3-sonnet",
  "input_tokens": 4521,
  "output_tokens": 1847,
  "cost_usd": 0.0089,
  "cumulative_session_cost": 1.47,
  "budget_remaining": 0.53
}
```

### 15.4 Budget Enforcement

```
AFTER each LLM call:
  IF agent_cost > agent_budget * 0.80:
    WARN: "Agent at 80% of budget"

  IF agent_cost > agent_budget:
    ACTION: Pause or downgrade agent
    NOTIFY: "Budget exceeded"

  IF session_cost > session_budget:
    BLOCK: Halt non-essential operations
```

### 15.5 Implementation Components

| Component | Priority |
|---|---|
| Budget configuration in agentops.config.json | P0 |
| Cost tracking on every LLM call | P0 |
| Budget enforcement in PreToolUse | P1 |
| Dashboard: Cost page | P1 |

---

## 16. Agent Lifecycle Management

### 16.1 Purpose

Provide formal state tracking for agents: creation, execution, pause, completion, cancellation. Critical for multi-agent coordination.

### 16.2 State Machine

```
CREATED → ACTIVE → AWAITING → COMPLETED
            ↓         ↓
         FAILED    CANCELLED
```

| State | Meaning | Transitions |
|---|---|---|
| CREATED | Instantiated, not started | → ACTIVE |
| ACTIVE | Executing | → AWAITING, COMPLETED, FAILED, CANCELLED |
| AWAITING | Paused for input | → ACTIVE, CANCELLED |
| COMPLETED | Task finished | Terminal |
| FAILED | Unrecoverable error | Terminal |
| CANCELLED | Gracefully terminated | Terminal |

### 16.3 Graceful Shutdown

```
ON cancel request:
  1. Set state to CANCELLING
  2. Agent finishes current tool call
  3. Agent saves progress to WORKFLOW.md
  4. Agent commits with "[agentops] cancelled — checkpoint"
  5. Agent returns partial results
  6. Set state to CANCELLED
  7. Clean up child processes and locks
```

### 16.4 Implementation Components

| Component | Priority |
|---|---|
| Agent state field in definitions | P0 |
| Lifecycle manager script | P0 |
| Graceful shutdown protocol | P0 |
| Dashboard: Lifecycle view | P1 |

---

## 17. Multi-Provider Orchestration Awareness

### 17.1 Purpose

AgentOps must work across Claude, OpenAI, Google, and other providers. Track health, errors, and costs per provider.

### 17.2 Per-Provider Tracking

```
Per provider:
  - Availability: % of calls that succeed
  - Latency: p50, p95, p99
  - Error rate by type
  - Cost per 1K tokens
  - Rate limit headroom
```

### 17.3 Failover Audit Trail

Every provider switch is logged:

```json
{
  "agentId": "agent-name",
  "provider": "openai",
  "fallback_used": true,
  "original_provider": "anthropic",
  "failover_reason": "rate_limited",
  "latency_increase_ms": 340,
  "cost_difference_usd": 0.002
}
```

### 17.4 Implementation Components

| Component | Priority |
|---|---|
| Provider field in all records | P0 |
| Provider health tracking | P1 |
| Failover event logging | P0 |
| Dashboard: Provider Health page | P1 |

---

## 18. Testing & Evaluation Framework

### 18.1 Purpose

When agent definitions or rules change, verify behavior didn't break. Golden datasets catch regressions.

### 18.2 Three-Tier System

**Tier 1 — Golden Datasets**

Each script gets test cases:

```yaml
# agentops/evals/secret-scanner/cases.yaml
- name: "Detects hardcoded API key"
  input_file: "fixtures/hardcoded-api-key.ts"
  expected: { blocked: true, pattern: "API_KEY" }

- name: "Allows environment variable"
  input_file: "fixtures/env-var-reference.ts"
  expected: { blocked: false }
```

**Tier 2 — Regression Suite**

Run all golden datasets on every change:

```bash
agentops/scripts/run-evals.sh
```

**Tier 3 — Behavioral Benchmarks**

Periodic full-system tests.

### 18.3 Implementation Components

| Component | Priority |
|---|---|
| Test fixtures and golden datasets | P1 |
| `run-evals.sh` test runner | P1 |
| CI integration (GitHub Actions) | P2 |
| Dashboard: Eval Results page | P2 |

---

## 19. Compliance & Immutable Audit Trail

### 19.1 Purpose

Maintain a complete, immutable, attributable record of every action for compliance with regulations like the EU AI Act.

### 19.2 Audit Record Format

```json
{
  "eventId": "evt-789",
  "traceId": "abc123",
  "ts": "2026-03-19T14:15:00.000Z",
  "actor": {
    "type": "agent",
    "id": "agent-name"
  },
  "originalUser": "developer@example.com",
  "action": "tool:Write",
  "target": "src/auth.ts",
  "status": "success",
  "tokens": { "input": 412, "output": 1435 },
  "hash": "<SHA-256 of this record + previous hash>"
}
```

### 19.3 Hash Chain for Tamper Detection

```
Record N:   hash = SHA256(record_content + hash_of_record_N-1)
If any record is modified, all subsequent hashes break.
```

### 19.4 Implementation Components

| Component | Priority |
|---|---|
| Append-only audit logging | P0 |
| Hash chain integrity verification | P1 |
| Dashboard: Audit Trail page | P1 |
| Compliance report generator | P2 |

---

## 20. Agent-to-Agent Trust & Delegation

### 20.1 Purpose

When agents delegate work, formalize the handoff with scoped, time-limited tokens that prevent scope creep and unauthorized escalation.

### 20.2 Delegation Token Format

```json
{
  "issuer": "agent-a",
  "delegate": "agent-b",
  "task": "Implement auth module",
  "scope": {
    "files": ["src/auth/**"],
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

### 20.3 Enforcement Rules

- Delegation tokens can only **narrow** scope, never widen
- Workers cannot further delegate unless `can_delegate: true`
- Tokens expire—no indefinite delegation
- Every permission check logs the full delegation chain

### 20.4 Output Validation

When delegated agent returns results:

```
Validate result structure
Check files modified are within delegation scope
Verify no permission violations occurred
Log complete delegation chain in audit trail

IF out_of_scope_modifications:
  REJECT result
  REVERT changes
  ALERT operator
```

### 20.5 Implementation Components

| Component | Priority |
|---|---|
| Delegation token schema | P1 |
| Token validator in PreToolUse | P1 |
| Output validator | P1 |
| Dashboard: Delegation visualization | P2 |

---

## 21. Self-Improvement & Plugin Architecture

### 21.1 Self-Improvement with Guardrails

Agents identify patterns and want to improve their own rules. A proposal system enables this safely:

```
1. Agent identifies pattern: "I keep forgetting to import X"
2. Agent proposes rule: "Always import X from the monorepo alias"
3. Proposal stored in agentops/proposals/pending/
4. Developer reviews in dashboard
5. On approval: Rule appended to AGENTS.md
6. On rejection: Proposal archived

CRITICAL: Agents can only ADD rules, never REMOVE.
Only developers can remove rules.
```

### 21.2 Plugin Architecture

Extend AgentOps without forking:

```
agentops/
├── plugins/
│   ├── core/                      # Built-in
│   │   ├── secret-scanner/
│   │   └── ...
│   └── community/                 # User-installed
│       ├── k8s-deploy-check/
│       └── custom-linter/
```

**Plugin manifest:**

```json
{
  "name": "k8s-deploy-check",
  "version": "1.0.0",
  "hooks": {
    "PreToolUse": { "matcher": "Bash", "filter": "kubectl" }
  },
  "config_schema": {
    "namespace_allowlist": { "type": "array" }
  }
}
```

### 21.3 Event Bus (Architectural Foundation)

Central pub/sub system for all extensions:

```
                 ┌──────────────────┐
                 │  AgentOps Event   │
                 │      Bus          │
                 └────────┬─────────┘
         ┌───────────────┼────────────────┐
         │               │                │
      Hooks           Plugins        Dashboard
```

Every hook emits events. Plugins subscribe to events. The dashboard subscribes to everything.

### 21.4 Implementation Components

| Component | Priority |
|---|---|
| Plugin manifest schema | P2 |
| Plugin loader and registry | P2 |
| Event bus core | P0 |
| Event type definitions | P0 |

---

## 22. Architectural Principles

These principles govern all design decisions:

| # | Principle | Rationale |
|---|---|---|
| 1 | **Append-only by default** | Logs, audit trails, and rules are never deleted by agents. Enables compliance, debugging, and guardrail protection. |
| 2 | **Event-driven, not script-driven** | The event bus is the spine. New capabilities subscribe to events, not modify existing scripts. |
| 3 | **Provider-agnostic** | Works across Claude, OpenAI, Google, and future providers. Every record includes provider field. |
| 4 | **Scope narrows, never widens** | Delegation, permissions, and budgets can only narrow. No agent can grant itself more access. |
| 5 | **Human-in-the-loop at trust boundaries** | Agents propose, developers approve. Applies to rules, permissions, budgets, deployments. |
| 6 | **Test what you ship** | Every check and detection pattern has golden datasets. Regressions are caught before production. |
| 7 | **Dashboard is the contract** | If it's not visible in the dashboard, it doesn't exist for developers. Every capability needs a dashboard view. |

---

## 23. Framework Evolution Roadmap

### Current → v3.0 → v4.0

```
CURRENT (v2.0)          v3.0 (Next 8 Weeks)      v4.0 (Post-Stabilization)
─────────────────       ─────────────────        ─────────────────
5 Core Skills           + Event Bus Core         + Plugin Marketplace
Shell Scripts           + Tracing (OTEL)         + Self-Improvement
NDJSON Logs             + Cost Metering          + Delegation Tokens
HTML Dashboard          + Agent Identity         + Compliance Reports
Generic Framework       + Lifecycle States       + Community Plugins
                        + Provider Health        + Behavioral Evals
                        + Audit Trail
                        + Testing Framework
```

### v3.0 Priority Stack (8 Weeks)

| Week | Component | Depends On |
|---|---|---|
| 1 | Event bus core | Nothing — foundational |
| 2 | Agent identity + permissions | Event bus |
| 3 | Distributed tracing | Event bus |
| 4 | Cost metering + budgets | Event bus + tracing |
| 5 | Lifecycle state machine | Event bus |
| 6 | Append-only audit trail | Event bus |
| 7 | Provider health monitoring | Tracing + cost metering |
| 8 | Eval framework | All modules stable |

---

## Appendix A: Generic Glossary

| Term | Definition |
|---|---|
| **Agent** | An AI system (using Claude, GPT, etc.) that performs tasks autonomously |
| **Tracing** | End-to-end visibility of a task through all agents and tool calls |
| **Span** | A single unit of work within a trace (one tool call, one LLM request) |
| **Delegation token** | Scoped, time-limited credential that narrowly permissions work |
| **Event bus** | Central pub/sub system where hooks emit events |
| **Golden dataset** | Curated (input, expected_output) pairs for testing |
| **Hash chain** | SHA-256 linked records for tamper detection |
| **RBAC** | Role-Based Access Control — permission model by agent role |
| **Append-only** | Data that can only be added, never modified or deleted |
| **Provider failover** | Automatic switch to backup provider when primary fails |
| **Blast radius** | Total files/systems impacted by a change |
| **Context degradation** | Loss of early instructions as context fills with new messages |
| **Scaffold documents** | PLANNING, TASKS, CONTEXT, WORKFLOW — state files across sessions |
| **Risk score** | Numerical estimate of a task's impact (1-20 scale) |

---

## Appendix B: Files AgentOps Creates and Modifies

### New Files (AgentOps Creates)

| File | Purpose |
|---|---|
| `agentops/scripts/*.sh` | Monitoring and audit scripts |
| `agentops/templates/*.md` | Scaffold document templates |
| `agentops/agentops.config.json` | Configuration |
| `agentops/dashboard/agentops-dashboard.html` | Web dashboard |
| `agentops/dashboard/data/*.json` | Dashboard data files |
| `agentops/tracing/trace-context.ts` | Trace ID generation |
| `agentops/audit/audit-logger.ts` | Audit logging |
| `agentops/audit/audit-trail.jsonl` | Immutable audit log |
| `agentops/core/event-bus.ts` | Event system |
| `agentops/evals/` | Test fixtures and golden datasets |
| `agentops/plugins/` | Plugin system |
| `PLANNING.md` | Scaffold document |
| `TASKS.md` | Scaffold document |
| `CONTEXT.md` | Scaffold document |
| `WORKFLOW.md` | Scaffold document |

### Existing Files (AgentOps Appends To)

| File | What Gets Added |
|---|---|
| `AGENTS.md` | AgentOps Universal Rules section |
| `CLAUDE.md` | AgentOps Management Rules section (if Claude Code) |
| Tool config (e.g., `.claude/settings.json`) | Hook entries (prefixed `[AgentOps]`) |
| `.gitignore` | Ensure .env patterns covered |

### Existing Files (AgentOps Reads Only)

| File | Why |
|---|---|
| Agent definitions | Agent scope validation |
| Tool config | Understand existing hooks |
| `.env.example` | Validate secret patterns |
| `package.json` / `requirements.txt` | Dependency audit |
| Source code | Security and error handling audits |

---

## Quick Start

1. **Install AgentOps:**
   - Download or clone the agentops/ directory to your project root
   - Copy agentops.config.json and adjust thresholds for your project

2. **Hook into your tool:**
   - For Claude Code: Add hook entries to `.claude/settings.json`
   - For Cursor: Follow analogous configuration in `.cursorrules`
   - For others: Create equivalent hook integrations

3. **Create rules files:**
   - Create `AGENTS.md` with universal rules
   - Create `CLAUDE.md` (or tool-specific file) with tool-specific rules
   - Run `/agentops scaffold` to create scaffold documents

4. **Set up git hooks:**
   - Run: `git config core.hooksPath .githooks`

5. **View the dashboard:**
   - Open `agentops/dashboard/agentops-dashboard.html` in your browser

6. **Start your session:**
   - Run `/agentops check` to verify everything is working
   - Begin your work — AgentOps will monitor in the background

---

**End of Specification**
