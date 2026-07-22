import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { GameScene } from '../scenes/GameScene';
import { HomeScene } from '../scenes/HomeScene';
import { COLORS, DPR, GAME } from './Constants';

const rendererType = String(import.meta.env.VITE_FTD_FORCE_CANVAS) === 'true'
  ? Phaser.CANVAS
  : Phaser.AUTO;

export const GameConfig: Phaser.Types.Core.GameConfig = {
  type: rendererType,
  width: GAME.WIDTH,
  height: GAME.HEIGHT,
  parent: 'game-container',
  // Device-parity MRV2-10 U1: the Phaser canvas must be TRANSPARENT so the
  // wave-3 purple bubble field painted on #game-container (hud.css) shows through
  // during gameplay. An opaque `backgroundColor: COLORS.BG` (cream) covered that
  // field on all four gameplay states — home only read purple because
  // #hud-overlay.home-mode repaints its own field on top. `transparent: true`
  // forces the WebGL/Canvas clear alpha to 0; `backgroundColor` is retained only
  // as the parsed clear tint (alpha is overridden to 0 by `transparent`).
  transparent: true,
  backgroundColor: COLORS.BG,
  roundPixels: true,
  antialias: true,
  // Cap the render loop at 30fps. FTD is a mostly-static hidden-object game —
  // long scrutiny windows with brief reveals — so 60/120Hz mostly burns GPU
  // for nothing. Apple WWDC22 cites up to ~20% battery from a single animation
  // forcing the whole panel to 60 (FTD's Android delta is smaller but real and
  // compounding with thermals). `limit` enforces the cap regardless of the
  // display's refresh rate. forceSetTimeOut is left false (default): switching
  // to setTimeout would break rAF's auto-pause-when-hidden backstop.
  // No per-gesture runtime lift — verified Phaser 3.90 has no public runtime
  // global-loop FPS setter (TweenManager.setFps throttles tween eval only).
  fps: {
    limit: 30,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
    zoom: 1 / DPR,
  },
  input: {
    activePointers: 3,
  },
  scene: [BootScene, HomeScene, GameScene],
};
