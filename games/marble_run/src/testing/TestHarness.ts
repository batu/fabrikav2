import Phaser from 'phaser';
import { driveInputAt, type ClientPoint, type GameHarness, type HarnessSaveProfile } from '@fabrikav2/testkit/harness';
import { gameState, type CompletionTransaction, type GameSettings, type WalletSnapshot } from '../core/GameState';
import { GAMEPLAY, TIMING } from '../core/Constants';
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
  type DriveStatePredicates,
  type DriveToDeps,
  type ViewportMetricsSnapshot,
} from '@fabrikav2/testkit/testing';

type MarbleRunVerb = 'gotoHome' | 'startLevel' | 'openSettings' | 'pause' | 'winLevel' | 'failLevel';

export const marbleRunDrivePredicates = {
  menu: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    return scene === 'menu' || scene === 'HomeScene' || snapshot.homeShellVisible === true;
  },
  level: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    const status = String(snapshot.status ?? '');
    const ready = snapshot.inputReady !== false && snapshot.levelDataReady !== false;
    return ready
      && (scene === 'playing' || scene === 'GameScene')
      && snapshot.levelComplete !== true
      && snapshot.lifecycleSuspended !== true
      && snapshot.homeShellVisible !== true
      && snapshot.levelCompleteOverlayVisible !== true
      && snapshot.levelFailedOverlayVisible !== true
      && status !== 'paused'
      && status !== 'complete'
      && status !== 'failed'
      && snapshot.lives !== 0;
  },
  settings: (snapshot: DriveSnapshot): boolean => snapshot.settingsOpen === true,
  pause: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    const status = String(snapshot.status ?? '');
    return scene === 'paused' || (scene === 'GameScene' && (status === 'paused' || snapshot.lifecycleSuspended === true));
  },
  win: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    const status = String(snapshot.status ?? '');
    const gameplayVisible = snapshot.homeShellVisible !== true;
    return gameplayVisible && (scene === 'complete'
      || snapshot.levelCompleteOverlayVisible === true
      || (scene === 'GameScene' && (status === 'complete' || snapshot.levelComplete === true)));
  },
  fail: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    const status = String(snapshot.status ?? '');
    const gameplayVisible = snapshot.homeShellVisible !== true;
    return gameplayVisible && (scene === 'failed'
      || snapshot.levelFailedOverlayVisible === true
      || (scene === 'GameScene' && (status === 'failed' || snapshot.lives === 0)));
  },
} satisfies DriveStatePredicates;

export function snapshotMatchesMarbleRunDriveState(state: DriveState, raw: unknown): boolean {
  const snapshot = (raw ?? {}) as DriveSnapshot;
  return marbleRunDrivePredicates[state](snapshot);
}

const SETTINGS_PAGE_SELECTOR = [
  '#home-page-overlay.home-page-settings',
  '.settings-page-card',
  '[data-page="settings"]',
  '.settings-page',
  '#settings-page',
].join(', ');

const SETTINGS_OPEN_TRIGGER_SELECTOR = '#home-nav-settings, #settings-btn';
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
  driveTo(state: DriveState): Promise<boolean>;
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
    return waitUntil(
      () => marbleRunDrivePredicates.settings(driveSnapshot()),
      SETTINGS_OPEN_TARGET_POLL_MS,
      SETTINGS_OPEN_TARGET_MAX_POLLS,
    );
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
    const settingsOpen = document.querySelector(SETTINGS_PAGE_SELECTOR) !== null;
    const levelCompleteOverlayVisible = document.getElementById('level-complete-overlay') !== null;
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
      if (isDriveState(state)) void harness.driveTo(state);
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

    driveTo(state: DriveState): Promise<boolean> {
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
