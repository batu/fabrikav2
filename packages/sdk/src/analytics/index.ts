/**
 * `@fabrikav2/sdk/analytics` — canonical event contract + pluggable sinks.
 *
 * Wiring sketch (a game does this once at boot):
 *
 *   const analytics = createAnalytics<'dog_found' | 'wrong_tap'>({
 *     env: import.meta.env.PROD ? 'production' : 'development',
 *     sessionId: crypto.randomUUID(),
 *     globalParams: { app_version, platform },
 *     sinks: [
 *       createConsoleSink(),
 *       createFirebaseSink(nativeFirebaseTransport),
 *       createOwnedMirrorSink({ url, publicClientKey, transport: httpsPost }),
 *     ],
 *   });
 *   analytics.levelStart({ level_id: 'l1', level_index: 0 });
 *   analytics.track('dog_found', { level_id: 'l1', dog_index: 2 }); // game event
 */

// --- contract (types + pure helpers) ---
export {
  CANONICAL_EVENT_NAMES,
  ENV_PARAM_KEY,
  SESSION_PARAM_KEY,
  TIMESTAMP_PARAM_KEY,
  compactParams,
  isCanonicalEventName,
  toWirePayload,
  type AdFormat,
  type AdParams,
  type AdRewardParams,
  type AnalyticsEnvironment,
  type AnalyticsEvent,
  type AnalyticsParams,
  type AnalyticsParamValue,
  type CanonicalEventName,
  type LevelCompleteParams,
  type LevelFailParams,
  type LevelStartParams,
  type PurchaseParams,
  type ResourceChangeParams,
  type ResourceFlow,
  type SessionEndParams,
  type SessionStartParams,
} from './contract.ts';

// --- wire contract (shared with @fabrikav2/services) ---
export {
  OWNED_ANALYTICS_WIRE_SCHEMA,
  type OwnedAnalyticsWireBatch,
  type OwnedAnalyticsWireEvent,
  type OwnedAnalyticsWireSchema,
} from './wire.ts';

// --- sinks ---
export { type AnalyticsSink } from './sink.ts';
export { createConsoleSink, type ConsoleSinkOptions } from './console-sink.ts';
export {
  createFirebaseSink,
  type FirebaseTransport,
} from './firebase-sink.ts';
export {
  OWNED_MIRROR_SCHEMA,
  createOwnedMirrorSink,
  type MirrorTransport,
  type MirrorTransportRequest,
  type MirrorTransportResult,
  type OwnedMirrorSink,
  type OwnedMirrorSinkOptions,
  type OwnedMirrorStats,
} from './owned-mirror-sink.ts';

// --- facade ---
export {
  createAnalytics,
  type Analytics,
  type CreateAnalyticsOptions,
} from './analytics.ts';
