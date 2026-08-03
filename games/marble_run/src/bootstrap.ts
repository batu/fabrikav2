// MUST be first: installs an in-memory localStorage fallback before any module
// reads storage at import time (sandboxed preview / private browsing).
import './platform/storageFallback';
import Phaser from 'phaser';
import { assignWindowBindings, maybeRunInsituTour } from '@fabrikav2/testkit/testing';
import { GameConfig } from './core/GameConfig';
import { TEST_HARNESS_ENABLED } from './core/Constants';
import { gameState } from './core/GameState';
import { initHUD } from './ui/HUD';
import { analytics } from './analytics/AnalyticsService';
import { attribution, configureAttributionStartupGate } from './attribution/AttributionService';
import { adService } from './ads/Service';
import { createSdkContext, getSdkContext, installSdkContext } from './sdk/SdkContext';
import { initializeCohort } from './data/cohortContext';
import { remoteConfigService } from './config/RemoteConfigService';
import { installPortraitOrientationLock } from './platform/portraitOrientation';
import { installGameLifecycle } from './platform/gameLifecycle';
import { installAudioUnlock, installButtonVoiceEffects } from './audio/AudioManager';
import { preloadIcons } from './ui/iconPreload';
import { installSdkVerifierGesture } from './devtools/installSdkVerifierGesture';
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

// Compose the SDK providers (ads / attribution / meta / analytics sinks) from
// env config before any consumer fires an init or event. Off is a first-class
// Disabled* state, so this is safe with an empty env.
installSdkContext(createSdkContext());
void getSdkContext().meta.init();
// Build-time automount for device evidence capture: a dev/harness build with
// VITE_SDK_VERIFIER_AUTOMOUNT=true shows the SDK verifier pane at launch, so
// screenshots need no tap choreography. Same gate as the 4-tap path.
if ((!import.meta.env.PROD || TEST_HARNESS_ENABLED) && import.meta.env.VITE_SDK_VERIFIER_AUTOMOUNT === 'true') {
  void import('./devtools/SdkVerifierMount').then(({ toggleSdkVerifierPane }): void => {
    toggleSdkVerifierPane(getSdkContext());
  });
  // VITE_SDK_VERIFIER_AUTOPRELOAD=true additionally inits ads and preloads both
  // units at launch, so ad-unit verification needs no tap choreography either
  // (simulators have no automated touch path). Same gate as the automount.
  if (import.meta.env.VITE_SDK_VERIFIER_AUTOPRELOAD === 'true') {
    void (async (): Promise<void> => {
      const ads = getSdkContext().ads;
      await ads.init();
      console.log('[sdk-verifier] autopreload interstitial:', await ads.preloadInterstitial().then(() => 'resolved', (e) => `rejected: ${String(e)}`));
      console.log('[sdk-verifier] autopreload rewarded:', await ads.preloadRewarded().then(() => 'resolved', (e) => `rejected: ${String(e)}`));
    })();
  }
}

const game: Phaser.Game = new Phaser.Game(GameConfig);
initHUD();
// Install the single suspend/resume authority (Capacitor pause/resume +
// visibilitychange) so backgrounding the app halts the rAF loop, Phaser
// timers/tweens, ambient motion, and audio instead of cooking the phone. See
// platform/gameLifecycle.ts.
installGameLifecycle(game);
// Retention notifications intentionally NOT bootstrapped: v1 Sugar3D never
// requests iOS notification permission (device-parity defect MRV2-7). The
// NotificationService module + its user-initiated settings toggle stay dormant
// plumbing — no install()/maybePromptOnLaunch() at boot, so no OS permission
// prompt fires. Re-enabling retention reminders is a deferred later-wave call.
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
// Marble Run has no in-app purchases. Remote config still initializes the
// gameplay and advertising policy, but no store provider or restore listener
// is started at launch.
void remoteConfigService.initAndWait();
let releaseTestBindings: (() => void) | null = null;
let releaseSdkVerifierGesture: (() => void) | null = null;
let sdkVerifierTogglePending = false;

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
  releaseSdkVerifierGesture?.();
  releaseSdkVerifierGesture = null;
});

if (typeof window !== 'undefined') {
  if (!import.meta.env.PROD || TEST_HARNESS_ENABLED) {
    releaseSdkVerifierGesture = installSdkVerifierGesture(window, (): void => {
      if (sdkVerifierTogglePending) return;
      sdkVerifierTogglePending = true;
      // Dev-only SDK verifier pane (status / actions / callback log for the
      // ads, attribution, firebase, and facebook components).
      void import('./devtools/SdkVerifierMount')
        .then(({ toggleSdkVerifierPane }): void => {
          toggleSdkVerifierPane(getSdkContext());
        })
        .finally((): void => {
          sdkVerifierTogglePending = false;
        });
    });
  }

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
      import('./testing/pixelsmithStates'),
      import('./audio/AmbientManager'),
    ]).then(([
      { createMarbleRunHarness, snapshotMatchesMarbleRunDriveState },
      { isPixelsmithState, snapshotMatchesPixelsmithState },
      ambient,
    ]): void => {
      const harness = createMarbleRunHarness(game);
      releaseTestBindings?.();
      releaseTestBindings = assignWindowBindings(window as unknown as Record<string, unknown>, {
        __FIND_DOG_GAME__: game,
        __FIND_DOG_STATE__: gameState,
        __MARBLE_RUN_HARNESS__: harness,
        // One-release compatibility alias for existing device drivers.
        __FIND_DOG_HARNESS__: harness,
        __FIND_DOG_AMBIENT__: ambient.__ambientDebugSnapshot,
      });
      // Pixelsmith launches the installed app with no args and waits ≤25s for a
      // `tourstate:<state>` marker, so the target state is baked at build time
      // (VITE_INSITU_TOUR=<state> or ?insituTour=<state>) and driven directly —
      // a sequential multi-state walk can never surface a late state inside 25s.
      // When the request names one of the ten Pixelsmith states, run the tour
      // over just that state; `allstates` and the default keep the six-state
      // verify-device walk verbatim. Same marker path as find_the_dog.
      const requestedTour = (import.meta.env.VITE_INSITU_TOUR as string | undefined)
        ?? new URLSearchParams(window.location.search).get('insituTour');
      const insituTour = requestedTour !== null && requestedTour !== undefined && isPixelsmithState(requestedTour)
        ? maybeRunInsituTour(harness, {
            script: 'allstates',
            states: [requestedTour],
            snapshotMatchesState: snapshotMatchesPixelsmithState,
            // home-fresh's identity IS an untouched save; seeding the default
            // progress profile would fake progress before the drive resets it.
            saveProfile: requestedTour === 'home-fresh' ? null : undefined,
          })
        : maybeRunInsituTour(harness, {
            snapshotMatchesState: snapshotMatchesMarbleRunDriveState,
          });
      void insituTour.catch((err: unknown): void => {
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
