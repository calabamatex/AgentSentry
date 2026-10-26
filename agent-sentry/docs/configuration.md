# Configuration Reference

All AgentSentry settings are in `agent-sentry.config.json`. This document covers every section.

## File Location

The config file is at `agent-sentry/agent-sentry.config.json` relative to your project root.

Generate a default config with the setup wizard:

```bash
bash agent-sentry/scripts/setup-wizard.sh
```

Or set the enablement level directly:

```bash
npx @calabamatex/agentsentry enable 2
```

## Sections

### enablement

Controls which skills are active and at what level.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `level` | number (1-6) | 2 | Progressive enablement level |
| `skills` | object | — | Per-skill configuration |
| `skills.<name>.enabled` | boolean | varies | Whether the skill is active |
| `skills.<name>.mode` | string | varies | `"off"`, `"basic"`, or `"full"` |

**Levels:**

| Level | Name | Skills Active |
|-------|------|---------------|
| 1 | Safe Ground | save_points (full) |
| 2 | Clear Head | + context_health (full) |
| 3 | House Rules | + standing_orders (basic), + directive_compliance (full) |
| 4 | Right Size | standing_orders (full), + small_bets (basic) |
| 5 | Full Guard | small_bets (full), + proactive_safety (full) |
| 6 | Risk Watch | + risk_scoring (full) — **[experimental]** |

### save_points

Automatic git checkpoints.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `auto_commit_enabled` | boolean | false | Create git stash snapshots automatically |
| `auto_commit_after_minutes` | number | 30 | Minutes between auto-checkpoints |
| `auto_branch_on_risk_score` | number | 8 | Risk score threshold to create a safety branch |
| `max_uncommitted_files_warning` | number | 5 | Warn when this many files are uncommitted |

### context_health

Context window monitoring.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `message_count_warning` | number | 20 | Warn at this many messages |
| `message_count_critical` | number | 30 | Critical at this many messages |
| `context_percent_warning` | number | 60 | Warn at this % of context used |
| `context_percent_critical` | number | 80 | Critical at this % of context used |

### rules_file

Rules file validation (Standing Orders skill).

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `max_lines` | number | 300 | Maximum lines in rules file |
| `required_sections` | string[] | ["security", "error handling"] | Sections that must exist |

### task_sizing

Risk scoring thresholds (Small Bets skill).

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `medium_risk_threshold` | number | 4 | Score >= this = MEDIUM risk |
| `high_risk_threshold` | number | 8 | Score >= this = HIGH risk |
| `critical_risk_threshold` | number | 13 | Score >= this = CRITICAL risk |
| `max_files_per_task_warning` | number | 5 | Warn when task touches this many files |
| `max_files_per_task_critical` | number | 8 | Critical when task touches this many files |

### security

Secret detection and permission enforcement.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `block_on_secret_detection` | boolean | true | Block commits containing secrets |
| `scan_git_history` | boolean | false | Scan git history for secrets |
| `check_common_provider_keys` | boolean | true | Check for AWS, GCP, Azure keys |
| `permission_fail_mode` | string | "block" | `"block"` or `"warn"` on permission violations |
| `suppressions` | string[] | [] | Patterns to suppress (e.g., test fixtures) |
| `exclude_paths` | string[] | ["node_modules/**", ...] | Paths to skip during scanning |

### budget

Cost tracking thresholds.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `session_budget` | number | 10 | Per-session budget in dollars |
| `monthly_budget` | number | 500 | Monthly budget in dollars |
| `warn_threshold` | number | 0.8 | Warn at this fraction of budget (0.8 = 80%) |

### notifications

Output formatting.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `verbose` | boolean | false | Enable verbose output |
| `prefix_all_messages` | string | "[AgentSentry]" | Prefix for all output messages |

### memory

Persistent storage configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | true | Enable/disable memory store |
| `provider` | string | "sqlite" | `"sqlite"` or `"supabase"` |
| `embedding_provider` | string | "auto" | `"auto"`, `"onnx"`, or `"noop"` |
| `database_path` | string | "agent-sentry/data/ops.db" | SQLite database file path |
| `max_events` | number | 100000 | Maximum events before pruning |
| `auto_prune_days` | number | 365 | Delete events older than this |

**Embedding providers:**
- `auto`: Uses ONNX if `onnxruntime-node` is installed, falls back to noop
- `onnx`: Requires `onnxruntime-node` (384-dimension vectors)
- `noop`: Text-based search only, no vector embeddings

### risk_scoring *(Level 6, [experimental])*

Optional. Tunes the context-aware risk-scoring engine (active only at enablement Level 6). The whole section may be omitted — sensible defaults apply.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | false | Master switch (auto-on at Level 6) |
| `correlation.enabled` | boolean | true | Run compound-risk correlation |
| `correlation.compound_risk_threshold` | number | 0.15 | Min severity boost for a compound risk to surface |
| `performance.max_evaluation_time_ms` | number | 100 | Per-evaluation compute budget |
| `calibration.minimum_samples_for_calibration` | number | 20 | Labeled samples required before a score may be `calibrated` |
| `calibration.max_brier_score` | number | 0.25 | Brier-score ceiling a scorer must beat to be `calibrated` |

Until a project accumulates enough calibrated samples, all scores are reported as `default_priors` (heuristic hints, not validated probabilities). See [architecture/risk-scoring.md](./architecture/risk-scoring.md).

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | Supabase provider | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase provider | Service role API key |
| `AGENT_SENTRY_ACCESS_KEY` | MCP server | Authentication key for MCP requests |
| `AGENT_SENTRY_SUPPRESS_EXPERIMENTAL_WARN` | Coordinator | Set to `1` to suppress experimental warnings |

## Example: Minimal Config

```json
{
  "memory": { "enabled": true, "provider": "sqlite" },
  "enablement": { "level": 2 }
}
```

## Example: Full Config

See `agent-sentry/agent-sentry.config.json` for the complete default configuration.
