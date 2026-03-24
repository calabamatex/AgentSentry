/**
 * Tests for context-estimation primitive.
 */

import { describe, it, expect } from 'vitest';
import { estimateContext } from '../../src/primitives/context-estimation';

describe('estimateContext', () => {
  it('should return continue for low usage', () => {
    const result = estimateContext(5);

    expect(result.recommendation).toBe('continue');
    expect(result.estimatedTokens).toBe(20_000);
    expect(result.percentUsed).toBe(10);
    expect(result.messageCount).toBe(5);
  });

  it('should return caution at 60-80% usage', () => {
    const result = estimateContext(30);

    expect(result.recommendation).toBe('caution');
    expect(result.percentUsed).toBe(60);
  });

  it('should return refresh above 80% usage', () => {
    const result = estimateContext(42);

    expect(result.recommendation).toBe('refresh');
    expect(result.percentUsed).toBeGreaterThan(80);
  });

  it('should use custom maxTokens', () => {
    const result = estimateContext(10, 50_000);

    expect(result.recommendation).toBe('caution');
    expect(result.percentUsed).toBe(80);
  });

  it('should cap percentUsed at 100', () => {
    const result = estimateContext(100);

    expect(result.percentUsed).toBeLessThanOrEqual(100);
  });

  it('should handle zero messages', () => {
    const result = estimateContext(0);

    expect(result.recommendation).toBe('continue');
    expect(result.estimatedTokens).toBe(0);
    expect(result.percentUsed).toBe(0);
  });

  it('should include remaining messages in details', () => {
    const result = estimateContext(10);

    expect(result.details).toContain('messages remaining');
  });

  it('should use 200000 as default maxTokens', () => {
    const result = estimateContext(25);
    expect(result.percentUsed).toBe(50);
    expect(result.recommendation).toBe('continue');
  });

  it('should return continue at exactly 59.9%', () => {
    const result = estimateContext(29);

    expect(result.recommendation).toBe('continue');
  });

  it('should return caution at exactly 80%', () => {
    const result = estimateContext(40);

    expect(result.recommendation).toBe('caution');
  });
});
