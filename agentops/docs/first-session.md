# Your First Session with AgentSentry

## What happens automatically

At Level 3 (the default), AgentSentry silently activates three skills:

- **save_points** -- session checkpoints captured automatically.
- **context_health** -- monitors context window usage.
- **standing_orders** -- validates rules on every action.

You do not need to start or configure anything.

## During your session

### Checking context window usage

Ask Claude Code to check how much context remains:

```json
{
  "estimated_tokens": 48000,
  "percent_used": 24,
  "messages": 12,
  "recommendation": "continue"
}
```

Recommendations: `continue` (< 50%), `caution` (50-80%), or `refresh` (> 80%).

### Sizing a task before you start

A small task ("add an email validation function to src/utils/validate.ts"):

```json
{
  "risk_level": "LOW",
  "estimated_files": 1,
  "factors": [
    { "name": "file-count", "contribution": 0 }
  ],
  "recommendation": "Low risk task. Proceed with standard development workflow."
}
```

A large task ("refactor the authentication system to use OAuth2 and migrate the user database schema"):

```json
{
  "risk_level": "CRITICAL",
  "estimated_files": 3,
  "factors": [
    { "name": "file-count", "contribution": 1 },
    { "name": "migration", "contribution": 3 },
    { "name": "refactoring", "contribution": 2 },
    { "name": "security", "contribution": 3 },
    { "name": "database-change", "contribution": 2 }
  ],
  "recommendation": "Critical risk. Key factors: migration, security, refactoring. Require senior review, comprehensive testing, and rollback plan."
}
```

### Catching security issues

If you accidentally include a real API key, `agent_sentry_scan_security` catches it:

```json
{
  "findings": [
    {
      "type": "api-key",
      "severity": "critical",
      "line": 7,
      "description": "Possible hardcoded API key detected"
    },
    {
      "type": "hardcoded-password",
      "severity": "critical",
      "line": 12,
      "description": "Possible hardcoded password detected"
    }
  ],
  "clean": false
}
```

The scanner detects API keys (Stripe, Google, GitHub, AWS patterns), hardcoded passwords, SQL injection, `eval()` usage, and embedded private keys.

## End of session

### Reviewing what happened

Search the event history to see what AgentSentry captured:

```json
{
  "results": [
    {
      "event": {
        "id": "evt_a1b2c3d4",
        "timestamp": "2026-03-22T14:32:08.000Z",
        "session_id": "sess_x9y8z7",
        "agent_id": "claude-code",
        "event_type": "decision",
        "severity": "low",
        "skill": "small_bets",
        "title": "Added email validation function",
        "detail": "Created validateEmail() in src/utils/validate.ts with RFC 5322 regex pattern",
        "affected_files": ["src/utils/validate.ts"],
        "tags": ["validation", "utils"],
        "metadata": {}
      },
      "score": 0.92
    }
  ],
  "total": 1
}
```

Results include a `score` (0.0-1.0) for query relevance. You can filter by `event_type`, `severity`, or time range via the `since` parameter.

### Checking overall health

The `agent_sentry_health` dashboard:

```json
{
  "status": "healthy",
  "store": {
    "provider": "sqlite",
    "total_events": 14,
    "by_type": { "decision": 8, "violation": 2, "pattern": 3, "handoff": 1 },
    "by_severity": { "low": 9, "medium": 2, "high": 1, "critical": 2 },
    "by_skill": { "save_points": 4, "context_health": 3, "standing_orders": 2, "small_bets": 3, "proactive_safety": 2 },
    "first_event": "2026-03-22T13:01:44.000Z",
    "last_event": "2026-03-22T15:12:09.000Z"
  },
  "chain": { "verified": true, "total_checked": 14 },
  "embedding": { "provider": "transformers", "dimension": 384, "available": true },
  "enablement": {
    "level": 3,
    "name": "Recommended",
    "active_skills": ["save_points", "context_health", "standing_orders"]
  },
  "config": {
    "max_events": 10000,
    "auto_prune_days": 90,
    "database_path": "/Users/you/project/.agent-sentry/memory.db"
  },
  "issues": []
}
```

- **status**: `healthy`, `degraded` (non-critical issue), or `error` (store failed).
- **chain.verified**: `true` confirms the tamper-evident hash chain is intact.
- **embedding.available**: `true` means semantic search is active; `false` falls back to text search.
- **issues**: Empty array means no problems. Issues appear here as plain-text descriptions.

## Your next session -- the payoff

Days or weeks later, `agent_sentry_recall_context` pulls in what you did before:

```
Found 1 relevant session(s) for: "email validation"

--- Session: sess_x9y8z7 (relevance: 0.89) ---
Summary: Added input validation utilities including email, URL, and phone number validators. Caught and removed a hardcoded API key in database config.
Key events:
  [decision/low] Added email validation function: Created validateEmail() in src/utils/validate.ts with RFC 5322 regex pattern
  [violation/critical] Hardcoded API key blocked: Detected hardcoded API key in src/config/database.ts line 7 before commit
```

This is the core value of AgentSentry: **persistent memory across sessions**. Without it, every new session starts from zero -- re-reading the same files, re-discovering the same patterns, risking the same mistakes. With `recall_context`, Claude Code already knows what was built, what went wrong, and what decisions were made before you write a single line of code.

The recall searches session summaries and stored events using semantic similarity. The `relevance_score` (0.0-1.0) indicates match quality. Control the search window with `lookback_days` (default: 90) and limit results with `max_results` (default: 5).
