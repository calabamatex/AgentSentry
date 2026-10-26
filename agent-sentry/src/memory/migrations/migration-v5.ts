/**
 * migration-v5.ts — Risk-scoring (Level 6) tables.
 *
 * Additive only: four new tables for the context-aware risk-scoring engine.
 * No existing tables are modified. Tables are created empty; the pattern /
 * profile catalogs are seeded at runtime from bundled constants when the
 * knowledge stores initialize (Phase C), keeping seed data in TypeScript
 * rather than SQL.
 */

export const MIGRATION_V5_SQL = `
  -- Risk pattern catalog (cataloged detection patterns + context metadata)
  CREATE TABLE IF NOT EXISTS risk_patterns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    detection_method TEXT NOT NULL,
    detection_config TEXT NOT NULL,          -- JSON
    base_severity REAL NOT NULL,
    false_positive_rate REAL NOT NULL DEFAULT 0.1,
    context_modifiers TEXT NOT NULL DEFAULT '[]',  -- JSON
    historical_frequency REAL DEFAULT 0.0,
    historical_resolution TEXT DEFAULT '{}',  -- JSON
    mean_time_to_incident REAL,
    correlated_patterns TEXT DEFAULT '[]',    -- JSON
    escalation_chain TEXT DEFAULT '[]',       -- JSON
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Misbehavior profiles (behavioral failure-mode models)
  CREATE TABLE IF NOT EXISTS misbehavior_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    preconditions TEXT NOT NULL,             -- JSON
    signals TEXT NOT NULL,                    -- JSON
    potential_damage TEXT NOT NULL,          -- JSON
    typical_blast_radius TEXT NOT NULL,
    base_likelihood REAL NOT NULL,
    precondition_multipliers TEXT NOT NULL,  -- JSON
    observed_frequency REAL DEFAULT 0.0,
    last_observed TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Risk score results (append-only log of evaluations)
  CREATE TABLE IF NOT EXISTS risk_scores (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    session_risk_level REAL NOT NULL,
    risk_trend TEXT NOT NULL,
    confidence_value REAL NOT NULL,
    confidence_basis TEXT NOT NULL,          -- 'default_priors' | 'calibrated'
    confidence_sample_size INTEGER NOT NULL,
    active_threats TEXT NOT NULL,            -- JSON
    active_profiles TEXT NOT NULL,           -- JSON
    compound_risks TEXT NOT NULL,            -- JSON
    algorithms_run TEXT NOT NULL,            -- JSON
    total_execution_time_ms INTEGER NOT NULL
  );

  -- Pattern statistics (aggregated outcomes for calibration)
  CREATE TABLE IF NOT EXISTS pattern_statistics (
    pattern_id TEXT NOT NULL,
    period TEXT NOT NULL,                     -- 'daily' | 'weekly' | 'monthly'
    period_start TEXT NOT NULL,
    occurrences INTEGER NOT NULL DEFAULT 0,
    true_positives INTEGER NOT NULL DEFAULT 0,
    false_positives INTEGER NOT NULL DEFAULT 0,
    ignored INTEGER NOT NULL DEFAULT 0,
    mean_severity REAL,
    PRIMARY KEY (pattern_id, period, period_start)
  );

  CREATE INDEX IF NOT EXISTS idx_risk_scores_session ON risk_scores(session_id);
  CREATE INDEX IF NOT EXISTS idx_risk_scores_timestamp ON risk_scores(timestamp);
  CREATE INDEX IF NOT EXISTS idx_pattern_stats_pattern ON pattern_statistics(pattern_id);
  CREATE INDEX IF NOT EXISTS idx_pattern_stats_period ON pattern_statistics(period_start);
`;
