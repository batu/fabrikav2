import { describe, expect, it } from 'vitest';
import { buildSagaNodes, SAGA_WINDOW_SIZE } from '../../src/menu/saga';

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
