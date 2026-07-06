/**
 * Motion micro-utils, de-duplicated from the v1 seeds.
 *
 * Both helpers were copied verbatim across the v1 codebase; wave B collapses
 * each to a single export (brainstorm D5):
 *  - `prefersReducedMotion` was identical at GameScene.ts:1907, EconomyTransfer.ts:252,
 *    and packages/core/src/ui/index.ts:517.
 *  - the reflow-retrigger dance was duplicated in `pulseDogCounter`
 *    (GameScene.ts:2300-2306) and `bumpTarget` (EconomyTransfer.ts:233-237).
 */

/**
 * Whether the user has asked the OS for reduced motion. Read live (not cached)
 * so a mid-session toggle is honored, and defensive against environments where
 * `matchMedia` is absent (older headless DOMs) — returns `false` there.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Restart a CSS animation/transition bound to `className` by removing the class,
 * forcing a synchronous reflow, then re-adding it. Without the reflow read the
 * browser coalesces remove+add into a no-op and the animation never replays.
 */
export function retriggerCssAnimation(el: HTMLElement, className: string): void {
  el.classList.remove(className);
  // Reading a layout property forces the pending style change to flush, so the
  // re-added class is seen as a fresh animation start.
  void el.offsetWidth;
  el.classList.add(className);
}
