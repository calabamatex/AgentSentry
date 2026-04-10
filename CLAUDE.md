# Claude Code Configuration — AgentSentry

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

## File Organization

- NEVER save to root folder — use the directories below
- Use `/src` for source code files
- Use `/tests` for test files
- Use `/docs` for documentation and markdown files
- Use `/config` for configuration files
- Use `/scripts` for utility scripts
- Use `/examples` for example code

## Project Architecture

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Use event sourcing for state changes
- Ensure input validation at system boundaries

### Project Config

- **Topology**: hierarchical-mesh
- **Memory**: SQLite (local), Supabase (experimental/remote)
- **Vector Search**: Linear scan with cosine similarity (bounded to 10k most recent embeddings)

## Build & Test

```bash
npm run build    # Compile TypeScript
npm test         # Run all tests (vitest)
npm run lint     # ESLint
npm run benchmark # Performance benchmarks
```

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing

## Error Handling

- Every API/tool call needs try/catch with a user-friendly message
- Never show blank screens — always provide a fallback state
- Agent failures must be caught and reported, not swallowed
- Use circuit breaker patterns for external service calls
- Log errors with structured context (module, operation, error type)

## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal

## Concurrency Guidelines

- Batch related operations into a single message when possible
- When spawning multiple agents, put all agent calls in ONE message for parallel execution
- After spawning agents, wait for results — do not poll

## Branch Hygiene

- Feature branches MUST be merged to main or cleaned up before a session ends
- Infrastructure fixes (hooks, gitignore, CI) go DIRECTLY on main
- Never leave orphaned branches — document incomplete work in commit messages
- Before creating a new branch, check `git branch -r` for existing unmerged branches

---

> **Note for contributors:** This project uses [claude-flow](https://github.com/ruvnet/ruflo/) for multi-agent orchestration in CI and automated testing workflows. The orchestration layer is optional for development — you can work on AgentSentry using standard Claude Code or any editor without it.
