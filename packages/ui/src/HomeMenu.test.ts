import { describe, expect, it, vi } from 'vitest';
import { createFlowMachine } from '@fabrikav2/kernel/flow';
import { mountHomeMenu, type LevelMapNode, type UiHandle } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

const NODES: LevelMapNode[] = [
  { id: 1, label: '1', name: 'Level 1', state: 'current' },
  { id: 2, label: '2', name: 'Level 2', state: 'locked' },
];

describe('mountHomeMenu', () => {
  it('composes SagaMap as its content and renders top-level actions', () => {
    const header = document.createElement('h1');
    header.textContent = 'Fabrika';
    const handle = mountHomeMenu({
      mountInto: host(),
      saga: { state: { nodes: NODES }, actions: { onSelectLevel: () => {} }, loadingLabel: 'Loading' },
      header,
      actions: [{ label: 'Levels', onClick: () => {} }],
      id: 'home',
    });
    expect(handle.el.querySelector('.fab-home-menu-header')?.textContent).toBe('Fabrika');
    expect(handle.el.querySelector('.fab-home-menu-content .fab-levelmap')).not.toBeNull();
    expect(handle.el.querySelectorAll('.fab-levelmap-node')).toHaveLength(2);
    expect(handle.el.querySelector('.fab-home-menu-actions .fab-btn')?.textContent).toBe('Levels');
  });

  it('mounts on Menu enter and unmounts on leave, driven by a real flow machine', () => {
    const h = host();
    const machine = createFlowMachine({ optionalStates: ['levelSelect'] });
    let menu: UiHandle | null = null;

    const reconcile = (): void => {
      const shouldShow = machine.state === 'menu';
      if (shouldShow && menu === null) {
        menu = mountHomeMenu({
          mountInto: h,
          saga: {
            state: { nodes: NODES },
            // A node tap is the LevelSelect→start(id) edge in both v1 consumers.
            actions: { onSelectLevel: (id) => dispatch(() => machine.start(String(id))) },
            loadingLabel: 'Loading',
          },
          // "Levels" is the Menu→LevelSelect edge (selectLevel takes no arg — S3).
          actions: [{ label: 'Levels', onClick: () => dispatch(() => machine.selectLevel()) }],
          id: 'home',
        });
      } else if (!shouldShow && menu !== null) {
        menu.dismiss();
        menu = null;
      }
    };
    const dispatch = (fn: () => void): void => {
      fn();
      reconcile();
    };

    // boot → menu: HomeMenu mounts.
    dispatch(() => machine.toMenu());
    expect(machine.state).toBe('menu');
    expect(h.querySelector('#home')).not.toBeNull();

    // "Levels" fires selectLevel → LevelSelect: HomeMenu unmounts.
    const levels = h.querySelector<HTMLButtonElement>('.fab-home-menu-actions .fab-btn')!;
    levels.click();
    expect(machine.state).toBe('levelSelect');
    expect(h.querySelector('#home')).toBeNull();

    // Back to menu re-mounts it.
    dispatch(() => machine.toMenu());
    expect(h.querySelector('#home')).not.toBeNull();
    machine.dispose();
  });

  it('unmounting the menu tears down the composed SagaMap handle', () => {
    const h = host();
    const onSelectLevel = vi.fn();
    const handle = mountHomeMenu({
      mountInto: h,
      saga: { state: { nodes: NODES }, actions: { onSelectLevel }, loadingLabel: 'Loading', id: 'saga-child' },
      id: 'home',
    });
    expect(h.querySelector('#saga-child')).not.toBeNull();
    handle.dismiss();
    expect(h.querySelector('#home')).toBeNull();
    expect(h.querySelector('#saga-child')).toBeNull();
  });
});
