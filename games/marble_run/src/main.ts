/**
 * Bootstrap: wire the canvas + DOM mount roots into the shell App, load the ui
 * stylesheet + design tokens, and expose the Playwright/unit test harness on
 * window when enabled. Not audited (src/, not src/shell) — but it carries no
 * design literals anyway.
 */
import '@fabrikav2/ui/ui.css';
import '../design/tokens.css';
import { assignWindowBindings } from '@fabrikav2/testkit/testing';
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
const sdk = createGameSdk({ economy, firstOpen: !saveState.hasProgress });
void sdk.init();

const app = new App({ canvas, hudRoot, uiRoot }, sdk);
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
}
