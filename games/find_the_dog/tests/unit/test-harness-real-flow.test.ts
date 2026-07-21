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
    openPage: vi.fn((id: "shop" | "settings" | "achievements") => {
      const overlay = document.getElementById("hud-overlay");
      if (overlay === null) return;
      const page = document.createElement("div");
      page.id = "home-page-overlay";
      page.className = `home-page-overlay home-page-${id} home-page-overlay--open`;
      page.innerHTML = id === "settings"
        ? '<div class="settings-page-card"></div>'
        : id === "achievements"
          ? '<article class="achievement-card"></article><article class="achievement-card"></article>'
          : "";
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
      load: vi.fn(),
      walletSnapshot: vi.fn(() => ({ coins: 0, hints: 3, noAds: false, premium: false, rewardProgressCount: 0 })),
      completionTransactionSnapshot: vi.fn(() => null),
      setCoinsForTest: vi.fn(),
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
      applyAchievementFact: vi.fn(() => ({ occurrenceId: "harness", progressChanges: [], newlyUnlocked: [], masteredLevelIdsAdded: [], rewards: [] })),
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

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
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

function captureTourMarkerHistory(): string[] {
  const history: string[] = [];
  const originalSetAttribute = HTMLElement.prototype.setAttribute;
  vi.spyOn(HTMLElement.prototype, "setAttribute").mockImplementation(function (this: HTMLElement, name: string, value: string): void {
    originalSetAttribute.call(this, name, value);
    if (this.id === "__tourstate__" && name === "aria-label") history.push(value);
  });
  return history;
}

function createFakeGame(options: { deferHomeRender?: boolean } = {}) {
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
          complete.innerHTML = '<aside class="achievement-unlock-callout"></aside>';
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
        <button id="home-achievements" data-hit-target="achievements" type="button">Achievements</button>
      </div>
    `;
    const play = overlay.querySelector<HTMLButtonElement>("#home-play-now")!;
    const settings = overlay.querySelector<HTMLButtonElement>("#home-nav-settings")!;
    const achievements = overlay.querySelector<HTMLButtonElement>("#home-achievements")!;
    setRect(play, { left: 10, top: 10, width: 40, height: 20 });
    setRect(settings, { left: 60, top: 10, width: 30, height: 20 });
    setRect(achievements, { left: 10, top: 40, width: 80, height: 20 });
    play.addEventListener("click", () => {
      if (overlay.querySelector("#home-page-overlay") !== null) return;
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
    achievements.addEventListener("click", () => mocks.openPage("achievements"));
  };

  canvas.addEventListener("click", (event) => {
    if (activeScene !== "GameScene") return;
    fakeGameScene.handleTap({ worldX: event.clientX, worldY: event.clientY });
  });

  const game = {
    canvas,
    scene: {
      start: vi.fn((key: string) => {
        if (key === "HomeScene") {
          activeScene = "HomeScene";
          if (options.deferHomeRender === true) window.setTimeout(renderHome, 10);
          else renderHome();
        }
        if (key === "GameScene") {
          overlay.innerHTML = "";
          activeScene = "GameScene";
          fakeGameScene.ready = true;
        }
      }),
      stop: vi.fn((key: string) => {
        if (activeScene === key) {
          activeScene = "unknown";
          if (key === "HomeScene") overlay.innerHTML = "";
        }
      }),
      getScene: vi.fn((key: string) => (key === "GameScene" ? fakeGameScene : null)),
      isActive: vi.fn((key: string) => activeScene === key),
      getScenes: vi.fn(() => activeScene === "unknown" ? [] : [{ scene: { key: activeScene } }]),
    },
  };

  renderHome();
  return { game, fakeGameScene, get playClicks() { return playClicks; } };
}

describe("find_the_dog TestHarness real-flow wiring", () => {
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
    const { createFindTheDogHarness } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame();
    const harness = createFindTheDogHarness(fixture.game as never);

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

  it("snapshot does not report level while the home shell is still visible", async () => {
    const { createFindTheDogHarness, snapshotMatchesFindTheDogDriveState } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame();
    const harness = createFindTheDogHarness(fixture.game as never);

    fixture.game.scene.start("GameScene");
    document.getElementById("hud-overlay")!.innerHTML = '<div id="home-shell"></div>';

    const snapshot = harness.snapshot();
    expect(snapshot).toMatchObject({
      activeScene: "HomeScene",
      phaserActiveScene: "GameScene",
      homeShellVisible: true,
    });
    expect(snapshotMatchesFindTheDogDriveState("level", snapshot)).toBe(false);
    expect(snapshotMatchesFindTheDogDriveState("menu", snapshot)).toBe(true);
  });

  it("gotoHome waits for the home UI instead of Phaser activation alone", async () => {
    const { createFindTheDogHarness } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame({ deferHomeRender: true });
    const harness = createFindTheDogHarness(fixture.game as never);
    await harness.verbs.startLevel.run();

    await expect(harness.verbs.gotoHome.run()).resolves.toBe(true);

    expect(harness.snapshot().homeShellVisible).toBe(true);
  });

  it("openSettings drives the mounted settings control and confirms the page", async () => {
    const { createFindTheDogHarness } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame();
    const harness = createFindTheDogHarness(fixture.game as never);

    await expect(harness.verbs.openSettings.run()).resolves.toBe(true);

    expect(mocks.openPage).toHaveBeenCalledWith("settings");
    expect(harness.snapshot()).toMatchObject({
      activeScene: "HomeScene",
      settingsOpen: true,
      homeShellVisible: true,
    });
  });

  it("achievements drives the Home action and requires rendered collection cards", async () => {
    const { createFindTheDogHarness, snapshotMatchesFindTheDogDriveState } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame();
    const harness = createFindTheDogHarness(fixture.game as never);

    await expect(harness.driveTo("achievements")).resolves.toBe(true);

    const { buildAchievementReadProjection } = await import("../../src/achievements/AchievementSystem");
    const seeded = JSON.parse(localStorage.getItem("ftd_achievements")!);
    expect(mocks.gameState.load).toHaveBeenCalled();
    // The collection capture must be able to show every reward status.
    expect(new Set(buildAchievementReadProjection(seeded).map((row) => row.rewardStatus))).toEqual(new Set([
      "locked",
      "in-progress",
      "live-reward-settled",
      "migration-unlocked-reward-ineligible",
      "legacy-unlocked-reward-provenance-unknown",
    ]));
    expect(mocks.openPage).toHaveBeenCalledWith("achievements");
    expect(snapshotMatchesFindTheDogDriveState("achievements", harness.snapshot())).toBe(true);
    document.querySelectorAll(".achievement-card").forEach((card) => card.remove());
    expect(snapshotMatchesFindTheDogDriveState("achievements", harness.snapshot())).toBe(false);
  });

  it("win-achievement requires both completion and the inline callout", async () => {
    const { createFindTheDogHarness, snapshotMatchesFindTheDogDriveState } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame();
    const harness = createFindTheDogHarness(fixture.game as never);

    localStorage.setItem("ftd_achievements", JSON.stringify({ unlocked: ["first_completion"] }));
    await expect(harness.driveTo("win-achievement")).resolves.toBe(true);
    // A guaranteed-locked seed so a real completion always produces newlyUnlocked.
    expect(JSON.parse(localStorage.getItem("ftd_achievements")!).unlocked).toEqual([]);
    expect(snapshotMatchesFindTheDogDriveState("win-achievement", harness.snapshot())).toBe(true);
    document.querySelector(".achievement-unlock-callout")?.remove();
    expect(snapshotMatchesFindTheDogDriveState("win-achievement", harness.snapshot())).toBe(false);
    expect(snapshotMatchesFindTheDogDriveState("win", harness.snapshot())).toBe(true);
  });

  it("startLevel clears an open settings page before driving Play", async () => {
    const { createFindTheDogHarness } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame();
    const harness = createFindTheDogHarness(fixture.game as never);
    await harness.verbs.openSettings.run();

    await expect(harness.verbs.startLevel.run()).resolves.toBe(true);

    expect(fixture.playClicks).toBe(1);
    expect(harness.snapshot()).toMatchObject({
      activeScene: "GameScene",
      settingsOpen: false,
      status: "playing",
    });
  });

  it("winLevel taps dog positions through the gameplay input boundary", async () => {
    const { createFindTheDogHarness } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame();
    const harness = createFindTheDogHarness(fixture.game as never);
    await harness.verbs.startLevel.run();
    mocks.driveInputAt.mockClear();

    await expect(harness.winLevel()).resolves.toBe(true);

    expect(mocks.driveInputAt).toHaveBeenCalledTimes(2);
    expect(fixture.fakeGameScene.taps.map((tap) => [tap.worldX, tap.worldY])).toEqual([[25, 25], [75, 75]]);
    expect(harness.snapshot()).toMatchObject({
      activeScene: "GameScene",
      status: "complete",
      levelComplete: true,
      levelCompleteOverlayVisible: true,
    });
  });

  it("publishes every canonical tour marker in order through the real harness", async () => {
    const { maybeRunInsituTour } = await import("@fabrikav2/testkit/testing");
    const { createFindTheDogHarness, snapshotMatchesFindTheDogDriveState } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame({ deferHomeRender: true });
    const harness = createFindTheDogHarness(fixture.game as never);
    const ariaHistory = captureTourMarkerHistory();

    await maybeRunInsituTour(harness, {
      script: "allstates",
      dwellMs: 0,
      markSettleRecheckMs: 0,
      sleep: async (): Promise<void> => {},
      snapshotMatchesState: snapshotMatchesFindTheDogDriveState,
    });

    expect(ariaHistory).toEqual([
      "tourstate:menu",
      "tourstate:menu-DONE",
      "tourstate:level",
      "tourstate:level-DONE",
      "tourstate:settings",
      "tourstate:settings-DONE",
      "tourstate:pause",
      "tourstate:pause-DONE",
      "tourstate:win",
      "tourstate:win-DONE",
      "tourstate:fail",
      "tourstate:fail-DONE",
      "tourstate:done",
    ]);
  }, 15_000);

  it("marks a lost real-harness state FAILED and continues to the next state", async () => {
    const { maybeRunInsituTour } = await import("@fabrikav2/testkit/testing");
    const { createFindTheDogHarness, snapshotMatchesFindTheDogDriveState } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame({ deferHomeRender: true });
    const harness = createFindTheDogHarness(fixture.game as never);
    const ariaHistory = captureTourMarkerHistory();
    let settingsChecks = 0;

    await maybeRunInsituTour(harness, {
      script: "allstates",
      states: ["settings", "pause"],
      dwellMs: 0,
      markSettleRecheckMs: 0,
      sleep: async (): Promise<void> => {},
      snapshotMatchesState: (state, snapshot): boolean => (
        state !== "settings"
          ? snapshotMatchesFindTheDogDriveState(state, snapshot)
          : ++settingsChecks === 1 && snapshotMatchesFindTheDogDriveState(state, snapshot)
      ),
    });

    expect(ariaHistory).toEqual([
      "tourstate:settings",
      "tourstate:settings-FAILED",
      "tourstate:pause",
      "tourstate:pause-DONE",
      "tourstate:done",
    ]);
  });

  it("publishes trusted achievement tour markers only after their real predicates pass", async () => {
    const { maybeRunInsituTour } = await import("@fabrikav2/testkit/testing");
    const { createFindTheDogHarness, snapshotMatchesFindTheDogDriveState } = await import("../../src/testing/TestHarness");
    const fixture = createFakeGame();
    const harness = createFindTheDogHarness(fixture.game as never);
    const ariaHistory = captureTourMarkerHistory();

    await maybeRunInsituTour(harness, {
      script: "allstates",
      states: ["achievements", "win-achievement"],
      dwellMs: 0,
      markSettleRecheckMs: 0,
      sleep: async (): Promise<void> => {},
      snapshotMatchesState: snapshotMatchesFindTheDogDriveState,
    });

    expect(ariaHistory).toEqual([
      "tourstate:achievements",
      "tourstate:achievements-DONE",
      "tourstate:win-achievement",
      "tourstate:win-achievement-DONE",
      "tourstate:done",
    ]);
  });
});
