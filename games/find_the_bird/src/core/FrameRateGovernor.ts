/**
 * Dynamic frame-rate cap: 30fps while the scene is still, uncapped while
 * anything is moving.
 *
 * The 30fps cap in GameConfig exists for battery (a single animation forcing
 * the panel to 60Hz is expensive, WWDC22), and for a hidden-object game that
 * is right almost all of the time — players spend most of a level scanning a
 * static picture. It is wrong during the moments that *are* motion: panning,
 * pinching, pickup flights, reveals. Those read as choppy at 30.
 *
 * Phaser 3.90 has no public runtime FPS setter (`TweenManager.setFps` only
 * throttles tween evaluation), and `hasFpsLimit` is read once when the step
 * function is bound — so it cannot be flipped later. But `stepLimitFPS`
 * consults `_limitRate` on EVERY frame:
 *
 *     if (this.delta >= this._limitRate) { ...run the frame... }
 *
 * so setting `_limitRate = 0` passes every frame through while leaving the
 * limited step function bound, and restoring it re-caps. That is the whole
 * mechanism; it is internal, hence the single narrow cast here and the
 * version note above.
 *
 * Callers `pulse()` while motion is happening. The cap returns on its own
 * after IDLE_TAIL_MS without another pulse, so no caller can leak an
 * uncapped loop by forgetting to release.
 */

/** How long an uncapped window survives without a further pulse. */
const IDLE_TAIL_MS = 220;

interface LimitedTimeStep {
  _limitRate: number;
  fpsLimit: number;
}

let cappedRate: number | null = null;
let uncappedUntil = 0;
let active = false;

function timeStep(game: Phaser.Game): LimitedTimeStep | null {
  const loop = game.loop as unknown as LimitedTimeStep | undefined;
  if (!loop || typeof loop._limitRate !== 'number') return null;
  return loop;
}

/**
 * Ask for uncapped frames for the next ~220ms. Cheap enough to call every
 * frame from an update loop; idempotent while already uncapped.
 */
export function pulseHighFrameRate(game: Phaser.Game | null | undefined): void {
  if (!game) return;
  const loop = timeStep(game);
  if (loop === null) return;

  uncappedUntil = performance.now() + IDLE_TAIL_MS;
  if (active) return;

  // Remember the configured cap the first time we lift it, so restoring never
  // invents a rate (and so a future GameConfig change is picked up).
  if (cappedRate === null) cappedRate = loop._limitRate;
  loop._limitRate = 0;
  active = true;
}

/**
 * Re-cap once the tail has elapsed. Call once per frame; no-op when already
 * capped or still inside a pulse window.
 */
export function settleFrameRate(game: Phaser.Game | null | undefined): void {
  if (!game || !active) return;
  if (performance.now() < uncappedUntil) return;
  const loop = timeStep(game);
  if (loop === null) return;
  loop._limitRate = cappedRate ?? (loop.fpsLimit > 0 ? 1000 / loop.fpsLimit : 0);
  active = false;
}

/** Testing/teardown helper: force the configured cap back immediately. */
export function resetFrameRateGovernor(game?: Phaser.Game | null): void {
  if (game) {
    const loop = timeStep(game);
    if (loop !== null && cappedRate !== null) loop._limitRate = cappedRate;
  }
  cappedRate = null;
  uncappedUntil = 0;
  active = false;
}

/** True while the loop is running uncapped. Exposed for tests. */
export function isFrameRateUncapped(): boolean {
  return active;
}
