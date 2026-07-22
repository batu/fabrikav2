import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LevelData } from "../../src/data/levels";

const mocks = vi.hoisted(() => {
  const foundDogIds = new Set<string>();
  let lifecycle: "active" | "inactive" = "active";

  return {
    driveInputAt: vi.fn((point: { x: number; y: number }) => {
      const hitTarget = document.elementFromPoint?.(point.x, point.y) ?? null;
      if (hitTarget !== null) {
        hitTarget.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
        }));
      }
      return { hitTarget };
    }),
    initHUD: vi.fn(),
    openPage: vi.fn((id: "shop" | "settings") => {
      const overlay = document.getElementById("hud-overlay");
      if (overlay === null) return;
      const page = document.createElement("div");
      page.id = "home-page-overlay";
      page.className = `home-page-overlay home-page-${id} home-page-overlay--open`;
      page.innerHTML = id === "settings" ? '<div class="settings-page-card"></div>' : "";
      overlay.appendChild(page);
    }),
    setFailOverlayPendingRecoveryMsForTest: vi.fn(),
    setRewardedAdResultForTest: vi.fn(),
    remoteConfigService: {
      snapshot: vi.fn(() => ({ values: {} })),
      setValuesForTest: vi.fn(),
    },
    iapService: {
      snapshot: vi.fn(() => ({ state: "idle", products: [], nativeOperationInProgress: false })),
      setStateForTest: vi.fn(),
    },
    get lifecycle() {
      return lifecycle;
    },
    gameState: {
      currentLevelIndex: 0,
      lives: 3,
      hintsRemaining: 3,
      hintCircleActive: false,
      foundDogIds,
      settings: {
        adsEnabled: false,
        hapticsOn: true,
        musicOn: true,
        soundEffectsOn: true,
        soundOn: true,
        tutorialEnabled: false,
      },
      save: vi.fn(),
      walletSnapshot: vi.fn(() => ({ coins: 0, hints: 3, noAds: false, premium: false, rewardProgressCount: 0 })),
      completionTransactionSnapshot: vi.fn(() => null),
      setCoinsForTest: vi.fn(),
      setTotalLevelsCompletedForTest: vi.fn(),
      tutorialShown: false,
      setHintsForTest: vi.fn((hints: number) => {
        mocks.gameState.hintsRemaining = hints;
      }),
      reset: vi.fn(() => {
        mocks.gameState.currentLevelIndex = 0;
        mocks.gameState.lives = 3;
        mocks.gameState.hintsRemaining = 3;
        foundDogIds.clear();
      }),
      grantNoAdsEntitlement: vi.fn(),
      grantPremiumEntitlement: vi.fn(),
      grantCoins: vi.fn(),
      setRewardProgressForTest: vi.fn(),
      markProcessedPurchaseId: vi.fn(() => true),
      grantRewardedHint: vi.fn(),
    },
    setLifecycleForTest: vi.fn((next: "active" | "inactive") => {
      lifecycle = next;
    }),
    isGameSuspended: vi.fn(() => lifecycle === "inactive"),
    reset() {
      lifecycle = "active";
      foundDogIds.clear();
      this.gameState.currentLevelIndex = 0;
      this.gameState.lives = 3;
      this.gameState.hintsRemaining = 3;
      this.gameState.hintCircleActive = false;
      this.gameState.settings.tutorialEnabled = false;
      this.driveInputAt.mockClear();
      this.initHUD.mockClear();
      this.openPage.mockClear();
      this.setLifecycleForTest.mockClear();
      this.gameState.save.mockClear();
    },
  };
});

vi.mock("phaser", () => ({ default: {} }));
vi.mock("@fabrikav2/testkit/harness", () => ({
  driveInputAt: mocks.driveInputAt,
}));
vi.mock("../../src/core/GameState", () => ({ gameState: mocks.gameState }));
vi.mock("../../src/core/Constants", () => ({
  GAMEPLAY: { LIVES_PER_LEVEL: 3 },
  TIMING: { PENALTY_COOLDOWN_MS: 0 },
}));
vi.mock("../../src/scenes/GameScene", () => ({ GameScene: class MockGameScene {} }));
vi.mock("../../src/data/levels", () => ({
  loadLevel: vi.fn(),
  packageCacheSnapshot: vi.fn(() => ({
    catalogRevision: null,
    packageCount: 0,
    lastRetentionPlan: null,
    lastServingAttempt: null,
    lastKnownLiveListedStorageKey: "",
  })),
  runtimeSequenceSnapshot: vi.fn(() => ({ levelIds: ["level-1", "level-2"] })),
}));
vi.mock("../../src/config/RemoteConfigService", () => ({ remoteConfigService: mocks.remoteConfigService }));
vi.mock("../../src/shop/IapService", () => ({ iapService: mocks.iapService }));
vi.mock("../../src/ads/Service", () => ({
  setRewardedAdResultForTest: mocks.setRewardedAdResultForTest,
}));
vi.mock("../../src/platform/gameLifecycle", () => ({
  isGameSuspended: mocks.isGameSuspended,
  setLifecycleForTest: mocks.setLifecycleForTest,
}));
vi.mock("../../src/ui/HUD", () => ({
  initHUD: mocks.initHUD,
  openPage: mocks.openPage,
}));
vi.mock("../../src/ui/LevelFailedOverlay", () => ({
  setFailOverlayPendingRecoveryMsForTest: mocks.setFailOverlayPendingRecoveryMsForTest,
}));

const levelData = {
  id: "level-1",
  width: 100,
  height: 100,
  dogs: [
    { id: "dog-a", x: 25, y: 25, r: 5 },
    { id: "dog-b", x: 75, y: 75, r: 5 },
  ],
} as LevelData;

function setRect(element: HTMLElement, rect: { left: number; top: number; width: number; height: number }): void {
  element.getBoundingClientRect = vi.fn(() => ({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect));
}

function installElementFromPoint(): void {
  vi.spyOn(document, "elementFromPoint").mockImplementation((x: number, y: number) => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-hit-target]")).reverse();
    return elements.find((element) => {
      if (!element.isConnected) return false;
      const rect = element.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }) ?? null;
  });
}

function createFakeGame() {
  let activeScene = "HomeScene";
  let playClicks = 0;
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  canvas.dataset.hitTarget = "canvas";
  setRect(canvas, { left: 0, top: 0, width: 100, height: 100 });
  document.body.appendChild(canvas);

  const overlay = document.createElement("div");
  overlay.id = "hud-overlay";
  document.body.appendChild(overlay);

  const fakeGameScene = {
    imgScale: 1,
    imgOffsetX: 0,
    imgOffsetY: 0,
    level: levelData,
    complete: false,
    ready: false,
    taps: [] as Array<{ worldX: number; worldY: number }>,
    scene: {
      restart: vi.fn(() => {
        activeScene = "GameScene";
        fakeGameScene.ready = true;
      }),
    },
    getLevel: vi.fn(() => fakeGameScene.level),
    isLevelComplete: vi.fn(() => fakeGameScene.complete),
    isLevelDataReady: vi.fn(() => fakeGameScene.ready),
    handleTap: vi.fn((tap: { worldX: number; worldY: number }) => {
      fakeGameScene.taps.push(tap);
      const hit = fakeGameScene.level.dogs.find((dog) => {
        if (mocks.gameState.foundDogIds.has(dog.id)) return false;
        return Math.hypot(dog.x - tap.worldX, dog.y - tap.worldY) <= dog.r * 3;
      });
      if (hit !== undefined) {
        mocks.gameState.foundDogIds.add(hit.id);
        if (mocks.gameState.foundDogIds.size === fakeGameScene.level.dogs.length) {
          fakeGameScene.complete = true;
          const complete = document.createElement("div");
          complete.id = "level-complete-overlay";
          overlay.appendChild(complete);
        }
        return;
      }
      mocks.gameState.lives -= 1;
      if (mocks.gameState.lives <= 0) {
        const failed = document.createElement("div");
        failed.id = "level-failed-overlay";
        overlay.appendChild(failed);
      }
    }),
    winLevel: vi.fn(() => {
      fakeGameScene.complete = true;
      const complete = document.createElement("div");
      complete.id = "level-complete-overlay";
      overlay.appendChild(complete);
    }),
    loseLife: vi.fn(() => {
      mocks.gameState.lives -= 1;
      if (mocks.gameState.lives <= 0) {
        const failed = document.createElement("div");
        failed.id = "level-failed-overlay";
        overlay.appendChild(failed);
      }
    }),
    getRevealedCellCount: vi.fn(() => 0),
    getDissolveCellCount: vi.fn(() => ({ active: 0, completed: 0 })),
    getLastRestorationDissolveBounds: vi.fn(() => null),
    getPickupAnimationCount: vi.fn(() => ({ active: 0, completed: 0 })),
    getMicroAnimationSnapshot: vi.fn(() => ({ activeObjects: 0, activeTweens: 0 })),
    getLastViewportEffectSnapshot: vi.fn(() => null),
    getIsRestoration: vi.fn(() => false),
    getCameraZoom: vi.fn(() => 1),
    getRuntimeTexturesSnapshot: vi.fn(() => ({ maxLongEdge: 0, color: null, bw: null, bg: [] })),
    getClassicRenderDiagnosticsSnapshot: vi.fn(() => null),
    getSectionSnapshot: vi.fn(() => null),
    enableMicroAnimationsForTest: vi.fn(),
    restorationMaskAlphaAtLevelPoint: vi.fn(() => null),
    cameras: { main: { scrollX: 0, scrollY: 0, setZoom: vi.fn() } },
  };

  const renderHome = (): void => {
    activeScene = "HomeScene";
    fakeGameScene.ready = false;
    overlay.innerHTML = `
      <div id="home-shell">
        <button id="home-play-now" data-hit-target="play" type="button">Play</button>
        <button id="home-nav-settings" data-hit-target="settings" type="button">Settings</button>
      </div>
    `;
    const play = overlay.querySelector<HTMLButtonElement>("#home-play-now")!;
    const settings = overlay.querySelector<HTMLButtonElement>("#home-nav-settings")!;
    setRect(play, { left: 10, top: 10, width: 40, height: 20 });
    setRect(settings, { left: 60, top: 10, width: 30, height: 20 });
    play.addEventListener("click", () => {
      playClicks += 1;
      mocks.initHUD();
      overlay.innerHTML = "";
      activeScene = "GameScene";
      fakeGameScene.ready = true;
      fakeGameScene.complete = false;
      mocks.gameState.lives = 3;
      mocks.gameState.foundDogIds.clear();
    });
    settings.addEventListener("click", () => mocks.openPage("settings"));
  };

  canvas.addEventListener("click", (event) => {
    if (activeScene !== "GameScene") return;
    fakeGameScene.handleTap({ worldX: event.clientX, worldY: event.clientY });
  });

  const game = {
    canvas,
    scene: {
      start: vi.fn((key: string) => {
        if (key === "HomeScene") renderHome();
        if (key === "GameScene") {
          overlay.innerHTML = "";
          activeScene = "GameScene";
          fakeGameScene.ready = true;
        }
      }),
      stop: vi.fn((key: string) => {
        if (activeScene === key) activeScene = "unknown";
      }),
      getScene: vi.fn((key: string) => (key === "GameScene" ? fakeGameScene : null)),
      isActive: vi.fn((key: string) => activeScene === key),
      getScenes: vi.fn(() => activeScene === "unknown" ? [] : [{ scene: { key: activeScene } }]),
    },
  };

  renderHome();
  return { game, fakeGameScene, get playClicks() { return playClicks; } };
}

describe("marble_run TestHarness real-flow wiring", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mocks.reset();
    installElementFromPoint();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("startLevel drives the mounted home Play button before confirming level", async () => {
    const { createMarbleRunHarness } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame();
    const harness = createMarbleRunHarness(fixture.game as never);

    await expect(harness.verbs.startLevel.run()).resolves.toBe(true);

    expect(fixture.playClicks).toBe(1);
    expect(mocks.initHUD).toHaveBeenCalledTimes(1);
    expect(harness.snapshot()).toMatchObject({
      activeScene: "GameScene",
      phaserActiveScene: "GameScene",
      homeShellVisible: false,
      status: "playing",
      levelDataReady: true,
    });
  });

  it("zeroes the wallet after seeding a driven gameplay capture (MRV2-9 U2a)", async () => {
    const { createMarbleRunHarness } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame();
    const harness = createMarbleRunHarness(fixture.game as never);
    mocks.gameState.setCoinsForTest.mockClear();

    await expect(harness.driveTo("gameplay-opener")).resolves.toBe(true);

    // Progress is seeded (suppresses the tutorial hand) and the persisted wallet
    // is explicitly zeroed so the capture shows 0 coins, not a stale leak.
    expect(mocks.gameState.setTotalLevelsCompletedForTest).toHaveBeenCalled();
    expect(mocks.gameState.setCoinsForTest).toHaveBeenCalledWith(0);
  });

  it("snapshot does not report level while the home shell is still visible", async () => {
    const { createMarbleRunHarness, snapshotMatchesMarbleRunDriveState } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame();
    const harness = createMarbleRunHarness(fixture.game as never);

    fixture.game.scene.start("GameScene");
    document.getElementById("hud-overlay")!.innerHTML = '<div id="home-shell"></div>';

    const snapshot = harness.snapshot();
    expect(snapshot).toMatchObject({
      activeScene: "HomeScene",
      phaserActiveScene: "GameScene",
      homeShellVisible: true,
    });
    expect(snapshotMatchesMarbleRunDriveState("level", snapshot)).toBe(false);
    expect(snapshotMatchesMarbleRunDriveState("menu", snapshot)).toBe(true);
  });

  it("openSettings drives the mounted settings control and confirms the page", async () => {
    const { createMarbleRunHarness } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame();
    const harness = createMarbleRunHarness(fixture.game as never);

    await expect(harness.verbs.openSettings.run()).resolves.toBe(true);

    expect(mocks.openPage).toHaveBeenCalledWith("settings");
    expect(harness.snapshot()).toMatchObject({
      activeScene: "HomeScene",
      settingsOpen: true,
      homeShellVisible: true,
    });
  });

  it("winLevel reports the win outcome through the stub scene seam", async () => {
    const { createMarbleRunHarness } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame();
    const harness = createMarbleRunHarness(fixture.game as never);
    await harness.verbs.startLevel.run();

    await expect(harness.winLevel()).resolves.toBe(true);

    expect(fixture.fakeGameScene.winLevel).toHaveBeenCalledTimes(1);
    expect(harness.snapshot()).toMatchObject({
      activeScene: "GameScene",
      status: "complete",
      levelComplete: true,
      levelCompleteOverlayVisible: true,
    });
  });
});
