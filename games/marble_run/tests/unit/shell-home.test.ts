import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSagaNodes } from '../../src/menu/saga';
import { mountHomeShell } from '../../src/menu/homeMenu';

function mount(overrides: Partial<Parameters<typeof mountHomeShell>[0]> = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const onStart = vi.fn();
  const onSelectLevel = vi.fn();
  const onOpenSettings = vi.fn();
  const handle = mountHomeShell({
    mountInto: root,
    coins: 1234,
    nodes: buildSagaNodes({ currentIndex: 2, levelCount: 10 }),
    currentLevelNumber: 3,
    onStart,
    onSelectLevel,
    onOpenSettings,
    ...overrides,
  });
  return { root, handle, onStart, onSelectLevel, onOpenSettings };
}

describe('mountHomeShell', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts a .fab-ui SagaMap, a Level N button, and the coin pill', () => {
    const { root } = mount();
    expect(root.querySelector('.fab-levelmap.fab-ui')).not.toBeNull();

    const play = root.querySelector<HTMLButtonElement>('[data-fab-action="play"]');
    expect(play).not.toBeNull();
    expect(play?.textContent).toBe('LEVEL 3');

    const pill = root.querySelector('.marble-coin-pill');
    expect(pill?.querySelector('.marble-coin-count')?.textContent).toBe('1234');
  });

  it('fires onStart when the LEVEL button is tapped', () => {
    const { root, onStart } = mount();
    root.querySelector<HTMLButtonElement>('[data-fab-action="play"]')?.click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('fires onSelectLevel with the current node id when the current node is tapped', () => {
    const { root, onSelectLevel } = mount();
    const current = root.querySelector<HTMLButtonElement>('.fab-levelmap-node.current');
    current?.click();
    expect(onSelectLevel).toHaveBeenCalledWith(2);
  });

  it('opens settings when the gear is tapped', () => {
    const { root, onOpenSettings } = mount();
    root.querySelector<HTMLButtonElement>('[data-fab-action="settings"]')?.click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
