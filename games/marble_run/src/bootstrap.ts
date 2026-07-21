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
import { preloadIcons } from './ui/iconPreload';
import { installShellArt } from '../design/theme';
import '@fabrikav2/ui/ui.css';
import '../design/tokens.css';
import './v1core/ui/ui.css';
import './ui/styles.css';
import './gameplay/hud.css';

installPortraitOrientationLock();
installAudioUnlock();
installButtonVoiceEffects();
// Inject the sugar shell art layer (fonts, purple bubble bg, vida PNG chrome)
// before any kit surface mounts.
installShellArt(document);
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

  // The 4-tap debug panel previously housed the screenshot-capture button.
  // Per card PscoX2dh, capture moved into Settings. Keeping the 4-tap
  // listener in place as a reserved gesture for future dev affordances
  // without re-adding the panel plumbing that had only one tenant.
  window.addEventListener('pointerup', (): void => {
    const now = Date.now();
    if (now - lastTapTime > TAP_WINDOW_MS) tapCount = 0;
    tapCount += 1;
    lastTapTime = now;
    if (tapCount >= TAPS_REQUIRED) {
      tapCount = 0;
      // Reserved for future dev toggles. Intentionally empty today.
    }
  });

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
    ]).then(([{ createMarbleRunHarness, snapshotMatchesMarbleRunDriveState }, ambient]): void => {
      const harness = createMarbleRunHarness(game);
      releaseTestBindings?.();
      releaseTestBindings = assignWindowBindings(window as unknown as Record<string, unknown>, {
        __FIND_DOG_GAME__: game,
        __FIND_DOG_STATE__: gameState,
        __FIND_DOG_HARNESS__: harness,
        __FIND_DOG_AMBIENT__: ambient.__ambientDebugSnapshot,
      });
      void maybeRunInsituTour(harness, {
        snapshotMatchesState: snapshotMatchesMarbleRunDriveState,
      }).catch((err: unknown): void => {
        console.warn('[insituTour] failed while running FTD tour', err);
      });
      if (String(import.meta.env.VITE_FTD_SIM_AUTOPLAY) === 'true') {
        // Sim autoplay: enter the stub game scene and immediately win the level.
        window.setTimeout((): void => {
          harness.gotoGameScene();
          const poll = window.setInterval((): void => {
            const snapshot = harness.snapshot();
            if (snapshot.activeScene !== 'GameScene' || !snapshot.levelDataReady) return;
            window.clearInterval(poll);
            void harness.winLevel();
          }, 250);
        }, 250);
      }
    }).catch((err: unknown): void => {
      console.warn('[testHarness] failed to initialize FTD harness', err);
    });
  }
}
