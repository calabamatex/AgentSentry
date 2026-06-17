/**
 * constants.ts — Default configuration for risk scoring.
 *
 * The pattern / misbehavior-profile catalogs (DEFAULT_RISK_PATTERNS,
 * DEFAULT_MISBEHAVIOR_PROFILES, COMPOUND_RISK_RULES) land in Phase C alongside
 * the knowledge stores that consume them. This file currently holds only the
 * config defaults, which the config loader (Phase A) needs now.
 */

import { RiskScoringConfigSchema, type RiskScoringConfig } from './types';

/** Canonical default config — risk scoring is OFF unless Level 6 is enabled. */
export const DEFAULT_RISK_SCORING_CONFIG: RiskScoringConfig = RiskScoringConfigSchema.parse({
  enabled: false,
});
