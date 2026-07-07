// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('../audio/Music.ts', () => ({
  music: { start: vi.fn(), stop: vi.fn(), refresh: vi.fn() },
}));
vi.mock('../audio/Sfx.ts', () => ({
  toggleClick: vi.fn(),
}));

import { App } from './App.ts';
import { saveState } from '../core/SaveState.ts';

interface SettingsActionHarness {
  pageStack: { pop: ReturnType<typeof vi.fn> };
  renderMenu: ReturnType<typeof vi.fn>;
  buildSettingsActions(inGame: boolean): HTMLElement;
  restartFromSettings(inGame: boolean): void;
  homeFromSettings(): void;
}

function harness(): SettingsActionHarness {
  const app = Object.create(App.prototype) as SettingsActionHarness;
  app.pageStack = { pop: vi.fn() };
  app.renderMenu = vi.fn();
  app.restartFromSettings = vi.fn();
  app.homeFromSettings = vi.fn();
  return app;
}

function action(root: HTMLElement, name: string): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(`[data-fab-action="${name}"]`);
}

describe('App settings action variants', () => {
  afterEach(() => {
    saveState.resetSave();
    vi.restoreAllMocks();
  });

  it('renders menu settings with close CTA and reset link only', () => {
    const app = harness();
    const actions = app.buildSettingsActions(false);

    expect(actions.classList.contains('mr-settings-actions--menu')).toBe(true);
    const close = action(actions, 'settings-close-cta');
    expect(close?.textContent).toBe('Close');
    expect(close?.style.getPropertyValue('--mr-button-sprite-image')).toContain('url(');
    expect(action(actions, 'settings-reset')?.textContent).toBe('Reset Progress');
    expect(action(actions, 'settings-restart')).toBeNull();
    expect(action(actions, 'settings-home')).toBeNull();

    close?.click();
    expect(app.pageStack.pop).toHaveBeenCalledOnce();
  });

  it('wires menu reset to reset progress, close the modal, and redraw the menu', () => {
    const app = harness();
    const reset = vi.spyOn(saveState, 'resetProgress').mockImplementation(() => undefined);
    const actions = app.buildSettingsActions(false);

    action(actions, 'settings-reset')?.click();

    expect(reset).toHaveBeenCalledOnce();
    expect(app.pageStack.pop).toHaveBeenCalledOnce();
    expect(app.renderMenu).toHaveBeenCalledOnce();
  });

  it('renders in-level settings with restart and home only', () => {
    const app = harness();
    const actions = app.buildSettingsActions(true);

    expect(actions.classList.contains('mr-settings-actions--inlevel')).toBe(true);
    const restart = action(actions, 'settings-restart');
    const home = action(actions, 'settings-home');
    expect(restart?.textContent).toBe('Restart');
    expect(home?.textContent).toBe('Home');
    expect(restart?.style.getPropertyValue('--mr-button-sprite-image')).toContain('url(');
    expect(home?.style.getPropertyValue('--mr-button-sprite-image')).toContain('url(');
    expect(action(actions, 'settings-close-cta')).toBeNull();
    expect(action(actions, 'settings-reset')).toBeNull();

    restart?.click();
    home?.click();
    expect(app.restartFromSettings).toHaveBeenCalledWith(true);
    expect(app.homeFromSettings).toHaveBeenCalledOnce();
  });

  it('exposes seeded capture progress through the harness snapshot path', async () => {
    const app = Object.create(App.prototype) as {
      controller: { snapshot(): Record<string, unknown> };
      machine: { state: string };
      uiRoot: HTMLElement;
      canvas: HTMLCanvasElement;
      perfRecorder: { sample: ReturnType<typeof vi.fn> };
      harnessSink: null;
      renderMenu: ReturnType<typeof vi.fn>;
      harness(): {
        resetSave?: () => void | Promise<void>;
        seedSave?: (profile: {
          unlockedLevel?: number;
          coins?: number;
          noAds?: boolean;
          sfx?: boolean;
          music?: boolean;
          haptics?: boolean;
        }) => void | Promise<void>;
        snapshot(): unknown;
      };
    };
    app.controller = {
      snapshot: () => ({
        unlocked: saveState.unlocked,
        coins: saveState.coins,
        status: 'none',
        inputReady: true,
      }),
    };
    app.machine = { state: 'menu' };
    app.uiRoot = document.createElement('div');
    app.canvas = document.createElement('canvas');
    app.perfRecorder = { sample: vi.fn() };
    app.harnessSink = null;
    app.renderMenu = vi.fn();

    saveState.recordWin(8, 0);
    saveState.addCoins(500);
    saveState.grantNoAds();

    const harness = app.harness();
    await harness.resetSave?.();
    await harness.seedSave?.({
      unlockedLevel: 2,
      coins: 25,
      noAds: false,
      sfx: true,
      music: true,
      haptics: true,
    });

    expect(harness.snapshot()).toMatchObject({
      scene: 'menu',
      unlocked: 2,
      coins: 25,
    });
    expect(app.renderMenu).toHaveBeenCalledTimes(2);
  });
});
