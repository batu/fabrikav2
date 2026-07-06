/**
 * Canonical analytics event contract — the game-agnostic core.
 *
 * v1's find_the_dog shipped a 2,610-line analytics subsystem whose canonical
 * registry (`CanonicalAnalyticsEvents.ts`, 672 lines) was welded to FTD: event
 * ids like `dog_found`, a hardcoded `game: 'find_the_dog'` user property, and
 * env separation done ONLY at the credential/endpoint level — no environment
 * marker ever rode inside a payload. block_blast's 122-line shape sat at the
 * other extreme (research 04, claim 2). This module distils the reusable middle:
 * a small canonical event core every Fabrika game shares, a typed per-game
 * extension point instead of forking the registry, and — the one deliberate
 * departure from FTD — a MANDATORY environment marker baked into every emitted
 * payload (decision doc 'SDK test credentials': events must carry a dev/test
 * environment marker so marble_run's SDK verification can't silently pollute
 * FTD's production analytics).
 *
 * This file is pure types + pure helpers: no transport, no I/O, no game strings.
 * The `Sink` interface and its implementations live beside it; the `Analytics`
 * facade (analytics.ts) is what stamps env/session/timestamp and fans an event
 * out to the configured sinks.
 */

import type { FullScreenAdType } from '../ads/AdProvider.ts';

/**
 * The environment marker. Rides in EVERY emitted payload (`toWirePayload`
 * injects it under {@link ENV_PARAM_KEY}) so a dashboard/query can always
 * partition test traffic out of production — the FTD-pollution guardrail from
 * the 'SDK test credentials' decision. This is a payload-level tag; per-env
 * credentials/endpoints remain the primary isolation and are configured on the
 * sinks, not here.
 */
export type AnalyticsEnvironment = 'production' | 'development' | 'test';

/**
 * Param values a sink may transmit. Deliberately narrow — Firebase's native
 * bundle only accepts string/number (booleans are coerced at that sink), and
 * keeping the union primitive keeps every payload JSON-trivially serialisable
 * for the owned mirror. `null`/`undefined` are NOT members: optional params are
 * dropped by {@link compactParams} rather than transmitted empty.
 */
export type AnalyticsParamValue = string | number | boolean;

export type AnalyticsParams = Readonly<Record<string, AnalyticsParamValue>>;

/**
 * The canonical, game-agnostic event core. Every Fabrika game emits these with
 * the same names and dimension vocabulary; per-game behavioural events go
 * through the extension point (a game-specific name union on {@link Analytics})
 * rather than being added here.
 */
export const CANONICAL_EVENT_NAMES = [
  'session_start',
  'session_end',
  'level_start',
  'level_complete',
  'level_fail',
  'purchase',
  'ad_request',
  'ad_impression',
  'ad_click',
  'ad_reward',
  'resource_change',
] as const;

export type CanonicalEventName = (typeof CANONICAL_EVENT_NAMES)[number];

const CANONICAL_EVENT_NAME_SET: ReadonlySet<string> = new Set(
  CANONICAL_EVENT_NAMES,
);

/** Whether `name` is one of the canonical core events (vs a game extension). */
export function isCanonicalEventName(name: string): name is CanonicalEventName {
  return CANONICAL_EVENT_NAME_SET.has(name);
}

// --- Canonical param shapes ------------------------------------------------
// Typed at the call boundary; flattened to AnalyticsParams (undefined dropped)
// before an event is built. Only the discriminating dimensions are required —
// everything optional is genuinely optional and stripped when absent.

export interface SessionStartParams {
  /** True on the very first session after install. */
  readonly first_open?: boolean;
}

export interface SessionEndParams {
  readonly duration_ms?: number;
}

export interface LevelStartParams {
  readonly level_id: string;
  readonly level_index?: number;
}

export interface LevelCompleteParams {
  readonly level_id: string;
  readonly level_index?: number;
  readonly duration_ms?: number;
}

export interface LevelFailParams {
  readonly level_id: string;
  readonly level_index?: number;
  readonly reason?: string;
}

export interface PurchaseParams {
  readonly product_id: string;
  readonly price_usd?: number;
  readonly currency?: string;
  readonly quantity?: number;
}

// `ad_format` must provably be a superset of what the ad provider can show —
// AdFormat = the full-screen formats (interstitial | rewarded) plus 'banner'.
// Type-only import (analytics → ads); ads never imports analytics, so no cycle.
export type AdFormat = FullScreenAdType | 'banner';

export interface AdParams {
  readonly ad_format: AdFormat;
  readonly placement: string;
  readonly provider?: string;
}

export interface AdRewardParams extends AdParams {
  readonly reward_type?: string;
  readonly reward_amount?: number;
}

/** A `source` grants the player currency; a `sink` spends it. */
export type ResourceFlow = 'source' | 'sink';

export interface ResourceChangeParams {
  readonly currency: string;
  /** Always positive; direction is carried by {@link ResourceFlow}. */
  readonly amount: number;
  readonly flow: ResourceFlow;
  readonly reason?: string;
  readonly balance?: number;
}

// --- The emitted envelope --------------------------------------------------

/**
 * A fully-stamped analytics event as it reaches a sink. The three global fields
 * (`env`, `sessionId`, `timestamp`) are populated by the {@link Analytics}
 * facade, not the caller — `env` in particular is a required field precisely so
 * "environment marker is mandatory" is a compile-time guarantee, not a
 * convention a caller can forget.
 */
export interface AnalyticsEvent {
  /** Canonical ({@link CanonicalEventName}) or per-game extension name. */
  readonly name: string;
  /** Event dimensions, already merged with any global params. */
  readonly params: AnalyticsParams;
  /** Milliseconds since epoch, stamped at emit time. */
  readonly timestamp: number;
  /** Session correlation id. */
  readonly sessionId: string;
  /** MANDATORY environment marker — never absent from an emitted payload. */
  readonly env: AnalyticsEnvironment;
}

/** Wire key the environment marker is transmitted under. */
export const ENV_PARAM_KEY = 'env';
/** Wire key the session id is transmitted under. */
export const SESSION_PARAM_KEY = 'session_id';
/** Wire key the event timestamp is transmitted under. */
export const TIMESTAMP_PARAM_KEY = 'event_ts';

/**
 * Flatten an event into the flat param bag every sink actually transmits. This
 * is the single chokepoint that GUARANTEES the environment marker (and session)
 * ride on the payload — Firebase's `logEvent(name, params)`, the console line,
 * and the owned-mirror body all go through here, so none of them can emit an
 * untagged event. Explicit params never shadow the reserved global keys.
 */
export function toWirePayload(event: AnalyticsEvent): AnalyticsParams {
  return {
    ...event.params,
    [ENV_PARAM_KEY]: event.env,
    [SESSION_PARAM_KEY]: event.sessionId,
    [TIMESTAMP_PARAM_KEY]: event.timestamp,
  };
}

/**
 * Drop `undefined`/`null` from a typed param object so optional canonical
 * fields are omitted rather than transmitted empty (FTD stripped these at every
 * sink; doing it once at the boundary keeps the sinks dumb).
 */
export function compactParams(
  params: Readonly<Record<string, AnalyticsParamValue | null | undefined>>,
): AnalyticsParams {
  const out: Record<string, AnalyticsParamValue> = {};
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return out;
}
