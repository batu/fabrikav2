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
 * gold-sun webp set; the menu-mount uses prominent 64/112px medallions and
 * solid (opacity 1) tiles so the dense candy rail reads clearly on phone widths.
 */
export const MARBLE_LEVELMAP_THEME: ThemeTokens = {
  '--fab-levelmap-art-default': "url('/v1/ui/level-node-default.webp')",
  '--fab-levelmap-art-locked': "url('/v1/ui/level-node-locked.webp')",
  '--fab-levelmap-art-completed': "url('/v1/ui/level-node-completed.webp')",
  '--fab-levelmap-art-current': "url('/v1/ui/level-node-current.webp')",
  '--fab-levelmap-node-size': '64px',
  '--fab-levelmap-node-current-size': '112px',
  '--fab-levelmap-node-gap': '2px',
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
  // The kit rail (`.fab-levelmap-path::before`) reads the THREE-stop
  // `--fab-levelmap-line-top/mid/bottom` vars, not the single `--fab-levelmap-line`
  // ftdTheme sets — leaving them unset painted the fat GRAY default rail behind the
  // saga (device-parity MRV2-9 U3). Point them at the v1 wooden-tan connector.
  '--fab-levelmap-line-top': 'rgba(214, 162, 96, 0.55)',
  '--fab-levelmap-line-mid': '#cf9a4f',
  '--fab-levelmap-line-bottom': '#a9702f',
  '--fab-levelmap-line-glow': '0 0 0 2px rgba(255, 246, 224, 0.28)',
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
/* Device-parity MRV2-10 U1: during gameplay the ONLY bubble field is
   #game-container::before (behind the transparent board canvas). This fixed
   full-screen tile lives on #hud-overlay (above the board), so it must be gated
   off while the gameplay HUD is mounted, or bubbles render OVER the playfield
   (judge3 "pale bubbles over the playfield" major). Home/shell screens keep it. */
.marble-ui.mr-gameplay-active::before { display: none; }
.marble-ui > * { position: relative; z-index: 1; }

/* v1 menu life: eight 6x12 candy dashes falling behind all interactive chrome. */
.marble-ambient-sprinkles {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.marble-ambient-sprinkle {
  position: absolute;
  top: -5vh;
  width: 6px;
  height: 12px;
  border-radius: 5px;
  opacity: 0.68;
  animation: marble-sprinkle-fall linear infinite;
}
@keyframes marble-sprinkle-fall {
  from { transform: translateY(0) rotate(0deg); }
  to { transform: translateY(115vh) rotate(540deg); }
}

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
  /* MRV2-23 item 3b: the wooden banner must paint ABOVE the rotating decor board
     (#hud-overlay > .marble-home-board-preview, z-index:2), while the saga rail
     stays behind it. The board raise (MRV2-20 item 4) already documented this
     intended banner level ("banner z-index:4") but it was never applied here, so
     the board rendered OVER the banner. .marble-home-header creates no stacking
     context (plain grid), so this competes in the same root context as the board,
     matching the LEVEL button (20) / current node (21) that already escape it. */
  z-index: 4;
  display: flex;
  justify-content: center;
  /* v1 parity: coin pill + gear sit ABOVE the banner (refs/home-fresh.png).
     The 3-col grid places pill/spacer/gear on row 1 and the full-width banner on
     row 2 in DOM order — so the banner must NOT be pulled up with order:-1. */
  margin-top: 4px;
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

/* v1 App.showMenuDecor: the tilted decor board between banner and saga chain.
   A three.js canvas (HomeBoardPreview) in DOM flow just under the header; the
   board frames itself with margins, so a square slot reads as the ref tile. */
.marble-home-board-preview-slot {
  /* Device-parity MRV2-11 U4: the decor board canvas is now rendered FULL-BLEED
     behind the home DOM (see .marble-home-board-preview below), reproducing v1's
     large tilted framed board at viewport aspect. This slot is now only a spacer
     that reserves the banner→saga vertical room so the saga column keeps hugging
     the board rather than floating in the emptied middle. */
  width: min(66vw, 300px);
  aspect-ratio: 1 / 1;
  /* MRV2-14 U1 (KTD1): trimmed from 264px so the banner→saga block fits the
     390×844 budget and the chain's tail (sun node 1 / node 106) clears the
     fixed LEVEL button instead of sliding under it. Tuned headlessly against
     refs/home-fresh.png + refs/level-map.png. */
  /* MRV2-15 U1: recover the final deliberate gap between the complete sun and
     fixed CTA. The wave-7 value avoided overlap but left the sun visually
     tucked behind the button at the reference viewport. */
  max-height: 155px;
  margin: 2px auto -6px;
  pointer-events: none;
}
@media (max-height: 800px) {
  .marble-home-board-preview-slot { max-height: 115px; }
}

/* MRV2-9 U3: force the saga into a single tight centered column. The kit centers
   nodes by default (--node-x:0); pin it so no inherited offset can reintroduce
   the zigzag, and keep the composed saga hugging the board rather than floating
   in the middle of the empty region. */
#home-shell .fab-levelmap-node { --node-x: 0px !important; }
/* MRV2-14 U1 (KTD1): the kit rail is min-height min(455px, 100%) with
   justify-content center, so a short 4-node chain leaves ~175px of centered
   dead band that (with the preview spacer) overflowed the 390×844 budget and
   pushed sun node 1 / node 106 under the fixed LEVEL button. Collapse the rail
   to its content height so the chain hangs directly off the board bottom (v1). */
#home-shell .fab-levelmap-path { min-height: 0; }
#home-shell .fab-home-menu-content {
  flex: 0 1 auto;
  justify-content: flex-start;
  padding-top: 4px;
}
/* MRV2-20 item 3: .fab-home-menu-content is a flex ROW with justify-content:
   flex-start, so the .fab-levelmap wrapper (a fixed-width flex item) packed to
   the LEFT — the saga chain drifted ~46px left of the viewport midline while v1
   (base game menu.png) centers it. margin-inline:auto absorbs the free space on
   both sides, centering the chain on the midline regardless of the row packing. */
#home-shell .fab-home-menu-content > .fab-levelmap { margin-inline: auto; }
/* MRV2-11 U4 (KTD4): full-bleed decor canvas behind the home DOM. Stage.resize
   already renders at window.innerWidth/Height (viewport aspect), so displaying
   the canvas viewport-sized — instead of squished into the old square slot —
   reproduces v1's large tilted framed board by construction. z-index:0 keeps it
   BELOW the home shell content (.marble-ui > * is z-index:1). MRV2-13: id
   strength (#hud-overlay, 1-1-0) on purpose — the gameplay sheet's
   '#game-container > canvas' rule (1-0-1) previously out-specified the old
   two-class selector and left this canvas in-flow below the viewport.
   Non-interactive so taps reach the DOM above it. */
#hud-overlay > .marble-home-board-preview {
  position: fixed;
  inset: 0;
  /* MRV2-24 same-device Pixel capture: keep the board behind the saga rail so
     its top numbered node remains fully readable at every progression point. */
  z-index: 0;
  display: block;
  width: 100vw;
  height: 100dvh;
  pointer-events: none;
}
/* Level-map / home current node sits ABOVE the fixed LEVEL button (z-index:20)
   where they meet (MRV2-11 U4: node 106 over the button on the level map). */
#home-shell .fab-levelmap-node.current {
  position: relative;
  z-index: 21;
}

/* Green LEVEL action button — Button_Green sprite already set via --fab-btn-sprite-image. */
.marble-ui .marble-level-button {
  /* MRV2-20 item 6: the kit paints the sprite as a background sized 100% 100%
     (ui.css .fab-btn), which STRETCHES Button_Green.png (native 435x200, ratio
     2.175:1) to the button box. The old min-width:220 / min-height:68 box is
     ~3.2:1, flattening the gloss + corner radius vs v1. v1 (.menu-play +
     .vida-button-art, style.css) instead uses width:min(56vw,232px) with an
     img at width:100% height:auto, i.e. the sprite's NATIVE aspect ratio. Match
     that: fix the box to the sprite ratio so the background is undistorted. */
  width: min(56vw, 232px);
  min-width: 0;
  min-height: 0;
  aspect-ratio: 435 / 200;
  padding: 0;
  color: #fff;
  font-family: var(--fab-font-display);
  font-size: 24px;
  text-shadow: 0 2px 0 rgba(20, 90, 30, 0.5);
}

.marble-ui .fab-home-menu {
  box-sizing: border-box;
  min-height: 100dvh;
  padding: 0 16px 96px;
  /* Device-parity MRV2-10 U2: the fixed LEVEL button (~86px tall at bottom 18px)
     was overlapping the last saga node (gold sun node 1 hidden behind it,
     refs/home-fresh.png). Reserve enough bottom room that the current node clears
     the button with margin. */
  padding-bottom: calc(148px + env(safe-area-inset-bottom, 0px));
}
.marble-ui .fab-home-menu-content { flex: 1 1 auto; min-height: 0; align-items: center; }
.marble-ui .fab-home-menu-actions {
  position: fixed;
  left: 50%;
  bottom: calc(18px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: 20;
  /* MRV2-14 U1 (KTD2): the kit sets this container width:100%, which on a
     position:fixed element resolves against the VIEWPORT — hence the edge-to-edge
     full-bleed LEVEL button. Shrink to the content so the button sizes from its
     own min-width:220px like v1 (inset pill, refs/home-fresh.png). */
  width: max-content;
}

/* Locked-node shake reject (v1 dom.ts affordance). */
.fab-levelmap-node.marble-node-rejected { animation: marble-node-shake 0.4s ease; }
@keyframes marble-node-shake {
  0%, 100% { transform: translateX(var(--node-x)) scale(var(--node-scale)); }
  25% { transform: translateX(calc(var(--node-x) - 8px)) scale(var(--node-scale)); }
  75% { transform: translateX(calc(var(--node-x) + 8px)) scale(var(--node-scale)); }
}

/* ---- Modal layer (MRV2-11 U2 / KTD1) ----
   #modal-root is the single fixed full-viewport layer (index.html). It carries
   .marble-ui only so the themed modal CSS below applies — it must NOT paint the
   animated bubble field the shell screens use, or a stray tile would float over
   every modal. */
#modal-root.marble-ui::before { display: none; }

/* The kit backdrop is position:absolute (fills its mount container). Pin it to
   the viewport so the card centers on the SCREEN regardless of any container
   box, with safe-area padding so the card never sits under a notch/home bar. */
.marble-ui .fab-modal-backdrop {
  position: fixed;
  inset: 0;
  padding:
    max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  /* MRV2-13 U2: the BACKDROP is the scroll container, never the card — the kit
     ribbon overhangs the card top via negative margin, so any card overflow
     clipping crops the ribbon and the top rounded corners (round-5 settings
     defect). margin-block:auto on the card keeps the wave-5 guarantee: auto
     margins center a fitting card and pin an overflowing card's top visible. */
  overflow-y: auto;
}
.marble-ui .fab-modal-card {
  margin-block: auto;
  /* Dock the close X on the card's top-right CORNER (refs/settings.png). */
  --fab-modal-close-inset: -8px;
}

/* ---- Settings / result modal cards (Popup vida via cardImage) ---- */
.marble-ui .fab-modal-card--image {
  border: 0;
  box-shadow: none;
  padding: 64px 30px 30px;
  min-width: min(86vw, 360px);
}
.marble-ui .fab-modal-ribbon-image { width: min(78vw, 300px); }

/* MRV2-14 U2 (KTD3, refs/pause.png + refs/settings.png): the settings/pause card
   (marble-settings-card) is a plain BLOCK, so the kit ribbon's align-self:center
   was ignored (left-aligned) and its ~-40px overhang couldn't beat the 64px card
   padding (ribbon sat fully inside, below the top edge). Make the card a flex
   column so the ribbon centers, cancel the 64px top padding so the ribbon
   overhangs the card top, restore the ribbon image to fill its (widened)
   container so it overhangs the card sides too. Scoped to marble-settings-card so
   the win result card (fab-result-card) composition is untouched (KTD3-guard).
   Constants tuned headlessly against refs/pause.png + refs/settings.png. */
.marble-ui .marble-settings-card.fab-modal-card--image {
  display: flex;
  flex-direction: column;
  /* MRV2-25 item 2 (ref pause.png): v2's settings/pause card rendered ~80% of
     screen width on the Pixel while v1 fills ~87%. Widen to match v1's ratio. */
  width: min(92vw, 420px);
  min-width: min(92vw, 420px);
  max-width: min(92vw, 420px);
}
.marble-ui .marble-settings-card > .fab-modal-ribbon {
  align-self: center;
  width: min(96%, 380px);
  margin: calc(-64px - var(--fab-ribbon-overhang)) 0 var(--fab-space-md);
}
.marble-ui .marble-settings-card > .fab-modal-ribbon > .fab-modal-ribbon-image {
  width: 100%;
  height: 100%;
}
.marble-ui .marble-settings-card .fab-modal-ribbon-title {
  left: 50%;
  transform: translate(-50%, -50%);
  width: 100%;
  text-align: center;
}
.marble-ui .fab-modal-ribbon-title {
  font-family: var(--fab-font-display);
  color: #fff;
  text-shadow: 0 2px 0 rgba(120, 60, 20, 0.55);
}
/* MRV2-17: menu settings replaces the home scene with its own fully opaque,
   dark-purple bubble field. The solid base prevents home chrome from reading
   through; the low-contrast tile and dark scrim reproduce refs/settings.png.
   The in-game variant intentionally retains the shared translucent scrim. */
/* MRV2-25 item 3: on the Pixel this field rendered ~(31,26,36) near-black while
   v1 is a clear ~(64,51,82) purple — the #3b3247 base darkens ~0.5x through
   device compositing. Pre-brighten the base + gradient so the device shade lands
   on v1's purple; the transparent bubble tile still supplies faint texture. */
.fab-ui.fab-modal-backdrop.marble-settings-modal--menu {
  background-color: #9577bf;
  background-image:
    linear-gradient(rgba(149, 119, 191, 0.82), rgba(149, 119, 191, 0.82)),
    url('/v1/ui/marble-shadow-tile.png');
  background-repeat: no-repeat, repeat;
  background-size: auto, 320px 320px;
}
/* MRV2-25 item 2 (ref pause.png): v1 FULLY dims the gameplay HUD beneath the
   pause card — hearts/gear/hint are barely visible and the field reads as a flat
   ~#3f3351 purple. MRV2-24's 0.66-alpha scrim left the HUD plainly visible on
   device. Raise the alpha near-opaque so the HUD is only faintly ghosted, and use
   a purple pre-brightened to counter the device darkening MRV2-24 measured on
   this layer, so the composited Pixel shade lands on v1's ~(64,51,82). */
.fab-ui.fab-modal-backdrop.marble-settings-modal--ingame {
  background: rgba(162, 129, 207, 0.93);
}
/* MRV2-11 U3 (KTD3, ref refs/settings.png): a small blue rounded SQUARE with a
   white × glyph docked top-right over the ribbon. No X sprite exists in-repo, so
   the blue Button_Settins tile IS the square and the × is a rendered text glyph
   (NOT color:transparent, which hid it as a stretched blob in wave-4). */
.marble-ui .fab-modal-close {
  width: 52px;
  min-width: 52px;
  height: 52px;
  min-height: 52px;
  background: url('${assetUrls.settingsButton}') center / 100% 100% no-repeat;
  border: 0;
  color: #fff;
  font-family: var(--fab-font-display);
  font-size: 30px;
  font-weight: 900;
  line-height: 1;
  text-shadow: 0 2px 0 rgba(30, 70, 140, 0.5);
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
.marble-ui .marble-settings-action {
  color: #fff;
  font-family: var(--fab-font-display);
  /* MRV2-14 U2 (KTD4, refs/pause.png): Restart/Home rows are inset pills (~60%
     card width, centered), not stretched edge-to-edge. */
  width: min(72%, 260px);
  min-height: 64px;
  margin-inline: auto;
}
.marble-settings-modal--ingame .marble-settings-action {
  text-transform: uppercase;
}

/* ---- Result cards (win/lose) ---- */
.marble-ui .fab-result-art { width: 96px; }
/* MRV2-14 U4 (ref refs/win.png): REWARD word-art stacked ABOVE a coin+value row,
   no pill background, directly on the card body; +value in white with a dark
   outline like v1. Was a single inline white pill (round-6 defect 5). */
.marble-ui .marble-reward-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: none;
  color: #fff;
  font-family: var(--fab-font-number);
  font-size: 30px;
}
.marble-ui .marble-reward-coinrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.marble-ui .marble-reward-coinrow img { width: 34px; height: 34px; }
.marble-ui .marble-reward-value {
  color: #fff;
  text-shadow:
    0 2px 0 rgba(60, 30, 10, 0.55),
    0 0 3px rgba(60, 30, 10, 0.6);
}
.marble-ui .marble-reward-text { height: 30px; width: auto; }
.marble-ui .fab-result-message { color: #3f6bb0; font-family: var(--fab-font-display); }

/* ---- Win card device parity (MRV2-11 U5, ref refs/win.png) ---- */
/* Translucent purple dim (NOT the wave-4 opaque gradient): the darkened live
   board — wooden frame and all — must show through beneath the win pieces. */
#modal-root.completion-mode .fab-modal-scrim {
  background: rgba(75, 47, 109, 0.62);
  opacity: 1;
}
/* Three screen-level pieces (ref): coin pill top-right, ribbon+card group, and a
   standalone Next well below. Stack the backdrop children as a centered column so
   the card and the standalone Next sit apart with the dimmed board between. */
#modal-root.completion-mode .fab-modal-backdrop {
  flex-direction: column;
  justify-content: center;
  gap: 0;
}
/* MRV2-23 item 4: keep the result panel at its settled iPhone geometry for the
   whole completion lifetime. The shared card's fluid vw width was observable
   reflowing during Next dismissal; the shell transition cover now masks that
   dismissal as intended, and this fixed flex item cannot stretch meanwhile. */
#modal-root.completion-mode .fab-modal-card.fab-result-card {
  flex: 0 0 auto;
  width: min(304px, calc(100vw - 36px));
  min-width: min(304px, calc(100vw - 36px));
  max-width: min(304px, calc(100vw - 36px));
}
/* MRV2-13 U3 (ref refs/win.png): the LEVEL COMPLETED ribbon sits ABOVE the
   card's top edge — bottom just kissing the card — not overlapping the card
   interior. Extends the kit's default ~20px overhang; needs the U2 no-clip
   card (overflow visible) or the lifted ribbon would be cropped. */
#modal-root.completion-mode .fab-modal-ribbon {
  margin-top: calc(-1 * var(--fab-space-lg) - var(--fab-ribbon-overhang) - 72px);
}
/* MRV2-21 R2 (card item 2, ref v1 .win-level sugar3d/src/ui/style.css:2029):
   the "LEVEL n" label sits in the TOP green band of the ribbon, above the baked
   "COMPLETED" word. The kit eyebrow default is a dark translucent grey at 30% —
   which read wrong (murky, mis-placed) over the green ribbon. Match v1: dark
   green with a subtle white lift, seated in the top band. */
#modal-root.completion-mode .fab-modal-ribbon-eyebrow {
  top: 17%;
  left: 0;
  right: 0;
  /* A game reset zeroes the kit's margin-inline:auto, so the eyebrow pinned to
     the ribbon's left edge instead of centering over COMPLETED. Restore auto. */
  margin-inline: auto;
  color: #26951d;
  font-size: clamp(15px, 4.2vw, 18px);
  letter-spacing: 0;
  text-shadow: 0 1px rgba(255, 255, 255, 0.45);
}
/* Green Next pill: Button_Green sprite is the surface; contain a white label so
   it never renders as giant word-art (the old Txt_Next sprite-label doubling). */
.marble-ui .marble-result-next {
  min-height: 68px;
  color: #fff;
  font-family: var(--fab-font-display);
  font-size: 24px;
  text-shadow: 0 2px 0 rgba(20, 90, 30, 0.5);
}
/* Standalone Next lives on the backdrop, spaced well below the card (ref). */
/* MRV2-21 R3 (card item 3, ref v1 win-next-button width:42%): v1's Next is a
   COMPACT pill, not a full-width bar. Pin its width and horizontal placement to
   the same backdrop-relative geometry so dismissing flex layout cannot morph it. */
.marble-ui .marble-win-next-standalone {
  position: absolute;
  left: 29%;
  /* v1's full-height result card occupies y=5%..95%; its Next is bottom:9.8%
     inside that frame. Flattening those two nested percentages onto this
     backdrop gives 5% + (90% * 9.8%) = 13.82% from the viewport bottom. */
  bottom: 13.82%;
  z-index: 2;
  margin: 0;
  flex: 0 0 auto;
  width: 42%;
  min-width: 0;
  max-width: none;
}
/* Blue wallet pill docked to the SCREEN top-right (backdrop child, safe area). */
.marble-ui .marble-win-coin-pill {
  position: absolute;
  top: max(14px, env(safe-area-inset-top));
  right: max(16px, env(safe-area-inset-right));
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 78px;
  height: 42px;
  padding: 0 14px 0 10px;
  color: #fff;
  font-family: var(--fab-font-number);
  font-size: 19px;
  background: url('${assetUrls.coinFrame}') center / 100% 100% no-repeat;
}
.marble-ui .marble-win-coin-pill img { width: 24px; height: 24px; }
/* Empty win action slot: the card renders no actions (Next is standalone). */
.marble-ui .marble-win-actions-empty { display: none; }
`;
  doc.head.appendChild(style);
}
