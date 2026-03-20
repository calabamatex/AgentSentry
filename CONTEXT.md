# AgentOps — Session Context

**Last updated:** 2026-03-20
**Branch:** main
**Test count:** 411+ tests passing
**Build status:** Clean

## Recent Work

This session completed all 4 build phases of AgentOps v4.0, plus P0 scaling fixes and a comprehensive review-driven remediation pass.

## Key Files

| Area | Entry Point |
|------|-------------|
| Memory Store | `agentops/src/memory/store.ts` |
| MCP Server | `agentops/src/mcp/server.ts` |
| Primitives | `agentops/src/primitives/index.ts` |
| Enablement | `agentops/src/enablement/engine.ts` |
| Enrichment | `agentops/src/memory/enrichment.ts` |
| Config | `agentops/agentops.config.json` |
| Build Plan | `AgentOps-OB1-Build-Plan.md` |
| Product Spec | `AgentOps-Product-Spec.md` |

## Constraints

- Do NOT modify: `audit-logger.ts`, `event-bus.ts`, `trace-context.ts`
- Supabase provider is a stub — throws NotImplementedError
- ONNX model (86MB) is in git; should move to Git LFS
