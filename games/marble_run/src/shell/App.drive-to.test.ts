// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSdk } from '../sdk/SdkContext.ts';

const controllerProbe = vi.hoisted(() => ({
  instances: [] as Array<{
    startedLevels: number[];
    postStartInputs: boolean[];
    resultHudModes: Array<'win' | 'lose' | null>;
  }>,
}));

vi.mock('../audio/Music.ts', () => ({
  music: { start: vi.fn(), stop: vi.fn(), refresh: vi.fn() },
}));
vi.mock('../audio/Sfx.ts', () => ({
  toggleClick: vi.fn(),
}));
vi.mock('../game/GameController.ts', () => {
  class GameController {
    readonly startedLevels: number[] = [];
    readonly postStartInputs: boolean[] = [];
    readonly resultHudModes: Array<'win' | 'lose' | null> = [];
    private mode: 'menu' | 'level' = 'menu';
    private levelSnapshotPolls = 0;

    constructor() {
      controllerProbe.instances.push(this);
    }

    showMenuScene(): void {
      this.mode = 'menu';
      this.levelSnapshotPolls = 0;
    }

    stopLevel(): void {
      this.mode = 'menu';
      this.levelSnapshotPolls = 0;
    }

    startLevel(levelId: number): void {
      this.startedLevels.push(levelId);
      this.mode = 'level';
      this.levelSnapshotPolls = 0;
    }

    pause(): void {}
    resume(): void {}
    setInputBlocked(): void {}
    setResultHudMode(mode: 'win' | 'lose' | null): void {
      this.resultHudModes.push(mode);
    }
    refreshHudCoins(): void {}
    showHint(): void {}
    setAnimationSpeed(): void {}
    tapCell(): void {}
    coinAnchor(): HTMLElement | null { return null; }
    engineRef(): null { return null; }
    currentLevelDef(): null { return null; }
    cellClientPoint(): null { return null; }

    snapshot(): Record<string, unknown> {
      const inputReady = this.mode !== 'level' || this.levelSnapshotPolls >= 1;
      if (this.mode === 'level') {
        this.postStartInputs.push(inputReady);
        this.levelSnapshotPolls += 1;
      }
      return {
        levelId: this.startedLevels.at(-1) ?? 0,
        status: this.mode === 'level' ? 'playing' : 'none',
        inputReady,
        hearts: this.mode === 'level' ? 5 : null,
        remaining: this.mode === 'level' ? 1 : null,
        coins: 0,
        paused: false,
      };
    }
  }
  return { GameController };
});

import { App } from './App.ts';

function mounts(): { canvas: HTMLCanvasElement; hudRoot: HTMLElement; uiRoot: HTMLElement } {
  const canvas = document.createElement('canvas');
  const hudRoot = document.createElement('div');
  const uiRoot = document.createElement('div');
  document.body.append(canvas, hudRoot, uiRoot);
  return { canvas, hudRoot, uiRoot };
}

function sdk(): GameSdk {
  return {
    iap: {},
    levelStart: vi.fn(),
    levelComplete: vi.fn(),
    levelFail: vi.fn(),
    recordSpend: vi.fn(),
    tryRewardedHint: vi.fn(async () => false),
    tryRewardedFailSave: vi.fn(async () => false),
    maybeShowInterstitialAfterLevel: vi.fn(async () => undefined),
    applyPurchaseResult: vi.fn(),
    applyRestoreResult: vi.fn(),
  } as unknown as GameSdk;
}

function bootApp(): App {
  const app = new App(mounts(), sdk());
  app.start();
  return app;
}

const CAPTURE_SETTLE_MS = 600;

interface WinHarness {
  handleWin(info: { levelId: number; reward: number; isFinalLevel: boolean }): void;
}

interface FailHarness {
  handleFail(info: { levelId: number }): void;
}

describe('App harness driveTo wiring', () => {
  beforeEach(() => {
    controllerProbe.instances.length = 0;
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("driveTo('level') waits for App.snapshot().inputReady before confirming", async () => {
    const app = bootApp();

    const reached = await app.harness().driveTo('level');
    const controller = controllerProbe.instances.at(-1)!;

    expect(reached).toBe(true);
    expect(controller.startedLevels).toEqual([1]);
    expect(controller.postStartInputs).toEqual([false, true]);
  });

  it("driveTo('level') clears menu modal pages before starting gameplay", async () => {
    const app = bootApp();
    const h = app.harness();

    expect(await h.driveTo('settings')).toBe(true);
    expect(h.snapshot()).toMatchObject({ settingsOpen: true });

    expect(await h.driveTo('level')).toBe(true);
    expect(h.snapshot()).toMatchObject({ settingsOpen: false });
  });

  it("driveTo('settings') keeps the settings modal mounted through the capture settle window", async () => {
    const app = bootApp();
    const h = app.harness();

    expect(await h.driveTo('settings')).toBe(true);
    expect(h.snapshot()).toMatchObject({ settingsOpen: true });

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(CAPTURE_SETTLE_MS);

    expect(h.snapshot()).toMatchObject({ settingsOpen: true });
    expect(document.querySelector('.mr-settings-card')).not.toBeNull();
  });

  it('keeps the win modal mounted through the capture settle window', async () => {
    const app = bootApp();
    const h = app.harness();

    h.startLevel(4);
    (app as unknown as WinHarness).handleWin({
      levelId: 4,
      reward: 25,
      isFinalLevel: false,
    });

    expect(h.snapshot()).toMatchObject({ scene: 'complete', settingsOpen: false });
    expect(document.querySelector('.fab-result-card--win')).not.toBeNull();
    expect(controllerProbe.instances.at(-1)!.resultHudModes).toEqual(['win']);

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(CAPTURE_SETTLE_MS);

    expect(h.snapshot()).toMatchObject({ scene: 'complete' });
    expect(document.querySelector('.fab-result-card--win')).not.toBeNull();
  });

  it('sets lose result HUD mode before mounting the fail modal', () => {
    const app = bootApp();
    const h = app.harness();

    h.startLevel(3);
    (app as unknown as FailHarness).handleFail({ levelId: 3 });

    expect(h.snapshot()).toMatchObject({ scene: 'failed', settingsOpen: false });
    expect(document.querySelector('.fab-result-card--lose')).not.toBeNull();
    expect(controllerProbe.instances.at(-1)!.resultHudModes).toEqual(['lose']);
  });
});
