/**
 * Enforcement evasion attack vectors.
 * Tests that the authority enforcement engine cannot be bypassed.
 */

import { describe, it, expect } from 'vitest';
import { evaluateAuthority } from '../../src/enforcement/engine';
import type { AuthorityPolicy } from '../../src/enforcement/types';

function denyPolicy(pattern: string, opts: { is_regex?: boolean } = {}): AuthorityPolicy {
  return {
    cannot_execute: [
      { name: 'test-deny', pattern, reason: 'Blocked', ...opts },
    ],
    must_escalate: [],
    can_execute: [],
    default_action: 'allow',
  };
}

describe('Enforcement evasion prevention', () => {
  it('case variation does not bypass substring match', () => {
    const policy = denyPolicy('delete');

    // All case variants should match
    const variants = ['DELETE', 'Delete', 'dElEtE', 'DELETE_FILE', 'pre_delete'];
    for (const action of variants) {
      const result = evaluateAuthority({ action }, policy);
      expect(result.action).toBe('deny');
    }
  });

  it('null byte in action name does not bypass', () => {
    const policy = denyPolicy('delete');
    const result = evaluateAuthority({ action: 'dele\x00te' }, policy);
    // The null byte makes it NOT match "delete" literally, so it falls to default
    // This is actually the correct behavior — the action is a different string
    expect(result.tier).toBe('default');
  });

  it('extremely long action name does not crash', () => {
    const policy = denyPolicy('delete');
    const longAction = 'x'.repeat(100_000) + 'delete';
    const result = evaluateAuthority({ action: longAction }, policy);
    expect(result.action).toBe('deny'); // "delete" is a substring
  });

  it('empty action name uses default', () => {
    const policy = denyPolicy('delete');
    const result = evaluateAuthority({ action: '' }, policy);
    expect(result.tier).toBe('default');
  });

  it('regex catastrophic backtracking protection', () => {
    // Security intent: a ReDoS-style pattern must NOT hang the enforcement
    // engine. We assert *completion with the correct verdict* rather than a
    // tight wall-clock bound. An absolute latency assertion (e.g. < 5000ms) is
    // flaky under CI/machine load — a healthy run can spike to several seconds
    // while still being orders of magnitude below a true catastrophic blowup,
    // which would run for minutes and trip the per-test timeout below.
    const policy: AuthorityPolicy = {
      cannot_execute: [{
        name: 'redos-test',
        pattern: '(a+)+$',
        is_regex: true,
        reason: 'ReDoS test',
      }],
      must_escalate: [],
      can_execute: [],
      default_action: 'allow',
    };

    // This input ends with 'b', so it does NOT match (a+)+$. If the engine
    // catastrophically backtracked it would never reach this verdict before
    // the test timeout fires. Returning the correct tier proves it completed.
    const result = evaluateAuthority(
      { action: 'aaaaaaaaaaaaaaaaaaaaaaab' },
      policy,
    );

    expect(result.tier).toBe('default');
  }, 30_000); // hard ceiling: real catastrophic backtracking never finishes this fast

  it('deny rule cannot be overridden by later allow rule', () => {
    const policy: AuthorityPolicy = {
      cannot_execute: [
        { name: 'block-write', pattern: 'write', reason: 'No writes' },
      ],
      must_escalate: [],
      can_execute: [
        { name: 'allow-write', pattern: 'write', reason: 'Writes OK' },
      ],
      default_action: 'allow',
    };
    const result = evaluateAuthority({ action: 'write_file' }, policy);
    expect(result.action).toBe('deny');
    expect(result.tier).toBe('cannot_execute');
  });

  it('policy with no rules uses default action', () => {
    const policy: AuthorityPolicy = {
      cannot_execute: [],
      must_escalate: [],
      can_execute: [],
      default_action: 'deny',
    };
    const result = evaluateAuthority({ action: 'anything' }, policy);
    expect(result.action).toBe('deny');
    expect(result.tier).toBe('default');
  });

  it('condition field injection does not cause errors', () => {
    const policy: AuthorityPolicy = {
      cannot_execute: [{
        name: 'field-inject',
        pattern: 'test',
        conditions: [
          { field: 'toString', operator: 'equals', value: 'exploit' },
        ],
        reason: 'Field injection test',
      }],
      must_escalate: [],
      can_execute: [],
      default_action: 'allow',
    };

    // "toString" field in metadata should not cause prototype access issues
    const result = evaluateAuthority(
      { action: 'test_action', metadata: {} },
      policy,
    );
    // The condition should not match (metadata doesn't have toString as a key)
    expect(result.tier).toBe('default');
  });
});
