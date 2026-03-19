# AgentOps: Agent Management Oversight System

## Specification Document for Claude Code Implementation

**Version:** 1.0
**Date:** March 16, 2026
**Mode:** Dual-mode (real-time session monitor + on-demand project audit)
**Platform:** Multi-tool compatible (Claude Code, Cursor, Codex, universal via AGENTS.md)
**Enforcement:** Guardrails — warns and takes preventive action where safe; never silently blocks

---

## 1. System Overview

### 1.1 Purpose

AgentOps is an oversight system that monitors AI coding agents and enforces the five core management skills: version control discipline, context health monitoring, rules file compliance, task sizing enforcement, and proactive safety checks. It operates in two modes — a real-time session monitor that runs alongside active agent sessions, and an on-demand auditor that evaluates project health between sessions.

### 1.2 Design Philosophy

AgentOps treats the human operator as the general contractor and the AI agent as the skilled-but-forgetful worker. The system exists to:

- Catch problems the agent won't raise on its own
- Enforce habits the operator hasn't yet internalized
- Preserve work through automated save points
- Reduce blast radius through task sizing enforcement
- Maintain continuity across sessions through scaffold document management

### 1.3 Architecture

```
agentops/
├── AGENTS.md                    # Universal rules (cross-tool)
├── CLAUDE.md                    # Claude Code-specific rules
├── .cursorrules                 # Cursor-specific rules (symlinked content)
├── .claude/
│   ├── settings.json            # Hook configuration
│   ├── agents/
│   │   ├── agentops-monitor.md  # Real-time session monitor subagent
│   │   ├── agentops-auditor.md  # On-demand project auditor subagent
│   │   └── agentops-scaffold.md # Scaffold document manager subagent
│   └── commands/
│       ├── agentops-check.md    # /agentops-check slash command
│       ├── agentops-audit.md    # /agentops-audit slash command
│       └── agentops-scaffold.md # /agentops-scaffold slash command
├── .githooks/
│   ├── pre-commit               # Automated pre-commit checks
│   └── post-commit              # Post-commit logging and notifications
├── scripts/
│   ├── git-hygiene-check.sh     # Checks git status, uncommitted changes, branch state
│   ├── scaffold-validator.sh    # Validates scaffold docs exist and are current
│   ├── security-audit.sh        # Scans for hardcoded secrets, missing RLS, PII logging
│   ├── rules-file-linter.sh     # Validates rules file structure, size, contradictions
│   ├── context-estimator.sh     # Estimates context usage from conversation length
│   └── task-sizer.sh            # Analyzes planned changes for blast radius
└── templates/
    ├── PLANNING.md.template
    ├── TASKS.md.template
    ├── CONTEXT.md.template
    ├── WORKFLOW.md.template
    ├── rules-file-starter.md
    └── handoff-message.md
```

---

## 2. Skill 1 — Save Points (Version Control Enforcement)

### 2.1 What This Module Does

Ensures the project always has recoverable save points. Detects missing git initialization, long gaps between commits, and risky operations without a safety net.

### 2.2 Real-Time Monitors

#### 2.2.1 Hook: Pre-Tool Gate for File Writes

**Event:** `PreToolUse` — triggers before `Write`, `Edit`, `Bash` (when command modifies files)
**Logic:**

```
IF tool = Write OR tool = Edit OR (tool = Bash AND command modifies files):
  IF git is not initialized in project:
    WARN: "No git repository detected. Run 'git init' and commit your working state before proceeding."
    ACTION: Block (exit code 2) and prompt operator to initialize git

  IF uncommitted_changes > 5 files OR last_commit_age > 30 minutes:
    WARN: "You have significant uncommitted work. Consider committing before this change."
    ACTION: Auto-commit with message "[agentops] auto-save before agent modification"
    LOG: Record auto-commit in WORKFLOW.md

  IF current_branch = "main" AND change_is_risky (see §5.2 for risk scoring):
    WARN: "Making risky changes directly on main. Recommend creating a branch."
    ACTION: Create branch "agentops/auto-branch-{timestamp}" and switch to it
```

#### 2.2.2 Hook: Post-Tool Commit Reminder

**Event:** `PostToolUse` — triggers after `Write`, `Edit`, `Bash` (when tool succeeds)
**Logic:**

```
IF files_modified_since_last_commit > 3:
  NOTIFY: "Agent has modified {n} files since last commit. Consider saving a checkpoint."

IF tool = Bash AND command contains "npm install" OR "pip install" OR "apt install":
  NOTIFY: "New dependency installed. Good time to commit before further changes."
```

#### 2.2.3 Hook: Session End Auto-Save

**Event:** `Stop` — triggers when agent completes its response
**Logic:**

```
IF session_duration > 20 minutes AND uncommitted_changes exist:
  ACTION: Auto-commit with message "[agentops] session checkpoint — {summary of changes}"
  LOG: Update WORKFLOW.md with session summary
```

### 2.3 Audit Checks

When `/agentops-audit` is run, evaluate:

| Check | Pass Criteria | Severity |
|---|---|---|
| Git initialized | `.git/` directory exists | Critical |
| .gitignore exists | File present and non-empty | Critical |
| .gitignore covers secrets | Contains `.env`, `.env.local`, `*.key`, `*.pem` patterns | Critical |
| Recent commits | At least 1 commit in last 24 hours (if project modified) | Warning |
| Commit frequency | Average gap between commits < 45 minutes during active work | Advisory |
| Branch hygiene | No stale branches older than 2 weeks | Advisory |
| Large uncommitted changes | Fewer than 10 uncommitted modified files | Warning |

### 2.4 Automated Actions

| Trigger | Action | Reversible? |
|---|---|---|
| No git repo detected | Block agent, prompt initialization | N/A |
| 30+ min since last commit with changes | Auto-commit checkpoint | Yes (git reset) |
| Risky change on main | Auto-branch | Yes (git checkout main) |
| Session end with uncommitted work | Auto-commit with summary | Yes (git reset) |

---

## 3. Skill 2 — Context Health Monitoring (Know When to Start Fresh)

### 3.1 What This Module Does

Monitors the agent's context window health and detects degradation. When the agent's performance drops, it triggers scaffold document updates and recommends a fresh session.

### 3.2 Real-Time Monitors

#### 3.2.1 Hook: Context Usage Estimator

**Event:** `PostToolUse` — triggers after every tool use
**Logic:**

```
context_estimate = sum of:
  - All user messages (character count)
  - All agent responses (character count)
  - All files read into context (character count)
  - Rules file content (character count)
  - System prompt overhead (~4000 tokens)

token_estimate = context_estimate / 4  # rough chars-to-tokens

IF token_estimate > 60% of model_context_limit:
  NOTIFY: "Context is at ~60%. Consider wrapping up current task and starting fresh."

IF token_estimate > 80% of model_context_limit:
  WARN: "Context critically full (~80%). Agent will begin losing early instructions."
  ACTION: Trigger scaffold document update (invoke agentops-scaffold subagent)
  RECOMMEND: "Start a fresh session. Use the handoff message template."
```

#### 3.2.2 Hook: Behavior Degradation Detector

**Event:** `PostToolUse` — triggers after `Write` and `Edit`
**Logic:**

The degradation detector tracks these signals across the session:

```
degradation_signals = {
  instruction_violations: 0,    # Agent does something rules file prohibits
  file_rewrites: 0,             # Agent modifies a file it already completed
  repeated_errors: 0,           # Same error appears after being "fixed"
  contradictions: 0,            # Agent proposes something it previously rejected
}

AFTER each tool use:
  Compare current change against rules file → increment instruction_violations
  Check if file was marked complete in TASKS.md → increment file_rewrites
  Check if error matches a previously-seen-and-fixed error → increment repeated_errors

IF sum(degradation_signals) >= 3:
  WARN: "Context degradation detected. The agent appears to be forgetting earlier decisions."
  ACTION: Invoke agentops-scaffold subagent to update all scaffold docs
  RECOMMEND: "Start fresh with the updated scaffold documents."
```

#### 3.2.3 Hook: Message Count Tracker

**Event:** `UserPromptSubmit` — triggers on every user message
**Logic:**

```
message_count += 1

IF message_count == 20:
  NOTIFY: "20 messages in this session. Watch for signs of context degradation."

IF message_count == 30:
  WARN: "30 messages. Consider starting a fresh session with updated scaffold docs."

IF message_count >= 40:
  WARN: "Extended session (40+ messages). High risk of context degradation."
  ACTION: Auto-update scaffold documents
```

### 3.3 Scaffold Document Manager (Subagent: agentops-scaffold)

This subagent is responsible for creating, updating, and validating the four scaffold documents.

**Subagent Definition (`agentops-scaffold.md`):**

```yaml
---
name: agentops-scaffold
description: >
  Manages project scaffold documents (PLANNING.md, TASKS.md, CONTEXT.md, WORKFLOW.md).
  Invoke when starting a new session, when context degradation is detected, or
  when the operator requests a scaffold update. Creates missing documents from
  templates, updates existing ones with current project state, and generates
  handoff messages for fresh sessions.
model: sonnet
tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
maxTurns: 15
---

# Scaffold Document Manager

## On invocation, perform these steps:

1. Check which scaffold documents exist (PLANNING.md, TASKS.md, CONTEXT.md, WORKFLOW.md)
2. For missing documents, create from templates in agentops/templates/
3. For existing documents, read current state and update:
   - TASKS.md: Scan codebase for completed features, update checklist
   - CONTEXT.md: Write summary of current session, list recently modified files
   - WORKFLOW.md: Append current session log entry
   - PLANNING.md: Verify tech stack and architecture sections are current
4. Generate a handoff message summarizing current state for a fresh session
5. Output the handoff message to the operator
```

### 3.4 Audit Checks

| Check | Pass Criteria | Severity |
|---|---|---|
| PLANNING.md exists | File present and non-empty | Warning |
| TASKS.md exists | File present with at least one task | Warning |
| CONTEXT.md exists | File present with "Last Session" section | Advisory |
| WORKFLOW.md exists | File present | Advisory |
| CONTEXT.md is current | "Last Session" date within 7 days of last commit | Warning |
| TASKS.md reflects reality | Completed tasks match actual codebase state | Warning |

### 3.5 Templates

Each template lives in `agentops/templates/` and is used by the scaffold subagent when creating new documents. Templates should be pre-populated with section headers and inline guidance comments that the agent fills in based on project analysis.

---

## 4. Skill 3 — Standing Orders (Rules File Compliance)

### 4.1 What This Module Does

Ensures a rules file exists, is well-structured, stays within size limits, and is actually being followed by the agent.

### 4.2 Real-Time Monitors

#### 4.2.1 Hook: Session Start Rules Check

**Event:** `SessionStart`
**Logic:**

```
rules_files = scan for: CLAUDE.md, .cursorrules, AGENTS.md

IF no rules_files found:
  WARN: "No rules file detected. Your agent has no standing orders."
  RECOMMEND: "Create a rules file. Run /agentops-scaffold to generate a starter."
  ACTION: Offer to create from agentops/templates/rules-file-starter.md

IF rules_file_line_count > 200:
  WARN: "Rules file is {n} lines. Recommended max is 200. Large rules files consume context."
  RECOMMEND: "Review and prune. Run /agentops-audit for a rules file health check."

IF rules_file_line_count < 10:
  NOTIFY: "Rules file is very minimal ({n} lines). Consider adding security and error handling sections."
```

#### 4.2.2 Hook: Rules Violation Detector

**Event:** `PostToolUse` — triggers after `Write` and `Edit`
**Logic:**

```
Parse rules file for explicit prohibitions (lines containing "NEVER", "DO NOT", "STOP", "always"):
  Extract rule statements

After each file write/edit:
  Check the diff against extracted rules:
    - If rules say "never hardcode API keys" → grep new content for key patterns
    - If rules say "always use dark mode" → check for light mode defaults
    - If rules say "never install new packages without asking" → check for new dependencies
    - If rules say "never log customer emails" → check for console.log/print with email fields

IF violation_detected:
  WARN: "Agent may have violated standing order: '{rule}'"
  SHOW: The specific code that triggered the violation
  RECOMMEND: "Review this change. Revert with 'git checkout -- {file}' if needed."
```

### 4.3 Rules File Linter (Script: `rules-file-linter.sh`)

Analyzes the rules file for quality issues:

```
Checks:
  1. STRUCTURE: Has at least these sections: Identity, Security, Error Handling
  2. SIZE: Under 200 lines total, no single section over 40 lines
  3. CONTRADICTIONS: Scan for opposing instructions (e.g., "always use X" vs "never use X")
  4. STALENESS: Compare rules against recent git history — are prohibited patterns actually appearing?
  5. COVERAGE: Check for critical missing categories:
     - Security rules (secrets, PII, auth)
     - Error handling rules
     - Scale expectations
     - UI/Design defaults
  6. CLARITY: Flag vague language ("try to", "when possible", "usually")
     → Recommend replacing with absolute directives ("always", "never", "must")
```

### 4.4 Audit Checks

| Check | Pass Criteria | Severity |
|---|---|---|
| Rules file exists | At least one of CLAUDE.md, .cursorrules, AGENTS.md | Critical |
| Has security section | Contains rules about secrets, PII, auth | Critical |
| Has error handling section | Contains rules about try/catch, user messages, blank screens | Warning |
| Has scale expectations | Contains user count or growth expectations | Advisory |
| Under size limit | Fewer than 200 lines | Warning |
| No contradictions | Linter finds no opposing rules | Warning |
| Recently updated | Modified within last 30 days | Advisory |

### 4.5 Cross-Tool Sync

When a rules file is updated, AgentOps should sync content across tool-specific formats:

```
IF CLAUDE.md is modified:
  Generate .cursorrules from CLAUDE.md content (strip Claude-specific syntax)
  Generate/update AGENTS.md universal section

IF AGENTS.md is modified:
  Merge universal rules into CLAUDE.md (preserve Claude-specific sections)
  Merge universal rules into .cursorrules (preserve Cursor-specific sections)
```

This ensures consistent standing orders regardless of which tool the operator uses.

---

## 5. Skill 4 — Small Bets (Task Sizing and Blast Radius Control)

### 5.1 What This Module Does

Intercepts large or risky tasks before the agent begins, enforces decomposition, and ensures the commit-test-continue rhythm is followed.

### 5.2 Risk Scoring Model

Every task is scored before execution:

```
risk_score = 0

# File count estimate
estimated_files = analyze task prompt for scope indicators
IF estimated_files <= 3:  risk_score += 1   # Small
IF estimated_files 4-8:   risk_score += 3   # Medium
IF estimated_files >= 9:  risk_score += 5   # Large

# Database changes
IF task mentions "database", "table", "schema", "migration", "model":
  IF task implies new tables/columns:   risk_score += 2
  IF task implies modifying existing:   risk_score += 4
  IF task implies deleting:             risk_score += 5

# Shared code modifications
IF task mentions "auth", "login", "session", "middleware":  risk_score += 3
IF task mentions "payment", "checkout", "billing":          risk_score += 4
IF task mentions "refactor", "redesign", "rewrite":         risk_score += 4
IF task mentions "all", "every", "entire", "whole":         risk_score += 3

# Risk levels
LOW:    risk_score 1-3   → Proceed normally
MEDIUM: risk_score 4-6   → Require plan before execution
HIGH:   risk_score 7+    → Require decomposition into sub-tasks
```

### 5.3 Real-Time Monitors

#### 5.3.1 Hook: Task Sizing Gate

**Event:** `UserPromptSubmit` — triggers when user sends a new task
**Logic:**

```
Analyze the user's message for task indicators
Calculate risk_score per §5.2

IF risk_score >= 7 (HIGH):
  WARN: "This looks like a large task (risk score: {score})."
  ACTION: Invoke decomposition prompt:
    "Before starting, break this into the smallest independent sub-tasks.
     Each should touch ≤3 files and be testable alone.
     Present the plan and wait for approval."
  REQUIRE: Operator confirms plan before agent proceeds

IF risk_score 4-6 (MEDIUM):
  NOTIFY: "Medium-complexity task. Recommend committing current state first."
  ACTION: Auto-commit if uncommitted changes exist
  RECOMMEND: "Consider asking the agent to present a plan before starting."

IF risk_score 1-3 (LOW):
  PASS: No intervention needed
```

#### 5.3.2 Hook: Blast Radius Monitor

**Event:** `PostToolUse` — triggers after every `Write` and `Edit`
**Logic:**

```
Track files_modified_this_task (reset when user sends new task prompt)

IF files_modified_this_task > 5 AND no commit since task started:
  WARN: "Agent has modified {n} files in this task without a checkpoint."
  RECOMMEND: "Consider pausing to review and commit before the agent continues."

IF files_modified_this_task > 8:
  WARN: "Blast radius is growing ({n} files). This is getting risky."
  ACTION: Auto-commit checkpoint with "[agentops] mid-task checkpoint"
  RECOMMEND: "Review changes with 'git diff HEAD~1' before continuing."
```

#### 5.3.3 Hook: Multi-Step Verification

**Event:** `PostToolUse` — tracks task completion flow
**Logic:**

```
IF agent signals "task complete" or "done" or presents results:
  CHECK: Did the agent actually test its changes?
    - Look for test execution in Bash history
    - Look for manual verification language

  IF no_testing_detected:
    NOTIFY: "Agent reported task complete but no testing was detected."
    RECOMMEND: "Ask the agent what to test before committing."
```

### 5.4 Audit Checks

| Check | Pass Criteria | Severity |
|---|---|---|
| Average commit size | Fewer than 8 files per commit (median) | Warning |
| Large commits | No commits touching 15+ files | Warning |
| Commit-to-task ratio | At least 1 commit per task in TASKS.md | Advisory |
| Branch usage for risky work | Database/auth changes done on branches | Advisory |

---

## 6. Skill 5 — Proactive Safety Checks (Ask What They Won't)

### 6.1 What This Module Does

Continuously audits the codebase for issues the agent will never raise on its own: missing error handling, security gaps, exposed secrets, unscoped data access, and scalability concerns.

### 6.2 Real-Time Monitors

#### 6.2.1 Hook: Error Handling Enforcer

**Event:** `PostToolUse` — triggers after `Write` and `Edit` when creating/modifying API calls
**Logic:**

```
After each file modification:
  Scan new/modified code for:
    - fetch(), axios, $http, supabase.from(), prisma.*, API route handlers
    - Database queries (SELECT, INSERT, UPDATE, DELETE, .query(), .findMany())

  For each detected call:
    Check if it's wrapped in try/catch or .catch() or error boundary
    Check if there's a user-facing error message (not just console.error)
    Check if there's a loading state in the associated UI component

  IF missing_error_handling:
    WARN: "New API call in {file} has no error handling."
    RECOMMEND: "Add try/catch with a user-friendly error message. Never show a blank screen."
```

#### 6.2.2 Hook: Secret Exposure Scanner

**Event:** `PreToolUse` — triggers before `Write` and `Edit` (blocks if secrets detected)
**Logic:**

```
Scan content being written for patterns:
  - API key patterns: sk_live_*, sk_test_*, AKIA*, ghp_*, glpat-*
  - Generic secrets: strings labeled key, secret, token, password, credential
  - Connection strings: postgresql://, mongodb://, redis://
  - JWT tokens: eyJ*
  - Private keys: -----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----

IF secret_pattern_detected:
  BLOCK: (exit code 2) "Possible secret detected in file content."
  SHOW: The specific pattern found (redacted)
  ACTION: "Use environment variables instead. Add this to your .env file."
```

#### 6.2.3 Hook: PII Logging Scanner

**Event:** `PostToolUse` — triggers after `Write` and `Edit`
**Logic:**

```
Scan new/modified code for logging statements that include:
  - console.log/warn/error with email, password, card, ssn, phone variables
  - Logger calls with user PII fields
  - print() statements with sensitive data

IF pii_logging_detected:
  WARN: "Code in {file} appears to log sensitive data: {field_name}"
  RECOMMEND: "Remove PII from log statements. Log only IDs and non-sensitive metadata."
```

### 6.3 Security Audit Script (`security-audit.sh`)

Comprehensive on-demand security scan:

```
Checks:
  1. SECRETS IN CODE
     - Scan all source files for hardcoded API keys, tokens, passwords
     - Check for secrets in git history (not just current files)
     - Verify .env is in .gitignore
     - Verify no .env files are committed

  2. ROW-LEVEL SECURITY
     - If using Supabase: check that RLS is enabled on all user-data tables
     - If using raw SQL: check for WHERE user_id = clauses in all queries
     - Flag any query that reads user data without user scoping

  3. AUTHENTICATION
     - Check that protected API routes verify auth tokens
     - Check that frontend route guards exist for authenticated pages
     - Verify auth middleware is applied consistently (not just on some routes)

  4. INPUT VALIDATION
     - Check form handlers for input validation
     - Check API endpoints for request body validation
     - Flag any user input that goes directly to database without sanitization

  5. DEPENDENCY AUDIT
     - Run npm audit / pip audit for known vulnerabilities
     - Flag outdated dependencies with known security issues

  6. PII HANDLING
     - Grep for console.log/print statements containing sensitive field names
     - Check database schema for unencrypted sensitive fields
     - Verify payment handling delegates to Stripe/third-party (not custom)
```

### 6.4 Error Handling Audit

On-demand scan for missing error handling:

```
Checks:
  1. API CALLS WITHOUT TRY/CATCH
     - Find all fetch/axios/http calls
     - Verify each has error handling
     - Verify error messages are user-friendly (not raw error objects)

  2. BLANK SCREEN SCENARIOS
     - Check page components for error boundaries (React) or error states
     - Verify loading states exist for async data fetches
     - Check that failed data loads show fallback UI, not empty screens

  3. FORM SUBMISSIONS
     - Verify double-submit prevention (disabled button on submit)
     - Verify validation on required fields
     - Verify error display on failed submission

  4. PAYMENT FLOWS
     - Verify Stripe webhook signature verification
     - Verify payment failure handling with user-facing messages
     - Verify idempotency keys to prevent double charges
```

### 6.5 Scale Analysis

On-demand architecture review:

```
Inputs: Current user count, expected user count, timeframe

Checks:
  1. DATABASE
     - Are indexes present on frequently queried columns?
     - Are there N+1 query patterns?
     - Is connection pooling configured?

  2. API
     - Is rate limiting configured?
     - Are expensive operations handled asynchronously (job queues)?
     - Is pagination implemented for list endpoints?

  3. FRONTEND
     - Are large lists virtualized?
     - Is a CDN configured for static assets?
     - Is code splitting / lazy loading used?

  4. INFRASTRUCTURE
     - Are environment-appropriate configurations in place?
     - Is caching configured for repeated reads?

Output: Risk report with specific files/lines and recommended fixes, prioritized by likelihood of failure at target scale.
```

### 6.6 Audit Checks

| Check | Pass Criteria | Severity |
|---|---|---|
| No hardcoded secrets | Zero secrets detected in source files | Critical |
| .env in .gitignore | .env and .env.local in .gitignore | Critical |
| RLS enabled | All user-data tables have row-level security | Critical |
| Auth on protected routes | All API routes verify authentication | Critical |
| Error handling coverage | ≥80% of API calls have try/catch | Warning |
| No PII in logs | Zero logging statements with sensitive data | Warning |
| Input validation | All form inputs and API endpoints validate | Warning |
| Double-submit prevention | Submit buttons disable on click | Advisory |
| Loading states | All async fetches have loading/error UI | Advisory |
| Scale expectations documented | Rules file includes user count targets | Advisory |

---

## 7. Slash Commands

### 7.1 `/agentops-check` — Quick Session Health Check

```yaml
---
name: agentops-check
description: >
  Quick health check for the current session. Reports git status,
  context usage estimate, rules file compliance, and any active warnings.
  Use at any time during a session to see where you stand.
---
```

**Runs:** Git hygiene check, context estimator, rules file lint, current blast radius assessment.
**Output:** A concise dashboard showing green/yellow/red for each skill area.

```
Example output:

  AgentOps Session Health
  ───────────────────────────────────
  ◉ Save Points      Last commit: 12 min ago (3 files uncommitted)
  ◉ Context Health    ~45% capacity, 18 messages, no degradation signals
  ◉ Standing Orders   CLAUDE.md: 87 lines, 0 violations this session
  ◉ Blast Radius      Current task: 2 files modified (low risk)
  ◉ Safety Checks     No new warnings since last check
  ───────────────────────────────────
  ▲ 1 advisory: Consider committing before starting next task.
```

### 7.2 `/agentops-audit` — Full Project Audit

```yaml
---
name: agentops-audit
description: >
  Comprehensive project audit across all 5 skill areas. Scans for
  security vulnerabilities, missing scaffold documents, rules file
  issues, git hygiene problems, and error handling gaps. Run between
  sessions or before major releases.
---
```

**Runs:** All audit checks from §2.3, §3.4, §4.4, §5.4, §6.6.
**Output:** Full report grouped by severity (Critical → Warning → Advisory) with specific file paths, line numbers, and recommended fixes.

### 7.3 `/agentops-scaffold` — Create or Update Scaffold Documents

```yaml
---
name: agentops-scaffold
description: >
  Creates missing scaffold documents (PLANNING.md, TASKS.md, CONTEXT.md,
  WORKFLOW.md) from templates, or updates existing ones by analyzing the
  current codebase. Also generates a handoff message for starting fresh
  sessions. Use when setting up a new project, after context degradation,
  or at the end of a session.
---
```

**Runs:** Scaffold subagent from §3.3.
**Output:** Created/updated scaffold documents and a handoff message printed to console.

---

## 8. Hook Configuration

### 8.1 Claude Code Settings (`.claude/settings.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "bash agentops/scripts/secret-scanner.sh",
        "description": "Scan for hardcoded secrets before file writes"
      },
      {
        "matcher": "Write|Edit|Bash",
        "command": "bash agentops/scripts/git-hygiene-check.sh --pre-write",
        "description": "Check git state before modifications"
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "bash agentops/scripts/post-write-checks.sh",
        "description": "Check error handling, PII logging, blast radius after writes"
      }
    ],
    "UserPromptSubmit": [
      {
        "command": "bash agentops/scripts/task-sizer.sh",
        "description": "Analyze task sizing and risk score"
      },
      {
        "command": "bash agentops/scripts/context-estimator.sh",
        "description": "Update context usage estimate"
      }
    ],
    "Stop": [
      {
        "command": "bash agentops/scripts/session-checkpoint.sh",
        "description": "Auto-commit and update scaffold docs if needed"
      }
    ],
    "SessionStart": [
      {
        "command": "bash agentops/scripts/session-start-checks.sh",
        "description": "Verify rules file, scaffold docs, and git state"
      }
    ]
  }
}
```

### 8.2 Git Hooks (`.githooks/`)

**pre-commit:**
```bash
#!/bin/bash
# Run secret scanner on staged files
# Run PII logging check on staged files
# Verify .env is not being committed
# Exit 1 to block commit if critical issues found
```

**post-commit:**
```bash
#!/bin/bash
# Update WORKFLOW.md with commit summary
# Reset blast radius counter
# Log commit to agentops session log
```

Setup: `git config core.hooksPath .githooks`

---

## 9. Multi-Tool Compatibility

### 9.1 Universal Layer (AGENTS.md)

The AGENTS.md file in the project root provides cross-tool instructions that work with Claude Code, Cursor, Codex, and any tool that supports the standard:

```markdown
# Agent Rules

## Before starting any task:
1. Check git status — commit if uncommitted changes exist
2. Read TASKS.md and CONTEXT.md for current project state
3. Confirm your plan before writing code
4. Make small, focused changes (≤5 files per task)

## After completing any task:
1. Summarize what you changed
2. List what to test
3. Wait for approval before starting the next task

## Security (Non-Negotiable):
- Never hardcode secrets
- Never log PII
- Always use row-level security for user data
- Always validate user input

## Error Handling:
- Every API call needs try/catch with user-friendly message
- Never show blank screens — always show fallback UI
```

### 9.2 Tool-Specific Extensions

| Tool | File | Extras |
|---|---|---|
| Claude Code | CLAUDE.md | Hook references, slash command references, subagent instructions |
| Cursor | .cursorrules | Cursor-specific formatting, composer mode instructions |
| Codex | codex.md | Codex-specific sandbox constraints |

### 9.3 Git Hooks (Universal)

Git hooks work regardless of which AI tool is used. They're the universal enforcement layer:

- Pre-commit: Secret scanning, PII check, .env protection
- Post-commit: Workflow logging, blast radius reset

---

## 10. Implementation Phases

### Phase 1: Foundation (Week 1)

**Goal:** Basic safety net — git enforcement and rules file creation.

| Component | Priority | Effort |
|---|---|---|
| `git-hygiene-check.sh` | P0 | 2 hours |
| `secret-scanner.sh` (PreToolUse hook) | P0 | 3 hours |
| Rules file starter template | P0 | 1 hour |
| `session-start-checks.sh` (SessionStart hook) | P0 | 2 hours |
| `.githooks/pre-commit` (secrets, .env) | P0 | 2 hours |
| `/agentops-check` slash command (basic version) | P1 | 2 hours |

**Deliverables:** Agent can't write secrets to files, git state is validated on session start, operator has a rules file.

### Phase 2: Monitoring (Week 2)

**Goal:** Real-time session monitoring — context health, blast radius, commit reminders.

| Component | Priority | Effort |
|---|---|---|
| `context-estimator.sh` | P0 | 3 hours |
| `task-sizer.sh` with risk scoring | P0 | 4 hours |
| Blast radius monitor (PostToolUse hook) | P1 | 3 hours |
| Message count tracker | P1 | 1 hour |
| Auto-commit on session end | P1 | 2 hours |
| `/agentops-check` full dashboard | P1 | 3 hours |

**Deliverables:** Operator gets real-time feedback on context health, task sizing warnings, and commit reminders.

### Phase 3: Scaffold System (Week 3)

**Goal:** Full scaffold document management — creation, updates, handoff messages.

| Component | Priority | Effort |
|---|---|---|
| All four scaffold templates | P0 | 2 hours |
| `agentops-scaffold` subagent | P0 | 4 hours |
| `/agentops-scaffold` slash command | P0 | 2 hours |
| Scaffold validator script | P1 | 2 hours |
| Auto-update on context degradation | P1 | 3 hours |
| Handoff message generator | P1 | 2 hours |

**Deliverables:** Operator can create/update scaffold docs with one command. Context degradation triggers automatic scaffold updates.

### Phase 4: Deep Auditing (Week 4)

**Goal:** Comprehensive on-demand auditing — security, error handling, scale analysis.

| Component | Priority | Effort |
|---|---|---|
| `security-audit.sh` full implementation | P0 | 6 hours |
| Error handling audit | P1 | 4 hours |
| `rules-file-linter.sh` | P1 | 3 hours |
| Scale analysis module | P2 | 4 hours |
| `/agentops-audit` full report | P1 | 4 hours |
| Cross-tool sync | P2 | 3 hours |

**Deliverables:** Full audit capability across all five skill areas. Operator can run a single command to get a complete project health report.

### Phase 5: Iteration and Hardening (Ongoing)

| Component | Priority | Effort |
|---|---|---|
| Behavior degradation detector (pattern matching) | P1 | 6 hours |
| Rules violation detector (rules ↔ diff comparison) | P1 | 5 hours |
| PII logging scanner refinement | P2 | 3 hours |
| False positive tuning across all hooks | P1 | Ongoing |
| Multi-tool testing (Cursor, Codex) | P2 | 4 hours |

---

## 11. Configuration and Tuning

### 11.1 Operator-Configurable Thresholds

All thresholds should be configurable via an `agentops.config.json` file:

```json
{
  "save_points": {
    "auto_commit_after_minutes": 30,
    "auto_branch_on_risk_score": 7,
    "max_uncommitted_files_warning": 5
  },
  "context_health": {
    "message_count_warning": 20,
    "message_count_critical": 30,
    "context_percent_warning": 60,
    "context_percent_critical": 80
  },
  "rules_file": {
    "max_lines": 200,
    "min_lines_warning": 10,
    "required_sections": ["security", "error handling"]
  },
  "task_sizing": {
    "medium_risk_threshold": 4,
    "high_risk_threshold": 7,
    "max_files_per_task_warning": 5,
    "max_files_per_task_critical": 8
  },
  "security": {
    "block_on_secret_detection": true,
    "scan_git_history": false,
    "require_rls_check": true
  },
  "notifications": {
    "verbose": false,
    "suppress_advisory": false
  }
}
```

### 11.2 Severity Levels and Actions

| Severity | Icon | Behavior |
|---|---|---|
| **Critical** | Red | Blocks action (PreToolUse exit 2). Requires operator resolution. |
| **Warning** | Yellow | Takes preventive action (auto-commit, auto-branch). Notifies operator. |
| **Advisory** | Blue | Notifies operator with recommendation. No automated action. |

### 11.3 False Positive Management

Operators can suppress specific checks or tune patterns:

```json
{
  "suppressions": {
    "secret_patterns": ["sk_test_*"],
    "files": ["src/test/fixtures/*"],
    "checks": ["pii_logging:test_files"]
  }
}
```

---

## 12. Success Metrics

Track these to measure AgentOps effectiveness over time:

| Metric | Target | How to Measure |
|---|---|---|
| Reverts needed per session | < 1 | Count `git checkout .` and `git reset` commands |
| Average commit frequency | Every 20-30 min during active work | Git log analysis |
| Context restarts per session | ≤ 1 | Count fresh session starts triggered by degradation |
| Security audit pass rate | 100% on critical, >90% on warning | `/agentops-audit` results |
| Scaffold doc freshness | Updated within 24 hours of last session | File modification timestamps |
| Blast radius per task | ≤ 5 files median | Git commit analysis |
| Time lost to agent mistakes | Decreasing week over week | Operator self-report |

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| **Blast radius** | How many files/features a single change can affect |
| **Context window** | The fixed amount of text an AI agent can hold in memory |
| **Context degradation** | When the agent starts forgetting instructions due to a full context window |
| **Scaffold documents** | Project state files (PLANNING, TASKS, CONTEXT, WORKFLOW) that survive across sessions |
| **Standing orders** | Persistent instructions in a rules file that load at every session start |
| **Save point** | A git commit representing a known-working state |
| **RLS** | Row-Level Security — database feature ensuring users only see their own data |
| **Handoff message** | A summary given to a fresh session so it can continue where the last left off |
| **Hook** | A user-defined script that runs automatically at specific points in the agent lifecycle |
| **Risk score** | A numeric assessment of how much damage a task could cause if something goes wrong |

---

## Appendix B: File Reference

| File | Purpose | Used By |
|---|---|---|
| `AGENTS.md` | Universal cross-tool agent rules | All AI tools |
| `CLAUDE.md` | Claude Code-specific rules | Claude Code |
| `.cursorrules` | Cursor-specific rules | Cursor |
| `PLANNING.md` | Architectural blueprint | Scaffold subagent, operator |
| `TASKS.md` | Task burndown list | Scaffold subagent, operator |
| `CONTEXT.md` | Session state briefing | Scaffold subagent, operator |
| `WORKFLOW.md` | Step-by-step session log | Scaffold subagent, hooks |
| `agentops.config.json` | All configurable thresholds | All scripts and hooks |
| `.claude/settings.json` | Hook configuration for Claude Code | Claude Code |
| `.githooks/pre-commit` | Universal secret/PII scanning at commit time | Git (all tools) |
| `.githooks/post-commit` | Workflow logging after commits | Git (all tools) |
