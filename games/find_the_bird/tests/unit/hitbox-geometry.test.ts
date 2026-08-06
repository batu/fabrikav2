import { describe, expect, it } from 'vitest';

import { resolveRuntimeHitRadius } from '../../src/scenes/hitboxGeometry';

describe('square campaign hitbox geometry', () => {
  it('keeps a forgiving radius when targets are isolated', () => {
    // 2.0x tolerance (2026-08-05): painted birds render larger than their
    // hitbox disc; taps on visible bird pixels must land. Since 2026-08-06
    // the base radius is floored at the uniform catalog radius (57@2688),
    // so a small stored r is lifted before the multiplier.
    const target = { id: 'a', x: 100, y: 100, r: 40 };
    expect(resolveRuntimeHitRadius(target, [target], true)).toBe(114);
  });

  it('caps neighboring square hitboxes so they cannot overlap', () => {
    const a = { id: 'a', x: 100, y: 100, r: 80 };
    const b = { id: 'b', x: 220, y: 100, r: 80 };
    const radiusA = resolveRuntimeHitRadius(a, [a, b], true);
    const radiusB = resolveRuntimeHitRadius(b, [a, b], true);

    expect(radiusA + radiusB).toBeLessThan(Math.hypot(a.x - b.x, a.y - b.y));
    expect(radiusA).toBeGreaterThanOrEqual(44);
  });

  it('preserves legacy tolerance for non-square levels', () => {
    const target = { id: 'a', x: 100, y: 100, r: 40 };
    expect(resolveRuntimeHitRadius(target, [target], false)).toBe(120);
  });
});

describe('minimum tap radius floor (2026-08-06)', () => {
  it('floors tiny hitboxes to the dim-scaled minimum', () => {
    const tiny = { id: 'a', x: 500, y: 500, r: 12 };
    const r = resolveRuntimeHitRadius(tiny, [tiny], true, 2688);
    expect(r).toBeGreaterThanOrEqual(57);
  });

  it('scales the floor with level size', () => {
    const tiny = { id: 'a', x: 500, y: 500, r: 12 };
    const r = resolveRuntimeHitRadius(tiny, [tiny], true, 4096);
    expect(r).toBeGreaterThanOrEqual(57 * (4096 / 2688) - 0.001);
  });

  it('floor wins over the neighbor clamp for very close pairs', () => {
    const a = { id: 'a', x: 500, y: 500, r: 12 };
    const b = { id: 'b', x: 540, y: 500, r: 12 };
    const r = resolveRuntimeHitRadius(a, [a, b], true, 2688);
    // clamp alone would give (40-4)/2 = 18; the lenient floor must win.
    expect(r).toBeGreaterThanOrEqual(57);
  });

  it('normal-size hitboxes keep the forgiving 2x tolerance', () => {
    const big = { id: 'a', x: 500, y: 500, r: 57 };
    const r = resolveRuntimeHitRadius(big, [big], true, 2688);
    expect(r).toBeCloseTo(114);
  });
});
