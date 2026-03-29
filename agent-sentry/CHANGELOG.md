# Changelog

All notable changes to AgentSentry are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.1.0-beta.1] - 2026-03-29

First beta release. Includes 28 fixes from a comprehensive SDLC analysis covering security, performance, code quality, CI/CD, and documentation.

### Added

- `agent_sentry_generate_handoff` — 10th MCP tool for structured session handoff messages
- `errorMessage()` shared utility used across 25 files for consistent error formatting
- SIGTERM graceful shutdown handler
- npm audit step in CI pipeline
- Vitest coverage configuration
- ESLint `no-floating-promises` and `no-misused-promises` rules enabled
- CI concurrency control (cancels stale runs)
- 4 missing CLI commands documented in README: `prune`, `export`, `import`, `handoff`

### Fixed

- **P1 (Critical):** Startup no longer loads entire events table — uses `getLatestHash()` instead
- **S1:** Auth bypass warning when no access key is configured
- **S2:** PostgREST filter injection in Supabase provider — inputs now sanitized
- **S8:** Removed query parameter authentication; header-only auth enforced
- **S13:** CORS defaults to `localhost` instead of wildcard
- **S14:** UUID validation on all Supabase provider inputs
- **A3:** ONNX model checksum verification on load
- **P2:** `QueryOptimizer` wired into SQLite provider initialization
- **P3:** SQLite `busy_timeout` set to 5000ms to prevent SQLITE_BUSY errors
- **P4:** Smarter cache invalidation with `shortenTtl()` in LRU cache
- **P5:** Embedding LRU cache to avoid redundant computation
- **P7:** Parallel Supabase aggregate queries (was sequential)
- **P8:** Transaction-wrapped batch inserts for atomicity
- **Q8:** ESLint strict promise rules enabled project-wide

### Security

- Patched `path-to-regexp` and `picomatch` high-severity dependency vulnerabilities
- 0 production vulnerabilities (npm audit clean)

### Changed

- Version updated from 4.1.0 to 4.1.0-beta.1 to reflect true project status
- All documentation references updated to v4.1.0-beta

## [4.1.0] - 2026-03-28

### Added

- Comprehensive SDLC analysis with 76 findings across 7 domains
- Full analysis report at `docs/sdlc-analysis-report.md`

## [4.0.0] - 2026-03-25

### Added

- Memory-aware agent management framework
- Hash-chained event storage with SQLite and Supabase providers
- 10 MCP tools for Claude Code integration
- 7 composable primitives (risk scoring, rules validation, secret scanning, context health, git checks, task sizing, event capture)
- 5-level progressive enablement system
- Auto-classification and event enrichment
- Cross-session intelligence (summaries, pattern detection, context recall)
- Plugin system with 4 categories and 11 validation checks
- Single-file HTML monitoring dashboard
- SSE/WebSocket event streaming
- CLI with 13 commands
- ONNX embedding support with noop fallback
