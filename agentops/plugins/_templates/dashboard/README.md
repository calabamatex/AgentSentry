# Dashboard Plugin Template

## What It Does

This template provides a starting point for building dashboard plugins that aggregate and visualize agent operational data, context health, and project scaffold status.

## Prerequisites

- AgentOps v4.0 or higher
- Node.js 18+
- Access to the `event-capture`, `context-estimation`, and `scaffold-update` primitives

## Installation

1. Copy this template directory to `plugins/community/your-plugin-name/`
2. Update `metadata.json` with your plugin details
3. Implement your dashboard logic in `src/index.ts`
4. Run `bash scripts/validate-plugin.sh plugins/community/your-plugin-name`

## Configuration

Edit `metadata.json` to configure:
- `hooks`: Which lifecycle hooks to subscribe to
- `requires.primitives`: Which primitives your dashboard reads from

## How It Works

The dashboard plugin hooks into the AgentOps lifecycle:
1. `SessionStart` — Initializes dashboard state and baseline metrics
2. `Stop` — Generates final summary report
3. Periodically queries the MemoryStore for event aggregation

## Troubleshooting

- **No data displayed**: Verify events are being captured by other skills
- **Stale data**: Check that the MemoryStore provider is properly configured
- **Missing scaffold files**: Run `updateScaffold()` to diagnose
