import { describe, it, expect } from 'vitest';
import { evaluateAuthority, validatePolicy } from '../../src/enforcement/engine';
import type { AuthorityPolicy, ActionContext } from '../../src/enforcement/types';

function makePolicy(overrides: Partial<AuthorityPolicy> = {}): AuthorityPolicy {
  return {
    cannot_execute: [],
    must_escalate: [],
    can_execute: [],
    default_action: 'allow',
    ...overrides,
  };
}

function makeContext(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    action: 'test_action',
    ...overrides,
  };
}

describe('evaluateAuthority', () => {
  // --- Tier matching ---

  it('denies when action matches cannot_execute', () => {
    const policy = makePolicy({
      cannot_execute: [
        { name: 'block-delete', pattern: 'delete', reason: 'Deletion forbidden' },
      ],
    });
    const result = evaluateAuthority(makeContext({ action: 'delete_file' }), policy);
    expect(result.action).toBe('deny');
    expect(result.tier).toBe('cannot_execute');
    expect(result.matched_rule).toBe('block-delete');
    expect(result.reason).toBe('Deletion forbidden');
  });

  it('escalates when action matches must_escalate', () => {
    const policy = makePolicy({
      must_escalate: [
        { name: 'escalate-deploy', pattern: 'deploy', reason: 'Needs approval' },
      ],
    });
    const result = evaluateAuthority(makeContext({ action: 'deploy_prod' }), policy);
    expect(result.action).toBe('escalate');
    expect(result.tier).toBe('must_escalate');
    expect(result.matched_rule).toBe('escalate-deploy');
  });

  it('allows when action matches can_execute', () => {
    const policy = makePolicy({
      can_execute: [
        { name: 'allow-read', pattern: 'read', reason: 'Read is safe' },
      ],
    });
    const result = evaluateAuthority(makeContext({ action: 'read_file' }), policy);
    expect(result.action).toBe('allow');
    expect(result.tier).toBe('can_execute');
    expect(result.matched_rule).toBe('allow-read');
  });

  it('uses default action when no rules match', () => {
    const policy = makePolicy({ default_action: 'deny' });
    const result = evaluateAuthority(makeContext({ action: 'unknown_action' }), policy);
    expect(result.action).toBe('deny');
    expect(result.tier).toBe('default');
    expect(result.matched_rule).toBeNull();
  });

  it('uses default allow when no rules match', () => {
    const policy = makePolicy({ default_action: 'allow' });
    const result = evaluateAuthority(makeContext({ action: 'something' }), policy);
    expect(result.action).toBe('allow');
    expect(result.tier).toBe('default');
  });

  // --- Priority ordering ---

  it('deny takes priority over escalate', () => {
    const policy = makePolicy({
      cannot_execute: [
        { name: 'block-all', pattern: 'deploy', reason: 'Blocked' },
      ],
      must_escalate: [
        { name: 'escalate-deploy', pattern: 'deploy', reason: 'Needs review' },
      ],
    });
    const result = evaluateAuthority(makeContext({ action: 'deploy' }), policy);
    expect(result.action).toBe('deny');
    expect(result.tier).toBe('cannot_execute');
  });

  it('deny takes priority over allow', () => {
    const policy = makePolicy({
      cannot_execute: [
        { name: 'block-write', pattern: 'write', reason: 'No writes' },
      ],
      can_execute: [
        { name: 'allow-write', pattern: 'write', reason: 'Writes OK' },
      ],
    });
    const result = evaluateAuthority(makeContext({ action: 'write_file' }), policy);
    expect(result.action).toBe('deny');
  });

  it('escalate takes priority over allow', () => {
    const policy = makePolicy({
      must_escalate: [
        { name: 'escalate-exec', pattern: 'execute', reason: 'Review needed' },
      ],
      can_execute: [
        { name: 'allow-exec', pattern: 'execute', reason: 'OK' },
      ],
    });
    const result = evaluateAuthority(makeContext({ action: 'execute_cmd' }), policy);
    expect(result.action).toBe('escalate');
  });

  // --- Pattern matching ---

  it('matches regex patterns', () => {
    const policy = makePolicy({
      cannot_execute: [
        { name: 'block-rm', pattern: '^rm\\s+-rf', is_regex: true, reason: 'Dangerous' },
      ],
    });
    const result = evaluateAuthority(makeContext({ action: 'rm -rf /' }), policy);
    expect(result.action).toBe('deny');
  });

  it('matches case-insensitive substring', () => {
    const policy = makePolicy({
      cannot_execute: [
        { name: 'block-delete', pattern: 'DELETE', reason: 'No deletes' },
      ],
    });
    const result = evaluateAuthority(makeContext({ action: 'delete_file' }), policy);
    expect(result.action).toBe('deny');
  });

  it('does not match when pattern is absent', () => {
    const policy = makePolicy({
      cannot_execute: [
        { name: 'block-drop', pattern: 'drop_table', reason: 'No drops' },
      ],
    });
    const result = evaluateAuthority(makeContext({ action: 'read_table' }), policy);
    expect(result.action).toBe('allow'); // falls to default
    expect(result.tier).toBe('default');
  });

  // --- Conditions ---

  it('matches condition with contains operator', () => {
    const policy = makePolicy({
      must_escalate: [{
        name: 'escalate-prod',
        pattern: 'deploy',
        conditions: [{ field: 'target', operator: 'contains', value: 'production' }],
        reason: 'Prod deploy needs approval',
      }],
    });
    const result = evaluateAuthority(
      makeContext({ action: 'deploy', target: 'production-east' }),
      policy,
    );
    expect(result.action).toBe('escalate');
  });

  it('condition contains does not match when value absent', () => {
    const policy = makePolicy({
      must_escalate: [{
        name: 'escalate-prod',
        pattern: 'deploy',
        conditions: [{ field: 'target', operator: 'contains', value: 'production' }],
        reason: 'Prod deploy needs approval',
      }],
    });
    const result = evaluateAuthority(
      makeContext({ action: 'deploy', target: 'staging' }),
      policy,
    );
    expect(result.action).toBe('allow'); // falls to default
  });

  it('matches condition with equals operator', () => {
    const policy = makePolicy({
      cannot_execute: [{
        name: 'block-admin',
        pattern: 'delete',
        conditions: [{ field: 'agent_id', operator: 'equals', value: 'untrusted-agent' }],
        reason: 'Untrusted agents cannot delete',
      }],
    });
    const result = evaluateAuthority(
      makeContext({ action: 'delete_resource', agent_id: 'untrusted-agent' }),
      policy,
    );
    expect(result.action).toBe('deny');
  });

  it('matches condition with not_equals operator', () => {
    const policy = makePolicy({
      must_escalate: [{
        name: 'escalate-non-admin',
        pattern: 'admin',
        conditions: [{ field: 'agent_id', operator: 'not_equals', value: 'admin-agent' }],
        reason: 'Non-admin agents need escalation',
      }],
    });
    const result = evaluateAuthority(
      makeContext({ action: 'admin_action', agent_id: 'regular-agent' }),
      policy,
    );
    expect(result.action).toBe('escalate');
  });

  it('matches condition with matches (regex) operator', () => {
    const policy = makePolicy({
      cannot_execute: [{
        name: 'block-sensitive-files',
        pattern: 'write',
        conditions: [{ field: 'target', operator: 'matches', value: '\\.(env|key|pem)$' }],
        reason: 'Cannot write sensitive files',
      }],
    });
    const result = evaluateAuthority(
      makeContext({ action: 'write_file', target: 'config.env' }),
      policy,
    );
    expect(result.action).toBe('deny');
  });

  it('all conditions must match (AND logic)', () => {
    const policy = makePolicy({
      cannot_execute: [{
        name: 'block-prod-delete',
        pattern: 'delete',
        conditions: [
          { field: 'target', operator: 'contains', value: 'production' },
          { field: 'agent_id', operator: 'not_equals', value: 'admin' },
        ],
        reason: 'Only admin can delete in prod',
      }],
    });

    // Both conditions met → deny
    const result1 = evaluateAuthority(
      makeContext({ action: 'delete', target: 'production-db', agent_id: 'worker' }),
      policy,
    );
    expect(result1.action).toBe('deny');

    // Only first condition met → no match → default allow
    const result2 = evaluateAuthority(
      makeContext({ action: 'delete', target: 'production-db', agent_id: 'admin' }),
      policy,
    );
    expect(result2.action).toBe('allow');
    expect(result2.tier).toBe('default');
  });

  it('matches condition on metadata field', () => {
    const policy = makePolicy({
      must_escalate: [{
        name: 'escalate-high-severity',
        pattern: 'execute',
        conditions: [{ field: 'severity', operator: 'equals', value: 'critical' }],
        reason: 'Critical severity needs approval',
      }],
    });
    const result = evaluateAuthority(
      makeContext({
        action: 'execute_command',
        metadata: { severity: 'critical' },
      }),
      policy,
    );
    expect(result.action).toBe('escalate');
  });

  it('unknown metadata field returns no match', () => {
    const policy = makePolicy({
      cannot_execute: [{
        name: 'block-by-region',
        pattern: 'deploy',
        conditions: [{ field: 'region', operator: 'equals', value: 'us-east-1' }],
        reason: 'Region blocked',
      }],
    });
    // No metadata at all
    const result = evaluateAuthority(
      makeContext({ action: 'deploy' }),
      policy,
    );
    expect(result.action).toBe('allow'); // default
  });

  // --- Edge cases ---

  it('empty policy uses default action', () => {
    const policy = makePolicy({ default_action: 'warn' });
    const result = evaluateAuthority(makeContext({ action: 'anything' }), policy);
    expect(result.action).toBe('warn');
  });

  it('deny cannot be overridden by later allow rule', () => {
    const policy = makePolicy({
      cannot_execute: [
        { name: 'block-all-writes', pattern: 'write', reason: 'No writes' },
      ],
      can_execute: [
        { name: 'allow-all-writes', pattern: 'write', reason: 'Writes OK' },
      ],
    });
    const result = evaluateAuthority(makeContext({ action: 'write_file' }), policy);
    expect(result.action).toBe('deny');
    expect(result.tier).toBe('cannot_execute');
  });

  it('preserves full context in result', () => {
    const ctx = makeContext({
      action: 'test',
      target: '/path/to/file',
      agent_id: 'agent-1',
      metadata: { key: 'value' },
    });
    const result = evaluateAuthority(ctx, makePolicy());
    expect(result.context).toEqual(ctx);
  });
});

describe('validatePolicy', () => {
  it('returns no errors for valid policy', () => {
    const policy = makePolicy({
      cannot_execute: [
        { name: 'r1', pattern: 'delete', reason: 'No deletes' },
      ],
      can_execute: [
        { name: 'r2', pattern: 'read', reason: 'Reads OK' },
      ],
    });
    expect(validatePolicy(policy)).toEqual([]);
  });

  it('detects invalid default_action', () => {
    const policy = makePolicy({ default_action: 'invalid' as any });
    const errors = validatePolicy(policy);
    expect(errors).toContainEqual(expect.stringContaining('Invalid default_action'));
  });

  it('detects missing rule name', () => {
    const policy = makePolicy({
      cannot_execute: [
        { name: '', pattern: 'test', reason: 'reason' },
      ],
    });
    const errors = validatePolicy(policy);
    expect(errors).toContainEqual(expect.stringContaining('missing "name"'));
  });

  it('detects missing rule pattern', () => {
    const policy = makePolicy({
      cannot_execute: [
        { name: 'rule1', pattern: '', reason: 'reason' },
      ],
    });
    const errors = validatePolicy(policy);
    expect(errors).toContainEqual(expect.stringContaining('missing "pattern"'));
  });

  it('detects invalid regex pattern', () => {
    const policy = makePolicy({
      cannot_execute: [
        { name: 'bad-regex', pattern: '([invalid', is_regex: true, reason: 'reason' },
      ],
    });
    const errors = validatePolicy(policy);
    expect(errors).toContainEqual(expect.stringContaining('invalid regex'));
  });

  it('detects missing rule reason', () => {
    const policy = makePolicy({
      cannot_execute: [
        { name: 'rule1', pattern: 'test', reason: '' },
      ],
    });
    const errors = validatePolicy(policy);
    expect(errors).toContainEqual(expect.stringContaining('missing "reason"'));
  });
});
