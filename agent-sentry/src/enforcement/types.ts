/**
 * Authority enforcement types.
 *
 * Four-tier evaluation model (priority order):
 * 1. cannot_execute — Forbidden actions → DENY
 * 2. must_escalate  — Actions requiring human review → ESCALATE
 * 3. can_execute    — Explicitly allowed → ALLOW
 * 4. default        — Unmatched actions → configurable (ALLOW or DENY)
 */

export type EnforcementAction = 'allow' | 'deny' | 'escalate' | 'warn';

export interface AuthorityPolicy {
  /** Actions that are always forbidden. */
  cannot_execute: PolicyRule[];
  /** Actions that require human/system approval before proceeding. */
  must_escalate: PolicyRule[];
  /** Actions that are explicitly permitted. */
  can_execute: PolicyRule[];
  /** Default action for unmatched requests. */
  default_action: EnforcementAction;
}

export interface PolicyRule {
  /** Human-readable name for the rule. */
  name: string;
  /** Pattern to match against action names. */
  pattern: string;
  /** Whether the pattern is a regex (default: false = case-insensitive substring match). */
  is_regex?: boolean;
  /** Optional conditions that must also be true (AND logic). */
  conditions?: PolicyCondition[];
  /** Reason displayed when the rule triggers. */
  reason: string;
}

export interface PolicyCondition {
  /** Field to check (e.g. 'action', 'target', 'agent_id', or a metadata key). */
  field: string;
  /** Comparison operator. */
  operator: 'contains' | 'equals' | 'matches' | 'not_equals';
  /** Value to compare against. */
  value: string;
}

export interface EnforcementResult {
  /** The action taken. */
  action: EnforcementAction;
  /** Which rule matched (null if default). */
  matched_rule: string | null;
  /** Which tier matched. */
  tier: 'cannot_execute' | 'must_escalate' | 'can_execute' | 'default';
  /** Human-readable reason. */
  reason: string;
  /** The action context that was evaluated. */
  context: ActionContext;
}

export interface ActionContext {
  /** The action being attempted (e.g. 'write_file', 'execute_command'). */
  action: string;
  /** Target of the action (e.g. file path, URL). */
  target?: string;
  /** The agent requesting the action. */
  agent_id?: string;
  /** Additional context fields for condition matching. */
  metadata?: Record<string, unknown>;
}
