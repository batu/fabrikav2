import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWhenVisibleAndIdle } from '../../src/platform/browserScheduling';

describe('runWhenVisibleAndIdle', () => {
  const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalVisibility !== undefined) {
      Object.defineProperty(document, 'visibilityState', originalVisibility);
    }
  });

  it('requeues idle work when the page hides after the idle callback was requested', () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });

    const idleCallbacks: Array<() => void> = [];
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: () => void): number => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    }));
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const work = vi.fn();

    const cancel = runWhenVisibleAndIdle(work, { idleTimeoutMs: 100 });
    vi.runOnlyPendingTimers();
    expect(idleCallbacks).toHaveLength(1);

    visibility = 'hidden';
    idleCallbacks.shift()?.();
    expect(work).not.toHaveBeenCalled();

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(idleCallbacks).toHaveLength(1);
    idleCallbacks.shift()?.();
    expect(work).toHaveBeenCalledOnce();

    cancel();
  });

  it('cancels the visibility retry installed after a queued idle callback observes a hidden page', () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });

    const idleCallbacks: Array<() => void> = [];
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: () => void): number => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    }));
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const work = vi.fn();

    const cancel = runWhenVisibleAndIdle(work, { idleTimeoutMs: 100 });
    vi.runOnlyPendingTimers();
    visibility = 'hidden';
    idleCallbacks.shift()?.();
    cancel();

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(idleCallbacks).toHaveLength(0);
    expect(work).not.toHaveBeenCalled();
  });

  it('requeues timeout fallback work when the page hides before the fallback fires', () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    vi.stubGlobal('requestIdleCallback', undefined);
    const work = vi.fn();

    const cancel = runWhenVisibleAndIdle(work, { idleTimeoutMs: 100 });
    vi.advanceTimersByTime(0);
    visibility = 'hidden';
    vi.advanceTimersByTime(100);
    expect(work).not.toHaveBeenCalled();

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(100);
    expect(work).toHaveBeenCalledOnce();

    cancel();
  });
});
