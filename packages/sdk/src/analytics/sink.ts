/**
 * The sink abstraction — one interface, N adapters beside it (the packages/sdk
 * house style: the next backend is a file, not a fork).
 *
 * FTD had THREE incompatible egress shapes (`FirebaseAnalyticsSink.logEvent`,
 * the 4-verb `GameAnalyticsSink`, and the `OwnedAnalyticsMirror` class that
 * conformed to neither) and hand-wired the fan-out inside `AnalyticsService`.
 * Here every backend implements the same `emit(event)` and the facade fans out
 * uniformly. A sink receives the fully-stamped {@link AnalyticsEvent} and
 * flattens it via `toWirePayload` — so the environment marker is carried by
 * construction, whatever the transport.
 */
import type { AnalyticsEvent } from './contract.ts';

export interface AnalyticsSink {
  /** Stable identifier, surfaced in errors/stats (e.g. `firebase`, `console`). */
  readonly name: string;

  /**
   * Record one event. Fire-and-forget from the facade's perspective: a sink
   * that batches or posts over the network does so internally and MUST NOT
   * throw synchronously (the facade guards the call, but a well-behaved sink
   * swallows its own transport errors so a dead backend can't stall a game).
   */
  emit(event: AnalyticsEvent): void;

  /**
   * Force any buffered events out (e.g. on visibility-hidden / app-background).
   * Optional: stateless sinks (console, firebase-forwarder) don't implement it.
   */
  flush?(): Promise<void>;
}
