/**
 * Authority enforcement engine.
 *
 * Evaluates actions against an AuthorityPolicy in strict priority order:
 * cannot_execute > must_escalate > can_execute > default.
 *
 * The engine does NOT consult the enablement system — that is the caller's
 * responsibility. This module is pure policy evaluation.
 */

import { Logger } from '../observability/logger';
import type {
  AuthorityPolicy,
  PolicyRule,
  PolicyCondition,
  ActionContext,
  EnforcementResult,
  EnforcementAction,
} from './types';

const logger = new Logger({ module: 'enforcement' });

/**
 * Evaluate an action against authority policy.
 *
 * Returns the enforcement result with the matched rule and tier.
 * Evaluation stops at the first matching tier (highest priority wins).
 */
export function evaluateAuthority(
  context: ActionContext,
  policy: AuthorityPolicy,
): EnforcementResult {
  // Tier 1: cannot_execute (DENY)
  for (const rule of policy.cannot_execute) {
    if (matchesRule(context, rule)) {
      logger.warn('Action DENIED by authority policy', {
        action: context.action,
        rule: rule.name,
        reason: rule.reason,
      });
      return {
        action: 'deny',
        matched_rule: rule.name,
        tier: 'cannot_execute',
        reason: rule.reason,
        context,
      };
    }
  }

  // Tier 2: must_escalate (ESCALATE)
  for (const rule of policy.must_escalate) {
    if (matchesRule(context, rule)) {
      logger.info('Action ESCALATED by authority policy', {
        action: context.action,
        rule: rule.name,
        reason: rule.reason,
      });
      return {
        action: 'escalate',
        matched_rule: rule.name,
        tier: 'must_escalate',
        reason: rule.reason,
        context,
      };
    }
  }

  // Tier 3: can_execute (ALLOW)
  for (const rule of policy.can_execute) {
    if (matchesRule(context, rule)) {
      logger.debug('Action ALLOWED by authority policy', {
        action: context.action,
        rule: rule.name,
      });
      return {
        action: 'allow',
        matched_rule: rule.name,
        tier: 'can_execute',
        reason: rule.reason,
        context,
      };
    }
  }

  // Tier 4: default
  logger.debug('Action fell through to default', {
    action: context.action,
    defaultAction: policy.default_action,
  });
  return {
    action: policy.default_action,
    matched_rule: null,
    tier: 'default',
    reason: `No matching rule — default action: ${policy.default_action}`,
    context,
  };
}

function matchesRule(context: ActionContext, rule: PolicyRule): boolean {
  // Check action pattern
  let actionMatch: boolean;
  if (rule.is_regex) {
    try {
      actionMatch = new RegExp(rule.pattern, 'i').test(context.action);
    } catch {
      // Invalid regex — treat as no match (logged during validation)
      return false;
    }
  } else {
    actionMatch = context.action.toLowerCase().includes(rule.pattern.toLowerCase());
  }

  if (!actionMatch) return false;

  // Check conditions (all must match — AND logic)
  if (rule.conditions && rule.conditions.length > 0) {
    return rule.conditions.every((cond) => matchesCondition(context, cond));
  }

  return true;
}

function matchesCondition(
  context: ActionContext,
  condition: PolicyCondition,
): boolean {
  // Resolve the field value from context
  let fieldValue: string | undefined;
  switch (condition.field) {
    case 'action':
      fieldValue = context.action;
      break;
    case 'target':
      fieldValue = context.target;
      break;
    case 'agent_id':
      fieldValue = context.agent_id;
      break;
    default:
      fieldValue = context.metadata?.[condition.field] as string | undefined;
  }

  if (fieldValue === undefined || typeof fieldValue !== 'string') return false;

  switch (condition.operator) {
    case 'contains':
      return fieldValue.toLowerCase().includes(condition.value.toLowerCase());
    case 'equals':
      return fieldValue.toLowerCase() === condition.value.toLowerCase();
    case 'not_equals':
      return fieldValue.toLowerCase() !== condition.value.toLowerCase();
    case 'matches':
      try {
        return new RegExp(condition.value, 'i').test(fieldValue);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * Validate an AuthorityPolicy for correctness.
 * Returns a list of validation errors (empty = valid).
 */
export function validatePolicy(policy: AuthorityPolicy): string[] {
  const errors: string[] = [];

  const validActions = new Set<string>(['allow', 'deny', 'escalate', 'warn']);
  if (!validActions.has(policy.default_action)) {
    errors.push(`Invalid default_action: "${policy.default_action}"`);
  }

  for (const tier of ['cannot_execute', 'must_escalate', 'can_execute'] as const) {
    const rules = policy[tier];
    if (!Array.isArray(rules)) {
      errors.push(`${tier} must be an array`);
      continue;
    }
    for (const rule of rules) {
      if (!rule.name) errors.push(`${tier}: rule missing "name"`);
      if (!rule.pattern) errors.push(`${tier}: rule "${rule.name}" missing "pattern"`);
      if (!rule.reason) errors.push(`${tier}: rule "${rule.name}" missing "reason"`);
      if (rule.is_regex) {
        try {
          new RegExp(rule.pattern);
        } catch {
          errors.push(`${tier}: rule "${rule.name}" has invalid regex: ${rule.pattern}`);
        }
      }
      if (rule.conditions) {
        const validOps = new Set(['contains', 'equals', 'matches', 'not_equals']);
        for (const cond of rule.conditions) {
          if (!cond.field) errors.push(`${tier}: rule "${rule.name}" condition missing "field"`);
          if (!validOps.has(cond.operator)) {
            errors.push(`${tier}: rule "${rule.name}" condition has invalid operator: "${cond.operator}"`);
          }
          if (cond.operator === 'matches') {
            try {
              new RegExp(cond.value);
            } catch {
              errors.push(`${tier}: rule "${rule.name}" condition has invalid regex: ${cond.value}`);
            }
          }
        }
      }
    }
  }

  return errors;
}
