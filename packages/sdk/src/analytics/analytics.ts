/**
 * The Analytics facade — what a game holds. It owns the three global stamps
 * (environment marker, session id, timestamp), merges any global params, builds
 * the {@link AnalyticsEvent} envelope, and fans it out to every configured sink.
 *
 * Two design choices carried from the card:
 *   - The environment marker is a REQUIRED constructor field, so a game
 *     physically cannot build an analytics instance that emits untagged events
 *     (the FTD-pollution guardrail, enforced at the type level rather than by
 *     convention).
 *   - The per-game extension point is the generic parameter `GameEvent`: a game
 *     declares its own string-literal union of extra event names and gets a
 *     `track()` that accepts canonical OR game names — without forking the
 *     canonical registry the way FTD forced (`dog_found` lived in the shared
 *     file). Typed canonical helpers (`levelStart`, `purchase`, …) sit on top of
 *     the same `track`.
 *
 * Sink fan-out is guarded per-sink: one throwing sink cannot stop the others or
 * bubble into game code.
 */
import type {
  AdParams,
  AdRewardParams,
  AnalyticsEnvironment,
  AnalyticsEvent,
  AnalyticsParams,
  AnalyticsParamValue,
  CanonicalEventName,
  LevelCompleteParams,
  LevelFailParams,
  LevelStartParams,
  PurchaseParams,
  ResourceChangeParams,
  SessionEndParams,
  SessionStartParams,
} from './contract.ts';
import { compactParams } from './contract.ts';
import type { AnalyticsSink } from './sink.ts';

export interface CreateAnalyticsOptions {
  /** MANDATORY environment marker stamped on every event. */
  readonly env: AnalyticsEnvironment;
  /** Session correlation id, stamped on every event. */
  readonly sessionId: string;
  /** Fan-out targets. May be empty (all events become no-ops). */
  readonly sinks: readonly AnalyticsSink[];
  /**
   * Params merged into EVERY event (e.g. `app_version`, `platform`). Explicit
   * per-event params win on key collision. Optional values are compacted out.
   */
  readonly globalParams?: Readonly<
    Record<string, AnalyticsParamValue | null | undefined>
  >;
  /** Injected clock; default `Date.now`. */
  readonly now?: () => number;
  /**
   * Called when a sink's `emit`/`flush` throws. Default: swallow. A game can
   * route this to its error reporter; it must never rethrow into the facade.
   */
  readonly onSinkError?: (sinkName: string, error: unknown) => void;
}

/**
 * `GameEvent` is the per-game extension point: a union of that game's extra
 * event-name literals. Defaults to `never`, so a game that only needs the
 * canonical core writes `Analytics` with no type argument.
 */
export interface Analytics<GameEvent extends string = never> {
  /** The environment marker this instance stamps (exposed for diagnostics). */
  readonly env: AnalyticsEnvironment;

  /**
   * Emit any canonical or game-extension event. This is the extension point:
   * pass a `GameEvent` name for game-specific events, a canonical name for the
   * core. Params are compacted (undefined/null dropped) and merged over globals.
   */
  track(
    name: CanonicalEventName | GameEvent,
    params?: Readonly<Record<string, AnalyticsParamValue | null | undefined>>,
  ): void;

  // --- typed canonical helpers (thin wrappers over track) ---
  sessionStart(params?: SessionStartParams): void;
  sessionEnd(params?: SessionEndParams): void;
  levelStart(params: LevelStartParams): void;
  levelComplete(params: LevelCompleteParams): void;
  levelFail(params: LevelFailParams): void;
  purchase(params: PurchaseParams): void;
  adRequest(params: AdParams): void;
  adImpression(params: AdParams): void;
  adClick(params: AdParams): void;
  adReward(params: AdRewardParams): void;
  resourceChange(params: ResourceChangeParams): void;

  /** Flush every sink that buffers. Resolves once all have settled. */
  flush(): Promise<void>;
}

export function createAnalytics<GameEvent extends string = never>(
  options: CreateAnalyticsOptions,
): Analytics<GameEvent> {
  const { env, sessionId, sinks } = options;
  const now = options.now ?? Date.now;
  const onSinkError = options.onSinkError ?? ((): void => {});
  const globalParams = options.globalParams
    ? compactParams(options.globalParams)
    : undefined;

  function emit(
    name: string,
    params: Readonly<
      Record<string, AnalyticsParamValue | null | undefined>
    > = {},
  ): void {
    const merged: AnalyticsParams = globalParams
      ? { ...globalParams, ...compactParams(params) }
      : compactParams(params);

    const event: AnalyticsEvent = {
      name,
      params: merged,
      timestamp: now(),
      sessionId,
      env,
    };

    for (const sink of sinks) {
      try {
        sink.emit(event);
      } catch (error) {
        onSinkError(sink.name, error);
      }
    }
  }

  return {
    env,
    track(name, params): void {
      emit(name, params);
    },
    // The typed canonical param interfaces have no index signature, so they
    // aren't structurally `Record<string, …>`; a fresh object-literal spread
    // is — hence `{ ...params }` at each call boundary.
    sessionStart(params): void {
      emit('session_start', { ...params });
    },
    sessionEnd(params): void {
      emit('session_end', { ...params });
    },
    levelStart(params): void {
      emit('level_start', { ...params });
    },
    levelComplete(params): void {
      emit('level_complete', { ...params });
    },
    levelFail(params): void {
      emit('level_fail', { ...params });
    },
    purchase(params): void {
      emit('purchase', { ...params });
    },
    adRequest(params): void {
      emit('ad_request', { ...params });
    },
    adImpression(params): void {
      emit('ad_impression', { ...params });
    },
    adClick(params): void {
      emit('ad_click', { ...params });
    },
    adReward(params): void {
      emit('ad_reward', { ...params });
    },
    resourceChange(params): void {
      emit('resource_change', { ...params });
    },
    async flush(): Promise<void> {
      await Promise.all(
        sinks.map(async (sink) => {
          if (!sink.flush) return;
          try {
            await sink.flush();
          } catch (error) {
            onSinkError(sink.name, error);
          }
        }),
      );
    },
  };
}
