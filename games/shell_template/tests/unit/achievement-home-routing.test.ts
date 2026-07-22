import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Real click-driven routing test: render the actual home overlay markup through
// HomeScene's own renderHomeScreen, click the achievements trigger, and assert
// the page-shell routing call. Heavy scene collaborators are mocked at the seam.
const { openPage } = vi.hoisted(() => ({ openPage: vi.fn() }));

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../../src/ui/HUD', () => ({
  initHUD: vi.fn(),
  openPage,
  setHomeCallback: vi.fn(),
}));
vi.mock('../../src/ui/OverlayVisibility', () => ({
  hideHomeMenuLayer: vi.fn(),
  showHomeMenuLayer: vi.fn(),
}));
vi.mock('../../src/ui/SceneTransitionCover', () => ({
  hideSceneTransitionCoverAfterPaint: vi.fn(),
  showPlayEntryTransitionCover: vi.fn(),
}));
vi.mock('../../src/ads/Service', () => ({ adService: {} }));
vi.mock('../../src/haptics/HapticsManager', () => ({ hapticWrong: vi.fn() }));
vi.mock('../../src/menu/MenuVignette', () => ({ configuredMenuVignetteFactory: (): null => null }));
vi.mock('../../src/audio/AmbientManager', () => ({ crossfadeTo: vi.fn(), presetForLevel: vi.fn() }));
vi.mock('../../src/v1core/ui', () => ({ mountLevelMap: vi.fn() }));
vi.mock('../../src/platform/browserScheduling', () => ({
  hasLowDataConnection: (): boolean => true,
  runWhenVisibleAndIdle: vi.fn(),
}));
vi.mock('../../src/platform/gameLifecycle', () => ({
  isGameSuspended: (): boolean => false,
  registerLifecycleHooks: vi.fn(() => vi.fn()),
}));
vi.mock('../../src/scenes/GameScene', () => ({ GameScene: class {} }));
vi.mock('../../src/data/levels', () => ({
  getLevelIndex: vi.fn(async () => []),
  loadLevel: vi.fn(),
  loadLevelForProgression: vi.fn(),
}));
vi.mock('../../src/core/GameState', () => ({
  gameState: {
    currentLevelIndex: 0,
    walletSnapshot: () => ({ coins: 0, hints: 0, counters: {} }),
  },
}));

import { HomeScene } from '../../src/scenes/HomeScene';

interface HomeSceneInternals {
  overlay: HTMLElement | null;
  navigationGeneration: number;
  levelIndex: unknown[];
  bannerVideoReplayTimer: number | null;
  bannerVideoElement: HTMLVideoElement | null;
  bannerVideoEndedHandler: ((event: Event) => void) | null;
  bannerVideoRetryCount: number;
  isShuttingDown: boolean;
  renderHomeScreen(): void;
}

function renderHome(): HTMLElement {
  document.body.innerHTML = '<div id="hud-overlay"></div>';
  const overlay = document.getElementById('hud-overlay')!;
  const scene = Object.create(HomeScene.prototype) as unknown as HomeSceneInternals;
  scene.overlay = overlay;
  scene.navigationGeneration = 0;
  scene.levelIndex = [];
  scene.bannerVideoReplayTimer = null;
  scene.bannerVideoElement = null;
  scene.bannerVideoEndedHandler = null;
  scene.bannerVideoRetryCount = 0;
  scene.isShuttingDown = false;
  scene.renderHomeScreen();
  return overlay;
}

describe('achievement Home discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
  });

  it('keeps Achievements in the left rail without adding a fourth nav cell', () => {
    const overlay = renderHome();
    const rail = overlay.querySelector('.home-rail-left')!;
    const nav = overlay.querySelector('.home-nav-bar')!;
    expect(rail.querySelector('#home-no-ads')).not.toBeNull();
    expect(rail.querySelector('#home-achievements')?.getAttribute('aria-label')).toBe('Open achievements');
    expect(nav.querySelector('#home-achievements')).toBeNull();
    expect(nav.querySelectorAll('button')).toHaveLength(3);
  });

  it('clicking the home achievements trigger opens the achievements page', () => {
    const overlay = renderHome();
    const trigger = overlay.querySelector<HTMLButtonElement>('#home-achievements')!;
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openPage).toHaveBeenCalledWith('achievements');
  });

  it('ignores the trigger while a page overlay is already open', () => {
    const overlay = renderHome();
    const page = document.createElement('div');
    page.id = 'home-page-overlay';
    document.body.append(page);
    overlay.querySelector<HTMLButtonElement>('#home-achievements')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openPage).not.toHaveBeenCalled();
  });

  it('keeps compact touch sizing for the rail action', () => {
    const css = readFileSync(join(process.cwd(), 'src/ui/styles.css'), 'utf8');
    expect(css).toContain('.home-achievements-btn');
    expect(css).toMatch(/\.home-side-btn\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(css).toContain('@media (max-height: 600px)');
  });
});
