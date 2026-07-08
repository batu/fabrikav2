import Phaser from 'phaser';
import type { GameHarness, HarnessSaveProfile } from '@fabrikav2/testkit/harness';
import { gameState, type CompletionTransaction, type GameSettings, type WalletSnapshot } from '../core/GameState';
import { GameScene, type ClassicRenderDiagnosticsSnapshot, type RuntimeTexturesSnapshot, type ViewportEffectSnapshot } from '../scenes/GameScene';
import { loadLevel, packageCacheSnapshot as getPackageCacheSnapshot, runtimeSequenceSnapshot as getRuntimeSequenceSnapshot, type LevelData, type LevelDog } from '../data/levels';
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

type FindTheDogVerb = 'gotoHome' | 'startLevel' | 'openSettings' | 'tapSafeMiss';

export const findTheDogDrivePredicates = {
  menu: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    return scene === 'menu' || scene === 'HomeScene';
  },
  level: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    const status = String(snapshot.status ?? '');
    const ready = snapshot.inputReady !== false && snapshot.levelDataReady !== false;
    return ready
      && (scene === 'playing' || scene === 'GameScene')
      && snapshot.levelComplete !== true
      && status !== 'complete'
      && status !== 'failed';
  },
  settings: (snapshot: DriveSnapshot): boolean => snapshot.settingsOpen === true,
  pause: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    const status = String(snapshot.status ?? '');
    return scene === 'paused' || status === 'paused' || snapshot.lifecycleSuspended === true;
  },
  win: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    const status = String(snapshot.status ?? '');
    return scene === 'complete' || status === 'complete' || snapshot.levelComplete === true;
  },
  fail: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    const status = String(snapshot.status ?? '');
    return scene === 'failed' || status === 'failed' || snapshot.lives === 0;
  },
} satisfies DriveStatePredicates;

export function snapshotMatchesFindTheDogDriveState(state: DriveState, raw: unknown): boolean {
  const snapshot = (raw ?? {}) as DriveSnapshot;
  return findTheDogDrivePredicates[state](snapshot);
}

export interface FindTheDogSnapshot {
  activeScene: string;
  status: 'playing' | 'paused' | 'complete' | 'failed' | undefined;
  settingsOpen: boolean;
  lifecycleSuspended: boolean;
  levelId: string;
  levelSize: { width: number; height: number };
  dogPositions: Array<{ id: string; x: number; y: number; r: number; found: boolean }>;
  foundDogIds: string[];
  totalDogs: number;
  lives: number;
  hintsRemaining: number;
  wallet: WalletSnapshot;
  completionTransaction: CompletionTransaction | null;
  hintCircleActive: boolean;
  levelComplete: boolean;
  revealedCellCount: number;
  /** Restoration mode: dissolve cells in flight and completed. Zero in Classic mode. */
  dissolveCells: { active: number; completed: number };
  lastRestorationDissolveBounds: { left: number; top: number; right: number; bottom: number } | null;
  /** Restoration mode: separated sprite fly-to-counter animations. */
  pickupAnimations: { active: number; completed: number };
  /** Runtime-only ambient motion layer; never tied to dog target positions. */
  microAnimations: { activeObjects: number; activeTweens: number };
  lastViewportEffect: ViewportEffectSnapshot | null;
  /** True when setupLevel resolved the scene in Restoration mode. False during Classic mode and before setupLevel completes. */
  isRestoration: boolean;
  imgScale: number;
  imgOffsetX: number;
  imgOffsetY: number;
  cameraZoom: number;
  cameraScrollX: number;
  cameraScrollY: number;
  gameSize: { width: number; height: number };
  viewportMetrics: ViewportMetricsSnapshot;
  runtimeTextures: RuntimeTexturesSnapshot;
  classicRenderDiagnostics: ClassicRenderDiagnosticsSnapshot | null;
  runtimeSequence: RuntimeSequenceResolution | null;
  packageCache: {
    catalogRevision: string | null;
    packageCount: number;
    lastRetentionPlan: ReturnType<typeof planRollingPackageRetention> | null;
    lastServingAttempt: LevelData['servingAttempt'] | null;
    lastKnownLiveListedStorageKey: string;
  };
  /** Section state — null for portrait levels with no SectionController. */
  section: {
    currentIndex: number;
    targetIndex: number | null;
    isPanning: boolean;
    isAfterMidpan: boolean;
    tappableXStart: number;
    tappableXEnd: number;
    cameraScrollX: number;
    cameraScrollY: number;
    totalSections: number;
  } | null;
  levelDataReady: boolean;
}

export interface FindTheDogHarness extends GameHarness<FindTheDogVerb> {
  readonly enabled: boolean;
  readonly verbs: {
    gotoHome: { run: () => void };
    startLevel: { run: () => void };
    openSettings: { run: () => void };
    tapSafeMiss: { run: () => { hitDogId: string | null; penalty: boolean } };
  };
  gotoGameScene(levelId?: string): void;
  /**
   * Start GameScene with a synthetic LevelData payload. Test-only:
   * skips the manifest + AssetCache entirely, so tests can exercise
   * landscape / bgImageUrls combinations that don't ship as bundled
   * levels (e.g. the landscape restoration branch — no shipping
   * landscape has a full bg set yet; see todo 045).
   */
  gotoSyntheticLevel(levelData: LevelData): void;
  findDog(dogId: string): { found: boolean; totalFound: number };
  tapAtLevelCoords(x: number, y: number): { hitDogId: string | null; penalty: boolean };
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
   * Mutate any subset of persisted settings. Used by e2e tests to
   * flip `gameMode` (Classic / Restoration), toggle sound/haptics/ads,
   * etc. without driving the DOM modal. `save()` persists to
   * localStorage so the change survives the scene.restart callers
   * typically fire next. Unknown keys are ignored.
   */
  setSettings(partial: Partial<GameSettings>): void;
  remoteConfigSnapshot(): RemoteConfigSnapshot;
  runtimeSequenceSnapshot(): RuntimeSequenceResolution | null;
  packageCacheSnapshot(): FindTheDogSnapshot['packageCache'];
  iapSnapshot(): IapSnapshot;
  setIapStateForTest(state: IapTestState): void;
  setRemoteConfigValuesForTest(values: Parameters<typeof remoteConfigService.setValuesForTest>[0]): void;
  setRewardedAdResultForTest(result: RewardedAdResultForTest | null): void;
  setLifecycleForTest(state: 'active' | 'inactive'): void;
  setFailOverlayPendingRecoveryMsForTest(ms: number | null): void;
  enableMicroAnimationsForTest(): void;
  /**
   * Directly set the main camera zoom. Test-only: simulates the outcome of a
   * pinch gesture (multi-touch pinch is impractical to drive in Playwright)
   * so the zoom-step of the first-time tutorial can be exercised.
   */
  setCameraZoomForTest(zoom: number): void;
  restorationMaskAlphaAtLevelCoords(x: number, y: number): number | null;
  gotoHomeForTest(): void;
  snapshot(): FindTheDogSnapshot;
}

export function createFindTheDogHarness(game: Phaser.Game): FindTheDogHarness {
  function getGameScene(): GameScene | null {
    return game.scene.getScene('GameScene') as GameScene | null;
  }

  function prepareGameplayOverlay(): void {
    game.scene.stop('BootScene');
    game.scene.stop('HomeScene');
    initHUD();
  }

  function gotoHome(): void {
    game.scene.stop('GameScene');
    game.scene.start('HomeScene');
  }

  function startLevel(): void {
    prepareGameplayOverlay();
    const scene = game.scene.getScene('GameScene');
    if (scene !== null && game.scene.isActive('GameScene')) scene.scene.restart({});
    else game.scene.start('GameScene', {});
  }

  function safeMissPoint(): { x: number; y: number } {
    const snapshot = harnessSnapshot();
    const width = Math.max(1, snapshot.levelSize.width);
    const height = Math.max(1, snapshot.levelSize.height);
    const candidates = [
      { x: width * 0.05, y: height * 0.05 },
      { x: width * 0.95, y: height * 0.05 },
      { x: width * 0.05, y: height * 0.95 },
      { x: width * 0.95, y: height * 0.95 },
      { x: width * 0.5, y: height * 0.5 },
    ];
    return candidates.find((point) => snapshot.dogPositions.every((dog) => (
      Math.hypot(dog.x - point.x, dog.y - point.y) > dog.r * 4
    ))) ?? candidates[0];
  }

  function tapSafeMiss(): { hitDogId: string | null; penalty: boolean } {
    const point = safeMissPoint();
    return harness.tapAtLevelCoords(point.x, point.y);
  }

  async function winLevel(): Promise<boolean> {
    const before = harnessSnapshot();
    for (const dog of before.dogPositions.filter((candidate) => !candidate.found)) {
      harness.findDog(dog.id);
    }
    return harnessSnapshot().levelComplete;
  }

  async function failLevel(): Promise<boolean> {
    for (let i = 0; i < 6; i += 1) {
      const snapshot = harnessSnapshot();
      if (snapshot.lives <= 0) return true;
      tapSafeMiss();
    }
    return harnessSnapshot().lives <= 0;
  }

  function driveSnapshot(): DriveSnapshot {
    const snapshot = harnessSnapshot();
    const settingsOpen = document.querySelector('[data-page="settings"], .settings-page, #settings-page') !== null;
    return {
      activeScene: snapshot.activeScene,
      inputReady: snapshot.levelDataReady,
      settingsOpen,
      levelComplete: snapshot.levelComplete,
      lives: snapshot.lives,
      status: snapshot.status,
    };
  }

  function driveDeps(): DriveToDeps {
    return {
      gotoMenu: () => gotoHome(),
      startLevel: () => startLevel(),
      openSettings: () => openPage('settings'),
      pause: () => setLifecycleForTest('inactive'),
      autoWin: () => winLevel(),
      autoFail: () => failLevel(),
      snapshot: () => driveSnapshot(),
    };
  }

  function harnessSnapshot(): FindTheDogSnapshot {
    const scene = getGameScene();
    const activeScene = game.scene.getScenes(true)[0]?.scene.key ?? 'unknown';
    const level = scene?.getLevel();
    const dogs: LevelDog[] = level?.dogs ?? [];

    return {
      activeScene,
      status: isGameSuspended()
        ? 'paused'
        : gameState.lives <= 0
          ? 'failed'
          : (scene?.isLevelComplete() ?? false)
            ? 'complete'
            : activeScene === 'GameScene'
              ? 'playing'
              : undefined,
      settingsOpen: document.querySelector('[data-page="settings"], .settings-page, #settings-page') !== null,
      lifecycleSuspended: isGameSuspended(),
      levelId: level?.id ?? '',
      levelSize: { width: level?.width ?? 0, height: level?.height ?? 0 },
      dogPositions: dogs.map((d) => ({
        id: d.id,
        x: d.x,
        y: d.y,
        r: d.r,
        found: gameState.foundDogIds.has(d.id),
      })),
      foundDogIds: [...gameState.foundDogIds],
      totalDogs: dogs.length,
      lives: gameState.lives,
      hintsRemaining: gameState.hintsRemaining,
      wallet: gameState.walletSnapshot(),
      completionTransaction: gameState.completionTransactionSnapshot(),
      hintCircleActive: gameState.hintCircleActive,
      levelComplete: scene?.isLevelComplete() ?? false,
      revealedCellCount: scene?.getRevealedCellCount() ?? 0,
      dissolveCells: scene?.getDissolveCellCount() ?? { active: 0, completed: 0 },
      lastRestorationDissolveBounds: scene?.getLastRestorationDissolveBounds() ?? null,
      pickupAnimations: scene?.getPickupAnimationCount() ?? { active: 0, completed: 0 },
      microAnimations: scene?.getMicroAnimationSnapshot() ?? { activeObjects: 0, activeTweens: 0 },
      lastViewportEffect: scene?.getLastViewportEffectSnapshot() ?? null,
      isRestoration: scene?.getIsRestoration() ?? false,
      imgScale: scene?.imgScale ?? 0,
      imgOffsetX: scene?.imgOffsetX ?? 0,
      imgOffsetY: scene?.imgOffsetY ?? 0,
      cameraZoom: scene?.getCameraZoom() ?? 1,
      cameraScrollX: scene?.cameras.main.scrollX ?? 0,
      cameraScrollY: scene?.cameras.main.scrollY ?? 0,
      gameSize: { width: game.canvas.width, height: game.canvas.height },
      viewportMetrics: readViewportMetrics(game.canvas),
      runtimeTextures: scene?.getRuntimeTexturesSnapshot() ?? {
        maxLongEdge: 0,
        color: null,
        bw: null,
        bg: [],
      },
      classicRenderDiagnostics: scene?.getClassicRenderDiagnosticsSnapshot() ?? null,
      runtimeSequence: getRuntimeSequenceSnapshot(),
      packageCache: getPackageCacheSnapshot(),
      section: scene?.getSectionSnapshot() ?? null,
      levelDataReady: scene?.isLevelDataReady() ?? false,
    };
  }

  const harness = {
    enabled: true,

    verbs: {
      gotoHome: { run: gotoHome },
      startLevel: { run: startLevel },
      openSettings: { run: () => openPage('settings') },
      tapSafeMiss: { run: tapSafeMiss },
    },

    gotoState(state: string): void {
      if (isDriveState(state)) void harness.driveTo(state);
    },

    startLevel(id: number): void {
      if (Number.isFinite(id)) gameState.currentLevelIndex = Math.max(0, Math.floor(id) - 1);
      startLevel();
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
        startLevel();
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

    setCameraZoomForTest(zoom: number): void {
      const scene = getGameScene();
      scene?.cameras.main.setZoom(zoom);
    },

    findDog(dogId: string): { found: boolean; totalFound: number } {
      const scene = getGameScene();
      const level = scene?.getLevel();
      if (!scene || !level) return { found: false, totalFound: 0 };

      const dog = level.dogs.find((d) => d.id === dogId);
      if (!dog) return { found: false, totalFound: gameState.foundDogIds.size };

      const canvasX = scene.imgOffsetX + dog.x * scene.imgScale;
      const canvasY = scene.imgOffsetY + dog.y * scene.imgScale;
      // World == canvas here since test harness computes world-space coords directly.
      scene.handleTap({ worldX: canvasX, worldY: canvasY, screenX: canvasX, screenY: canvasY });

      return {
        found: gameState.foundDogIds.has(dogId),
        totalFound: gameState.foundDogIds.size,
      };
    },

    winLevel,

    failLevel,

    driveTo(state: DriveState): Promise<boolean> {
      return driveTo(driveDeps(), state, {
        predicates: findTheDogDrivePredicates,
        playingReady: findTheDogDrivePredicates.level,
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

    tapAtLevelCoords(x: number, y: number): { hitDogId: string | null; penalty: boolean } {
      const scene = getGameScene();
      if (!scene) return { hitDogId: null, penalty: false };

      const livesBefore = gameState.lives;
      const foundBefore = new Set(gameState.foundDogIds);

      const canvasX = scene.imgOffsetX + x * scene.imgScale;
      const canvasY = scene.imgOffsetY + y * scene.imgScale;
      scene.handleTap({ worldX: canvasX, worldY: canvasY, screenX: canvasX, screenY: canvasY });

      let hitDogId: string | null = null;
      for (const id of gameState.foundDogIds) {
        if (!foundBefore.has(id)) {
          hitDogId = id;
          break;
        }
      }

      return {
        hitDogId,
        penalty: gameState.lives < livesBefore,
      };
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

    packageCacheSnapshot(): FindTheDogSnapshot['packageCache'] {
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

    enableMicroAnimationsForTest(): void {
      getGameScene()?.enableMicroAnimationsForTest();
    },

    restorationMaskAlphaAtLevelCoords(x: number, y: number): number | null {
      return getGameScene()?.getRestorationMaskAlphaAtLevelPoint(x, y) ?? null;
    },

    gotoHomeForTest(): void {
      if (game.scene.isActive('HomeScene')) {
        game.scene.stop('HomeScene');
      }
      game.scene.start('HomeScene');
    },

    snapshot(): FindTheDogSnapshot {
      return harnessSnapshot();
    },
  } satisfies FindTheDogHarness;

  return harness;
}
