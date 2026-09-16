import { createFirebaseSink, type AnalyticsSink } from '@fabrikav2/sdk/analytics';
import { Capacitor } from '@capacitor/core';
import { canonicalAnalyticsEvents, sanitizeCanonicalAnalyticsParams } from './CanonicalAnalyticsEvents';

type FirebaseAnalyticsPlugin = typeof import('@capacitor-firebase/analytics').FirebaseAnalytics;
type FirebaseModule = {
  FirebaseAnalytics: Pick<FirebaseAnalyticsPlugin, 'logEvent'> & Partial<Pick<FirebaseAnalyticsPlugin, 'setUserProperty'>>;
};
export type FirebaseAnalyticsLoader = () => Promise<FirebaseModule>;

let sharedPlugin: Promise<FirebaseModule> | null = null;
let sharedLoader: FirebaseAnalyticsLoader = () => import('@capacitor-firebase/analytics');

/** The facade owns events; this native transport only projects the registry. */
export function createFirebaseAnalyticsSink(
  loader: FirebaseAnalyticsLoader = () => import('@capacitor-firebase/analytics'),
): AnalyticsSink {
  sharedLoader = loader;
  sharedPlugin = null;
  const sink = createFirebaseSink({
    async logEvent(name, params) {
      sharedPlugin ??= sharedLoader();
      await (await sharedPlugin).FirebaseAnalytics.logEvent({ name, params });
    },
  });
  return {
    ...sink,
    emit(event) {
      const definition = canonicalAnalyticsEvents.find((entry) => entry.id === event.name);
      // Firebase owns its automatic session_start event. Keep our lifecycle
      // observations distinct rather than doubling its session metric.
      const name = event.name === 'session_start' ? 'game_session_start'
        : event.name === 'session_end' ? 'game_session_end'
          : definition?.firebaseName ?? event.name;
      sink.emit({ ...event, name, params: sanitizeCanonicalAnalyticsParams(event.name, event.params) });
    },
  };
}

/**
 * User-scoped properties (install day, ad policy cohort, ad exposure). Only
 * meaningful where the native plugin exists; a web or test runtime is a no-op
 * unless a loader was injected through `createFirebaseAnalyticsSink`.
 */
export async function setFirebaseUserProperties(properties: Record<string, string>): Promise<void> {
  if (sharedPlugin === null && !Capacitor.isNativePlatform()) return;
  sharedPlugin ??= sharedLoader();
  const { FirebaseAnalytics } = await sharedPlugin;
  if (FirebaseAnalytics.setUserProperty === undefined) return;
  for (const [key, value] of Object.entries(properties)) {
    await FirebaseAnalytics.setUserProperty({ key, value });
  }
}
