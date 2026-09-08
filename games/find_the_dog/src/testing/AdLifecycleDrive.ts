import { gameState } from '../core/GameState';
import { adService } from '../ads/Service';
import { buildStamp } from '../analytics/AnalyticsService';
import type { FindTheDogHarness } from './TestHarness';

/**
 * Build-time gated physical-device drive for the ad lifecycle proof
 * (docs/evidence/2026-09-08-ftd-ads-lifecycle). Loaded from runtime.ts only
 * when the test harness is enabled AND `VITE_FTD_AD_LIFECYCLE_DRIVE === 'true'`,
 * so store builds never contain it (same gate pattern as VITE_FTD_SIM_AUTOPLAY).
 *
 * It plays the real game through the real ad seams and prints timestamped
 * `[ad-drive]` markers plus every drained owned-analytics ad event as JSON, so
 * the native syslog holds the whole sequence next to the provider's own
 * `[ads:admob]` lines and the GMA SDK's logs. Full-screen test ads are closed
 * by the companion XCUITest (tools/verify-device/runner AdCloserTests); this
 * drive only waits for them.
 *
 * Player state: the drive snapshots the level index and wallet at start and
 * restores both at the end, and logs both, so the device owner's progress and
 * balances are not silently changed. Best times of the played levels can
 * still update; nothing is deleted or reset.
 */
const AD_EVENT_NAMES = new Set(['ad_lifecycle', 'ad_shown', 'ad_show_failed', 'ad_revenue_paid', 'rewarded_ad_granted']);
const JOURNAL_KEY = '__ad_drive_journal__';
const MARKER_ID = '__addrive__';
let sequence = 0;

/**
 * Three sinks for one line: console (Xcode), localStorage (pulled afterwards
 * from the app data container with `devicectl device copy from`), and a hidden
 * accessibility element whose label the companion XCUITest polls — the same
 * mechanism the insitu tour uses for `tourstate:` markers.
 */
function log(step: string, details?: unknown): void {
  sequence += 1;
  const line = `${new Date().toISOString()} ${step}${details === undefined ? '' : ` ${JSON.stringify(details)}`}`;
  console.info(`[ad-drive] ${line}`);
  try {
    const existing = localStorage.getItem(JOURNAL_KEY) ?? '';
    localStorage.setItem(JOURNAL_KEY, `${existing}${line}\n`.slice(-200_000));
  } catch {
    /* storage denied: console + marker still carry the line */
  }
  let marker = document.getElementById(MARKER_ID);
  if (marker === null) {
    marker = document.createElement('div');
    marker.id = MARKER_ID;
    marker.setAttribute('role', 'text');
    marker.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;overflow:hidden;pointer-events:none;z-index:2147483647;';
    document.body.appendChild(marker);
  }
  marker.setAttribute('aria-label', `addrive:${sequence}:${line.slice(0, 900)}`);
  marker.textContent = `addrive:${sequence}`;
}

const BASELINE_KEY = '__ad_drive_baseline__';
interface DriveBaseline { levelIndex: number; coins: number; hints: number }

function parseBaseline(raw: string | null | undefined): DriveBaseline | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DriveBaseline>;
    if (typeof value.levelIndex === 'number' && typeof value.coins === 'number' && typeof value.hints === 'number') {
      return { levelIndex: value.levelIndex, coins: value.coins, hints: value.hints };
    }
  } catch { /* fall through */ }
  return null;
}

/** Flag-supplied baseline (`true;baseline={"levelIndex":1,"coins":45,"hints":3}`) wins over the persisted one. */
function readBaseline(): DriveBaseline | null {
  const flag = String(import.meta.env.VITE_FTD_AD_LIFECYCLE_DRIVE ?? '');
  const supplied = parseBaseline(flag.split(';baseline=')[1]);
  if (supplied !== null) {
    writeBaseline(supplied);
    return supplied;
  }
  try { return parseBaseline(localStorage.getItem(BASELINE_KEY)); } catch { return null; }
}

function writeBaseline(baseline: DriveBaseline): void {
  try { localStorage.setItem(BASELINE_KEY, JSON.stringify(baseline)); } catch { /* ignore */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitFor(label: string, predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(250);
  }
  log(`wait timeout: ${label}`);
  return false;
}

export function installAdLifecycleDrive(harness: FindTheDogHarness): void {
  const dumpEvents = (phase: string): void => {
    const events = harness.drainEvents().filter((event) => AD_EVENT_NAMES.has(event.name));
    for (const event of events) log(`event:${phase}`, { name: event.name, params: event.params });
  };
  const button = (selector: string): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(selector);
  const clickable = (selector: string): boolean => {
    const el = button(selector);
    return el !== null && !el.disabled && el.getClientRects().length > 0;
  };

  const run = async (): Promise<void> => {
    try { localStorage.removeItem(JOURNAL_KEY); } catch { /* ignore */ }
    // Baseline = the device owner's real progress, captured once and restored
    // at every drive start AND end, so interrupted runs (WebContent recycle,
    // test-runner teardown) cannot leave the phone advanced. A baseline may
    // be supplied through the flag value (`true;baseline={...}`) for a device
    // whose first runs predate this persistence.
    const baseline = readBaseline();
    if (baseline !== null) {
      harness.setState({ currentLevelIndex: baseline.levelIndex });
      harness.setWallet({ coins: baseline.coins, hints: baseline.hints });
      log('restored baseline at start', baseline);
    } else {
      writeBaseline({ levelIndex: gameState.currentLevelIndex, coins: harness.walletSnapshot().coins, hints: harness.walletSnapshot().hints });
    }
    // `true;restoreOnly;baseline={...}`: put the owner's state back (progress,
    // wallet, No-Ads, ads and rate-prompt settings) and stop without playing.
    if (String(import.meta.env.VITE_FTD_AD_LIFECYCLE_DRIVE ?? '').includes(';restoreOnly')) {
      harness.setWallet({ noAds: true });
      harness.setSettings({ adsEnabled: false, ratePromptEnabled: true });
      void adService.hideBanner();
      log('restore-only done', { levelIndex: gameState.currentLevelIndex, wallet: harness.walletSnapshot(), adsEnabled: gameState.settings.adsEnabled, noAds: gameState.hasNoAdsEntitlement, ratePromptEnabled: gameState.settings.ratePromptEnabled });
      return;
    }
    const startIndex = gameState.currentLevelIndex;
    const startWallet = harness.walletSnapshot();
    log('start', {
      build: buildStamp(),
      adsEnabled: gameState.settings.adsEnabled,
      noAds: gameState.hasNoAdsEntitlement,
      levelIndex: startIndex,
      wallet: startWallet,
      remoteConfig: (({ state, lastFetchStatus, fetchTimeMillis, active, sources }) => ({
        state,
        lastFetchStatus,
        fetchTimeMillis,
        // Effective cadence values and where each one came from (default vs remote).
        interstitialEveryNLevels: [active.interstitialEveryNLevels, sources.interstitialEveryNLevels],
        interstitialMinIntervalS: [active.interstitialMinIntervalS, sources.interstitialMinIntervalS],
        interstitialMinLevel: [active.interstitialMinLevel, sources.interstitialMinLevel],
        levelEndClaimX2Enabled: [active.levelEndClaimX2Enabled, sources.levelEndClaimX2Enabled],
        hintRwEnabled: [active.hintRwEnabled, sources.hintRwEnabled],
      }))(harness.remoteConfigSnapshot()),
    });
    const ticker = window.setInterval(() => dumpEvents('tick'), 5_000);
    // A device that owns No-Ads cannot exercise the ad lifecycle. Lift the
    // entitlement for the drive only, restore it in `finally`; the runtime's
    // RevenueCat customer-info recovery re-grants it on the next launch anyway.
    const liftedNoAds = gameState.hasNoAdsEntitlement || !gameState.settings.adsEnabled;
    // The rate prompt opens on Next after the 5th completion and blocks the
    // level transition; suppress it for the drive so no answer is recorded on
    // the owner's behalf, then restore the setting.
    const startRatePromptEnabled = gameState.settings.ratePromptEnabled;
    harness.setSettings({ ratePromptEnabled: false });
    try {
      if (liftedNoAds) {
        // The harness can only grant No-Ads (there is no product path that
        // revokes it), so the drive clears the private flag directly and
        // re-grants through the harness in `finally`.
        (gameState as unknown as { _noAdsEntitlement: boolean })._noAdsEntitlement = false;
        harness.setSettings({ adsEnabled: true });
        log('temporarily lifted No-Ads entitlement for the drive', { adsEnabled: gameState.settings.adsEnabled, noAds: gameState.hasNoAdsEntitlement });
        // Boot skipped ad init for the entitled player; start it now like a
        // fresh launch would (consent → initialize → interstitial prewarm).
        await adService.init();
        void adService.preloadRewarded();
      }
      await sleep(6_000); // consent + init + prewarm + HUD rewarded preload
      dumpEvents('boot');
      // In-memory, test-only cadence override so the FIRST Next is
      // interstitial-eligible (the live value stays 3 and is logged above):
      // completion 1 = claim-x2 rewarded + Next interstitial, completion 2 =
      // the 120 s frequency-cap skip. Two level loads instead of three keeps
      // the WebContent process under the iPhone 12 memory ceiling (run 5
      // recycled it on the third rapid level load).
      harness.setRemoteConfigValuesForTest({ interstitialEveryNLevels: 1 });
      log('drive-only remote config override', { interstitialEveryNLevels: harness.remoteConfigSnapshot().active.interstitialEveryNLevels });

      for (let completion = 1; completion <= 2; completion += 1) {
        log(`goto GameScene (completion ${completion})`);
        harness.gotoGameScene();
        const ready = await waitFor('gameplay dogs', () => {
          const snapshot = harness.snapshot();
          return snapshot.activeScene === 'GameScene' && snapshot.dogPositions.length > 0;
        }, 60_000);
        if (!ready) return;
        await sleep(5_000); // banner request → loaded → native impression
        dumpEvents(`gameplay-${completion}`);

        const won = await harness.winLevel();
        log(`winLevel -> ${won}`);
        await waitFor('completion overlay', () => clickable('.fab-complete-claim-btn'), 30_000);
        await sleep(1_500);
        dumpEvents(`complete-${completion}`);

        const overlayState = (): Record<string, unknown> => {
          const reward = document.querySelector('.fab-complete-reward, [class*="fab-complete-reward"]');
          const next = button('.fab-complete-next-btn');
          const claim = button('.fab-complete-claim-btn');
          const x2 = button('.fab-complete-claim-x2-btn');
          return {
            claim: claim === null ? null : { disabled: claim.disabled, hidden: claim.hidden, rects: claim.getClientRects().length },
            claimX2: x2 === null ? null : { disabled: x2.disabled, hidden: x2.hidden, rects: x2.getClientRects().length },
            next: next === null ? null : { disabled: next.disabled, rects: next.getClientRects().length },
            rewardClasses: reward?.className ?? null,
            overlays: document.querySelectorAll('.fab-complete-claim-btn').length,
            // Why claim-x2 may be absent: the GameScene gate reads these.
            claimX2Gate: {
              levelEndClaimX2Enabled: harness.remoteConfigSnapshot().active.levelEndClaimX2Enabled,
              adsEnabled: gameState.settings.adsEnabled,
              noAds: gameState.hasNoAdsEntitlement,
              activeCompletionTransaction: harness.walletSnapshot().activeCompletionTransaction,
            },
          };
        };
        const useX2 = completion === 1 && clickable('.fab-complete-claim-x2-btn');
        const selector = useX2 ? '.fab-complete-claim-x2-btn' : '.fab-complete-claim-btn';
        // Retry the tap: the kit re-enables the claim buttons and resets when
        // its coin-fly rejects, and a tap during the reveal can be ignored.
        let nextReady = false;
        for (let attempt = 1; attempt <= 3 && !nextReady; attempt += 1) {
          log(`tap ${useX2 ? 'claim x2 (rewarded)' : 'claim'} attempt ${attempt}`, overlayState());
          const target = button(selector);
          target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          // A rewarded test ad stays on screen until the XCUITest closes it.
          nextReady = await waitFor('next enabled', () => clickable('.fab-complete-next-btn'), useX2 ? 120_000 : 20_000);
          if (!nextReady) log('after claim attempt', overlayState());
        }
        await sleep(1_000);
        dumpEvents(`claimed-${completion}`);

        log(`tap Next (completion ${completion}; interstitial gate per drive-only cadence override)`);
        button('.fab-complete-next-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        // A cadence-eligible interstitial blocks here until the XCUITest closes it.
        // Any in-app modal that Next awaits (rate prompt) is declined so the
        // drive never leaves the device owner a pending dialog; each decline
        // and the modal state are journaled.
        await waitFor('next level started', () => {
          const modal = document.querySelector<HTMLElement>('[aria-modal="true"]');
          if (modal !== null && !modal.classList.contains('fab-complete')) {
            const decline = [...modal.querySelectorAll<HTMLButtonElement>('.fab-modal-actions button, button')]
              .find((b) => /not really|later|no thanks|not now|close/i.test(b.textContent ?? ''));
            log('modal during Next', { text: (modal.textContent ?? '').replace(/\s+/g, ' ').slice(0, 120), declined: decline?.textContent ?? null });
            decline?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          }
          const snapshot = harness.snapshot();
          return snapshot.activeScene === 'GameScene' && !snapshot.levelCompleteOverlayVisible && snapshot.foundDogIds.length === 0;
        }, 120_000);
        await sleep(2_000);
        dumpEvents(`next-${completion}`);
      }

      log('go home (banner hidden), then back to gameplay (banner re-requested)');
      harness.gotoHomeForTest();
      await sleep(3_000);
      dumpEvents('home');
      harness.gotoGameScene();
      await waitFor('gameplay again', () => harness.snapshot().activeScene === 'GameScene', 60_000);
      await sleep(5_000);
      dumpEvents('gameplay-again');
    } finally {
      window.clearInterval(ticker);
      dumpEvents('final');
      harness.setState({ currentLevelIndex: startIndex });
      harness.setWallet({ coins: startWallet.coins, hints: startWallet.hints });
      harness.setSettings({ ratePromptEnabled: startRatePromptEnabled });
      if (liftedNoAds) {
        harness.setWallet({ noAds: startWallet.hasNoAdsEntitlement });
        harness.setSettings({ adsEnabled: false });
        void adService.hideBanner();
        log('restored No-Ads entitlement and ads setting', { adsEnabled: gameState.settings.adsEnabled, noAds: gameState.hasNoAdsEntitlement });
      }
      log('end', { levelIndexRestoredTo: startIndex, wallet: harness.walletSnapshot() });
    }
  };

  window.setTimeout((): void => {
    void run().catch((err: unknown): void => log('drive failed', { error: String(err) }));
  }, 1_500);
}
