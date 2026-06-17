/**
 * Authority enforcement — [experimental].
 *
 * This module is defined and unit-tested but NOT yet wired into the CLI or MCP
 * decision path. The public API (evaluateAuthority / validatePolicy) may change
 * before it is integrated into runtime decision-making.
 */
export { evaluateAuthority, validatePolicy } from './engine';
export type {
  AuthorityPolicy,
  PolicyRule,
  PolicyCondition,
  ActionContext,
  EnforcementResult,
  EnforcementAction,
} from './types';
