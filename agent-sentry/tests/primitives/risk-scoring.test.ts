/**
 * Tests for risk-scoring primitive.
 */

import { describe, it, expect } from 'vitest';
import { assessRisk } from '../../src/primitives/risk-scoring';

describe('assessRisk', () => {
  it('should return LOW for minimal changes', () => {
    const result = assessRisk({
      files: ['file1.ts'],
      hasDatabaseChanges: false,
      touchesSharedCode: false,
      isMainBranch: false,
    });

    expect(result.level).toBe('LOW');
    expect(result.score).toBeLessThanOrEqual(3);
    expect(result.factors).toHaveLength(4);
  });

  it('should return CRITICAL when on main branch with db changes', () => {
    const result = assessRisk({
      files: ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts', 'file5.ts'],
      hasDatabaseChanges: true,
      touchesSharedCode: true,
      isMainBranch: true,
    });

    expect(result.level).toBe('CRITICAL');
    expect(result.score).toBeGreaterThanOrEqual(12);
  });

  it('should return MEDIUM for moderate changes', () => {
    const result = assessRisk({
      files: ['file1.ts', 'file2.ts', 'file3.ts'],
      hasDatabaseChanges: true,
      touchesSharedCode: false,
      isMainBranch: false,
    });

    expect(result.level).toBe('MEDIUM');
    expect(result.score).toBeGreaterThanOrEqual(4);
    expect(result.score).toBeLessThanOrEqual(7);
  });

  it('should weigh main_branch heavily (weight 5)', () => {
    const result = assessRisk({
      files: [],
      hasDatabaseChanges: false,
      touchesSharedCode: false,
      isMainBranch: true,
    });

    const mainFactor = result.factors.find((f) => f.name === 'main_branch');
    expect(mainFactor?.contribution).toBe(5);
    expect(mainFactor?.weight).toBe(5);
  });

  it('should weigh db_changes at weight 3', () => {
    const result = assessRisk({
      files: [],
      hasDatabaseChanges: true,
      touchesSharedCode: false,
      isMainBranch: false,
    });

    const dbFactor = result.factors.find((f) => f.name === 'db_changes');
    expect(dbFactor?.contribution).toBe(3);
    expect(dbFactor?.weight).toBe(3);
  });

  it('should cap file count at 5', () => {
    const result = assessRisk({
      files: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
      hasDatabaseChanges: false,
      touchesSharedCode: false,
      isMainBranch: false,
    });

    const fileFactor = result.factors.find((f) => f.name === 'file_count');
    expect(fileFactor?.value).toBe(5);
  });

  it('should return 0 score for empty params', () => {
    const result = assessRisk({
      files: [],
      hasDatabaseChanges: false,
      touchesSharedCode: false,
      isMainBranch: false,
    });

    expect(result.score).toBe(0);
    expect(result.level).toBe('LOW');
  });

  it('should cap total score at 15', () => {
    const result = assessRisk({
      files: ['a', 'b', 'c', 'd', 'e'],
      hasDatabaseChanges: true,
      touchesSharedCode: true,
      isMainBranch: true,
    });

    expect(result.score).toBeLessThanOrEqual(15);
  });

  it('should provide appropriate recommendation for each level', () => {
    const low = assessRisk({ files: [], hasDatabaseChanges: false, touchesSharedCode: false, isMainBranch: false });
    expect(low.recommendation).toContain('standard');

    const high = assessRisk({ files: ['a', 'b', 'c', 'd', 'e'], hasDatabaseChanges: true, touchesSharedCode: true, isMainBranch: true });
    expect(high.recommendation.toLowerCase()).toContain('safety branch');
  });

  it('should set level boundaries correctly', () => {
    const lowMax = assessRisk({ files: [], hasDatabaseChanges: true, touchesSharedCode: false, isMainBranch: false });
    expect(lowMax.score).toBe(3);
    expect(lowMax.level).toBe('LOW');

    const medium = assessRisk({ files: [], hasDatabaseChanges: false, touchesSharedCode: false, isMainBranch: true });
    expect(medium.score).toBe(5);
    expect(medium.level).toBe('MEDIUM');
  });
});
