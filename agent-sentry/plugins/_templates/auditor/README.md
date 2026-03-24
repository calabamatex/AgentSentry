# Auditor Plugin Template

## What It Does

This template provides a starting point for building auditor plugins that validate agent actions against project rules, detect secrets, and assess risk before changes are applied.

## Prerequisites

- AgentSentry v4.0 or higher
- Node.js 18+
- Access to the `rules-validation`, `secret-detection`, and `risk-scoring` primitives

## Installation

1. Copy this template directory to `plugins/community/your-plugin-name/`
2. Update `metadata.json` with your plugin details
3. Implement your auditing logic in `src/index.ts`
4. Run `bash scripts/validate-plugin.sh plugins/community/your-plugin-name`

## Configuration

Edit `metadata.json` to configure:
- `hooks`: Which lifecycle hooks to subscribe to (typically `PreToolUse` for gating)
- `requires.primitives`: Which primitives your auditor depends on

## How It Works

The auditor plugin hooks into the AgentSentry lifecycle:
1. `PreToolUse` — Validates proposed actions before execution
2. `PostToolUse` — Reviews results after execution for compliance
3. Violations are reported via the `event-capture` primitive

## Troubleshooting

- **Plugin not loading**: Ensure `metadata.json` passes schema validation
- **False positives**: Adjust rule sensitivity in your validation logic
- **Missing rules files**: Ensure CLAUDE.md or AGENTS.md exist in project root
