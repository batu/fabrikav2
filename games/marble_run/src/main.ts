/**
 * Bootstrap: wire the canvas + DOM mount roots into the shell App, load the ui
 * stylesheet + design tokens, and expose the Playwright/unit test harness on
 * window when enabled. Not audited (src/, not src/shell) — but it carries no
 * design literals anyway.
 */
import '@fabrikav2/ui/ui.css';
import '../design/tokens.css';
import { assignWindowBindings, maybeRunInsituTour } from '@fabrikav2/testkit/testing';
import { createRingBufferSink } from '@fabrikav2/sdk/analytics';
import { App, isHarnessEnabled } from './shell/App';
import { createGameSdk, type GameEconomyBridge } from './sdk/SdkContext';
import { saveState } from './core/SaveState';
import { installLevelMapArt } from '../design/theme';
import { unlockAudio } from './audio/Sfx';

// Level-map node art (Vite-resolved urls) as an unlayered `.fab-levelmap` rule —
// see installLevelMapArt for why an inline theme can't reach the nested rail.
installLevelMapArt();

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

// Compose the four SDKs at the one boot seam. The economy bridge adapts the
// SaveState singleton so GameSdk stays decoupled from concrete persistence.
const economy: GameEconomyBridge = {
  addCoins: (amount) => saveState.addCoins(amount),
  grantNoAds: () => saveState.grantNoAds(),
  hasNoAds: () => saveState.noAds,
  coinBalance: () => saveState.coins,
};

// Test-only analytics witness: when the harness is enabled, fan a RingBufferSink
// beside the console sink so the GameHarness `drainEvents()` can read the trace
// (the coins-conservation oracle for the chaos e2e). Null in production.
const harnessSink = isHarnessEnabled ? createRingBufferSink() : null;

const sdk = createGameSdk({
  economy,
  firstOpen: !saveState.hasProgress,
  analyticsSinks: harnessSink ? [harnessSink] : undefined,
});
void sdk.init();

// StatusBar (light content + overlay) is configured declaratively in
// capacitor.config.ts. The matching runtime init —
//   import { StatusBar, Style } from '@capacitor/status-bar';
//   if (Capacitor.isNativePlatform()) {
//     void StatusBar.setStyle({ style: Style.Light });
//     void StatusBar.setOverlaysWebView({ overlay: true });
//   }
// — is intentionally omitted: @capacitor/status-bar is not yet a dependency
// (adding it + the iOS platform is the SDK-wiring/native card's scope). The
// top-chrome status-bar OVERLAP fix (--fab-safe-top insets) lands this card and
// works on-device without the plugin; only the glyph tint (N5) awaits it.

const app = new App({ canvas, hudRoot, uiRoot }, sdk, harnessSink);
app.start();

// End the analytics session when the tab is hidden/closed (flush pending events).
window.addEventListener('pagehide', () => sdk.endSession(), { once: true });

// Web Audio must be unlocked from a user gesture.
window.addEventListener('pointerdown', () => unlockAudio(), { once: false });

if (isHarnessEnabled) {
  assignWindowBindings(window as unknown as Record<string, unknown>, {
    __MARBLE_RUN_HARNESS__: app.harness(),
    __MARBLE_RUN_GAME__: app,
  });
  void maybeRunInsituTour(app.harness());
}
