# AGENTS.md — AgentOps Universal Rules (All Tools)

> Implements AgentOps-Product-Spec.md §4.2 — universal agent rules that work with any AI tool.

## Before Starting Any Task

1. **Check git status** — commit if uncommitted changes exist.
2. **Read TASKS.md and CONTEXT.md** for current state.
3. **Confirm your plan** before writing code.
4. **Assess blast radius:** how many files will this touch?

## After Completing Any Task

1. **Summarize what changed** and which files were modified.
2. **List what to test.**
3. **Wait for approval** before starting next task.
4. **Update TASKS.md** with completion status.

## Security

- Never hardcode secrets — use environment variables.
- Never log PII in any output.
- Validate all user input before processing.

## Error Handling

- Every API/tool call needs try/catch with a user-friendly message.
- Never show blank screens — always show a fallback state.
- Agent failures must be caught and reported, not swallowed.
