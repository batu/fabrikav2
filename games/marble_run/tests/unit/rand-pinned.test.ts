import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@fabrikav2/kernel';

/**
 * The 20 committed levels were generated against this exact PRNG sequence. The
 * generator imports mulberry32 from @fabrikav2/kernel (S2 — imported, not
 * copied). Re-assert the pinned value locally so a kernel bump that changed the
 * sequence would fail HERE, loudly, instead of silently invalidating every
 * committed level. Mirrors kernel's own rand.test.ts pin.
 */
describe('mulberry32 pinned sequence (level identity)', () => {
  it('reproduces the committed first draw for seed 101', () => {
    const rng = mulberry32(101);
    expect(rng()).toBe(0.1356478596571833);
  });
});
