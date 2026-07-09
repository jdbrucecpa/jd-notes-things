// tests/unit/pcmPacing.test.js
import { describe, it, expect } from 'vitest';
import { computeSilenceDeficit } from '../../src/main/recording/pcmPacing.js';

describe('computeSilenceDeficit', () => {
  const byteRate = 192000; // 48kHz * 2ch * 2B
  const frameBytes = 4;

  it('returns 0 when caught up', () => {
    expect(computeSilenceDeficit(1000, byteRate, frameBytes, 192000)).toBe(0);
  });

  it('returns frame-aligned deficit when behind', () => {
    const d = computeSilenceDeficit(1000, byteRate, frameBytes, 0);
    expect(d).toBe(192000);
    expect(d % frameBytes).toBe(0);
  });

  it('rounds a non-aligned deficit down to a whole frame', () => {
    // 1 byte already written → raw deficit 191999, not divisible by 4
    const d = computeSilenceDeficit(1000, byteRate, frameBytes, 1);
    expect(d).toBe(191996); // 191999 - (191999 % 4)
    expect(d % frameBytes).toBe(0);
  });

  it('caps at ~1s of bytes', () => {
    expect(computeSilenceDeficit(60000, byteRate, frameBytes, 0)).toBe(byteRate);
  });

  it('returns 0 for zero byteRate or frameBytes', () => {
    expect(computeSilenceDeficit(1000, 0, 4, 0)).toBe(0);
    expect(computeSilenceDeficit(1000, byteRate, 0, 0)).toBe(0);
  });
});
