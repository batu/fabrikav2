import { describe, expect, it } from 'vitest';
import { buildSagaNodes, SAGA_WINDOW_SIZE } from '../../src/menu/saga';
import { LEVELS } from '../../src/levels/levels.generated';
import { contentLevelNumber } from '../../src/levels/progression';

describe('buildSagaNodes windowing ({ahead:4, behind:0})', () => {
  it('fresh save yields level 1 current + 3 locked ahead, 0 behind', () => {
    const nodes = buildSagaNodes({ currentIndex: 0, levelCount: 20 });
    expect(nodes).toHaveLength(SAGA_WINDOW_SIZE);
    // Display order is top→bottom: locked ahead first, current last.
    expect(nodes.map((n) => n.state)).toEqual(['locked', 'locked', 'locked', 'current']);
    expect(nodes[nodes.length - 1].id).toBe(0);
    expect(nodes[nodes.length - 1].label).toBe('1');
    // Exactly one current, no completed/behind nodes.
    expect(nodes.filter((n) => n.state === 'current')).toHaveLength(1);
    expect(nodes.some((n) => n.state === 'completed')).toBe(false);
  });

  it('mid-progress anchors the current node at the bottom with ascending labels', () => {
    const nodes = buildSagaNodes({ currentIndex: 5, levelCount: 20 });
    expect(nodes.map((n) => n.label)).toEqual(['9', '8', '7', '6']);
    expect(nodes.map((n) => n.id)).toEqual([8, 7, 6, 5]);
    expect(nodes[nodes.length - 1].state).toBe('current');
  });

  it('clamps the window to the available level count', () => {
    const nodes = buildSagaNodes({ currentIndex: 0, levelCount: 2 });
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.state)).toEqual(['locked', 'current']);
  });

  it('keeps the gold sun at the final level — no completed nodes, ever (2026-07-27)', () => {
    // Supersedes MRV2-10 U3, which reproduced v1's last-level presentation
    // (window slid behind the current, showing four green `completed` nodes and
    // no sun). Product decision: the map always reads current-gold-sun +
    // locked-wood. Progression is endless, so level 110 still has levels ahead
    // — the sequence loops back to level 20.
    const nodes = buildSagaNodes({
      currentIndex: 109,
      levelCount: 110,
      levelNumberFor: contentLevelNumber,
    });
    expect(nodes).toHaveLength(SAGA_WINDOW_SIZE);
    expect(nodes.map((n) => n.state)).toEqual(['locked', 'locked', 'locked', 'current']);
    // Current is level 110; the three ahead have wrapped to the replay start.
    expect(nodes.map((n) => n.label)).toEqual(['22', '21', '20', '110']);
    expect(nodes.some((n) => n.state === 'completed')).toBe(false);
  });

  it('keeps the forward window (no completed nodes) mid-sequence (MRV2-9 U3 ordering unchanged)', () => {
    const nodes = buildSagaNodes({ currentIndex: 5, levelCount: 110 });
    expect(nodes.map((n) => n.state)).toEqual(['locked', 'locked', 'locked', 'current']);
    expect(nodes.some((n) => n.state === 'completed')).toBe(false);
  });

  it('folds injected level names into the accessible name', () => {
    const nodes = buildSagaNodes({
      currentIndex: 0,
      levelCount: 4,
      nameFor: (logical) => (logical === 0 ? 'Sugar Rush' : undefined),
    });
    expect(nodes[nodes.length - 1].name).toBe('Level 1: Sugar Rush current');
    expect(nodes[0].name).toBe('Level 4 locked');
  });
});

describe('saga is sized by the real marble content, not the scaffold stub index', () => {
  // Regression: HomeScene sized the window from `levels-index.json` (20 leftover
  // find_the_dog stub entries) while gameplay runs the 110 generated marble
  // levels. Any save past level 20 therefore hit the end-of-content branch: the
  // gold-sun current node vanished and four green completed nodes rendered
  // instead. Observed on the Pixel at level 22 (2026-07-27).
  it('keeps the current gold-sun node past the old 20-level stub boundary', () => {
    const nodes = buildSagaNodes({ currentIndex: 21, levelCount: LEVELS.length });
    expect(nodes.map((n) => n.state)).toEqual(['locked', 'locked', 'locked', 'current']);
    expect(nodes.map((n) => n.label)).toEqual(['25', '24', '23', '22']);
    expect(nodes.some((n) => n.state === 'completed')).toBe(false);
  });

  it('the generated marble set is what HomeScene sizes the saga from', () => {
    expect(LEVELS.length).toBe(110);
  });

  it('never emits a completed node at any progress point', () => {
    for (const currentIndex of [0, 5, 19, 21, 109, 110, 250]) {
      const nodes = buildSagaNodes({ currentIndex, levelCount: LEVELS.length, levelNumberFor: contentLevelNumber });
      expect(nodes.some((n) => n.state === 'completed')).toBe(false);
      expect(nodes.filter((n) => n.state === 'current')).toHaveLength(1);
    }
  });
});
