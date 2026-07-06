import { describe, expect, it, vi } from 'vitest';
import { mountSagaMap, type LevelMapNode } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

const NODES: LevelMapNode[] = [
  { id: 1, label: '1', name: 'Level 1', state: 'completed' },
  { id: 2, label: '2', name: 'Level 2', state: 'current' },
  { id: 3, label: '3', name: 'Level 3', state: 'locked' },
];

describe('mountSagaMap', () => {
  it('renders nodes in order with their state classes', () => {
    const handle = mountSagaMap({
      mountInto: host(),
      state: { nodes: NODES },
      actions: { onSelectLevel: () => {} },
      loadingLabel: 'Loading levels',
      id: 'saga',
    });

    const nodes = Array.from(handle.el.querySelectorAll<HTMLElement>('.fab-levelmap-node'));
    expect(nodes).toHaveLength(3);
    expect(nodes[0].classList.contains('completed')).toBe(true);
    expect(nodes[1].classList.contains('current')).toBe(true);
    expect(nodes[2].classList.contains('locked')).toBe(true);
    expect(nodes.map((n) => n.querySelector('.fab-levelmap-node-dot')?.textContent)).toEqual(['1', '2', '3']);
    expect(nodes[2].getAttribute('aria-label')).toBe('Level 3');
  });

  it('renders the loading placeholder with the injected label and no baked copy', () => {
    const handle = mountSagaMap({
      mountInto: host(),
      state: { nodes: [] },
      actions: { onSelectLevel: () => {} },
      loadingLabel: 'Chargement…',
      id: 'saga',
    });
    const path = handle.el.querySelector<HTMLElement>('.fab-levelmap-path')!;
    expect(path.dataset.loading).toBe('true');
    expect(path.getAttribute('aria-label')).toBe('Chargement…');
    expect(handle.el.querySelectorAll('.fab-levelmap-loading-node')).toHaveLength(3);
    expect(handle.el.querySelector('.fab-levelmap-node')).toBeNull();
  });

  it('fires onSelectLevel with the node id for every node — including locked', () => {
    const onSelectLevel = vi.fn();
    const handle = mountSagaMap({
      mountInto: host(),
      state: { nodes: NODES },
      actions: { onSelectLevel },
      loadingLabel: 'Loading',
      id: 'saga',
    });
    const nodes = handle.el.querySelectorAll<HTMLElement>('.fab-levelmap-node');
    nodes[1].click(); // current
    nodes[2].click(); // locked — primitive never blocks the click
    expect(onSelectLevel).toHaveBeenNthCalledWith(1, 2);
    expect(onSelectLevel).toHaveBeenNthCalledWith(2, 3);
  });

  it('is re-entrant by id (returns the live handle, no duplicate DOM)', () => {
    const h = host();
    const a = mountSagaMap({
      mountInto: h,
      state: { nodes: NODES },
      actions: { onSelectLevel: () => {} },
      loadingLabel: 'Loading',
      id: 'saga',
    });
    const b = mountSagaMap({
      mountInto: h,
      state: { nodes: [] },
      actions: { onSelectLevel: () => {} },
      loadingLabel: 'Loading',
      id: 'saga',
    });
    expect(h.querySelectorAll('#saga')).toHaveLength(1);
    expect(b.el).toBe(a.el);
  });

  it('dismiss() unmounts the rail', () => {
    const h = host();
    const handle = mountSagaMap({
      mountInto: h,
      state: { nodes: NODES },
      actions: { onSelectLevel: () => {} },
      loadingLabel: 'Loading',
      id: 'saga',
    });
    handle.dismiss();
    expect(h.querySelector('#saga')).toBeNull();
  });
});
