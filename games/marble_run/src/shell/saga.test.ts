import { describe, expect, it } from 'vitest';
import { buildSagaNodes } from './saga';
import { LEVEL_COUNT } from '../core/Constants';

describe('buildSagaNodes', () => {
  const ids = (unlocked: number, opts?: Parameters<typeof buildSagaNodes>[1]) =>
    buildSagaNodes(unlocked, opts).map((n) => n.id);
  const currentId = (unlocked: number) =>
    buildSagaNodes(unlocked).find((n) => n.state === 'current')?.id;

  it('emits exactly one current node, equal to the clamped unlocked level', () => {
    for (const u of [1, 5, 10, 20]) {
      const currents = buildSagaNodes(u).filter((n) => n.state === 'current');
      expect(currents).toHaveLength(1);
      expect(currents[0].id).toBe(u);
    }
  });

  it('labels nodes below current completed and above current locked', () => {
    const nodes = buildSagaNodes(10);
    for (const n of nodes) {
      const id = Number(n.id);
      if (id < 10) expect(n.state).toBe('completed');
      else if (id === 10) expect(n.state).toBe('current');
      else expect(n.state).toBe('locked');
    }
  });

  it('orders nodes top→bottom as descending level numbers (forward-fade geometry)', () => {
    const list = ids(10);
    const sorted = [...list].sort((a, b) => Number(b) - Number(a));
    expect(list).toEqual(sorted);
  });

  it('keeps the current node at/near the bottom so locked-ahead nodes can fade', () => {
    // Mid-progress: current must not be the first (top) node — the nodes above it
    // are the locked-ahead levels that the component fades into the distance.
    const nodes = buildSagaNodes(10);
    const currentPos = nodes.findIndex((n) => n.state === 'current');
    expect(currentPos).toBeGreaterThan(0);
    // At least 3 nodes ahead (above) so `.far` (distance >= 3) actually fires.
    expect(currentPos).toBeGreaterThanOrEqual(3);
  });

  describe('boundary clamping', () => {
    it('level 1: no level-0 node, current at the bottom', () => {
      const list = ids(1).map(Number);
      expect(Math.min(...list)).toBe(1);
      expect(list).not.toContain(0);
      const nodes = buildSagaNodes(1);
      expect(nodes[nodes.length - 1].id).toBe(1); // current is last (bottom)
      expect(nodes[nodes.length - 1].state).toBe('current');
    });

    it(`level ${LEVEL_COUNT}: no id past the ceiling, current still unique`, () => {
      const list = ids(LEVEL_COUNT).map(Number);
      expect(Math.max(...list)).toBe(LEVEL_COUNT);
      expect(list.every((n) => n >= 1 && n <= LEVEL_COUNT)).toBe(true);
      expect(currentId(LEVEL_COUNT)).toBe(LEVEL_COUNT);
    });

    it('clamps out-of-range unlocked into [1, LEVEL_COUNT]', () => {
      expect(currentId(0)).toBe(1);
      expect(currentId(999)).toBe(LEVEL_COUNT);
    });
  });

  it('keeps a stable window size away from the edges', () => {
    const mid = buildSagaNodes(10).length; // 4 ahead + current + 1 behind = 6
    expect(mid).toBe(6);
    // Near both edges the shortfall is redistributed, so size stays the same.
    expect(buildSagaNodes(1)).toHaveLength(mid);
    expect(buildSagaNodes(LEVEL_COUNT)).toHaveLength(mid);
  });

  it('never emits a node id outside [1, levelCount] for any unlocked value', () => {
    for (let u = 1; u <= LEVEL_COUNT; u += 1) {
      for (const n of buildSagaNodes(u)) {
        expect(Number(n.id)).toBeGreaterThanOrEqual(1);
        expect(Number(n.id)).toBeLessThanOrEqual(LEVEL_COUNT);
      }
    }
  });
});
