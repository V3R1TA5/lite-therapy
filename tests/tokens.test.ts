import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../src/core/tokens.js';

describe('estimateTokens', () => {
  it('counts empty text as zero', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('counts CJK characters as roughly one token each with a 10% margin', () => {
    expect(estimateTokens('你好')).toBe(3);
    expect(estimateTokens('心理咨询')).toBe(5);
  });

  it('counts other characters at 0.3 tokens each with a 10% margin', () => {
    expect(estimateTokens('abcd')).toBe(2);
    expect(estimateTokens('hello')).toBe(2);
  });

  it('handles mixed text', () => {
    expect(estimateTokens('你好 abc')).toBeGreaterThanOrEqual(4);
  });
});
