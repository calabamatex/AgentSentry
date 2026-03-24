# Commit Frequency Monitor

## What It Does

Tracks time since last git commit and number of uncommitted files. Emits warnings when:
- More than 30 minutes have passed since the last commit
- More than 5 files are uncommitted
- The session has been active for over an hour with no commits

## Prerequisites

- Git repository initialized
- AgentSentry v4.0+ installed
- Node.js 18+

## Installation

This plugin ships with AgentSentry core. No additional installation needed.

## Configuration

Add to `agent-sentry.config.json`:

```json
{
  "plugins": {
    "commit-monitor": {
      "max_minutes_since_commit": 30,
      "max_uncommitted_files": 5,
      "session_commit_interval_minutes": 60
    }
  }
}
```

## How It Works

1. On `SessionStart`: Records session start time, checks initial commit state
2. On `PostToolUse` (Write/Edit): Checks time since last commit and uncommitted file count
3. When thresholds exceeded: Captures an event to the memory store and emits a warning

Uses the `checkpoint-and-branch` primitive for git operations and `event-capture` for persistence.

## Troubleshooting

- **No warnings appearing**: Check that the plugin is loaded in your hook configuration
- **False positives on new repos**: The monitor uses `git log -1` which fails on repos with no commits
- **Performance**: Git operations are cached for 10 seconds to avoid repeated shell calls
