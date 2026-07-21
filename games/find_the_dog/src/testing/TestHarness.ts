import Phaser from 'phaser';
import type { AnalyticsEvent } from '@fabrikav2/sdk/analytics';
import { driveInputAt, type ClientPoint, type GameHarness, type HarnessSaveProfile } from '@fabrikav2/testkit/harness';
import { gameState, type CompletionTransaction, type GameSettings, type WalletSnapshot } from '../core/GameState';
import { GAMEPLAY, TIMING } from '../core/Constants';
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
import { getSdkContext } from '../sdk/SdkContext';
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

type FindTheDogVerb = 'gotoHome' | 'startLevel' | 'openSettings' | 'pause' | 'winLevel' | 'failLevel' | 'tapSafeMiss';

export const findTheDogDrivePredicates = {
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

export function snapshotMatchesFindTheDogDriveState(state: DriveState, raw: unknown): boolean {
  const snapshot = (raw ?? {}) as DriveSnapshot;
  return findTheDogDrivePredicates[state](snapshot);
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
// Priority order matters: a comma-list querySelector returns the DOCUMENT-order
// first match, and the saga map places `.fab-levelmap-node.current` before the
// Play button — but only the Play button reliably starts a level from a
// dispatched pointer sequence. Query each selector in turn instead.
const HOME_PLAY_TRIGGER_SELECTORS = ['#home-play-now', '#home-nav-play', '.fab-levelmap-node.current'];

function queryHomePlayTrigger(): HTMLElement | null {
  for (const selector of HOME_PLAY_TRIGGER_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element !== null) return element;
  }
  return null;
}
const HOME_READY_TARGET_POLL_MS = 50;
const HOME_READY_TARGET_MAX_POLLS = 80;
const START_LEVEL_TARGET_POLL_MS = 50;
const START_LEVEL_TARGET_MAX_POLLS = 160;
const TERMINAL_TARGET_POLL_MS = 50;
const TERMINAL_TARGET_MAX_POLLS = 160;
const WRONG_TAP_SETTLE_MS = TIMING.PENALTY_COOLDOWN_MS + 20;

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

export interface FindTheDogSnapshot {
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
    gotoHome: { run: () => Promise<boolean> };
    startLevel: { run: () => Promise<boolean> };
    openSettings: { run: () => Promise<boolean> };
    pause: { run: () => Promise<boolean> };
    winLevel: { run: () => Promise<boolean> };
    failLevel: { run: () => Promise<boolean> };
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
  drainEvents(): AnalyticsEvent[];
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

  async function gotoHome(): Promise<boolean> {
    setLifecycleForTest('active');
    game.scene.stop('GameScene');
    game.scene.stop('HomeScene');
    game.scene.start('HomeScene');
    return waitUntil(
      () => driveSnapshot().homeShellVisible === true,
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

    const menuSnapshot = driveSnapshot();
    const atMenu = (menuSnapshot.homeShellVisible === true && menuSnapshot.settingsOpen !== true) || await gotoHome();
    if (!atMenu) return false;

    const buttonReady = await waitUntil(
      () => queryHomePlayTrigger() !== null,
      HOME_READY_TARGET_POLL_MS,
      HOME_READY_TARGET_MAX_POLLS,
    );
    if (!buttonReady) return false;

    const trigger = queryHomePlayTrigger();
    if (trigger === null || !driveElementClick(trigger)) return false;

    return waitUntil(
      () => findTheDogDrivePredicates.level(driveSnapshot()),
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
      () => findTheDogDrivePredicates.settings(driveSnapshot()),
      SETTINGS_OPEN_TARGET_POLL_MS,
      SETTINGS_OPEN_TARGET_MAX_POLLS,
    );
  }

  function canvasClientPoint(canvasX: number, canvasY: number): ClientPoint | null {
    const rect = game.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || game.canvas.width <= 0 || game.canvas.height <= 0) return null;
    return {
      x: rect.left + (canvasX / game.canvas.width) * rect.width,
      y: rect.top + (canvasY / game.canvas.height) * rect.height,
    };
  }

  function tryDriveGameplayTap(scene: GameScene, canvasX: number, canvasY: number): boolean {
    const point = canvasClientPoint(canvasX, canvasY);
    if (point === null || typeof document.elementFromPoint !== 'function') {
      scene.handleTap({ worldX: canvasX, worldY: canvasY, screenX: canvasX, screenY: canvasY });
      return true;
    }

    const { hitTarget } = driveInputAt(point);
    return hitTarget === game.canvas;
  }

  async function pauseGame(): Promise<boolean> {
    setLifecycleForTest('inactive');
    return waitUntil(
      () => findTheDogDrivePredicates.pause(driveSnapshot()),
      TERMINAL_TARGET_POLL_MS,
      TERMINAL_TARGET_MAX_POLLS,
    );
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
    const dogSafe = candidates.filter((point) => snapshot.dogPositions.every((dog) => (
      Math.hypot(dog.x - point.x, dog.y - point.y) > dog.r * 4
    )));
    // Corner candidates can land under the DOM HUD (top bar, hint pill), where
    // the dispatched tap hits the overlay instead of the canvas and silently
    // does nothing. Prefer a candidate whose client point actually hit-tests to
    // the canvas.
    const scene = getGameScene();
    const canvasSafe = scene === null || typeof document.elementFromPoint !== 'function'
      ? dogSafe
      : dogSafe.filter((point) => {
        const client = canvasClientPoint(
          scene.imgOffsetX + point.x * scene.imgScale,
          scene.imgOffsetY + point.y * scene.imgScale,
        );
        return client !== null && document.elementFromPoint(client.x, client.y) === game.canvas;
      });
    return canvasSafe[0] ?? dogSafe[0] ?? candidates[0];
  }

  function tapSafeMiss(): { hitDogId: string | null; penalty: boolean } {
    const point = safeMissPoint();
    return harness.tapAtLevelCoords(point.x, point.y);
  }

  async function winLevel(): Promise<boolean> {
    const before = harnessSnapshot();
    for (const dog of before.dogPositions.filter((candidate) => !candidate.found)) {
      harness.findDog(dog.id);
      await waitUntil(
        () => gameState.foundDogIds.has(dog.id),
        TERMINAL_TARGET_POLL_MS,
        TERMINAL_TARGET_MAX_POLLS,
      );
    }
    return waitUntil(
      () => findTheDogDrivePredicates.win(driveSnapshot()),
      TERMINAL_TARGET_POLL_MS,
      TERMINAL_TARGET_MAX_POLLS,
    );
  }

  async function failLevel(): Promise<boolean> {
    // One wrong tap should end the level: burning every life through the
    // penalty cooldown adds seconds of variance the capture runner's per-state
    // budget has to absorb after the previous state's dwell.
    if (gameState.lives > 1) gameState.lives = 1;
    for (let i = 0; i < GAMEPLAY.LIVES_PER_LEVEL + 2; i += 1) {
      if (findTheDogDrivePredicates.fail(driveSnapshot())) return true;
      tapSafeMiss();
      if (findTheDogDrivePredicates.fail(driveSnapshot())) return true;
      await sleep(WRONG_TAP_SETTLE_MS);
    }
    return waitUntil(
      () => findTheDogDrivePredicates.fail(driveSnapshot()),
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

  function harnessSnapshot(): FindTheDogSnapshot {
    const scene = getGameScene();
    const phaserActiveScene = game.scene.getScenes(true)[0]?.scene.key ?? 'unknown';
    const homeShellVisible = document.querySelector('#home-shell') !== null;
    const settingsOpen = document.querySelector(SETTINGS_PAGE_SELECTOR) !== null;
    const levelCompleteOverlayVisible = document.getElementById('level-complete-overlay') !== null;
    const levelFailedOverlayVisible = document.getElementById('level-failed-overlay') !== null;
    const activeScene = homeShellVisible ? 'HomeScene' : phaserActiveScene;
    const visibleGameScene = activeScene === 'GameScene';
    const level = scene?.getLevel();
    const dogs: LevelDog[] = level?.dogs ?? [];
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
      levelComplete,
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
      // scene.cameras.main is undefined while GameScene boots or shuts down; a
      // snapshot taken in that window must degrade, not throw — a thrown
      // snapshot rejects driveTo() and kills the whole insitu tour.
      cameraZoom: scene?.cameras?.main !== undefined ? scene.getCameraZoom() : 1,
      cameraScrollX: scene?.cameras?.main?.scrollX ?? 0,
      cameraScrollY: scene?.cameras?.main?.scrollY ?? 0,
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
      openSettings: { run: openSettingsFromUi },
      pause: { run: pauseGame },
      winLevel: { run: winLevel },
      failLevel: { run: failLevel },
      tapSafeMiss: { run: tapSafeMiss },
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
      tryDriveGameplayTap(scene, canvasX, canvasY);

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
      // A seeded save is by definition not a first run. Leaving the tutorial
      // armed swallows wrong-tap penalties and non-target finds (handleTap's
      // tutorial gate), which deadlocks the insitu tour's fail drive.
      gameState.tutorialShown = true;
      gameState.save();
    },

    tapAtLevelCoords(x: number, y: number): { hitDogId: string | null; penalty: boolean } {
      const scene = getGameScene();
      if (!scene) return { hitDogId: null, penalty: false };

      const livesBefore = gameState.lives;
      const foundBefore = new Set(gameState.foundDogIds);

      const canvasX = scene.imgOffsetX + x * scene.imgScale;
      const canvasY = scene.imgOffsetY + y * scene.imgScale;
      tryDriveGameplayTap(scene, canvasX, canvasY);

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

    drainEvents() {
      return getSdkContext().analyticsRing.drain();
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
