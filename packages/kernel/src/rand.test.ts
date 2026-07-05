import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rand.ts';

describe('mulberry32', () => {
  it('is deterministic for a fixed seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i += 1) {
      expect(a()).toBe(b());
    }
  });

  it('emits values in [0, 1) with seed-dependent sequences', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let differs = false;
    for (let i = 0; i < 100; i += 1) {
      const va = a();
      const vb = b();
      expect(va).toBeGreaterThanOrEqual(0);
      expect(va).toBeLessThan(1);
      if (va !== vb) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('pins the first values of the canonical sequence (cross-variant level identity)', () => {
    const r = mulberry32(101);
    // Marble Run committed level sets depend on this exact sequence.
    expect(r()).toBeCloseTo(0.1356478596571833, 12);
    expect(r()).toBeCloseTo(0.764801949961111, 12);
  });
});
