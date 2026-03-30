# Contributing to AgentSentry

Thanks for your interest in contributing to AgentSentry.

## Development Setup

```bash
git clone https://github.com/calabamatex/AgentSentry.git
cd AgentSentry/agent-sentry
npm install
npm run build
npm test
```

**Requirements:** Node.js >= 18

## Project Layout

```
agent-sentry/
  src/            # Source code (TypeScript)
  tests/          # Tests mirror src/ structure
  docs/           # User-facing documentation
  config/         # JSON schemas
  plugins/        # Plugin templates and core plugins
  scripts/        # Shell wrappers and utility scripts
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run all tests via Vitest |
| `npm run test:unit` | Unit tests only (no build required) |
| `npm run test:contracts` | Build artifact validation (requires build) |
| `npm run test:e2e` | End-to-end integration tests |
| `npm run test:perf` | Performance benchmarks |
| `npm run test:watch` | Watch mode |
| `npm run lint` | ESLint on `src/` |
| `npm run benchmark` | Run performance benchmarks |

## Code Style

- TypeScript strict mode
- ESLint with `no-floating-promises` and `no-misused-promises` enabled
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Every API/tool call needs try/catch with a user-friendly message
- Validate user input at system boundaries
- Never hardcode secrets or credentials

## Testing

- Tests live in `tests/` mirroring the `src/` directory structure
- Use Vitest for all tests
- Run `npm test` before submitting a PR — all 1,113 tests must pass
- Add tests for new features and bug fixes
- Performance benchmarks in `tests/performance/`

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes
3. Run `npm run build && npm test && npm run lint`
4. Ensure 0 lint errors
5. Write a clear commit message explaining the "why"
6. Open a PR against `main`

## File Organization

- Source code: `src/`
- Tests: `tests/`
- Documentation: `docs/`
- Configuration: `config/`
- Scripts: `scripts/`
- Examples: `docs/examples/`

Do not add files to the repository root unless they are standard project files (package.json, tsconfig.json, etc.).

## Reporting Issues

Open an issue at [github.com/calabamatex/AgentSentry/issues](https://github.com/calabamatex/AgentSentry/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- AgentSentry version (`npx agentsentry health`)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
