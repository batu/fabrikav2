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
];

describe("find_the_dog bootstrap insitu tour wiring", () => {
  afterEach(() => {
    for (const moduleId of mockedModules) vi.doUnmock(moduleId);
    vi.restoreAllMocks();
    vi.resetModules();
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
    const FIND_THE_DOG_TOUR_STATES = ["achievements", "win-achievement", "menu", "level", "settings", "pause", "win", "fail"];
    const snapshotMatchesFindTheDogDriveState = vi.fn();
    const Game = vi.fn(function MockPhaserGame() {
      return game;
    });

    vi.doMock("phaser", () => ({
      default: { Game },
    }));
    vi.doMock("@fabrikav2/testkit/testing", () => ({
      assignWindowBindings,
      maybeRunInsituTour,
    }));
    vi.doMock("../../src/core/GameConfig", () => ({ GameConfig: {} }));
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

    await import("../../src/bootstrap.ts");

    await vi.waitFor(() => {
      expect(assignWindowBindings).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
        __FIND_DOG_HARNESS__: harness,
      }));
      expect(maybeRunInsituTour).toHaveBeenCalledWith(harness, {
        snapshotMatchesState: snapshotMatchesFindTheDogDriveState,
        states: FIND_THE_DOG_TOUR_STATES,
      });
    });
  });
});
