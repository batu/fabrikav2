import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion, retriggerCssAnimation } from './index.ts';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('prefersReducedMotion', () => {
  it('returns the matchMedia result for the reduce query', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true } as MediaQueryList);
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('returns false when the query does not match', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false } as MediaQueryList) as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });

  it('returns false when matchMedia is unavailable', () => {
    // @ts-expect-error — simulate an environment without matchMedia.
    window.matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('retriggerCssAnimation', () => {
  it('removes then re-adds the class (reflow restarts the animation)', () => {
    const el = document.createElement('div');
    el.classList.add('bump');
    const remove = vi.spyOn(el.classList, 'remove');
    const add = vi.spyOn(el.classList, 'add');

    retriggerCssAnimation(el, 'bump');

    expect(remove).toHaveBeenCalledWith('bump');
    expect(add).toHaveBeenCalledWith('bump');
    // Remove must precede add, else the browser coalesces it into a no-op.
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(add.mock.invocationCallOrder[0]);
    expect(el.classList.contains('bump')).toBe(true);
  });
});
