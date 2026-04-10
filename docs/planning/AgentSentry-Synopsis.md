# AgentSentry: The Management Layer Your Agents Are Missing

## A Project Synopsis for Agentic Developers

---

## The Problem in One Sentence

You can get AI to build almost anything now — but the moment your agent runs for 30 minutes, touches 15 files, or coordinates with other agents, you're one bad step away from losing hours of work, leaking secrets, or shipping broken software you can't roll back.

---

## Who This Is For

You're an agentic developer. You build software by describing what you want and letting AI build it. You may have started as a "vibe coder" in 2025 and now you're using Claude Code, Cursor, Codex, or Replit to ship real products. Maybe you have customers. Maybe you're running multi-agent workflows to build faster.

You're not writing code line by line. You're managing the thing that writes code. And that management layer — the part between your intent and what the agent actually does — is where everything breaks.

AgentSentry is the management layer.

---

## What AgentSentry Actually Is

AgentSentry is an open oversight framework that sits on top of your AI coding agents and does three things:

1. **Watches in real time** while your agents work — flagging risky changes, secret exposure, context window degradation, and scope creep before they become disasters
2. **Audits on demand** — scanning your entire project for security gaps, missing error handling, rules file problems, and architectural risks
3. **Maintains continuity** — keeping scaffold documents updated so you (or your agents) can pick up where you left off across sessions, without starting from zero

It works with Claude Code, Cursor, Codex, and any tool that supports AGENTS.md. It runs locally, requires no server, and integrates through hooks, slash commands, and subagents that your existing tools already support.

---

## Why This Matters Right Now

### Agents got powerful faster than we learned to manage them

In 2025, AI coding was a prompting exercise. You described what you wanted, got a block of code, pasted it in. If something broke, the blast radius was one file.

In 2026, agents read your database, create tables, build interfaces, install dependencies, and iterate on their own mistakes — autonomously, for 10 to 60 minutes at a stretch. A single agent task can touch 20 files across your project. A swarm of agents can touch 50.

The failure mode is no longer "the AI gave me bad code." It's "the AI rewrote my authentication system, broke three features I wasn't looking at, and I can't get back to the version that worked."

### Real damage is already happening

A Meta security researcher had OpenAI's agent delete a large portion of her email inbox in February 2026 — despite explicit instructions to confirm before acting. She described having to physically unplug the machine to save what was left.

Senior developers are losing production databases to agents making "minor changes" with no version control. Vibe coders are losing entire evenings to circular conversations where the agent breaks, tries to fix, and breaks worse.

These aren't edge cases. They're the default outcome when you give a powerful agent autonomy without a management layer.

### The 40% failure cliff

Gartner predicts that 40%+ of agentic AI projects will be cancelled by 2027 due to escalating costs, unclear value, and inadequate risk controls. The difference between the projects that ship and the ones that get cancelled is almost never the AI model. It's the governance, the oversight, and the operational discipline around the AI.

AgentSentry is that operational discipline, packaged as a framework.

---

## The Feature Set

AgentSentry is organized around 5 core management skills, plus 9 architectural extensions that future-proof the framework for 2026-2027.

### The 5 Core Skills

**Skill 1: Save Points (Version Control)**
Your agent can't delete what Git has already saved. AgentSentry auto-commits checkpoints before risky changes, auto-branches when you're working on main, and saves your state at the end of every session. If something goes wrong, you're one command away from the last version that worked.

What it does in practice: a PreToolUse hook checks git state before every file write. If you have 5+ uncommitted files or it's been 30+ minutes since your last commit, it saves automatically. If your agent is about to make a high-risk change on your main branch, it creates a safety branch first.

**Skill 2: Context Health (Know When to Start Fresh)**
Every agent has a fixed memory (the context window). As your conversation grows, early instructions get dropped. Your agent starts "forgetting" decisions, rewriting working code, and ignoring rules. AgentSentry monitors context usage, counts messages, and detects degradation signals — then automatically updates your project's scaffold documents and generates a handoff message so your next session picks up cleanly.

What it does in practice: at 60% context capacity, you get a warning. At 80%, it triggers the scaffold subagent to save the current state of PLANNING.md, TASKS.md, CONTEXT.md, and WORKFLOW.md. You start a fresh session with a handoff message that gives the new session everything it needs in the first prompt.

**Skill 3: Standing Orders (Rules Files)**
Your agent reads a rules file at the start of every session — the "employee handbook" that says how you do things. AgentSentry validates that this file exists, has the right sections (security, error handling, scale expectations), isn't too bloated for the context window, and is actually being followed. When the agent violates a rule, AgentSentry flags it in real time.

What it does in practice: a SessionStart hook validates your CLAUDE.md and AGENTS.md. A PostToolUse hook compares every file change against your rules (e.g., "never hardcode secrets" → agent just hardcoded a secret → immediate warning). A linter checks for contradictions, vague language, and missing critical sections.

**Skill 4: Small Bets (Blast Radius Control)**
The single biggest source of agent disasters is scope. When you ask an agent to "redesign the order system," it touches every file, and if step 4 of 12 goes wrong, steps 5 through 12 compound the damage. AgentSentry scores every task for risk (how many files, does it change the database, does it touch shared code?) and enforces decomposition for high-risk tasks.

What it does in practice: a UserPromptSubmit hook analyzes your task before the agent starts. Low risk (1-3 files) → proceed. Medium risk (4-7 files) → auto-commit first, recommend a plan. High risk (8+ files) → require decomposition into sub-tasks with validation between each one. For multi-agent swarms, it tracks total blast radius across all agents and catches file conflicts.

**Skill 5: Ask What They Won't (Proactive Safety)**
Your agent builds for the happy path. It won't think to add error handling, protect customer data, scan for exposed secrets, or plan for scale — unless you tell it to. AgentSentry does the telling for you, automatically. A secret scanner blocks hardcoded API keys before they're written. A PII detector flags customer data in log statements. An error handling enforcer checks that every API call has a try/catch.

What it does in practice: a PreToolUse hook blocks any file write that contains secret patterns (API keys, tokens, connection strings) — immediately, before the file is saved. A PostToolUse hook scans every new file for missing error handling on API calls, PII in log statements, and unprotected database queries. A full security audit runs on demand covering secrets, authentication, input validation, dependencies, and database security.

### The 9 Architectural Extensions

These extend the 5 core skills into a full framework for production agent management:

**Observability & Tracing** — OpenTelemetry-compatible distributed tracing. Every task gets a trace ID that follows it through every agent, tool call, and LLM request. You can see exactly what happened, who did it, how long it took, and what it cost — across an entire multi-agent swarm.

**Agent Identity & Permissions** — Formal permission boundaries per agent. A coder agent can write to source files but not touch security configs. A tester can run tests but not push to production. Enforced at runtime, not just suggested in a prompt.

**Cost Management** — Hierarchical token budgets (per-agent, per-session, monthly). Real-time metering of every LLM call with automatic model downgrading when budgets are hit. Because a 12-agent swarm running for an hour can burn $50 without you noticing.

**Lifecycle Management** — Formal state machine for agent lifecycle (created → active → awaiting → completed/failed/cancelled). Graceful shutdown that saves progress before terminating. No more orphaned processes or half-written files from killed agents.

**Multi-Provider Awareness** — Provider-level health monitoring across Claude, GPT, Gemini, Cohere, and Ollama. Failover audit trails that log why a provider switch happened. Cost normalization so you can compare spend across providers.

**Testing & Evals** — Golden datasets for every AgentSentry module. Regression testing on every rules file or agent definition change. If you change a prompt and it breaks a detection pattern, you find out before your users do.

**Compliance & Audit Trail** — Append-only, hash-chained audit records for every agent action. EU AI Act Article 12 compliant (enforceable August 2, 2026). Every action timestamped, attributed, and tamper-proof.

**Agent-to-Agent Trust** — Delegation tokens that narrow scope when a parent agent delegates to a sub-agent. Tokens expire, can be revoked, and never widen permissions. If a sub-agent gets compromised, the damage is contained to its delegation scope.

**Self-Improvement with Guardrails** — Agents can propose rules file additions when they detect repeated failures. Proposals go to a review queue — the operator approves or rejects. Agents can only add rules, never remove them. No agent can weaken its own guardrails.

### The Dashboard

A zero-dependency local HTML dashboard that you open in a browser. No server, no npm install, no build step.

The main view shows your overall health score (0-100), commit frequency, context usage, blast radius, and violations — all in real time. Drill into any of the 5 skills for detailed metrics, tables, and charts. A trends page shows how your health scores change over days and weeks. An audit page shows the full results of your last security scan.

For teams running multi-agent workflows, a dedicated Agents page shows the live state of all active agents: what they're working on, their lifecycle state, drift events, delegation chains, and resource usage.

### The Plugin System

AgentSentry is designed to be extended. The core scripts become first-party plugins. Community and team-specific checks (Kubernetes deployment validators, GraphQL schema linters, custom compliance rules) plug in through a standard manifest format with hook subscriptions, config schemas, and dashboard panels.

---

## Why This Has Value

### For individual agentic developers

You stop losing work. You stop losing hours to circular conversations where the agent digs itself deeper. You stop accidentally committing secrets. You stop shipping broken features because the agent touched something you didn't expect. You get a safety net that costs nothing to run and pays for itself the first time it saves you from a disaster.

### For teams building on agent platforms

You get a governance layer. You can answer "what did the agents actually do?" with a trace. You can answer "how much did that cost?" with a budget log. You can answer "are we compliant?" with an audit trail. You can enforce permission boundaries so a compromised agent can't escalate beyond its scope.

### For the agentic ecosystem

Every tool that ships agents — Claude Code, Cursor, Codex, Copilot, and whatever launches next month — needs this layer. The models will keep getting better. The agents will keep getting more autonomous. The management discipline is the part that doesn't ship with the model. It has to be built separately, and it has to work across tools, across providers, and across time.

AgentSentry is that layer. It's the difference between "we built something cool" and "we built something we can run."

---

## Project Inventory

| Document | What It Is | Lines |
|---|---|---|
| `AgentSentry-Product-Spec.md` | Complete product specification (v3.0), 23 sections + appendices — generic, stack-agnostic | 1,605 |
| `Agent-Management-Implementation-Guide.md` | Detailed how-to for each of the 5 core skills with templates, prompts, and iteration plans | 656 |
| `AgentSentry-Architecture-Evolution.md` | Analysis of 9 architectural gaps with research-backed solutions | 763 |
| `AgentSentry-Synopsis.md` | This document — project overview for agentic developers | ~170 |
| `From-Vibe-Coding-to-Agent-Management.md` | Original synopsis of the 5 skills (source transcript distillation) | 132 |
| `agent-management-guide.html` | Interactive HTML guide with expandable sections, progress tracking, and copyable templates | 1,041 |
| `agent-sentry-dashboard.html` | Full dashboard prototype with skill drill-downs, trends, and agent monitoring | 787 |
| **Total** | | **~5,154** |

---

## What Makes This Different

Most agent tooling focuses on making agents smarter. AgentSentry focuses on making the human managing them more effective.

It doesn't require you to write code. It doesn't require you to understand distributed systems. It requires you to let hooks run, read a dashboard, and commit when the green light says commit. The framework does the rest.

And it's built to evolve. The event bus, plugin system, and provider-agnostic design mean that as agents get more powerful — as swarms get larger, as context windows grow, as new models and providers appear — AgentSentry adapts rather than breaks.

The wall between vibe coding and production isn't code. It's management. AgentSentry is the management.
