/**
 * Unit tests for backoff calculation.
 */

import { describe, it, expect } from 'vitest';
import { computeBackoffDelay, computeNextAttemptAt } from '../../src/core/backoff';

describe('computeBackoffDelay', () => {
  it('should compute base^attempts with base=2', () => {
    expect(computeBackoffDelay(1, 2)).toBe(2);   // 2^1
    expect(computeBackoffDelay(2, 2)).toBe(4);   // 2^2
    expect(computeBackoffDelay(3, 2)).toBe(8);   // 2^3
    expect(computeBackoffDelay(4, 2)).toBe(16);  // 2^4
  });

  it('should compute base^attempts with base=3', () => {
    expect(computeBackoffDelay(1, 3)).toBe(3);   // 3^1
    expect(computeBackoffDelay(2, 3)).toBe(9);   // 3^2
    expect(computeBackoffDelay(3, 3)).toBe(27);  // 3^3
  });

  it('should handle attempt=0 (edge case)', () => {
    expect(computeBackoffDelay(0, 2)).toBe(1);   // 2^0 = 1
  });
});

describe('computeNextAttemptAt', () => {
  it('should return a valid ISO timestamp in the future', () => {
    const before = Date.now();
    const nextAt = computeNextAttemptAt(1, 2);
    const after = Date.now();

    const nextTime = new Date(nextAt).getTime();
    // Should be roughly 2 seconds from now (base=2, attempts=1)
    expect(nextTime).toBeGreaterThanOrEqual(before + 1900);
    expect(nextTime).toBeLessThanOrEqual(after + 2100);
  });

  it('should produce increasing delays as attempts increase', () => {
    const t1 = new Date(computeNextAttemptAt(1, 2)).getTime();
    const t2 = new Date(computeNextAttemptAt(2, 2)).getTime();
    const t3 = new Date(computeNextAttemptAt(3, 2)).getTime();

    // Each subsequent delay should be longer
    expect(t2 - Date.now()).toBeGreaterThan(t1 - Date.now());
    expect(t3 - Date.now()).toBeGreaterThan(t2 - Date.now());
  });
});
