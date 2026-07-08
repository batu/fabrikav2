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

function expectSpriteRibbon(
  card: HTMLElement,
  opts: { assetName: string; title: string; eyebrow?: string },
): void {
  const ribbon = card.querySelector<HTMLElement>('.fab-modal-ribbon')!;
  expect(ribbon).not.toBeNull();
  expect(Array.from(ribbon.classList).filter((name) => name.startsWith('fab-modal-ribbon--'))).toEqual([]);
  expect(ribbon.style.backgroundImage).toBe('');
  expect(ribbon.querySelector<HTMLImageElement>('.fab-modal-ribbon-image')?.src).toContain(opts.assetName);
  const titleNodes = card.querySelectorAll<HTMLElement>('.fab-modal-ribbon-title');
  expect(titleNodes).toHaveLength(1);
  expect(card.querySelectorAll('.fab-modal-title')).toHaveLength(0);
  const title = titleNodes[0]!;
  expect(title.textContent).toBe(opts.title);
  if (opts.eyebrow !== undefined) {
    const eyebrowNodes = card.querySelectorAll<HTMLElement>('.fab-modal-ribbon-eyebrow');
    expect(eyebrowNodes).toHaveLength(1);
    const eyebrow = eyebrowNodes[0]!;
    expect(eyebrow.textContent).toBe(opts.eyebrow);
    expect(eyebrow.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

function expectSpriteButton(action: string, assetName: string): void {
  const button = document.querySelector<HTMLButtonElement>(`[data-fab-action="${action}"]`)!;
  expect(button).not.toBeNull();
  expect(button.classList.contains('fab-btn')).toBe(true);
  expect(button.classList.contains('fab-btn-primary')).toBe(false);
  expect(button.style.getPropertyValue('--fab-btn-sprite-image')).toContain(assetName);
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
    const next = document.querySelector<HTMLButtonElement>('[data-fab-action="result-next"]')!;
    expect(next.classList.contains('mr-result-cta')).toBe(true);
    expect(next.style.getPropertyValue('--fab-btn-sprite-image')).toContain('url(');
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
    const watch = document.querySelector<HTMLButtonElement>('[data-fab-action="result-next"]')!;
    const retry = document.querySelector<HTMLButtonElement>('[data-fab-action="result-retry"]')!;
    expect(watch.style.getPropertyValue('--fab-btn-sprite-image')).toContain('url(');
    expect(retry.classList.contains('mr-result-cta--orange')).toBe(true);
    expect(retry.style.getPropertyValue('--fab-btn-sprite-image')).toContain('url(');
    expect(controllerProbe.instances.at(-1)!.resultHudModes).toEqual(['lose']);
  });

  it('composes settings, win, and fail surfaces with real sprite ribbons and buttons', async () => {
    const app = bootApp();
    const h = app.harness();

    expect(await h.driveTo('settings')).toBe(true);
    const settings = document.querySelector<HTMLElement>('.mr-settings-card')!;
    expect(settings.classList.contains('fab-modal-card--image')).toBe(true);
    expect(settings.style.getPropertyValue('--fab-modal-card-image')).toContain('popup-card');
    expectSpriteRibbon(settings, { assetName: 'ribbon-orange', title: 'Settings' });
    expectSpriteButton('settings-close-cta', 'button-green');
    expectSpriteButton('settings-reset', 'button-orange');

    h.startLevel(4);
    (app as unknown as WinHarness).handleWin({ levelId: 4, reward: 25, isFinalLevel: false });
    const win = document.querySelector<HTMLElement>('.fab-result-card--win')!;
    expect(win.classList.contains('fab-modal-card--image')).toBe(true);
    expect(win.style.getPropertyValue('--fab-modal-card-image')).toContain('popup-card');
    expectSpriteRibbon(win, { assetName: 'ribbon-completed-blank', title: 'COMPLETED', eyebrow: 'Level 4' });
    expectSpriteButton('result-next', 'button-green');

    document.querySelector<HTMLButtonElement>('[data-fab-action="result-next"]')!.click();
    h.startLevel(4);
    (app as unknown as FailHarness).handleFail({ levelId: 4 });
    const fail = document.querySelector<HTMLElement>('.fab-result-card--lose')!;
    expect(fail.classList.contains('fab-modal-card--image')).toBe(true);
    expect(fail.style.getPropertyValue('--fab-modal-card-image')).toContain('popup-card');
    expectSpriteRibbon(fail, { assetName: 'ribbon-failed-blank', title: 'FAILED', eyebrow: 'Level 4' });
    expectSpriteButton('result-next', 'button-green');
    expectSpriteButton('result-retry', 'button-orange');
  });
});
