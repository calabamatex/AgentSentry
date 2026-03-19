# Handoff Message Template
#
# Use this template to generate a handoff message when starting a fresh session.
# Replace all {placeholders} with actual values drawn from the project's tracking
# files (TASKS.md, CONTEXT.md, PLANNING.md, WORKFLOW.md).
#
# The goal is to give any AI agent or human collaborator enough context to resume
# work immediately without re-reading the entire codebase.

---

I'm continuing work on {project_name}. Here's where we are:

## Overview

<!-- Basic project identity and current branch/commit state. -->

PROJECT: {project_name}
TECH STACK: {languages, frameworks, key dependencies}
ACTIVE BRANCH: {branch_name}
LAST COMMIT: {commit_hash} — {commit_message}

## Progress

<!-- Pulled from TASKS.md. List completed items so the next session knows what
     ground has already been covered. -->

WHAT'S DONE:
- {completed_task_1}
- {completed_task_2}

<!-- Pulled from TASKS.md in-progress and up-next sections. This is the immediate
     focus for the incoming session. -->

WHAT'S NEXT:
- {next_task_1}
- {next_task_2}

## Tooling

<!-- Which agents, MCP servers, or CLI tools are actively being used and why.
     Helps the next session avoid re-discovering or misconfiguring tooling. -->

AGENTS IN USE:
- {agent_or_tool_name}: {what_it_does_in_this_project}

## Decisions

<!-- Important architectural or design decisions already locked in.
     Pulled from CONTEXT.md. Prevents the next session from revisiting
     settled questions. -->

KEY DECISIONS ALREADY MADE:
- {decision_1}
- {decision_2}

## Constraints

<!-- Hard rules the next session must respect. Pulled from CONTEXT.md.
     Anything listed here should not be changed without explicit approval. -->

DO NOT CHANGE:
- {constraint_1}
- {constraint_2}

## Known Issues

<!-- Open bugs or gotchas. Pulled from TASKS.md known-bugs section.
     Alerts the next session to landmines before they step on them. -->

KNOWN ISSUES:
- {issue_1}
- {issue_2}

## Required Reading

<!-- Files the next session should read before writing any code.
     Order matters — start broad (architecture) and narrow down. -->

READ THESE FILES FIRST:
1. PLANNING.md — architecture and tech stack
2. TASKS.md — what's done and what's next
3. CONTEXT.md — current state summary
4. WORKFLOW.md — recent session logs
