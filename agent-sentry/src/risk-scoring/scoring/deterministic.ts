/**
 * deterministic.ts — Deterministic, explainable composite risk score.
 *
 * No probabilities, no learned weights — a transparent weighted combination of
 * session signals plus compound-risk boosts. Every score carries a Confidence
 * built through the calibration gate; with no labeled outcomes yet, that basis
 * is always 'default_priors' (a heuristic hint), which is the honest answer.
 */

import type { RiskScore, RiskScoringConfig, SessionTopologyState } from '../types';
import { RiskCorrelator, type CorrelationSignals } from '../correlation/correlator';
import { buildConfidence } from '../calibration/gate';
import type { Prediction } from '../calibration/metrics';

export interface DeterministicScoreInput {
  state: SessionTopologyState;
  signals: CorrelationSignals;
  /** Composite levels from recent prior evaluations, for trend (newest last). */
  recentLevels?: number[];
  /** Labeled outcomes for this input class (empty until calibration data exists). */
  calibrationEvidence?: Prediction[];
  timestamp: string;
}

export class DeterministicScorer {
  constructor(private readonly correlator: RiskCorrelator = new RiskCorrelator()) {}

  score(input: DeterministicScoreInput, config: RiskScoringConfig): RiskScore {
    const start = performance.now();
    const { state, signals } = input;

    // --- transparent topology-derived base risk ---
    // Only count the commit gap as risk when there is uncommitted work.
    const commitGapFactor =
      state.uncommitted_file_count > 0 && Number.isFinite(state.minutes_since_last_commit)
        ? clamp01(state.minutes_since_last_commit / 60)
        : 0;
    const baseRisk = clamp01(
      0.4 * state.context_utilization + 0.3 * state.error_rate + 0.3 * commitGapFactor,
    );

    // --- compound risks (the explainable centerpiece) ---
    const compoundRisks = config.correlation.enabled
      ? this.correlator
          .evaluate(state, signals)
          .filter((c) => c.exceeds_individual_max_by >= config.correlation.compound_risk_threshold)
      : [];
    const maxCompound = compoundRisks.reduce((m, c) => Math.max(m, c.compound_severity), 0);

    const sessionRisk = clamp01(Math.max(baseRisk, signals.maxIndividualSeverity, maxCompound));

    // --- confidence (gated; default_priors until calibration data exists) ---
    // Raw trust scales with evidence quantity in the session.
    const rawTrust = clamp01(state.tool_calls_count / 10);
    const confidence = buildConfidence(rawTrust, input.calibrationEvidence ?? [], config);

    // --- trend from recent levels ---
    const risk_trend = computeTrend(input.recentLevels ?? [], sessionRisk);

    const explanation = buildExplanation(state, baseRisk, sessionRisk, compoundRisks, confidence.basis);

    return {
      session_risk_level: round3(sessionRisk),
      risk_trend,
      confidence,
      active_threats: [], // populated when the pattern-library layer lands
      active_profiles: [], // populated by the Bayesian layer (Phase D)
      compound_risks: compoundRisks,
      algorithms_run: ['deterministic', ...(config.correlation.enabled ? ['correlation'] : [])],
      algorithms_skipped: [],
      total_execution_time_ms: Math.round((performance.now() - start) * 1000) / 1000,
      evaluation_timestamp: input.timestamp,
      explanation,
    };
  }
}

function computeTrend(
  recent: number[],
  current: number,
): RiskScore['risk_trend'] {
  if (recent.length === 0) return 'stable';
  const series = [...recent, current];
  const deltas: number[] = [];
  for (let i = 1; i < series.length; i++) deltas.push(series[i] - series[i - 1]);
  const net = current - recent[0];
  const swings = deltas.filter((d) => Math.abs(d) > 0.1).length;
  if (swings >= 2 && hasSignChange(deltas)) return 'volatile';
  if (net > 0.1) return 'increasing';
  if (net < -0.1) return 'decreasing';
  return 'stable';
}

function hasSignChange(deltas: number[]): boolean {
  let sawPos = false;
  let sawNeg = false;
  for (const d of deltas) {
    if (d > 0.05) sawPos = true;
    if (d < -0.05) sawNeg = true;
  }
  return sawPos && sawNeg;
}

function buildExplanation(
  state: SessionTopologyState,
  baseRisk: number,
  sessionRisk: number,
  compounds: RiskScore['compound_risks'],
  basis: string,
): string {
  const parts: string[] = [
    `Risk ${sessionRisk.toFixed(2)} (confidence basis: ${basis}).`,
    `Base risk ${baseRisk.toFixed(2)} from context_util=${state.context_utilization.toFixed(2)}, ` +
      `error_rate=${state.error_rate.toFixed(2)}, commit_gap=${fmtMin(state.minutes_since_last_commit)}.`,
  ];
  if (compounds.length > 0) {
    parts.push('Compound risks: ' + compounds.map((c) => c.id).join(', ') + '.');
  }
  if (basis === 'default_priors') {
    parts.push('Heuristic estimate — not yet validated against outcomes for this project.');
  }
  return parts.join(' ');
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
function fmtMin(x: number): string {
  return Number.isFinite(x) ? `${x.toFixed(0)}min` : 'never';
}
