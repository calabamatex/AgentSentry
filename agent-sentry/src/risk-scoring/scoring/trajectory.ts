/**
 * trajectory.ts — Trajectory / Monte-Carlo projection: INTENTIONALLY DEFERRED.
 *
 * The original design proposed a Monte-Carlo simulator that projects the session
 * forward and emits an "incident probability in the next N steps." We do NOT
 * ship that in v1, on purpose: forward simulation over un-calibrated transition
 * probabilities produces confident-looking numbers (e.g. "0.68 probability of
 * incident") that are not validated against any outcome. For a safety tool,
 * miscalibrated confidence is worse than no prediction.
 *
 * This module exists so the deferral is explicit in code (mirroring how
 * `enforcement` and `coordination` are labeled `[experimental]`), rather than a
 * silent omission. Trajectory projection will only ship once the calibration
 * harness (see ../calibration) demonstrates it is reliable.
 *
 * [experimental] — not available; do not use for decisions.
 */

export interface TrajectoryProjection {
  available: false;
  reason: string;
}

/**
 * Always reports "not available". Kept as a typed seam so callers get an honest,
 * explicit answer instead of a fabricated probability.
 */
export function projectTrajectory(): TrajectoryProjection {
  return {
    available: false,
    reason:
      'Trajectory projection (Monte Carlo) is experimental and disabled: it would ' +
      'project forward over un-calibrated transition probabilities and emit ' +
      'confident-but-unvalidated numbers. It will ship only after the calibration ' +
      'harness shows it is reliable.',
  };
}
