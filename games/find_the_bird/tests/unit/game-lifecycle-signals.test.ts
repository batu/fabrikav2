import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installGameLifecycle,
  isGameSuspended,
  registerLifecycleHooks,
  resetGameLifecycleForTest,
} from '../../src/platform/gameLifecycle';

interface AppStateListenerHandle {
  remove(): Promise<void>;
}

type AppStateListener = (state: { isActive: boolean }) => void;

function fakeGame() {
  return {
    loop: {
      resetDelta: vi.fn(),
      sleep: vi.fn(),
      wake: vi.fn(),
    },
  };
}

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  setDocumentHidden(false);
  resetGameLifecycleForTest();
});

afterEach(() => {
  resetGameLifecycleForTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('game lifecycle signals', () => {
  it('uses appStateChange as the primary signal and deduplicates browser fallbacks', async () => {
    const game = fakeGame();
    const onSuspend = vi.fn();
    const onResume = vi.fn();
    let appStateListener: AppStateListener | undefined;
    const handle: AppStateListenerHandle = { remove: vi.fn().mockResolvedValue(undefined) };
    const addListener = vi.fn(
      async (_eventName: 'appStateChange', listener: AppStateListener): Promise<AppStateListenerHandle> => {
        appStateListener = listener;
        return handle;
      },
    );

    registerLifecycleHooks('test', { onSuspend, onResume });
    installGameLifecycle(game as never, async () => ({ App: { addListener } }), () => true);
    await vi.waitFor(() => expect(addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function)));

    appStateListener?.({ isActive: false });
    setDocumentHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));

    expect(isGameSuspended()).toBe(true);
    expect(game.loop.sleep).toHaveBeenCalledTimes(1);
    expect(onSuspend).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    appStateListener?.({ isActive: true });
    setDocumentHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(isGameSuspended()).toBe(false);
    expect(game.loop.wake).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledWith(1_000);
  });

  it('keeps browser visibility and pagehide fallbacks when the App listener rejects', async () => {
    const game = fakeGame();
    const onSuspend = vi.fn();
    const onResume = vi.fn();
    const addListener = vi.fn().mockRejectedValue(new Error('App plugin unavailable'));

    registerLifecycleHooks('test', { onSuspend, onResume });
    installGameLifecycle(game as never, async () => ({ App: { addListener } }), () => true);
    await vi.waitFor(() => expect(addListener).toHaveBeenCalled());

    setDocumentHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    setDocumentHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onSuspend).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('isolates throwing hooks and removes only its App listener handle on reset', async () => {
    const game = fakeGame();
    const flush = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    let appStateListener: AppStateListener | undefined;
    const addListener = vi.fn(
      async (_eventName: 'appStateChange', listener: AppStateListener): Promise<AppStateListenerHandle> => {
        appStateListener = listener;
        return { remove };
      },
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    registerLifecycleHooks('throws', {
      onSuspend: () => {
        throw new Error('hook failed');
      },
    });
    registerLifecycleHooks('analytics-flush', { onSuspend: flush });
    installGameLifecycle(game as never, async () => ({ App: { addListener } }), () => true);
    await vi.waitFor(() => expect(addListener).toHaveBeenCalled());

    appStateListener?.({ isActive: false });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledOnce();

    resetGameLifecycleForTest();
    expect(remove).toHaveBeenCalledTimes(1);

    appStateListener?.({ isActive: true });
    expect(game.loop.wake).not.toHaveBeenCalled();
  });
});
