/**
 * correlator.ts — Compound-risk correlation.
 *
 * The honest, explainable centerpiece: deterministic boolean conditions over
 * session state that capture "the whole is riskier than the parts." Each rule
 * is fully transparent — no probabilities, no learned weights — and produces a
 * human-readable explanation. This is where most of the real v1 value lives.
 */

import type { CompoundRisk, SessionTopologyState } from '../types';

/**
 * Signals derived from the rule-based layer that the correlator also consults.
 * Kept minimal and explicit.
 */
export interface CorrelationSignals {
  /** Risk categories currently detected as active in the session. */
  activeCategories: Set<string>;
  /** Max individual severity from the rule-based layer (0..1). */
  maxIndividualSeverity: number;
}

interface CompoundRuleDef {
  id: string;
  /** Boost added to the max individual severity when the rule fires. */
  boost: number;
  /** Plain-language description used in the explanation. */
  describe: (state: SessionTopologyState) => string;
  /** Deterministic predicate over session state + signals. */
  matches: (state: SessionTopologyState, signals: CorrelationSignals) => string[] | null;
}

/**
 * The five compound-risk rules. Each `matches` returns the list of contributing
 * signal descriptions when it fires, or null when it does not.
 */
export const COMPOUND_RULES: CompoundRuleDef[] = [
  {
    id: 'blind_bulldozing',
    boost: 0.25,
    describe: () =>
      'Blind Bulldozing: high context utilization + large uncommitted diff + extended time without commit',
    matches: (s) => {
      if (
        s.context_utilization > 0.75 &&
        s.uncommitted_file_count > 10 &&
        s.minutes_since_last_commit > 45
      ) {
        return [
          `context_utilization ${s.context_utilization.toFixed(2)} > 0.75`,
          `uncommitted_files ${s.uncommitted_file_count} > 10`,
          `minutes_since_commit ${fmt(s.minutes_since_last_commit)} > 45`,
        ];
      }
      return null;
    },
  },
  {
    id: 'history_repeating',
    boost: 0.2,
    describe: () =>
      'History Repeating: working in a module with prior incidents while errors are accumulating',
    matches: (s) => {
      if (s.module_has_incident_history && s.error_rate > 0.25) {
        return [
          'module_has_incident_history',
          `error_rate ${s.error_rate.toFixed(2)} > 0.25`,
        ];
      }
      return null;
    },
  },
  {
    id: 'leak_under_pressure',
    boost: 0.15,
    describe: () =>
      'Leak Under Pressure: a secret was detected while context utilization is high (rushed review risk)',
    matches: (s, sig) => {
      if (sig.activeCategories.has('secret_leak') && s.context_utilization > 0.75) {
        return [
          'secret_leak detected',
          `context_utilization ${s.context_utilization.toFixed(2)} > 0.75`,
        ];
      }
      return null;
    },
  },
  {
    id: 'scope_explosion',
    boost: 0.2,
    describe: () =>
      'Scope Explosion: changes spreading across many directories with a growing uncommitted diff',
    matches: (s) => {
      if (s.unique_directories.length >= 3 && s.uncommitted_file_count > 5) {
        return [
          `directories ${s.unique_directories.length} >= 3`,
          `uncommitted_files ${s.uncommitted_file_count} > 5`,
        ];
      }
      return null;
    },
  },
  {
    id: 'cost_spiral',
    boost: 0.3,
    describe: () =>
      'Cost Spiral: error rate is high and the budget is exhausted — burning spend on a failing approach',
    matches: (s) => {
      if (s.error_rate > 0.3 && s.estimated_session_cost > 0 && s.budget_remaining <= 0) {
        return [
          `error_rate ${s.error_rate.toFixed(2)} > 0.3`,
          'budget_remaining <= 0',
        ];
      }
      return null;
    },
  },
];

export class RiskCorrelator {
  constructor(private readonly rules: CompoundRuleDef[] = COMPOUND_RULES) {}

  /**
   * Evaluate all compound rules against session state.
   * `compound_severity` is the max individual severity plus the rule's boost,
   * clamped to [0,1]; `exceeds_individual_max_by` makes the boost explicit.
   */
  evaluate(state: SessionTopologyState, signals: CorrelationSignals): CompoundRisk[] {
    const out: CompoundRisk[] = [];
    for (const rule of this.rules) {
      const contributing = rule.matches(state, signals);
      if (!contributing) continue;
      const compound = clamp01(signals.maxIndividualSeverity + rule.boost);
      out.push({
        id: rule.id,
        description: rule.describe(state),
        individual_signals: contributing,
        compound_severity: compound,
        exceeds_individual_max_by: round3(compound - clamp01(signals.maxIndividualSeverity)),
      });
    }
    return out;
  }
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
function fmt(x: number): string {
  return Number.isFinite(x) ? x.toFixed(0) : '∞';
}
