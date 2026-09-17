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

export type BurstKind = 'confetti' | 'sparkle' | 'puff' | 'feather';

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

function layer(): HTMLElement {
  let el = document.getElementById('juice-layer');
  if (el instanceof HTMLElement) return el;
  el = document.createElement('div');
  el.id = 'juice-layer';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  return el;
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

const PALETTE = ['#f5c451', '#ffe9a8', '#a8c06a', '#82925e', '#4d9cc4', '#fff8e8', '#e8a07a'];

const rnd = (min: number, max: number): number => min + Math.random() * (max - min);

interface BurstOptions {
  /** Particle count; each kind has a sensible default. */
  count?: number;
  /** Spread radius in CSS px. */
  radius?: number;
  delay?: number;
}

/**
 * Throw a handful of particles from a viewport point. Confetti arcs up and
 * falls; sparkles bloom in place and fade; a puff spreads low and sideways
 * (dust at a landing); feathers drift down slowly.
 */
export function burst(origin: Point, kind: BurstKind, options: BurstOptions = {}): void {
  if (prefersReducedMotion()) return;
  const host = layer();
  const delay = options.delay ?? 0;
  const defaults: Record<BurstKind, { count: number; radius: number }> = {
    confetti: { count: 36, radius: 220 },
    sparkle: { count: 14, radius: 120 },
    puff: { count: 8, radius: 70 },
    feather: { count: 7, radius: 80 },
  };
  const count = options.count ?? defaults[kind].count;
  const radius = options.radius ?? defaults[kind].radius;

  for (let i = 0; i < count; i += 1) {
    const particle = document.createElement('span');
    particle.className = `juice-particle juice-particle--${kind}`;
    particle.style.left = `${origin.x}px`;
    particle.style.top = `${origin.y}px`;
    particle.style.background = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    host.appendChild(particle);

    const stagger = delay + rnd(0, kind === 'confetti' ? 90 : 160);
    if (kind === 'confetti') {
      // Fan upward from the origin, then fall past it, tumbling.
      const angle = rnd(-Math.PI * 0.85, -Math.PI * 0.15);
      const power = rnd(0.55, 1) * radius;
      const dx = Math.cos(angle) * power;
      const peakY = Math.sin(angle) * power;
      const spin = rnd(180, 720) * (Math.random() < 0.5 ? -1 : 1);
      const size = rnd(11, 18);
      particle.style.width = `${size}px`;
      particle.style.height = `${size * rnd(0.55, 1)}px`;
      run(particle, [
        { transform: 'translate(-50%, -50%) scale(.4) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx * 0.7}px), calc(-50% + ${peakY}px)) scale(1) rotate(${spin * 0.4}deg)`, opacity: 1, offset: 0.38 },
        { transform: `translate(calc(-50% + ${dx * 0.9}px), calc(-50% + ${peakY * 0.3 + radius * 0.45}px)) scale(1) rotate(${spin * 0.75}deg)`, opacity: 1, offset: 0.72 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${-peakY * 0.15 + radius * 0.9}px)) scale(.9) rotate(${spin}deg)`, opacity: 0 },
      ], { duration: rnd(1100, 1500), delay: stagger, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' }, true);
    } else if (kind === 'sparkle') {
      const angle = rnd(0, Math.PI * 2);
      const power = rnd(0.3, 1) * radius;
      const dx = Math.cos(angle) * power;
      const dy = Math.sin(angle) * power;
      const size = rnd(16, 30);
      particle.style.width = `${size}px`;
      particle.style.height = `${size}px`;
      run(particle, [
        { transform: 'translate(-50%, -50%) scale(0) rotate(0deg)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${dy * 0.6}px)) scale(1.1) rotate(60deg)`, opacity: 1, offset: 0.4 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0) rotate(120deg)`, opacity: 0 },
      ], { duration: rnd(520, 800), delay: stagger, easing: 'ease-out', fill: 'forwards' }, true);
    } else if (kind === 'puff') {
      const dir = i % 2 === 0 ? -1 : 1;
      const dx = dir * rnd(0.35, 1) * radius;
      const dy = rnd(-radius * 0.35, radius * 0.05);
      const size = rnd(16, 26);
      particle.style.width = `${size}px`;
      particle.style.height = `${size}px`;
      run(particle, [
        { transform: 'translate(-50%, -50%) scale(.3)', opacity: .85 },
        { transform: `translate(calc(-50% + ${dx * 0.7}px), calc(-50% + ${dy}px)) scale(1.2)`, opacity: .6, offset: 0.45 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy - 6}px)) scale(1.6)`, opacity: 0 },
      ], { duration: rnd(420, 620), delay: stagger, easing: 'ease-out', fill: 'forwards' }, true);
    } else {
      // Feathers: a short flick outward, then a lazy sway down.
      const dx = rnd(-1, 1) * radius;
      const fall = rnd(0.6, 1.1) * radius;
      const sway = rnd(8, 16) * (Math.random() < 0.5 ? -1 : 1);
      const tilt = rnd(-40, 40);
      particle.style.width = `${rnd(9, 13)}px`;
      particle.style.height = `${rnd(18, 26)}px`;
      run(particle, [
        { transform: `translate(-50%, -50%) rotate(${tilt}deg) scale(.5)`, opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${-radius * 0.25}px)) rotate(${tilt + 20}deg) scale(1)`, opacity: 1, offset: 0.22 },
        { transform: `translate(calc(-50% + ${dx + sway}px), calc(-50% + ${fall * 0.55}px)) rotate(${tilt - 25}deg) scale(1)`, opacity: .95, offset: 0.62 },
        { transform: `translate(calc(-50% + ${dx - sway}px), calc(-50% + ${fall}px)) rotate(${tilt + 15}deg) scale(.9)`, opacity: 0 },
      ], { duration: rnd(1100, 1500), delay: stagger, easing: 'ease-out', fill: 'forwards' }, true);
    }
  }
}

/**
 * A camera-ish nudge: the element pushes in slightly toward a focus point and
 * settles back with a small overshoot. `focus` is a viewport point; it becomes
 * the transform origin so the push reads as leaning toward the moment.
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
