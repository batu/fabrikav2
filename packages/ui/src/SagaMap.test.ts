import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mountSagaMap, type LevelMapNode } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

function unwrapCssLayers(css: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let output = '';
  let i = 0;
  while (i < withoutComments.length) {
    if (withoutComments.startsWith('@layer', i)) {
      const open = withoutComments.indexOf('{', i);
      const semi = withoutComments.indexOf(';', i);
      if (semi !== -1 && (open === -1 || semi < open)) {
        i = semi + 1;
        continue;
      }
      if (open === -1) break;
      let depth = 1;
      let close = open + 1;
      while (close < withoutComments.length && depth > 0) {
        const char = withoutComments[close];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        close += 1;
      }
      output += unwrapCssLayers(withoutComments.slice(open + 1, close - 1));
      i = close;
      continue;
    }
    output += withoutComments[i];
    i += 1;
  }
  return output;
}

function installUiCss(): void {
  if (document.getElementById('fab-ui-css-test')) return;
  const style = document.createElement('style');
  style.id = 'fab-ui-css-test';
  style.textContent = unwrapCssLayers(readFileSync(resolve('src/ui.css'), 'utf8'));
  document.head.appendChild(style);
}

function isTransparent(color: string): boolean {
  const normalized = color.trim().toLowerCase();
  return (
    normalized === '' ||
    normalized === 'transparent' ||
    /rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(normalized)
  );
}

function expectVisibleSagaDots(root: HTMLElement): void {
  const dots = Array.from(root.querySelectorAll<HTMLElement>('.fab-levelmap-node-dot'));
  expect(dots).toHaveLength(3);
  for (const dot of dots) {
    const style = getComputedStyle(dot);
    expect(Number.parseFloat(style.width)).toBeGreaterThan(0);
    expect(Number.parseFloat(style.height)).toBeGreaterThan(0);
    expect(style.backgroundImage).not.toContain('var(');
    expect(style.backgroundColor).not.toContain('var(');
    const hasImage = !['', 'none'].includes(style.backgroundImage.trim());
    const hasColor = !isTransparent(style.backgroundColor);
    expect(hasImage || hasColor).toBe(true);
  }
}

function expectCenteredSagaNodes(root: HTMLElement): void {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('.fab-levelmap-node'));
  expect(nodes).toHaveLength(3);
  for (const node of nodes) {
    expect(getComputedStyle(node).getPropertyValue('--node-x').trim()).toBe('0px');
  }
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

  it('computes visible chip backgrounds and dimensions from the kit stylesheet', () => {
    installUiCss();
    const handle = mountSagaMap({
      mountInto: host(),
      state: { nodes: NODES },
      actions: { onSelectLevel: () => {} },
      loadingLabel: 'Loading levels',
      id: 'saga-visible-css',
    });

    expectVisibleSagaDots(handle.el);
    expectCenteredSagaNodes(handle.el);
  });

  it('can suppress the kit default node disc while retaining game node art', () => {
    installUiCss();
    const handle = mountSagaMap({
      mountInto: host(),
      state: { nodes: NODES },
      actions: { onSelectLevel: () => {} },
      loadingLabel: 'Loading levels',
      suppressDefaultNodeDisc: true,
      theme: {
        '--fab-levelmap-art-default': 'linear-gradient(180deg, #ffffff 0%, #eeeeee 100%)',
        '--fab-levelmap-art-locked': 'linear-gradient(180deg, #dddddd 0%, #bbbbbb 100%)',
        '--fab-levelmap-art-completed': 'linear-gradient(180deg, #ccddff 0%, #99bbff 100%)',
        '--fab-levelmap-art-current': 'linear-gradient(180deg, #88ffff 0%, #2299cc 100%)',
      },
      id: 'saga-no-disc',
    });

    expect(handle.el.dataset.fabNodeDisc).toBe('none');
    const dots = Array.from(handle.el.querySelectorAll<HTMLElement>('.fab-levelmap-node-dot'));
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      const style = getComputedStyle(dot);
      expect(isTransparent(style.backgroundColor)).toBe(true);
      expect(style.backgroundImage).not.toContain('var(');
      expect(style.backgroundImage).not.toBe('none');
    }
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
