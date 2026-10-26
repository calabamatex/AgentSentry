/**
 * foundation.test.ts — Phase A.2: migration + type/schema scaffolding.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, LATEST_VERSION } from '../../src/memory/migrations/sqlite-migrations';
import {
  ConfidenceSchema,
  RiskScoringConfigSchema,
} from '../../src/risk-scoring/types';
import { DEFAULT_RISK_SCORING_CONFIG } from '../../src/risk-scoring';

describe('risk-scoring migration (v5)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  const tableNames = (): string[] =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (r) => r.name,
    );

  it('LATEST_VERSION is at least 5', () => {
    expect(LATEST_VERSION).toBeGreaterThanOrEqual(5);
  });

  it('creates all four risk-scoring tables', () => {
    runMigrations(db);
    const tables = tableNames();
    for (const t of ['risk_patterns', 'misbehavior_profiles', 'risk_scores', 'pattern_statistics']) {
      expect(tables).toContain(t);
    }
  });

  it('is additive — existing ops_events table is untouched', () => {
    runMigrations(db);
    expect(tableNames()).toContain('ops_events');
  });

  it('is idempotent — re-running migrations does not throw', () => {
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('risk_scores carries the confidence columns (no bare probabilities)', () => {
    runMigrations(db);
    const cols = (db.prepare("PRAGMA table_info('risk_scores')").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('confidence_value');
    expect(cols).toContain('confidence_basis');
    expect(cols).toContain('confidence_sample_size');
  });
});

describe('risk-scoring types & config', () => {
  it('ConfidenceSchema accepts a well-formed confidence', () => {
    expect(() =>
      ConfidenceSchema.parse({ value: 0.5, basis: 'default_priors', sample_size: 0 }),
    ).not.toThrow();
  });

  it('ConfidenceSchema rejects an unknown basis', () => {
    expect(() =>
      ConfidenceSchema.parse({ value: 0.5, basis: 'made_up', sample_size: 0 }),
    ).toThrow();
  });

  it('ConfidenceSchema rejects out-of-range value', () => {
    expect(() =>
      ConfidenceSchema.parse({ value: 1.5, basis: 'calibrated', sample_size: 10 }),
    ).toThrow();
  });

  it('default config is disabled and parses', () => {
    expect(DEFAULT_RISK_SCORING_CONFIG.enabled).toBe(false);
    expect(DEFAULT_RISK_SCORING_CONFIG.performance.max_evaluation_time_ms).toBe(100);
    expect(DEFAULT_RISK_SCORING_CONFIG.calibration.minimum_samples_for_calibration).toBe(20);
  });

  it('config schema applies defaults for a minimal object', () => {
    const cfg = RiskScoringConfigSchema.parse({ enabled: true });
    expect(cfg.enabled).toBe(true);
    expect(cfg.correlation.compound_risk_threshold).toBe(0.15);
  });

  it('config schema rejects an out-of-range threshold', () => {
    expect(() =>
      RiskScoringConfigSchema.parse({ correlation: { compound_risk_threshold: 2 } }),
    ).toThrow();
  });
});
