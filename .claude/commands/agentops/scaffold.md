---
name: agentops-scaffold
description: >
  Create or update scaffold documents (PLANNING.md, TASKS.md, CONTEXT.md, WORKFLOW.md)
  with current project state. Generates a handoff message for starting fresh sessions.
---

Create or update the AgentOps scaffold documents for this project. Follow these steps exactly:

## Step 1: Check which scaffold docs exist

Check the repo root for these 4 files:
- PLANNING.md
- TASKS.md
- CONTEXT.md
- WORKFLOW.md

## Step 2: Create missing docs from templates

For each missing file, copy from `agentops/templates/{NAME}.md.template` and fill in project-specific content:

- **PLANNING.md**: Scan `package.json` (if exists) for project name, dependencies, scripts. Scan directory structure for tech stack clues. Fill in the Project Overview and Tech Stack sections.
- **TASKS.md**: Scan recent `git log --oneline -20` for recent work. Scan for TODO/FIXME comments in source files. Populate In Progress and Completed sections.
- **CONTEXT.md**: Run `git branch --show-current` for active branch, `git log -1 --format='%h — %s'` for last commit. Fill in Current State and Active Goals.
- **WORKFLOW.md**: Add a new session entry with today's date, current branch, and note that scaffold docs were created.

## Step 3: Update existing docs

For docs that already exist:
- **TASKS.md**: Cross-reference against `git log --oneline -10` to see if any completed tasks should be checked off.
- **CONTEXT.md**: Update the Current State section with current branch and last commit. Update Last Session Summary.
- **WORKFLOW.md**: Append a new session entry for today.

## Step 4: Generate handoff message

Using the template at `agentops/templates/handoff-message.md`, fill in all `{placeholders}` with real data from the scaffold docs and git state. Sources:
- `{project}`: from PLANNING.md or package.json name
- `{branch_name}`: from `git branch --show-current`
- `{commit_hash}` and `{commit_message}`: from `git log -1 --format='%h' and '%s'`
- `WHAT'S DONE`: from TASKS.md completed section
- `WHAT'S NEXT`: from TASKS.md in-progress section
- `KEY DECISIONS`: from CONTEXT.md
- `KNOWN ISSUES`: from TASKS.md known bugs
- `DO NOT CHANGE`: from CONTEXT.md

## Step 5: Output the handoff message

Print the completed handoff message so the user can copy it for their next session.
