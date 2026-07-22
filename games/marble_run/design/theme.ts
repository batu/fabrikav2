/**
 * Sugar3D shell theme foundation for @fabrikav2/ui. design/** is OUTSIDE the
 * no-literals audit scan, so asset paths, hex colors, and CSS live here freely.
 *
 * All art/fonts load from the MRV2-3 ported tree under public/v1/ui/**, so URLs
 * begin "/v1/ui/". Do NOT re-copy assets into design/assets — the asset-manifest
 * test guards the ported tree.
 */
import type { ThemeTokens } from '@fabrikav2/ui';

/** Vida PNG-layer + level-node art referenced by the shell surfaces. */
export const assetUrls = {
  banner: '/v1/ui/marble-run-banner.webp',
  shadowTile: '/v1/ui/marble-shadow-tile.png',

  // Home chrome (GameScreen vida).
  coinFrame: '/v1/ui/vida/GameScreen/Frame_Currency.png',
  coinIcon: '/v1/ui/vida/GameScreen/Icon_Coin.png',
  settingsButton: '/v1/ui/vida/GameScreen/Button_Settins.png',
  settingsIcon: '/v1/ui/vida/GameScreen/Icon_Settings.png',
  levelButton: '/v1/ui/vida/End/Win/Button_Green.png',

  // Settings modal + finale (Win / Tutorial vida).
  popup: '/v1/ui/vida/End/Win/Popup.png',
  ribbonOrange: '/v1/ui/vida/End/Tutorial/Ribbon_Orange.png',

  // Win result card.
  ribbonCompleted: '/v1/ui/vida/End/Win/Ribbon_Completed.png',
  winGlare: '/v1/ui/vida-win-glare.png',
  crown: '/v1/ui/vida/End/Win/Icon_Crown.png',
  rewardText: '/v1/ui/vida/End/Win/Txt_Reward.png',
  nextText: '/v1/ui/vida/End/Win/Txt_Next.png',

  // Lose result card.
  ribbonFailed: '/v1/ui/vida/End/Fail/Ribbon_Failed.png',
  iconFailed: '/v1/ui/vida/End/Fail/Icon_Failed.png',
  buttonOrange: '/v1/ui/vida/End/Fail/Button_Orange.png',
  buttonGreen: '/v1/ui/vida/End/Win/Button_Green.png',
} as const;

/**
 * Sugar levelmap tokens applied on the SagaMap root. Node art is the ported
 * gold-sun webp set; the menu-mount uses the smaller 56/100px node sizes and
 * solid (opacity 1) tiles so the candy rail reads cleanly against the bubble bg.
 */
export const MARBLE_LEVELMAP_THEME: ThemeTokens = {
  '--fab-levelmap-art-default': "url('/v1/ui/level-node-default.webp')",
  '--fab-levelmap-art-locked': "url('/v1/ui/level-node-locked.webp')",
  '--fab-levelmap-art-completed': "url('/v1/ui/level-node-completed.webp')",
  '--fab-levelmap-art-current': "url('/v1/ui/level-node-current.webp')",
  '--fab-levelmap-node-size': '56px',
  '--fab-levelmap-node-current-size': '100px',
  '--fab-levelmap-node-gap': '4px',
  '--fab-levelmap-node-font': '18px',
  '--fab-levelmap-node-current-font': '39px',
  '--fab-levelmap-far-opacity': '1',
  '--fab-levelmap-distant-opacity': '1',
  '--fab-levelmap-node-color': '#6a3016',
  '--fab-levelmap-dot-color': '#5b4636',
  '--fab-levelmap-locked-color': '#5b4636',
  '--fab-levelmap-locked-dot-color': '#5b4636',
  '--fab-levelmap-completed-color': '#6a3016',
  // v1 renders the current (gold-sun) node number in the same dark brown as the
  // wooden-medallion nodes — white was a shell_template default and reads as a
  // near-invisible digit on the cream sun center (device-parity MRV2-7, defect 5).
  '--fab-levelmap-current-color': '#6a3016',
};

const SHELL_ART_STYLE_ID = 'marble-shell-art';

/**
 * Inject ONE idempotent <style> carrying the parts tokens can't express:
 * @font-face for the v1 fonts, the purple bubble background + animated shadow
 * tile, and the vida PNG-layer chrome CSS for the home header, settings modal,
 * and result cards. Idempotent on repeated calls.
 */
export function installShellArt(doc: Document = document): void {
  if (doc.getElementById(SHELL_ART_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = SHELL_ART_STYLE_ID;
  style.textContent = `
@font-face {
  font-family: 'FredokaOne';
  src: url('/v1/ui/fonts/FredokaOne.woff2') format('woff2');
  font-display: swap;
}
@font-face {
  font-family: 'LilitaOne';
  src: url('/v1/ui/fonts/LilitaOne.ttf') format('truetype');
  font-display: swap;
}
@font-face {
  font-family: 'TitanOne';
  src: url('/v1/ui/fonts/TitanOne.ttf') format('truetype');
  font-display: swap;
}

/* Purple bubble world: gradient body + animated marble-shadow-tile overlay. */
body {
  background: linear-gradient(180deg, #9b7bcd 0%, #6b568e 100%);
}
.marble-ui::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: url('/v1/ui/marble-shadow-tile.png') repeat;
  background-size: 320px 320px;
  opacity: 0.46;
  animation: marble-shadow-drift 32s linear infinite;
}
@keyframes marble-shadow-drift {
  to { background-position: 320px 320px; }
}
.marble-ui > * { position: relative; z-index: 1; }

/* ---- Home header chrome (game-owned slot) ---- */
.marble-home-header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  width: min(100%, 460px);
  margin: 0 auto;
  padding: max(14px, env(safe-area-inset-top)) 12px 4px;
}
.marble-home-banner {
  grid-column: 1 / -1;
  position: relative;
  display: flex;
  justify-content: center;
  order: -1;
  margin-bottom: 4px;
}
.marble-home-banner img {
  width: min(78vw, 360px);
  height: auto;
  filter: drop-shadow(0 10px 18px rgba(40, 20, 60, 0.32));
}
/* v1 "Marble Run" title text overlaying the empty wooden banner plate. */
.marble-home-banner-title {
  position: absolute;
  top: 46%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 62%;
  text-align: center;
  font-family: 'FredokaOne', var(--fab-font-display), sans-serif;
  font-size: clamp(20px, 6.6vw, 32px);
  line-height: 1;
  color: #6a3016;
  text-shadow: 0 2px 0 rgba(255, 240, 205, 0.6);
  pointer-events: none;
  white-space: nowrap;
}
.marble-coin-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 92px;
  height: 46px;
  padding: 0 16px 0 12px;
  color: #fff;
  font-family: var(--fab-font-number);
  font-size: 20px;
  background: url('${assetUrls.coinFrame}') center / 100% 100% no-repeat;
}
.marble-coin-pill img { width: 26px; height: 26px; }
.marble-gear-btn {
  width: 52px;
  height: 52px;
  border: 0;
  background: url('${assetUrls.settingsButton}') center / 100% 100% no-repeat;
  cursor: pointer;
}
.marble-gear-btn img { width: 28px; height: 28px; }

/* Green LEVEL action button — Button_Green sprite already set via --fab-btn-sprite-image. */
.marble-ui .marble-level-button {
  min-width: 220px;
  min-height: 68px;
  color: #fff;
  font-family: var(--fab-font-display);
  font-size: 24px;
  text-shadow: 0 2px 0 rgba(20, 90, 30, 0.5);
}

.marble-ui .fab-home-menu {
  box-sizing: border-box;
  min-height: 100dvh;
  padding: 0 16px 96px;
  padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px));
}
.marble-ui .fab-home-menu-content { flex: 1 1 auto; min-height: 0; align-items: center; }
.marble-ui .fab-home-menu-actions {
  position: fixed;
  left: 50%;
  bottom: calc(18px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: 20;
}

/* Locked-node shake reject (v1 dom.ts affordance). */
.fab-levelmap-node.marble-node-rejected { animation: marble-node-shake 0.4s ease; }
@keyframes marble-node-shake {
  0%, 100% { transform: translateX(var(--node-x)) scale(var(--node-scale)); }
  25% { transform: translateX(calc(var(--node-x) - 8px)) scale(var(--node-scale)); }
  75% { transform: translateX(calc(var(--node-x) + 8px)) scale(var(--node-scale)); }
}

/* ---- Settings / result modal cards (Popup vida via cardImage) ---- */
.marble-ui .fab-modal-card--image {
  border: 0;
  box-shadow: none;
  padding: 64px 30px 30px;
  min-width: min(86vw, 360px);
}
.marble-ui .fab-modal-ribbon-image { width: min(78vw, 300px); }
.marble-ui .fab-modal-ribbon-title {
  font-family: var(--fab-font-display);
  color: #fff;
  text-shadow: 0 2px 0 rgba(120, 60, 20, 0.55);
}
.marble-ui .fab-modal-close {
  background: url('${assetUrls.settingsButton}') center / 100% 100% no-repeat;
  border: 0;
  color: transparent;
}

/* Sugar toggle rows: translucent white pill rows, green-on switch. */
.marble-ui .fab-toggle-row {
  background: rgba(255, 255, 255, 0.54);
  color: #4a2f6d;
  font-family: var(--fab-font-display);
}
.marble-ui .fab-toggle-row-label { color: #4a2f6d; }
.marble-ui .fab-toggle-input:checked + .fab-toggle-slider {
  background: linear-gradient(180deg, #55f464, #10b535);
}

/* In-game settings action rows (Restart / Home) + menu Close. */
.marble-ui .marble-settings-action { color: #fff; font-family: var(--fab-font-display); }

/* ---- Result cards (win/lose) ---- */
.marble-ui .fab-result-art { width: 96px; }
.marble-ui .marble-reward-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.62);
  color: #7a4515;
  font-family: var(--fab-font-number);
  font-size: 26px;
}
.marble-ui .marble-reward-row img { width: 30px; height: 30px; }
.marble-ui .marble-reward-text { height: 26px; width: auto; }
.marble-ui .fab-result-message { color: #3f6bb0; font-family: var(--fab-font-display); }
`;
  doc.head.appendChild(style);
}
