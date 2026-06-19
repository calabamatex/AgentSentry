/**
 * pattern-library.ts — Rule-based pattern detection over session topology.
 *
 * Populates `RiskScore.active_threats`. v1 evaluates the catalog's
 * topology-derivable patterns (thresholds) plus secret detections that arrived
 * as recorded events. Severity is context-adjusted (e.g. a secret in a test
 * fixture is downgraded). Every threat is confidence-labeled `default_priors`
 * until calibration data exists.
 */

import type {
  ActiveThreat,
  RiskPattern,
  RiskScoringConfig,
  SessionTopologyState,
} from '../types';
import { DEFAULT_RISK_PATTERNS } from '../constants';
import { buildConfidence } from '../calibration/gate';
import type { Prediction } from '../calibration/metrics';

export interface ThreatDetection {
  threats: ActiveThreat[];
  /** Max individual (context-adjusted) severity — feeds the correlator. */
  maxSeverity: number;
}

const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[tj]sx?$/i;

export class PatternLibrary {
  constructor(private readonly patterns: RiskPattern[] = DEFAULT_RISK_PATTERNS) {}

  getAll(): RiskPattern[] {
    return this.patterns;
  }

  get(id: string): RiskPattern | undefined {
    return this.patterns.find((p) => p.id === id);
  }

  /**
   * Detect active threats from current session state.
   * `calibrationEvidence` is empty until labeled outcomes exist → default_priors.
   */
  detect(
    state: SessionTopologyState,
    config: Pick<RiskScoringConfig, 'calibration'>,
    calibrationEvidence: Prediction[] = [],
  ): ThreatDetection {
    const threats: ActiveThreat[] = [];

    for (const pattern of this.patterns) {
      const hit = evaluatePattern(pattern, state);
      if (!hit) continue;

      threats.push({
        pattern_id: pattern.id,
        name: pattern.name,
        severity: round3(hit.severity),
        confidence: buildConfidence(1 - pattern.false_positive_rate, calibrationEvidence, config),
        contributing_algorithms: ['rule_based'],
      });
    }

    threats.sort((a, b) => b.severity - a.severity);
    const maxSeverity = threats.reduce((m, t) => Math.max(m, t.severity), 0);
    return { threats, maxSeverity };
  }
}

/** Returns the context-adjusted severity if the pattern is active, else null. */
function evaluatePattern(
  pattern: RiskPattern,
  state: SessionTopologyState,
): { severity: number } | null {
  const cfg = pattern.detection_config;

  switch (pattern.category) {
    case 'secret_leak': {
      const filesWithSecret = Object.values(state.files_touched).filter((f) =>
        f.active_risks.includes('secret_leak'),
      );
      if (filesWithSecret.length === 0) return null;
      const allTestFiles = filesWithSecret.every((f) => TEST_FILE.test(f.path));
      return { severity: applyContextSeverity(pattern, allTestFiles ? 'test' : 'source') };
    }
    case 'context_degradation':
      return state.context_utilization > (cfg.threshold as number)
        ? { severity: pattern.base_severity }
        : null;
    case 'checkpoint_gap':
      return state.uncommitted_file_count > 0 &&
        Number.isFinite(state.minutes_since_last_commit) &&
        state.minutes_since_last_commit > (cfg.threshold as number)
        ? { severity: pattern.base_severity }
        : null;
    case 'oversized_change':
      return state.uncommitted_file_count > (cfg.threshold as number)
        ? { severity: pattern.base_severity }
        : null;
    case 'scope_violation': {
      const outOfScope = Object.values(state.files_touched).some((f) => !f.in_declared_scope);
      const manyDirs = state.unique_directories.length >= (cfg.threshold as number);
      return outOfScope || manyDirs ? { severity: pattern.base_severity } : null;
    }
    default:
      return null;
  }
}

/** Apply the matching context modifier's severity multiplier, clamped to [0,1]. */
function applyContextSeverity(pattern: RiskPattern, fileType: 'test' | 'source'): number {
  let severity = pattern.base_severity;
  for (const mod of pattern.context_modifiers) {
    if (mod.condition.file_type === fileType) severity *= mod.severity_multiplier;
  }
  return clamp01(severity);
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
