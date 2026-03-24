# Integration Plugin Template

## What It Does

This template provides a starting point for building integration plugins that connect AgentSentry with external services, APIs, and tools via MCP (Model Context Protocol).

## Prerequisites

- AgentSentry v4.0 or higher
- Node.js 18+
- Access to the `event-capture` and `checkpoint-and-branch` primitives
- External service credentials (configured via environment variables)

## Installation

1. Copy this template directory to `plugins/community/your-plugin-name/`
2. Update `metadata.json` with your plugin details
3. Implement your integration logic in `src/index.ts`
4. Run `bash scripts/validate-plugin.sh plugins/community/your-plugin-name`

## Configuration

Edit `metadata.json` to configure:
- `hooks`: Which lifecycle hooks to subscribe to
- `mcp_tools`: MCP tool names your integration exposes
- `requires.primitives`: Which primitives your integration depends on

## How It Works

The integration plugin hooks into the AgentSentry lifecycle:
1. `SessionStart` — Establishes connection to external service
2. `PreToolUse` / `PostToolUse` — Syncs data with external service
3. `Stop` — Gracefully disconnects and flushes pending data

## Troubleshooting

- **Connection failures**: Verify environment variables and network access
- **Authentication errors**: Check that credentials are set (never hardcode them)
- **Data sync issues**: Enable debug logging to trace MCP communication
