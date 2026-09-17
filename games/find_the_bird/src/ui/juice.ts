/**
 * Small celebration helpers for the meta pages: particle bursts and a camera
 * nudge, all Web Animations.
 *
 * Particles live on one fixed layer over the whole viewport, so a burst from a
 * card inside a scroll-snap deck is not clipped by the deck, and a page that
 * closes mid-burst does not orphan them. Every animation is released on
 * `finished` (cancel + effect = null) and the element removed — the September
 * memory kill came from WAAPI animations retaining detached nodes, so nothing
 * here relies on garbage collection alone. `cancelJuice()` releases everything
 * early for page teardown.
 */

import { prefersReducedMotion } from '@fabrikav2/ui';

export interface Point { x: number; y: number }

const live = new Set<Animation>();

function release(animation: Animation): void {
  live.delete(animation);
  try {
    animation.cancel();
    animation.effect = null;
  } catch {
    // Already detached.
  }
}

/** Release every particle and nudge still running. Safe to call repeatedly. */
export function cancelJuice(): void {
  for (const animation of [...live]) release(animation);
  document.getElementById('juice-layer')?.replaceChildren();
}

function run(element: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions, remove: boolean): Animation | null {
  if (typeof element.animate !== 'function') { if (remove) element.remove(); return null; }
  const animation = element.animate(keyframes, options);
  live.add(animation);
  const done = (): void => { release(animation); if (remove) element.remove(); };
  animation.finished.then(done, done);
  return animation;
}

/** Viewport centre of an element, or null when it has no box. */
export function centerOf(element: Element | null, yFraction = 0.5): Point | null {
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height * yFraction };
}

/**
 * Throw a handful of particles from a viewport point. Confetti arcs up and
 * falls; sparkles bloom in place and fade; a puff spreads low and sideways
 * (dust at a landing); feathers drift down slowly.
 */
export function nudge(element: HTMLElement, focus: Point | null = null, strength = 0.025): void {
  if (prefersReducedMotion()) return;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const origin = focus === null
    ? '50% 50%'
    : `${(((focus.x - rect.left) / rect.width) * 100).toFixed(1)}% ${(((focus.y - rect.top) / rect.height) * 100).toFixed(1)}%`;
  const previous = element.style.transformOrigin;
  element.style.transformOrigin = origin;
  const animation = run(element, [
    { transform: 'scale(1)' },
    { transform: `scale(${1 + strength})`, offset: 0.3 },
    { transform: `scale(${1 - strength * 0.3})`, offset: 0.7 },
    { transform: 'scale(1)' },
  ], { duration: 460, easing: 'ease-out', composite: 'add' }, false);
  const restore = (): void => { element.style.transformOrigin = previous; };
  if (animation === null) { restore(); return; }
  animation.finished.then(restore, restore);
}
