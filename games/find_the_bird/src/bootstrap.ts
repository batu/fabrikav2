import Phaser from 'phaser';
import { assignWindowBindings, maybeRunInsituTour } from '@fabrikav2/testkit/testing';
import { GameConfig } from './core/GameConfig';
import { TEST_HARNESS_ENABLED } from './core/Constants';
import { gameState } from './core/GameState';
import { initHUD } from './ui/HUD';
import { analytics } from './analytics/AnalyticsService';
import { attribution, configureAttributionStartupGate } from './attribution/AttributionService';
import { adService } from './ads/Service';
import { initializeCohort } from './data/cohortContext';
import { remoteConfigService } from './config/RemoteConfigService';
import { iapService, ownedProductIdsFromCustomerInfo, type CustomerInfo } from './shop/IapService';
import { restoreNonConsumableEntitlements } from './shop/PurchaseFulfillment';
import { buildFullShopCatalog } from './shop/ProductCatalog';
import { installPortraitOrientationLock } from './platform/portraitOrientation';
import { installGameLifecycle } from './platform/gameLifecycle';
import { notificationService } from './notifications/NotificationService';
import { installAudioUnlock, installButtonVoiceEffects } from './audio/AudioManager';
import { getSdkContext } from './sdk/SdkContext';
import { preloadIcons } from './ui/iconPreload';
import '@fabrikav2/ui/ui.css';
import '../design/tokens.css';
import './v1core/ui/ui.css';
import './ui/styles.css';

// One production composition root installs every provider before any service
// init or game-facing call can observe it.
getSdkContext();

installPortraitOrientationLock();
installAudioUnlock();
installButtonVoiceEffects();
preloadIcons();

const game: Phaser.Game = new Phaser.Game(GameConfig);
initHUD();
// Install the single suspend/resume authority (Capacitor pause/resume +
// visibilitychange) so backgrounding the app halts the rAF loop, Phaser
// timers/tweens, ambient motion, and audio instead of cooking the phone. See
// platform/gameLifecycle.ts.
installGameLifecycle(game);
// Retention reminders: schedule on suspend, cancel on resume. The one-time OS
// permission prompt fires on the second app open — never on first launch,
// never mid-gameplay.
notificationService.install();
void notificationService.maybePromptOnLaunch();
const shouldInitializeAds = gameState.settings.adsEnabled && !gameState.hasNoAdsEntitlement;
const adConsentReady = shouldInitializeAds ? adService.init() : Promise.resolve();
configureAttributionStartupGate(adConsentReady);
void adConsentReady
  .finally((): void => {
    void attribution.init();
  })
  .catch((err: unknown): void => {
    console.warn('[ads] consent initialization failed before attribution startup', err);
  });
// Recover deferred NON-CONSUMABLE entitlements (no-ads) from a CustomerInfo
// snapshot — used both at cold-start (via restore()) and on every customerInfo
// update (via the RevenueCat listener). This is the safe recovery path for
// purchases that the 60s purchase timeout abandoned while the OS payment queue
// kept running (Ask-to-Buy / slow auth / user walked away). It grants ONLY
// no-ads; it must NOT re-fulfill consumables — on iOS the listener's
// transaction ids (RevenueCat internal) ≠ the purchase path's ids (StoreKit),
// so consumable reconciliation here would double-grant (see plan PR-6 spike).
// Consumable recovery requires a server-side RevenueCat webhooks follow-up.
function recoverDeferredNonConsumableEntitlements(customerInfo: CustomerInfo): void {
  const ownedProductIds = ownedProductIdsFromCustomerInfo(customerInfo);
  const grant = restoreNonConsumableEntitlements(ownedProductIds, buildFullShopCatalog().products, gameState);
  if (grant.noAds) {
    void adService.hideBanner();
  }
}

iapService.setOnCustomerInfoUpdate(recoverDeferredNonConsumableEntitlements);

void remoteConfigService.initAndWait().finally(() => {
  iapService.init();
  const initPromise = iapService.initPromiseValue;
  if (initPromise === null) return;
  void initPromise.finally(() => {
    // Cold-start recovery: surface any deferred/abandoned non-consumable
    // entitlements (e.g. Ask-to-Buy approved before this launch). The
    // customerInfo listener registered during init handles subsequent updates.
    void iapService.restore().then((restore): void => {
      if (restore.customerInfo !== null) recoverDeferredNonConsumableEntitlements(restore.customerInfo);
    }).catch((err: unknown): void => {
      console.warn('[iap] launch-time deferred entitlement restore failed', err);
    });
  });
});
let releaseTestBindings: (() => void) | null = null;

// Resolve AB cohort before appOpen so every analytics event carries it
// as a user property. First-launch cost is one SubtleCrypto SHA-256
// call (~sub-millisecond); later launches read a sticky localStorage
// record synchronously and this awaits immediately.
//
// Cohort resolution must NOT block the appOpen anchor event — if
// SubtleCrypto or localStorage throws (rare WebView variants, or
// private-browsing with storage quota exceeded), analytics still
// fires without the cohort user-property. Losing cohort tagging for
// one session is acceptable; losing the entire analytics funnel is not.
void initializeCohort()
  .then((bucket: number): void => {
    analytics.setCohortBucket(bucket);
  })
  .catch((err: unknown): void => {
     
    console.warn('[cohort] initializeCohort failed; events will ship without cohort_bucket', err);
  })
  .finally((): void => {
    void analytics.appOpen();
  });

game.events.once('destroy', (): void => {
  releaseTestBindings?.();
  releaseTestBindings = null;
});

if (typeof window !== 'undefined') {
  // 4-tap debug panel toggle
  let tapCount = 0;
  let lastTapTime = 0;
  const TAP_WINDOW_MS = 600;
  const TAPS_REQUIRED = 4;

  // The 4-tap pickup-style cycler was removed 2026-08-05 (Batu: single
  // shipped style, accidental triggers during play were confusing A/B
  // sessions). Reserved-gesture plumbing removed with it.
  void tapCount; void lastTapTime; void TAP_WINDOW_MS; void TAPS_REQUIRED;

  // TEMPORARY level-skip button for the level-variant A/B campaign: the
  // player must be able to reach later variant levels even when an earlier
  // variant's hitboxes are broken. Remove before any public build.
  const skipBtn = document.createElement('button');
  skipBtn.textContent = 'next ▸';
  skipBtn.style.cssText = 'position:fixed;top:max(env(safe-area-inset-top,0px),8px);right:8px;'
    + 'background:rgba(0,0,0,.6);color:#fff;border:0;padding:6px 12px;border-radius:12px;'
    + 'font:700 13px system-ui;z-index:9999;';
  skipBtn.addEventListener('click', (): void => {
    for (const scene of game.scene.getScenes(true)) {
      const s = scene as Partial<{ skipLevelForTest: () => void }>;
      if (s.skipLevelForTest !== undefined) { s.skipLevelForTest(); return; }
    }
  });
  document.body.appendChild(skipBtn);

  // TEMPORARY variant-label overlay for the level A/B campaign: names the
  // pipeline variant of the level being played so on-device judgments can
  // be attributed. Remove together with the skip button.
  const VARIANT_LABELS: Record<string, string> = {
    ad_campaigns_ad_autumn_forest_bird_389c_v1oai: 'V1 LANE: openai masked crop — seamless pickups',
    ad_campaigns_ad_autumn_forest_bird_389c_v1oai2: 'V1 LANE v2-code: openai crop, fixed PNG client',
    ad_campaigns_ad_autumn_forest_bird_389c_v1refoai: 'V1 LANE + reference sheet (known junk birds)',
    ad_campaigns_ad_autumn_forest_bird_389c_v1code: 'ACTUAL v1 pipeline output (16/16 birds)',
    ad_campaigns_ad_autumn_forest_bird_389c: 'MAGENTA full-scene (gemini flash) + aligned restore',
    ad_campaigns_ad_autumn_forest_bird_389c_adopt: 'ADOPT: painted birds pasted on clean bg',
    ad_campaigns_ad_autumn_forest_bird_e016: 'MAGENTA full-scene (openai bg+paint), HITL hitboxes',
    ad_campaigns_ad_autumn_forest_bird_389c_gpt2: 'MAGENTA full-scene (gpt-image-2 paint), HITL hitboxes',
  };
  const levelLabel = document.createElement('div');
  levelLabel.style.cssText = 'position:fixed;top:max(env(safe-area-inset-top,0px),8px);left:8px;right:80px;'
    + 'background:rgba(0,0,0,.65);color:#ffe14a;padding:5px 10px;border-radius:10px;'
    + 'font:700 12px system-ui;z-index:9999;pointer-events:none;display:none;';
  document.body.appendChild(levelLabel);
  window.setInterval((): void => {
    let id: string | undefined;
    for (const scene of game.scene.getScenes(true)) {
      const lvl = (scene as Partial<{ level: { id?: string } | null }>).level;
      if (lvl?.id !== undefined) { id = lvl.id; break; }
    }
    if (id === undefined) { levelLabel.style.display = 'none'; return; }
    levelLabel.textContent = VARIANT_LABELS[id] ?? id;
    levelLabel.style.display = 'block';
  }, 800);

  // __FIND_DOG_GAME__ is consumed by the Settings → Capture flow in HUD.ts,
  // which is itself gated on `!import.meta.env.PROD`. The
  // TEST_HARNESS_ENABLED gate (DEV || VITE_ENABLE_TEST_HARNESS) is stricter
  // — it skips `vite build --mode development` builds, leaving the Capture
  // button visible but its game handle unassigned. Expose the game handle
  // under the SAME gate the consumer uses so dev APKs work.
  if (!import.meta.env.PROD) {
    void import('@fabrikav2/testkit/testing').then(({ assignWindowBindings: assign }): void => {
      assign(window as unknown as Record<string, unknown>, { __FIND_DOG_GAME__: game });
    });
  }

  if (TEST_HARNESS_ENABLED) {
    void Promise.all([
      import('./testing/TestHarness'),
      import('./audio/AmbientManager'),
    ]).then(([{ createFindTheDogHarness, FIND_THE_DOG_TOUR_STATES, snapshotMatchesFindTheDogDriveState }, ambient]): void => {
      const harness = createFindTheDogHarness(game);
      releaseTestBindings?.();
      const releaseHarnessBindings = assignWindowBindings(window as unknown as Record<string, unknown>, {
        __FIND_DOG_GAME__: game,
        __FIND_DOG_STATE__: gameState,
        __FIND_DOG_HARNESS__: harness,
        __FIND_DOG_AMBIENT__: ambient.__ambientDebugSnapshot,
      });
      if (import.meta.env.MODE === 'zoom-eval' && String(import.meta.env.VITE_ENABLE_TEST_HARNESS) === 'true') {
        void import('./testing/ZoomEvalHook').then(({ installZoomEvalHook }): void => {
          const releaseZoomEval = installZoomEvalHook(game, harness);
          releaseTestBindings = (): void => {
            releaseZoomEval();
            releaseHarnessBindings();
          };
        });
      } else {
        releaseTestBindings = releaseHarnessBindings;
      }
      const requestedTourState = String(import.meta.env.VITE_INSITU_TOUR_STATE ?? '');
      const tourStates = (FIND_THE_DOG_TOUR_STATES as readonly string[]).includes(requestedTourState)
        ? [requestedTourState as (typeof FIND_THE_DOG_TOUR_STATES)[number]]
        : FIND_THE_DOG_TOUR_STATES;
      void maybeRunInsituTour(harness, {
        snapshotMatchesState: snapshotMatchesFindTheDogDriveState,
        states: tourStates,
      }).catch((err: unknown): void => {
        console.warn('[insituTour] failed while running FTD tour', err);
      });
      if (String(import.meta.env.VITE_FTD_SIM_AUTOPLAY) === 'true') {
        window.setTimeout((): void => {
          harness.gotoGameScene();
          const poll = window.setInterval((): void => {
            const snapshot = harness.snapshot();
            if (snapshot.activeScene !== 'GameScene' || snapshot.dogPositions.length === 0) return;
            window.clearInterval(poll);
            const centerX = snapshot.levelSize.width / 2;
            const centerY = snapshot.levelSize.height / 2;
            const target = snapshot.dogPositions.reduce((best, dog) => {
              const bestDistance = Math.hypot(best.x - centerX, best.y - centerY);
              const dogDistance = Math.hypot(dog.x - centerX, dog.y - centerY);
              return dogDistance < bestDistance ? dog : best;
            });
            harness.findDog(target.id);
          }, 250);
        }, 250);
      }
    }).catch((err: unknown): void => {
      console.warn('[testHarness] failed to initialize FTD harness', err);
    });
  }
}
