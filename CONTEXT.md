# AgentOps — Session Context

**Last updated:** 2026-03-22
**Branch:** main
**Test count:** 1003 tests passing (79 test files)
**Build status:** Clean
Last verified: 2026-03-22

## Recent Work

This session completed all 4 build phases of AgentOps v4.0, plus P0 scaling fixes and a comprehensive review-driven remediation pass.

## Key Files

| Area | Entry Point |
|------|-------------|
| Memory Store | `agentops/src/memory/store.ts` |
| MCP Server | `agentops/src/mcp/server.ts` (built: `agentops/dist/src/mcp/server.js`) |
| Primitives | `agentops/src/primitives/index.ts` |
| Enablement | `agentops/src/enablement/engine.ts` |
| Enrichment | `agentops/src/memory/enrichment.ts` |
| Config | `agentops/agentops.config.json` |
| Build Plan | `AgentOps-OB1-Build-Plan.md` |
| Product Spec | `AgentOps-Product-Spec.md` |

## Constraints

- Do NOT modify: `audit-logger.ts`, `event-bus.ts`, `trace-context.ts`
- Supabase provider is implemented `[beta]` — full CRUD, vector search, and chain checkpoints via raw HTTPS against PostgREST; requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars
- ONNX model tracked via Git LFS
