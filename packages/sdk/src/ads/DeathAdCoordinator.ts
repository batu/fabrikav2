/**
 * Death-ad coordinator. Carried as-is from v1 `packages/core/src/ads/
 * DeathAdCoordinator.ts` — it was already provider-agnostic, depending only on
 * a minimal `DeathAdService` (any `AdProvider` satisfies it) and a `game:over`
 * event bus. On game over it shows an interstitial (time-bounded), then
 * re-arms the next one, guarding against overlapping runs.
 *
 * `GameOverEventBus` is a minimal structural interface: `@fabrikav2/kernel`'s
 * `TypedEventEmitter<{ 'game:over': { score: number } }>` satisfies it directly
 * (its `on`/`off` are a superset), so the game can pass a kernel emitter
 * without this module taking a dependency on the kernel package.
 */

interface GameOverPayload {
  score: number;
}

type GameOverListener = (payload: GameOverPayload) => void | Promise<void>;

export interface GameOverEventBus {
  on: (event: 'game:over', listener: GameOverListener) => void;
  off: (event: 'game:over', listener: GameOverListener) => void;
}

export interface DeathAdCoordinator {
  dispose: () => void;
}

export interface DeathAdService {
  maybeShowInterstitial: () => Promise<boolean>;
  preloadInterstitial: () => Promise<void>;
}

const DEFAULT_AD_STEP_TIMEOUT_MS = 5_000;

interface DeathAdCoordinatorOptions {
  adStepTimeoutMs?: number;
}

/**
 * `settleWithin` — run `promise` but never let it wedge the game-over flow:
 * resolve void on success, on failure, AND on timeout (settle-on-anything,
 * never throws). This is the OPPOSITE contract to the shared
 * `with-timeout.ts` `withTimeout`, which rejects with `TimeoutError`. The
 * death-ad coordinator deliberately wants "continue no matter what after N ms"
 * (an ad step must never block the game-over transition), so the two helpers
 * are intentionally kept separate — same idea, honestly different names.
 */
const settleWithin = async (promise: Promise<unknown>, timeoutMs: number): Promise<void> =>
  new Promise<void>((resolve: () => void): void => {
    let finished = false;
    const settle = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout((): void => {
      settle();
    }, timeoutMs);

    void promise.then(
      (): void => settle(),
      (): void => settle(),
    );
  });

export const createDeathAdCoordinator = (
  adService: DeathAdService,
  eventBus: GameOverEventBus,
  options: DeathAdCoordinatorOptions = {},
): DeathAdCoordinator => {
  const adStepTimeoutMs: number = options.adStepTimeoutMs ?? DEFAULT_AD_STEP_TIMEOUT_MS;
  let isDisposed = false;
  let isHandlingDeath = false;

  const handleGameOver = async (): Promise<void> => {
    if (isDisposed || isHandlingDeath) {
      return;
    }

    isHandlingDeath = true;
    try {
      await settleWithin(adService.maybeShowInterstitial(), adStepTimeoutMs);
    } finally {
      try {
        await settleWithin(adService.preloadInterstitial(), adStepTimeoutMs);
      } finally {
        isHandlingDeath = false;
      }
    }
  };

  const onGameOver: GameOverListener = (): void => {
    void handleGameOver();
  };

  eventBus.on('game:over', onGameOver);

  return {
    dispose: (): void => {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      eventBus.off('game:over', onGameOver);
    },
  };
};
