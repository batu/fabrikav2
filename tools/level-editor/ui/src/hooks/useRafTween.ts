import { useCallback, useEffect, useRef } from 'react';

export type Easing = (v: number) => number;

/**
 * Drive a single tween via requestAnimationFrame. Designed for canvas writes
 * (no React state updates from inside `onUpdate` — those are an anti-pattern at
 * 60fps). Cancel-on-unmount via cleanup effect.
 *
 * Why no `alive` flag: cancelAnimationFrame is synchronous — once we cancel,
 * the next tick can't fire. The flag is only needed when `onUpdate` does async
 * work (fetch, image decode) where late callbacks could resolve after cancel.
 * For canvas-direct writes the cancel is sufficient.
 */
export function useRafTween(
  durationMs: number,
  easing: Easing,
  onUpdate: (easedProgress: number) => void,
  onComplete?: () => void,
) {
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    startRef.current = null;
  }, []);

  const start = useCallback(() => {
    cancel();
    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const t = Math.min(1, (now - startRef.current) / durationMs);
      onUpdate(easing(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        startRef.current = null;
        onComplete?.();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [durationMs, easing, onUpdate, onComplete, cancel]);

  // Cancel on unmount so the RAF doesn't keep firing against a stale canvas ref.
  useEffect(() => cancel, [cancel]);

  return { start, cancel };
}

/**
 * Phaser's `Sine.easeInOut`. Byte-identical to
 * node_modules/phaser/src/math/easing/sine/InOut.js — short-circuit at v=0/v=1
 * keeps endpoint values exact, formula `0.5 * (1 - cos(πv))` smooths the
 * middle. Match guaranteed by the contract test in tests/e2e/section-pan-timing.
 */
export const sineInOut: Easing = (v: number) =>
  v === 0 || v === 1 ? v : 0.5 * (1 - Math.cos(Math.PI * v));
