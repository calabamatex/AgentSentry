/**
 * engine.ts — RiskScoringEngine: orchestrates topology + deterministic scorer.
 *
 * Stateless-friendly: the MCP tool rebuilds an engine per call from the
 * session's stored events plus any live signals the caller supplies. Scores are
 * confidence-gated (default_priors until calibration data exists).
 *
 * The Bayesian layer (Phase D) and the pattern-library/rule-based severity layer
 * plug in here later; today active_threats is empty and severity is signal-derived.
 */

import type { OpsEvent } from '../memory/schema';
import { SessionTopology, type Clock } from './knowledge/session-topology';
import { MisbehaviorProfileStore } from './knowledge/misbehavior-profiles';
import { DeterministicScorer } from './scoring/deterministic';
import type { CorrelationSignals } from './correlation/correlator';
import type { Prediction } from './calibration/metrics';
import type { RiskScore, RiskScoringConfig } from './types';

/** Externally-known live signals an agent/host can pass at evaluation time. */
export interface LiveSignals {
  context_utilization?: number;
  uncommitted_files?: number;
  uncommitted_diff_size?: number;
  minutes_since_commit?: number;
}

const MAX_TREND_HISTORY = 5;

export class RiskScoringEngine {
  private topology: SessionTopology;
  private readonly scorer = new DeterministicScorer();
  private readonly profiles = new MisbehaviorProfileStore();
  private recentLevels: number[] = [];

  constructor(
    private readonly config: RiskScoringConfig,
    sessionId: string,
    clock: Clock = () => Date.now(),
  ) {
    this.topology = new SessionTopology(sessionId, clock);
  }

  /** Rebuild topology from a session's stored events (oldest → newest). */
  loadFromEvents(events: OpsEvent[]): void {
    for (const e of events) this.applyEvent(e);
  }

  /** Apply one captured event to the topology (heuristic mapping). */
  applyEvent(event: OpsEvent): void {
    for (const f of event.affected_files ?? []) this.topology.recordFileTouch(f, true);

    const failure =
      event.event_type === 'violation' ||
      event.event_type === 'incident' ||
      event.severity === 'critical';
    this.topology.recordToolCall(!failure);

    if (isSecretSignal(event)) {
      const files = event.affected_files?.length ? event.affected_files : ['<unknown>'];
      for (const f of files) this.topology.recordRiskDetection(f, 'secret_leak');
    }
  }

  /** Apply externally-known live signals (all optional). */
  applySignals(signals: LiveSignals): void {
    if (signals.context_utilization !== undefined) {
      this.topology.updateContextUtilization(signals.context_utilization);
    }
    if (signals.uncommitted_files !== undefined || signals.uncommitted_diff_size !== undefined) {
      this.topology.updateUncommitted(signals.uncommitted_diff_size ?? 0, signals.uncommitted_files ?? 0);
    }
    if (signals.minutes_since_commit !== undefined) {
      this.topology.setCommitAgeMinutes(signals.minutes_since_commit);
    }
  }

  /** Score the current topology. */
  evaluate(timestamp: string, calibrationEvidence: Prediction[] = []): RiskScore {
    const state = this.topology.getState();

    // Active categories from files that have recorded risk detections.
    const activeCategories = new Set<string>();
    for (const f of Object.values(state.files_touched)) {
      for (const cat of f.active_risks) activeCategories.add(cat);
    }
    const signals: CorrelationSignals = { activeCategories, maxIndividualSeverity: 0 };

    const score = this.scorer.score(
      { state, signals, recentLevels: this.recentLevels, calibrationEvidence, timestamp },
      this.config,
    );

    // Behavioral failure-mode matching (confidence-labeled, default_priors).
    score.active_profiles = this.profiles.evaluate(state, this.config, calibrationEvidence);

    this.recentLevels.push(score.session_risk_level);
    if (this.recentLevels.length > MAX_TREND_HISTORY) this.recentLevels.shift();

    return score;
  }

  getState() {
    return this.topology.getState();
  }
}

function isSecretSignal(event: OpsEvent): boolean {
  if (event.tags?.some((t) => /secret|credential|api[_-]?key|token/i.test(t))) return true;
  if (event.skill === 'proactive_safety' && /secret|credential|key|token/i.test(event.title)) return true;
  return false;
}
