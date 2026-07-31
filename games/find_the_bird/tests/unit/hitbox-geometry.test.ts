import { describe, expect, it } from 'vitest';

import { resolveRuntimeHitRadius } from '../../src/scenes/hitboxGeometry';

describe('square campaign hitbox geometry', () => {
  it('keeps a forgiving radius when targets are isolated', () => {
    const target = { id: 'a', x: 100, y: 100, r: 40 };
    expect(resolveRuntimeHitRadius(target, [target], true)).toBe(54);
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
