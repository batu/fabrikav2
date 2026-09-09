import { afterEach, describe, expect, it, vi } from "vitest";

const mockedModules = [
  "phaser",
  "@fabrikav2/testkit/testing",
  "../../src/core/GameConfig",
  "../../src/core/Constants",
  "../../src/core/GameState",
  "../../src/ui/HUD",
  "../../src/analytics/AnalyticsService",
  "../../src/attribution/AttributionService",
  "../../src/ads/Service",
  "../../src/data/cohortContext",
  "../../src/config/RemoteConfigService",
  "../../src/shop/IapService",
  "../../src/shop/PurchaseFulfillment",
  "../../src/shop/ProductCatalog",
  "../../src/platform/portraitOrientation",
  "../../src/platform/gameLifecycle",
  "../../src/audio/AudioManager",
  "../../src/sdk/SdkContext",
  "../../src/ui/iconPreload",
  "../../src/testing/TestHarness",
  "../../src/audio/AmbientManager",
  "../../src/notifications/NotificationService",
];
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

describe("find_the_dog bootstrap insitu tour wiring", () => {
  afterEach(() => {
    for (const moduleId of mockedModules) vi.doUnmock(moduleId);
    vi.restoreAllMocks();
    vi.resetModules();
    if (originalLocalStorageDescriptor === undefined) {
      Reflect.deleteProperty(window, "localStorage");
    } else {
      Object.defineProperty(window, "localStorage", originalLocalStorageDescriptor);
    }
    document.body.innerHTML = "";
  });

  it("starts maybeRunInsituTour with the mounted harness when the test harness is enabled", async () => {
    document.body.innerHTML = '<canvas id="scene"></canvas><div id="hud"></div><div id="ui"></div>';

    const harness = {
      gotoGameScene: vi.fn(),
      snapshot: vi.fn(),
      driveTo: vi.fn(),
      findDog: vi.fn(),
    };
    const game = {
      events: { once: vi.fn() },
    };
    const assignWindowBindings = vi.fn(() => vi.fn());
    const maybeRunInsituTour = vi.fn(() => Promise.resolve());
    const createFindTheDogHarness = vi.fn(() => harness);
    const FIND_THE_DOG_TOUR_STATES = ["menu", "level", "settings", "win", "fail", "pause", "achievements", "shop", "win-achievement"];
    const snapshotMatchesFindTheDogDriveState = vi.fn();
    const Game = vi.fn(function MockPhaserGame() {
      return game;
    });
    let gameConfigSawUsableStorage = false;

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("sandboxed", "SecurityError");
      },
    });

    vi.doMock("phaser", () => ({
      default: { Game },
    }));
    vi.doMock("@fabrikav2/testkit/testing", () => ({
      assignWindowBindings,
      maybeRunInsituTour,
    }));
    vi.doMock("../../src/core/GameConfig", () => {
      window.localStorage.getItem("bootstrap-order-probe");
      gameConfigSawUsableStorage = true;
      return { GameConfig: {} };
    });
    vi.doMock("../../src/core/Constants", () => ({ TEST_HARNESS_ENABLED: true }));
    vi.doMock("../../src/core/GameState", () => ({
      gameState: {
        settings: { adsEnabled: false },
        hasNoAdsEntitlement: false,
      },
    }));
    vi.doMock("../../src/ui/HUD", () => ({ initHUD: vi.fn() }));
    vi.doMock("../../src/analytics/AnalyticsService", () => ({
      analytics: {
        setCohortBucket: vi.fn(),
        appOpen: vi.fn(),
      },
    }));
    vi.doMock("../../src/attribution/AttributionService", () => ({
      attribution: { init: vi.fn() },
      configureAttributionStartupGate: vi.fn(),
    }));
    vi.doMock("../../src/ads/Service", () => ({
      adService: {
        init: vi.fn(() => Promise.resolve()),
        hideBanner: vi.fn(),
      },
    }));
    vi.doMock("../../src/data/cohortContext", () => ({
      initializeCohort: vi.fn(() => Promise.resolve(0)),
    }));
    vi.doMock("../../src/config/RemoteConfigService", () => ({
      remoteConfigService: { initAndWait: vi.fn(() => Promise.resolve()) },
    }));
    vi.doMock("../../src/shop/IapService", () => ({
      iapService: {
        setOnCustomerInfoUpdate: vi.fn(),
        setOnCompletedPurchase: vi.fn(),
        reconcilePendingPurchases: vi.fn(),
        init: vi.fn(),
        initPromiseValue: null,
        restore: vi.fn(),
      },
      ownedProductIdsFromCustomerInfo: vi.fn(() => []),
    }));
    vi.doMock("../../src/shop/PurchaseFulfillment", () => ({
      restoreNonConsumableEntitlements: vi.fn(() => ({ noAds: false })),
    }));
    vi.doMock("../../src/shop/ProductCatalog", () => ({
      buildFullShopCatalog: vi.fn(() => ({ products: [] })),
    }));
    vi.doMock("../../src/platform/portraitOrientation", () => ({
      installPortraitOrientationLock: vi.fn(),
    }));
    vi.doMock("../../src/platform/gameLifecycle", () => ({
      installGameLifecycle: vi.fn(),
      registerLifecycleHooks: vi.fn(() => vi.fn()),
    }));
    vi.doMock("../../src/audio/AudioManager", () => ({
      installAudioUnlock: vi.fn(),
      installButtonVoiceEffects: vi.fn(),
    }));
    vi.doMock("../../src/sdk/SdkContext", () => ({ getSdkContext: vi.fn() }));
    vi.doMock("../../src/ui/iconPreload", () => ({ preloadIcons: vi.fn() }));
    vi.doMock("../../src/testing/TestHarness", () => ({
      createFindTheDogHarness,
      FIND_THE_DOG_TOUR_STATES,
      snapshotMatchesFindTheDogDriveState,
    }));
    vi.doMock("../../src/audio/AmbientManager", () => ({ __ambientDebugSnapshot: vi.fn() }));
    const notificationService = {
      install: vi.fn(),
      maybePromptOnLaunch: vi.fn(() => Promise.resolve()),
    };
    vi.doMock("../../src/notifications/NotificationService", () => ({ notificationService }));

    await import("../../src/bootstrap.ts");

    await vi.waitFor(() => {
      // Production notification wiring: bootstrap must install the lifecycle
      // hooks and fire the one-time launch prompt path.
      expect(notificationService.install).toHaveBeenCalledTimes(1);
      expect(notificationService.maybePromptOnLaunch).toHaveBeenCalledTimes(1);
      expect(gameConfigSawUsableStorage).toBe(true);
      expect(assignWindowBindings).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
        __FIND_DOG_HARNESS__: harness,
      }));
      expect(maybeRunInsituTour).toHaveBeenCalledWith(harness, {
        snapshotMatchesState: snapshotMatchesFindTheDogDriveState,
        states: FIND_THE_DOG_TOUR_STATES,
        dwellMs: 1_500,
      });
      expect(document.body.textContent).not.toContain("next ▸");
      expect(document.body.children).toHaveLength(3);
    });
    const { iapService } = await import("../../src/shop/IapService");
    const { registerLifecycleHooks } = await import("../../src/platform/gameLifecycle");
    expect(iapService.setOnCompletedPurchase).toHaveBeenCalledWith(expect.any(Function));
    const recovery = vi.mocked(registerLifecycleHooks).mock.calls.find(([id]) => id === "pending-purchases");
    expect(recovery).toBeDefined();
    recovery![1].onResume?.(10);
    expect(iapService.reconcilePendingPurchases).toHaveBeenCalledOnce();
  });
});
