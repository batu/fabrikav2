import { describe, expect, it, vi } from 'vitest';
import { createDeathAdCoordinator, type GameOverEventBus } from './DeathAdCoordinator.ts';

interface ListenerRegistry {
  listener: ((payload: { score: number }) => void | Promise<void>) | null;
}

const createTestEventBus = (): GameOverEventBus & {
  emitGameOver: (score: number) => void;
  listeners: ListenerRegistry;
} => {
  const listeners: ListenerRegistry = { listener: null };
  return {
    listeners,
    on: (_event: 'game:over', listener: (payload: { score: number }) => void | Promise<void>): void => {
      listeners.listener = listener;
    },
    off: (): void => {
      listeners.listener = null;
    },
    emitGameOver: (score: number): void => {
      if (listeners.listener) {
        void listeners.listener({ score });
      }
    },
  };
};

const waitForMicrotask = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const waitForMs = async (ms: number): Promise<void> =>
  new Promise<void>((resolve: () => void): ReturnType<typeof setTimeout> => setTimeout(resolve, ms));

describe('DeathAdCoordinator', (): void => {
  it('attempts ad display and preloads after game over', async (): Promise<void> => {
    const eventBus = createTestEventBus();
    const adService = {
      maybeShowInterstitial: vi.fn(async (): Promise<boolean> => true),
      preloadInterstitial: vi.fn(async (): Promise<void> => {}),
    };

    createDeathAdCoordinator(adService, eventBus);
    eventBus.emitGameOver(100);
    await waitForMicrotask();

    expect(adService.maybeShowInterstitial).toHaveBeenCalledTimes(1);
    expect(adService.preloadInterstitial).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate show attempts while one is in-flight', async (): Promise<void> => {
    const eventBus = createTestEventBus();
    let resolveShow: (shown: boolean) => void = (): void => {};
    const showPromise = new Promise<boolean>((resolve: (shown: boolean) => void): void => {
      resolveShow = resolve;
    });
    const adService = {
      maybeShowInterstitial: vi.fn((): Promise<boolean> => showPromise),
      preloadInterstitial: vi.fn(async (): Promise<void> => {}),
    };

    createDeathAdCoordinator(adService, eventBus);
    eventBus.emitGameOver(10);
    eventBus.emitGameOver(20);

    expect(adService.maybeShowInterstitial).toHaveBeenCalledTimes(1);
    resolveShow(true);
    await waitForMicrotask();

    expect(adService.preloadInterstitial).toHaveBeenCalledTimes(1);
  });

  it('recovers when preload rejects', async (): Promise<void> => {
    const eventBus = createTestEventBus();
    const adService = {
      maybeShowInterstitial: vi.fn(async (): Promise<boolean> => true),
      preloadInterstitial: vi.fn(async (): Promise<void> => {
        throw new Error('preload-failed');
      }),
    };

    createDeathAdCoordinator(adService, eventBus);
    eventBus.emitGameOver(1);
    await waitForMs(5);
    eventBus.emitGameOver(2);
    await waitForMs(5);

    expect(adService.maybeShowInterstitial).toHaveBeenCalledTimes(2);
    expect(adService.preloadInterstitial).toHaveBeenCalledTimes(2);
  });

  it('recovers when show hangs and timeout elapses', async (): Promise<void> => {
    const eventBus = createTestEventBus();
    const adService = {
      maybeShowInterstitial: vi.fn((): Promise<boolean> => new Promise<boolean>(() => {})),
      preloadInterstitial: vi.fn(async (): Promise<void> => {}),
    };

    createDeathAdCoordinator(adService, eventBus, { adStepTimeoutMs: 1 });
    eventBus.emitGameOver(10);
    await waitForMs(5);
    eventBus.emitGameOver(11);
    await waitForMs(5);

    expect(adService.maybeShowInterstitial).toHaveBeenCalledTimes(2);
    expect(adService.preloadInterstitial).toHaveBeenCalledTimes(2);
  });

  it('stops listening after dispose', async (): Promise<void> => {
    const eventBus = createTestEventBus();
    const adService = {
      maybeShowInterstitial: vi.fn(async (): Promise<boolean> => true),
      preloadInterstitial: vi.fn(async (): Promise<void> => {}),
    };

    const coordinator = createDeathAdCoordinator(adService, eventBus);
    coordinator.dispose();
    eventBus.emitGameOver(50);
    await waitForMicrotask();

    expect(adService.maybeShowInterstitial).not.toHaveBeenCalled();
    expect(adService.preloadInterstitial).not.toHaveBeenCalled();
  });
});
