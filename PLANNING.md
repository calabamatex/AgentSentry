# AgentOps v4.0 — Architecture & Planning

## Architecture Overview

AgentOps is a standalone agent management framework with four layers:

1. **Shell Scripts** — Hook-based automation (pre/post tool use, session lifecycle)
2. **TypeScript Primitives** — 7 composable modules (risk scoring, secret detection, etc.)
3. **Memory Store** — Persistent, hash-chained event storage with vector search
4. **MCP Server** — 9 tools exposed via Model Context Protocol

## Design Decisions

- **SQLite as default storage**: Local-first, zero-config, portable
- **Hash-chained events**: Tamper-evident audit trail without external dependencies
- **Progressive enablement**: 5 levels so teams can adopt incrementally
- **Provider pattern**: StorageProvider and EmbeddingProvider interfaces for swappable backends

## Current State (v4.0)

| Component | Status |
|-----------|--------|
| Memory Store (SQLite) | Stable, 44 tests |
| MCP Server (9 tools) | Stable, 97 tests |
| Primitives (7 modules) | Stable, 95 tests |
| Enablement Engine | Stable, 47 tests |
| Enrichment + Audit | Stable, 67 tests |
| Auto-Pruning + Perf | Stable, 18 tests |
| Plugin System | Stable, commit-monitor plugin shipped |
| Supabase Provider | Beta (full CRUD, vector search, chain checkpoints) |

## Roadmap

- **v4.1**: Supabase provider, dashboard HTML updates, CI build matrix
- **v4.2**: Cloud LLM enrichment, multi-agent coordination
- **v5.0**: Team dashboards, real-time streaming, plugin marketplace
