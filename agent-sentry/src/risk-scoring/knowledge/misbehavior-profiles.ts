/**
 * misbehavior-profiles.ts — Behavioral failure-mode matching.
 *
 * Honest design: the VALUE is deterministic precondition matching (explainable —
 * "you matched X and Y"). The likelihood is a modest, bounded update over a
 * hand-authored prior — NOT a calibrated probability. Every output is therefore
 * confidence-labeled `default_priors` until the project has calibration data.
 */

import type {
  ActiveProfile,
  MisbehaviorProfile,
  RiskScoringConfig,
  SessionCondition,
  SessionTopologyState,
} from '../types';
import { DEFAULT_MISBEHAVIOR_PROFILES } from '../constants';
import { buildConfidence } from '../calibration/gate';
import type { Prediction } from '../calibration/metrics';

/** Likelihood at/above which a profile is reported as "active". */
const ACTIVE_THRESHOLD = 0.3;

export class MisbehaviorProfileStore {
  constructor(private readonly profiles: MisbehaviorProfile[] = DEFAULT_MISBEHAVIOR_PROFILES) {}

  getAll(): MisbehaviorProfile[] {
    return this.profiles;
  }

  /**
   * Evaluate all profiles against session state. Returns the elevated ones.
   * `calibrationEvidence` is empty until a project accumulates labeled outcomes,
   * so confidence basis is `default_priors`.
   */
  evaluate(
    state: SessionTopologyState,
    config: Pick<RiskScoringConfig, 'calibration'>,
    calibrationEvidence: Prediction[] = [],
  ): ActiveProfile[] {
    const out: ActiveProfile[] = [];
    for (const profile of this.profiles) {
      const matched: string[] = [];
      let matchedWeight = 0;
      let totalWeight = 0;
      for (const cond of profile.preconditions) {
        totalWeight += cond.weight;
        if (conditionMatches(cond, state)) {
          matched.push(describeCondition(cond));
          matchedWeight += cond.weight;
        }
      }
      const preconditionScore = totalWeight === 0 ? 0 : matchedWeight / totalWeight;

      // Bounded, monotonic update of the prior — reduces to the prior when no
      // preconditions match; never claims more than the evidence supports.
      const likelihood = clamp01(profile.base_likelihood + (1 - profile.base_likelihood) * preconditionScore);

      if (likelihood < ACTIVE_THRESHOLD) continue;

      out.push({
        profile_id: profile.id,
        name: profile.name,
        likelihood: round3(likelihood),
        confidence: buildConfidence(preconditionScore, calibrationEvidence, config),
        matched_preconditions: matched,
        recommended_action: profile.recommended_action,
      });
    }
    // Most-likely first.
    out.sort((a, b) => b.likelihood - a.likelihood);
    return out;
  }
}

function conditionMatches(cond: SessionCondition, s: SessionTopologyState): boolean {
  switch (cond.type) {
    case 'context_utilization_above':
      return s.context_utilization > cond.threshold;
    case 'time_since_commit_above':
      // A finite gap is a direct comparison. "Never committed" (Infinity) only
      // counts as a stale checkpoint when there is actual work in progress —
      // a brand-new empty session is not bulldozing.
      return Number.isFinite(s.minutes_since_last_commit)
        ? s.minutes_since_last_commit > cond.threshold
        : s.uncommitted_file_count > 0 || Object.keys(s.files_touched).length > 0;
    case 'files_touched_above':
      return Object.keys(s.files_touched).length > cond.threshold;
    case 'error_count_above':
      return s.tool_call_errors > cond.threshold;
    case 'session_duration_above':
      return s.session_duration_minutes > cond.threshold;
    case 'module_has_history':
      return s.module_has_incident_history;
    default:
      return false;
  }
}

function describeCondition(cond: SessionCondition): string {
  if (cond.type === 'module_has_history') return 'module_has_incident_history';
  return `${cond.type.replace(/_above$/, '')} > ${cond.threshold}`;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
