/**
 * Canvas↔DOM coordinate bridge.
 *
 * Generalizes FTD `GameScene.ts:counterTargetPoint` (2254-2271) — the pure,
 * substrate-free half of the coin-fly's cross-substrate dependency (grader 08
 * "Most significant miss", R43/R44). It maps a DOM element's on-screen rect into
 * a game's logical coordinate space, so a canvas game can aim a tween at a live
 * HTML anchor (a HUD counter, a balance pill) without knowing where layout put
 * it.
 *
 * Scope note (brainstorm D3 / SURPRISES S1): the two camera-space transforms
 * that sit downstream in v1 — `viewportToScrollFactorZeroPoint` and
 * `levelToViewportPoint` (GameScene.ts:2236-2252) — are Phaser-camera-coupled
 * (`cameras.main`, `imgScale`, `camera.zoom`) and are NOT DOM-only, so they do
 * not live here. They belong to a future kernel/canvas-utils module.
 */

/** A point in a game's logical coordinate space. */
export interface CanvasPoint {
  x: number;
  y: number;
}

/**
 * Fraction (0..1) within an element's rect to aim at. `{x:0.5,y:0.5}` is the
 * center; FTD's dog-counter used `{x:0.34,y:0.5}` (GameScene.ts:2268-2269).
 */
export interface AnchorFraction {
  x: number;
  y: number;
}

const CENTER_ANCHOR: AnchorFraction = { x: 0.5, y: 0.5 };

/**
 * Resolve the on-screen anchor point of `el` into `canvas`'s logical coordinate
 * space (`logicalWidth`×`logicalHeight`), sampling `el` at `anchor` (default
 * center).
 *
 * Returns `null` when either rect has non-positive size — an off-layout or
 * zero-sized element/canvas has no meaningful point. (v1 substituted a hardcoded
 * fallback here; returning `null` lets each caller choose its own fallback,
 * which is the cleaner contract for a shared util.)
 */
export function resolveDomAnchorToCanvasPoint(
  el: Element,
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  anchor: AnchorFraction = CENTER_ANCHOR,
): CanvasPoint | null {
  const canvasRect = canvas.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;

  const elRect = el.getBoundingClientRect();
  if (elRect.width <= 0 || elRect.height <= 0) return null;

  return {
    x: ((elRect.left + elRect.width * anchor.x - canvasRect.left) / canvasRect.width) * logicalWidth,
    y: ((elRect.top + elRect.height * anchor.y - canvasRect.top) / canvasRect.height) * logicalHeight,
  };
}
