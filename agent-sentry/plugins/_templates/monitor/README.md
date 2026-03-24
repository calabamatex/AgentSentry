# Monitor Plugin Template

## What It Does

This template provides a starting point for building monitor plugins that observe agent activity, capture operational events, and track context health.

## Prerequisites

- AgentSentry v4.0 or higher
- Node.js 18+
- Access to the `event-capture` and `context-estimation` primitives

## Installation

1. Copy this template directory to `plugins/community/your-plugin-name/`
2. Update `metadata.json` with your plugin details
3. Implement your monitoring logic in `src/index.ts`
4. Run `bash scripts/validate-plugin.sh plugins/community/your-plugin-name`

## Configuration

Edit `metadata.json` to configure:
- `hooks`: Which lifecycle hooks to subscribe to
- `requires.primitives`: Which primitives your monitor depends on

## How It Works

The monitor plugin hooks into the AgentSentry lifecycle:
1. `SessionStart` — Initializes monitoring state
2. `PostToolUse` — Captures events after each tool invocation
3. Events are stored via the `event-capture` primitive

## Troubleshooting

- **Plugin not loading**: Ensure `metadata.json` passes schema validation
- **Events not captured**: Verify the MemoryStore is initialized
- **High overhead**: Reduce hook frequency or batch event captures
