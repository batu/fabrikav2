import Phaser from 'phaser';
import { driveInputAt, type ClientPoint, type GameHarness, type HarnessSaveProfile } from '@fabrikav2/testkit/harness';
import { gameState, type CompletionTransaction, type GameSettings, type WalletSnapshot } from '../core/GameState';
import { GAMEPLAY, TIMING } from '../core/Constants';
import { LEVEL_COUNT } from '../three/constants';
import { GameScene } from '../scenes/GameScene';
import { loadLevel, packageCacheSnapshot as getPackageCacheSnapshot, runtimeSequenceSnapshot as getRuntimeSequenceSnapshot, type LevelData } from '../data/levels';
import type { RuntimeSequenceResolution } from '../sequence/runtimeSequence';
import type { planRollingPackageRetention } from '../data/levelPackageCache';
import { remoteConfigService, type RemoteConfigSnapshot } from '../config/RemoteConfigService';
import { iapService, type IapSnapshot, type IapTestState } from '../shop/IapService';
import { setRewardedAdResultForTest, type RewardedAdResultForTest } from '../ads/Service';
import { isGameSuspended, setLifecycleForTest } from '../platform/gameLifecycle';
import { initHUD, openPage } from '../ui/HUD';
import { setFailOverlayPendingRecoveryMsForTest } from '../ui/LevelFailedOverlay';
import {
  driveTo,
  isDriveState,
  readViewportMetrics,
  type DriveSnapshot,
  type DriveState,
  type DriveToDeps,
  type ViewportMetricsSnapshot,
} from '@fabrikav2/testkit/testing';
import { marbleRunDrivePredicates, snapshotMatchesMarbleRunDriveState, type SettingsVariant } from './drivePredicates';
import {
  PIXELSMITH_STATE_LEVELS,
  isGameplayState,
  isPixelsmithState,
  pixelsmithStatePredicates,
  type PixelsmithState,
} from './pixelsmithStates';

type MarbleRunVerb = 'gotoHome' | 'startLevel' | 'openSettings' | 'pause' | 'winLevel' | 'failLevel';

export type MarbleRunDriveState = DriveState | PixelsmithState;

// Re-exported so existing consumers (bootstrap, tests) keep importing the drive
// predicates from TestHarness; the definitions now live in the Phaser-free
// drivePredicates module (shared with pixelsmithStates).
export { marbleRunDrivePredicates, snapshotMatchesMarbleRunDriveState };

const SETTINGS_PAGE_SELECTOR = [
  '#home-page-overlay.home-page-settings',
  '.settings-page-card',
  '[data-page="settings"]',
  '.settings-page',
  '#settings-page',
].join(', ');

const SHOP_PAGE_SELECTOR = '#home-page-overlay.home-page-shop';
const LEVELMAP_NODE_SELECTOR = '.fab-levelmap-node';
const SETTINGS_OPEN_TRIGGER_SELECTOR = '#home-nav-settings, #settings-btn';
// The real home gear (game-owned header, homeMenu.ts) and the in-game HUD
// settings button (hud.ts) — the drives click these so pause/settings open the
// same modals a player would see, not a lifecycle flag or a page overlay.
const HOME_GEAR_SELECTOR = '.marble-gear-btn[data-fab-action="settings"]';
const HUD_SETTINGS_BUTTON_SELECTOR = '[data-a="settings"]';
// v1 driveTo('win'): run at 6x and tap a movable marble each frame until the
// engine genuinely completes the level and the overlay mounts.
const WIN_DRIVE_ANIMATION_SPEED = 6;
const WIN_DRIVE_MAX_TAPS = 120;
const WIN_DRIVE_TAP_INTERVAL_MS = 140;
const SETTINGS_OPEN_TARGET_POLL_MS = 50;
const SETTINGS_OPEN_TARGET_MAX_POLLS = 40;
const HOME_PLAY_TRIGGER_SELECTOR = '#home-play-now, #home-nav-play, .fab-levelmap-node.current';
const HOME_READY_TARGET_POLL_MS = 50;
const HOME_READY_TARGET_MAX_POLLS = 80;
const START_LEVEL_TARGET_POLL_MS = 50;
const START_LEVEL_TARGET_MAX_POLLS = 160;
const TERMINAL_TARGET_POLL_MS = 50;
const TERMINAL_TARGET_MAX_POLLS = 160;
const LOSE_LIFE_SETTLE_MS = TIMING.PENALTY_COOLDOWN_MS + 20;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

async function waitUntil(
  predicate: () => boolean,
  pollMs: number,
  maxPolls: number,
): Promise<boolean> {
  for (let i = 0; i < maxPolls; i += 1) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
}

function elementClientCenter(element: HTMLElement): ClientPoint | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

/**
 * True when `el` is mounted AND actually rendered — has layout box, is not
 * display:none/visibility:hidden, and is not fully transparent. The UI-truth
 * predicates require this so a detached-or-hidden node can never publish a
 * tourstate marker for a surface the player can't see (wave-1 lying markers).
 */
function isElementVisible(el: Element | null | undefined): boolean {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (Number.parseFloat(style.opacity || '1') <= 0.01) return false;
  // On device (WKWebView) an off-layout node has a zero box; reject it. In a
  // headless DOM (jsdom) getBoundingClientRect is always 0×0, so only apply the
  // box check where layout is actually measured.
  const rect = el.getBoundingClientRect();
  const hasLayout = rect.width > 0 || rect.height > 0;
  const layoutMeasured = document.documentElement.getBoundingClientRect().width > 0;
  return hasLayout || !layoutMeasured;
}

/**
 * Which settings modal (if any) is mounted AND visible, distinguished by the
 * action rows the game renders per variant (menu = Close; in-game = Restart/
 * Home). The kit modal card (`.fab-modal-card`) carries aria-modal, so the
 * testkit marker re-parents into it — the variant is the game's DOM truth.
 */
function detectSettingsVariant(): SettingsVariant {
  const menuBtn = document.querySelector('[data-action="settings-close"]');
  if (isElementVisible(menuBtn?.closest('.fab-modal-card') ?? menuBtn)) return 'menu';
  const ingameBtn = document.querySelector('[data-action="settings-restart"], [data-action="settings-home"]');
  if (isElementVisible(ingameBtn?.closest('.fab-modal-card') ?? ingameBtn)) return 'ingame';
  return null;
}

function driveElementClick(element: HTMLElement): boolean {
  const point = elementClientCenter(element);
  if (point !== null && typeof document.elementFromPoint === 'function') {
    const { hitTarget } = driveInputAt(point);
    return hitTarget !== null && (hitTarget === element || element.contains(hitTarget));
  }

  element.click();
  return true;
}

export interface MarbleRunSnapshot {
  /** Visible scene/surface inferred from DOM plus Phaser. */
  activeScene: string;
  /** Raw Phaser scene key, retained to expose visible/engine divergence. */
  phaserActiveScene: string;
  status: 'playing' | 'paused' | 'complete' | 'failed' | undefined;
  settingsOpen: boolean;
  /** Mounted+visible settings modal variant (menu Close / in-game Restart-Home), else null. */
  settingsVariant: SettingsVariant;
  shopOpen: boolean;
  levelMapVisible: boolean;
  homeShellVisible: boolean;
  levelCompleteOverlayVisible: boolean;
  levelFailedOverlayVisible: boolean;
  lifecycleSuspended: boolean;
  levelId: string;
  levelSize: { width: number; height: number };
  totalDogs: number;
  foundDogIds: string[];
  lives: number;
  hintsRemaining: number;
  wallet: WalletSnapshot;
  completionTransaction: CompletionTransaction | null;
  hintCircleActive: boolean;
  levelComplete: boolean;
  gameSize: { width: number; height: number };
  viewportMetrics: ViewportMetricsSnapshot;
  runtimeSequence: RuntimeSequenceResolution | null;
  packageCache: {
    catalogRevision: string | null;
    packageCount: number;
    lastRetentionPlan: ReturnType<typeof planRollingPackageRetention> | null;
    lastServingAttempt: LevelData['servingAttempt'] | null;
    lastKnownLiveListedStorageKey: string;
  };
  levelDataReady: boolean;
}

export interface MarbleRunHarness extends GameHarness<MarbleRunVerb> {
  readonly enabled: boolean;
  readonly verbs: {
    gotoHome: { run: () => Promise<boolean> };
    startLevel: { run: () => Promise<boolean> };
    openSettings: { run: () => Promise<boolean> };
    pause: { run: () => Promise<boolean> };
    winLevel: { run: () => Promise<boolean> };
    failLevel: { run: () => Promise<boolean> };
  };
  gotoGameScene(levelId?: string): void;
  /**
   * Start GameScene with a synthetic LevelData payload. Test-only:
   * skips the manifest + AssetCache entirely.
   */
  gotoSyntheticLevel(levelData: LevelData): void;
  winLevel(): Promise<boolean>;
  failLevel(): Promise<boolean>;
  driveTo(state: MarbleRunDriveState): Promise<boolean>;
  resetSave(): void;
  seedSave(profile: HarnessSaveProfile): void;
  setState(partial: { lives?: number; hintsRemaining?: number; currentLevelIndex?: number }): void;
  setWallet(partial: { coins?: number; hints?: number; noAds?: boolean; premium?: boolean; rewardProgressCount?: number }): void;
  markProcessedPurchaseId(id: string): boolean;
  grantRewardedHintForTest(): void;
  walletSnapshot(): WalletSnapshot;
  /**
   * Mutate any subset of persisted settings. `save()` persists to
   * localStorage so the change survives scene.restart. Unknown keys ignored.
   */
  setSettings(partial: Partial<GameSettings>): void;
  remoteConfigSnapshot(): RemoteConfigSnapshot;
  runtimeSequenceSnapshot(): RuntimeSequenceResolution | null;
  packageCacheSnapshot(): MarbleRunSnapshot['packageCache'];
  iapSnapshot(): IapSnapshot;
  setIapStateForTest(state: IapTestState): void;
  setRemoteConfigValuesForTest(values: Parameters<typeof remoteConfigService.setValuesForTest>[0]): void;
  setRewardedAdResultForTest(result: RewardedAdResultForTest | null): void;
  setLifecycleForTest(state: 'active' | 'inactive'): void;
  setFailOverlayPendingRecoveryMsForTest(ms: number | null): void;
  gotoHomeForTest(): void;
  snapshot(): MarbleRunSnapshot;
}

export function createMarbleRunHarness(game: Phaser.Game): MarbleRunHarness {
  function getGameScene(): GameScene | null {
    return game.scene.getScene('GameScene') as GameScene | null;
  }

  function prepareGameplayOverlay(): void {
    game.scene.stop('BootScene');
    game.scene.stop('HomeScene');
    initHUD();
  }

  async function gotoHome(): Promise<boolean> {
    setLifecycleForTest('active');
    game.scene.stop('GameScene');
    game.scene.start('HomeScene');
    return waitUntil(
      () => marbleRunDrivePredicates.menu(driveSnapshot()),
      HOME_READY_TARGET_POLL_MS,
      HOME_READY_TARGET_MAX_POLLS,
    );
  }

  async function startLevel(levelId: number = gameState.currentLevelIndex + 1): Promise<boolean> {
    setLifecycleForTest('active');
    if (Number.isFinite(levelId)) {
      gameState.currentLevelIndex = Math.max(0, Math.floor(levelId) - 1);
      gameState.save();
    }

    const atMenu = await gotoHome();
    if (!atMenu) return false;

    const buttonReady = await waitUntil(
      () => document.querySelector(HOME_PLAY_TRIGGER_SELECTOR) !== null,
      HOME_READY_TARGET_POLL_MS,
      HOME_READY_TARGET_MAX_POLLS,
    );
    if (!buttonReady) return false;

    // The scene-transition cover swallows pointer input while it fades
    // (~1.5-2.4s after boot). A single click racing that window hits the
    // cover, not the Play button, and the level never starts — so wait the
    // cover out and retry the click until the level predicate confirms.
    await waitUntil(
      () => document.getElementById('scene-transition-cover') === null,
      HOME_READY_TARGET_POLL_MS,
      HOME_READY_TARGET_MAX_POLLS,
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const trigger = document.querySelector<HTMLElement>(HOME_PLAY_TRIGGER_SELECTOR);
      if (trigger !== null) driveElementClick(trigger);
      const started = await waitUntil(
        () => marbleRunDrivePredicates.level(driveSnapshot()),
        START_LEVEL_TARGET_POLL_MS,
        START_LEVEL_TARGET_MAX_POLLS / 3,
      );
      if (started) return true;
      if (document.querySelector(HOME_PLAY_TRIGGER_SELECTOR) === null) break;
    }

    return waitUntil(
      () => marbleRunDrivePredicates.level(driveSnapshot()),
      START_LEVEL_TARGET_POLL_MS,
      START_LEVEL_TARGET_MAX_POLLS,
    );
  }

  async function waitForSettingsOpenTarget(): Promise<void> {
    for (let i = 0; i < SETTINGS_OPEN_TARGET_MAX_POLLS; i += 1) {
      if (document.querySelector(SETTINGS_PAGE_SELECTOR) !== null) return;
      if (document.querySelector(SETTINGS_OPEN_TRIGGER_SELECTOR) !== null) return;
      await sleep(SETTINGS_OPEN_TARGET_POLL_MS);
    }
  }

  async function openSettingsFromUi(): Promise<boolean> {
    await waitForSettingsOpenTarget();
    const button = document.querySelector<HTMLButtonElement>(SETTINGS_OPEN_TRIGGER_SELECTOR);
    if (button !== null) {
      driveElementClick(button);
    }
    if (document.querySelector(SETTINGS_PAGE_SELECTOR) === null) openPage('settings');
    // Generic settings verb: confirm ANY settings surface is open (page or
    // modal). The strict menu-modal (Close variant) capture is the Pixelsmith
    // `settings` state's own drive (driveMenuSettingsViaUi), not this verb.
    return waitUntil(
      () => driveSnapshot().settingsOpen === true,
      SETTINGS_OPEN_TARGET_POLL_MS,
      SETTINGS_OPEN_TARGET_MAX_POLLS,
    );
  }

  async function openShopFromUi(): Promise<boolean> {
    const atHome = marbleRunDrivePredicates.menu(driveSnapshot()) || await gotoHome();
    if (!atHome) return false;
    if (document.querySelector(SHOP_PAGE_SELECTOR) === null) openPage('shop');
    return waitUntil(
      () => pixelsmithStatePredicates.shop(driveSnapshot()),
      SETTINGS_OPEN_TARGET_POLL_MS,
      SETTINGS_OPEN_TARGET_MAX_POLLS,
    );
  }

  async function driveToPixelsmithState(state: PixelsmithState): Promise<boolean> {
    if (state === 'home-fresh') {
      harness.resetSave();
      const atHome = await gotoHome();
      return atHome && pixelsmithStatePredicates['home-fresh'](driveSnapshot());
    }
    if (state === 'level-map') {
      const atHome = await gotoHome();
      if (!atHome) return false;
      return waitUntil(
        () => pixelsmithStatePredicates['level-map'](driveSnapshot()),
        HOME_READY_TARGET_POLL_MS,
        HOME_READY_TARGET_MAX_POLLS,
      );
    }
    if (state === 'shop') return openShopFromUi();
    if (isGameplayState(state)) {
      // v1 driveTo parity: teach shows the tutorial hand (fires only on level 1
      // from a pristine save); opener/plugs/voids seed prior progress so the
      // hand is suppressed (opener shares level 1 with teach — progress is the
      // sole differentiator, see GameScene isFirstLevel + pixelsmithStates map).
      if (state === 'gameplay-teach') harness.resetSave();
      else gameState.setTotalLevelsCompletedForTest(LEVEL_COUNT);
      const started = await startLevel(PIXELSMITH_STATE_LEVELS[state]);
      return started && marbleRunDrivePredicates.level(driveSnapshot());
    }
    if (state === 'win') return driveWinViaPlay();
    if (state === 'pause') return drivePauseViaUi();
    if (state === 'settings') return driveMenuSettingsViaUi();
    return harness.driveTo(state);
  }

  /**
   * Win drive — v1 driveTo('win') semantics. Seed progress (no tutorial hand),
   * start level 1, run the board at 6x and tap a movable marble each cycle until
   * the engine genuinely completes and the level-complete overlay mounts. No
   * `scene.winLevel()` shortcut — the Pixelsmith capture must show the real
   * result card, so the predicate (visible overlay + reward row) is the target.
   */
  async function driveWinViaPlay(): Promise<boolean> {
    gameState.setTotalLevelsCompletedForTest(LEVEL_COUNT);
    const started = await startLevel(1);
    if (!started) return false;
    const controller = getGameScene()?.getGameplayControllerForTest();
    if (controller === null || controller === undefined) return false;
    controller.setAnimationSpeed(WIN_DRIVE_ANIMATION_SPEED);
    for (let i = 0; i < WIN_DRIVE_MAX_TAPS; i += 1) {
      if (pixelsmithStatePredicates.win(driveSnapshot())) return true;
      const movable = controller.engineRef()?.movableMarbles() ?? [];
      if (movable.length > 0) controller.tapCell(movable[0].cell);
      await sleep(WIN_DRIVE_TAP_INTERVAL_MS);
    }
    return pixelsmithStatePredicates.win(driveSnapshot());
  }

  /**
   * Pause drive — open the in-game settings modal (Restart/Home variant) through
   * the real HUD settings button, NOT a lifecycle suspend. The wave-1 pause
   * capture was raw gameplay because the drive only set the lifecycle flag; the
   * predicate now demands the mounted+visible in-game modal.
   */
  async function drivePauseViaUi(): Promise<boolean> {
    gameState.setTotalLevelsCompletedForTest(LEVEL_COUNT);
    const started = await startLevel(1);
    if (!started) return false;
    const opened = await waitUntil(() => {
      if (detectPauseModalVisible()) return true;
      const button = document.querySelector<HTMLElement>(HUD_SETTINGS_BUTTON_SELECTOR);
      if (button !== null) driveElementClick(button);
      return detectPauseModalVisible();
    }, SETTINGS_OPEN_TARGET_POLL_MS, SETTINGS_OPEN_TARGET_MAX_POLLS);
    return opened && marbleRunDrivePredicates.pause(driveSnapshot());
  }

  function detectPauseModalVisible(): boolean {
    return marbleRunDrivePredicates.pause(driveSnapshot());
  }

  /**
   * Menu settings drive — go home first, then open the menu settings modal
   * (Close variant) through the real home gear. MRV2-5 ruling: menu settings =
   * Close variant. The wave-1 drive opened the in-game (Restart/Home) variant
   * over gameplay and never published a marker.
   */
  async function driveMenuSettingsViaUi(): Promise<boolean> {
    const atHome = await gotoHome();
    if (!atHome) return false;
    const opened = await waitUntil(() => {
      if (marbleRunDrivePredicates.settings(driveSnapshot())) return true;
      const gear = document.querySelector<HTMLElement>(HOME_GEAR_SELECTOR);
      if (gear !== null) driveElementClick(gear);
      return marbleRunDrivePredicates.settings(driveSnapshot());
    }, SETTINGS_OPEN_TARGET_POLL_MS, SETTINGS_OPEN_TARGET_MAX_POLLS);
    return opened && marbleRunDrivePredicates.settings(driveSnapshot());
  }

  async function pauseGame(): Promise<boolean> {
    setLifecycleForTest('inactive');
    return waitUntil(
      () => marbleRunDrivePredicates.pause(driveSnapshot()),
      TERMINAL_TARGET_POLL_MS,
      TERMINAL_TARGET_MAX_POLLS,
    );
  }

  async function winLevel(): Promise<boolean> {
    getGameScene()?.winLevel();
    return waitUntil(
      () => marbleRunDrivePredicates.win(driveSnapshot()),
      TERMINAL_TARGET_POLL_MS,
      TERMINAL_TARGET_MAX_POLLS,
    );
  }

  async function failLevel(): Promise<boolean> {
    for (let i = 0; i < GAMEPLAY.LIVES_PER_LEVEL + 2; i += 1) {
      if (marbleRunDrivePredicates.fail(driveSnapshot())) return true;
      getGameScene()?.loseLife();
      if (marbleRunDrivePredicates.fail(driveSnapshot())) return true;
      await sleep(LOSE_LIFE_SETTLE_MS);
    }
    return waitUntil(
      () => marbleRunDrivePredicates.fail(driveSnapshot()),
      TERMINAL_TARGET_POLL_MS,
      TERMINAL_TARGET_MAX_POLLS,
    );
  }

  function driveSnapshot(): DriveSnapshot {
    const snapshot = harnessSnapshot();
    return {
      activeScene: snapshot.activeScene,
      phaserActiveScene: snapshot.phaserActiveScene,
      inputReady: snapshot.levelDataReady,
      settingsOpen: snapshot.settingsOpen,
      settingsVariant: snapshot.settingsVariant,
      shopOpen: snapshot.shopOpen,
      levelMapVisible: snapshot.levelMapVisible,
      homeShellVisible: snapshot.homeShellVisible,
      levelCompleteOverlayVisible: snapshot.levelCompleteOverlayVisible,
      levelFailedOverlayVisible: snapshot.levelFailedOverlayVisible,
      lifecycleSuspended: snapshot.lifecycleSuspended,
      levelComplete: snapshot.levelComplete,
      lives: snapshot.lives,
      status: snapshot.status,
    };
  }

  function driveDeps(): DriveToDeps {
    return {
      gotoMenu: async () => { await gotoHome(); },
      startLevel: async (id) => { await startLevel(id); },
      openSettings: async () => { await openSettingsFromUi(); },
      pause: async () => { await pauseGame(); },
      autoWin: () => winLevel(),
      autoFail: () => failLevel(),
      snapshot: () => driveSnapshot(),
    };
  }

  function harnessSnapshot(): MarbleRunSnapshot {
    const scene = getGameScene();
    const phaserActiveScene = game.scene.getScenes(true)[0]?.scene.key ?? 'unknown';
    const homeShellVisible = document.querySelector('#home-shell') !== null;
    const settingsVariant = detectSettingsVariant();
    // settingsOpen stays broad (modal OR legacy page overlay) so home-fresh /
    // level-map exclusions still hold; the win/pause/settings predicates key on
    // the visibility-qualified settingsVariant instead.
    const settingsOpen = settingsVariant !== null || document.querySelector(SETTINGS_PAGE_SELECTOR) !== null;
    const shopOpen = document.querySelector(SHOP_PAGE_SELECTOR) !== null;
    const levelMapVisible = document.querySelector(LEVELMAP_NODE_SELECTOR) !== null;
    // UI-truth: the overlay must be mounted AND visibly rendered, not merely
    // present in the DOM. The reward row is dropped-reveal so it is intrinsic to
    // the mounted overlay — the overlay's own visibility is the capture truth.
    const levelCompleteEl = document.getElementById('level-complete-overlay');
    const levelCompleteOverlayVisible = isElementVisible(levelCompleteEl);
    const levelFailedOverlayVisible = document.getElementById('level-failed-overlay') !== null;
    const activeScene = homeShellVisible ? 'HomeScene' : phaserActiveScene;
    const visibleGameScene = activeScene === 'GameScene';
    const level = scene?.getLevel();
    const levelComplete = visibleGameScene && ((scene?.isLevelComplete() ?? false) || levelCompleteOverlayVisible);
    const levelFailed = visibleGameScene && (levelFailedOverlayVisible || gameState.lives <= 0);

    return {
      activeScene,
      phaserActiveScene,
      status: isGameSuspended()
        ? 'paused'
        : levelFailed
          ? 'failed'
          : levelComplete
            ? 'complete'
            : visibleGameScene
              ? 'playing'
              : undefined,
      settingsOpen,
      settingsVariant,
      shopOpen,
      levelMapVisible,
      homeShellVisible,
      levelCompleteOverlayVisible,
      levelFailedOverlayVisible,
      lifecycleSuspended: isGameSuspended(),
      levelId: level?.id ?? '',
      levelSize: { width: level?.width ?? 0, height: level?.height ?? 0 },
      totalDogs: level?.dogs.length ?? 0,
      foundDogIds: [...gameState.foundDogIds],
      lives: gameState.lives,
      hintsRemaining: gameState.hintsRemaining,
      wallet: gameState.walletSnapshot(),
      completionTransaction: gameState.completionTransactionSnapshot(),
      hintCircleActive: gameState.hintCircleActive,
      levelComplete,
      gameSize: { width: game.canvas.width, height: game.canvas.height },
      viewportMetrics: readViewportMetrics(game.canvas),
      runtimeSequence: getRuntimeSequenceSnapshot(),
      packageCache: getPackageCacheSnapshot(),
      levelDataReady: scene?.isLevelDataReady() ?? false,
    };
  }

  const harness = {
    enabled: true,

    verbs: {
      gotoHome: { run: gotoHome },
      startLevel: { run: startLevel },
      openSettings: { run: openSettingsFromUi },
      pause: { run: pauseGame },
      winLevel: { run: winLevel },
      failLevel: { run: failLevel },
    },

    gotoState(state: string): void {
      if (isDriveState(state) || isPixelsmithState(state)) {
        void harness.driveTo(state as MarbleRunDriveState);
      }
    },

    startLevel(id: number): void {
      void startLevel(id);
    },

    sagaNodes(): readonly (string | number)[] {
      return getRuntimeSequenceSnapshot()?.levelIds ?? [];
    },

    unlockAll(): void {
      const totalLevels = getRuntimeSequenceSnapshot()?.levelIds.length ?? 54;
      gameState.currentLevelIndex = Math.max(0, totalLevels - 1);
      gameState.save();
    },

    grantCoins(amount: number): void {
      gameState.grantCoins(amount, 'test');
    },

    gotoGameScene(levelId?: string): void {
      if (levelId === undefined) {
        void startLevel();
        return;
      }
      prepareGameplayOverlay();
      void loadLevel(levelId)
        .then((levelData) => {
          const scene = game.scene.getScene('GameScene');
          if (scene !== null) {
            scene.scene.restart({ levelData });
          } else {
            game.scene.start('GameScene', { levelData });
          }
        })
        .catch((err) => {
          console.error('[harness] gotoGameScene loadLevel failed:', err);
        });
    },

    gotoSyntheticLevel(levelData: LevelData): void {
      prepareGameplayOverlay();
      const scene = game.scene.getScene('GameScene');
      if (scene !== null) scene.scene.restart({ levelData });
      else game.scene.start('GameScene', { levelData });
    },

    winLevel,

    failLevel,

    driveTo(state: MarbleRunDriveState): Promise<boolean> {
      if (isPixelsmithState(state) && !isDriveState(state)) {
        return driveToPixelsmithState(state);
      }
      return driveTo(driveDeps(), state, {
        predicates: marbleRunDrivePredicates,
        playingReady: marbleRunDrivePredicates.level,
        maxPolls: START_LEVEL_TARGET_MAX_POLLS,
      });
    },

    resetSave(): void {
      gameState.currentLevelIndex = 0;
      gameState.setCoinsForTest(0);
      gameState.setHintsForTest(0);
      // Pristine progress so the level-1 tutorial hand shows (teach state) and
      // home-fresh renders the fresh-install saga — gameState.reset() only
      // clears per-attempt state (lives/found), not lifetime progress.
      gameState.setTotalLevelsCompletedForTest(0);
      gameState.tutorialShown = false;
      gameState.reset();
      gameState.save();
    },

    seedSave(profile: HarnessSaveProfile): void {
      if (typeof profile.unlockedLevel === 'number') {
        gameState.currentLevelIndex = Math.max(0, profile.unlockedLevel - 1);
      }
      if (typeof profile.coins === 'number') gameState.setCoinsForTest(profile.coins);
      if (profile.noAds === true) gameState.grantNoAdsEntitlement();
      if (typeof profile.music === 'boolean') gameState.settings.musicOn = profile.music;
      if (typeof profile.sfx === 'boolean') gameState.settings.soundEffectsOn = profile.sfx;
      if (typeof profile.haptics === 'boolean') gameState.settings.hapticsOn = profile.haptics;
      gameState.save();
    },

    setState(partial: { lives?: number; hintsRemaining?: number; currentLevelIndex?: number }): void {
      if (partial.lives !== undefined) gameState.lives = partial.lives;
      if (partial.hintsRemaining !== undefined) gameState.setHintsForTest(partial.hintsRemaining);
      if (partial.currentLevelIndex !== undefined) gameState.currentLevelIndex = partial.currentLevelIndex;
      gameState.save();
    },

    setWallet(partial: { coins?: number; hints?: number; noAds?: boolean; premium?: boolean; rewardProgressCount?: number }): void {
      if (partial.coins !== undefined) gameState.setCoinsForTest(partial.coins);
      if (partial.hints !== undefined) gameState.setHintsForTest(partial.hints);
      if (partial.noAds === true) gameState.grantNoAdsEntitlement();
      if (partial.premium === true) gameState.grantPremiumEntitlement();
      if (partial.rewardProgressCount !== undefined) gameState.setRewardProgressForTest(partial.rewardProgressCount);
    },

    markProcessedPurchaseId(id: string): boolean {
      return gameState.markProcessedPurchaseId(id);
    },

    grantRewardedHintForTest(): void {
      gameState.grantRewardedHint();
    },

    walletSnapshot(): WalletSnapshot {
      return gameState.walletSnapshot();
    },

    setSettings(partial: Partial<GameSettings>): void {
      if (typeof partial.voronoiReveal === 'boolean') gameState.settings.voronoiReveal = partial.voronoiReveal;
      if (typeof partial.soundOn === 'boolean') gameState.settings.soundOn = partial.soundOn;
      if (typeof partial.musicOn === 'boolean') gameState.settings.musicOn = partial.musicOn;
      if (typeof partial.soundEffectsOn === 'boolean') gameState.settings.soundEffectsOn = partial.soundEffectsOn;
      if (typeof partial.hapticsOn === 'boolean') gameState.settings.hapticsOn = partial.hapticsOn;
      if (typeof partial.showDebugOverlay === 'boolean') gameState.settings.showDebugOverlay = partial.showDebugOverlay;
      if (typeof partial.adsEnabled === 'boolean') gameState.settings.adsEnabled = partial.adsEnabled;
      if (typeof partial.ratePromptEnabled === 'boolean') gameState.settings.ratePromptEnabled = partial.ratePromptEnabled;
      if (typeof partial.tutorialEnabled === 'boolean') gameState.settings.tutorialEnabled = partial.tutorialEnabled;
      if (partial.gameMode === 'classic' || partial.gameMode === 'restoration') gameState.settings.gameMode = partial.gameMode;
      gameState.save();
    },

    remoteConfigSnapshot(): RemoteConfigSnapshot {
      return remoteConfigService.snapshot();
    },

    runtimeSequenceSnapshot(): RuntimeSequenceResolution | null {
      return getRuntimeSequenceSnapshot();
    },

    packageCacheSnapshot(): MarbleRunSnapshot['packageCache'] {
      return getPackageCacheSnapshot();
    },

    iapSnapshot(): IapSnapshot {
      return iapService.snapshot();
    },

    setIapStateForTest(state: IapTestState): void {
      iapService.setStateForTest(state);
    },

    setRemoteConfigValuesForTest(values: Parameters<typeof remoteConfigService.setValuesForTest>[0]): void {
      remoteConfigService.setValuesForTest(values);
    },

    setRewardedAdResultForTest(result: RewardedAdResultForTest | null): void {
      setRewardedAdResultForTest(result);
    },

    setLifecycleForTest(state: 'active' | 'inactive'): void {
      setLifecycleForTest(state);
    },

    setFailOverlayPendingRecoveryMsForTest(ms: number | null): void {
      setFailOverlayPendingRecoveryMsForTest(ms);
    },

    gotoHomeForTest(): void {
      if (game.scene.isActive('HomeScene')) {
        game.scene.stop('HomeScene');
      }
      game.scene.start('HomeScene');
    },

    snapshot(): MarbleRunSnapshot {
      return harnessSnapshot();
    },
  } satisfies MarbleRunHarness;

  return harness;
}
