/**
 * primitives/index.ts — Public API re-exporting all primitives.
 */

export {
  createCheckpoint,
  createSafetyBranch,
  getCurrentBranch,
} from './checkpoint-and-branch';
export type { CheckpointResult } from './checkpoint-and-branch';

export { validateRules } from './rules-validation';
export type { RuleViolation, ValidationResult } from './rules-validation';

export { assessRisk } from './risk-scoring';
export type { RiskFactor, RiskAssessment } from './risk-scoring';

export { estimateContext } from './context-estimation';
export type { ContextHealth } from './context-estimation';

export { updateScaffold } from './scaffold-update';
export type { ScaffoldFile, ScaffoldResult } from './scaffold-update';

export { scanForSecrets } from './secret-detection';
export type { SecretFinding } from './secret-detection';

export { captureEvent } from './event-capture';
export type { CaptureParams } from './event-capture';
