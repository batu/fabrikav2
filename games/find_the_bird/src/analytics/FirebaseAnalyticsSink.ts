import { createFirebaseSink, type AnalyticsSink } from '@fabrikav2/sdk/analytics';
import { canonicalAnalyticsEvents, sanitizeCanonicalAnalyticsParams } from './CanonicalAnalyticsEvents';

type FirebaseModule = { FirebaseAnalytics: Pick<typeof import('@capacitor-firebase/analytics').FirebaseAnalytics, 'logEvent'> };
export type FirebaseAnalyticsLoader = () => Promise<FirebaseModule>;

/** The facade owns events; this native transport only projects the registry. */
export function createFirebaseAnalyticsSink(
  loader: FirebaseAnalyticsLoader = () => import('@capacitor-firebase/analytics'),
): AnalyticsSink {
  let plugin: Promise<FirebaseModule> | null = null;
  const sink = createFirebaseSink({
    async logEvent(name, params) {
      plugin ??= loader();
      await (await plugin).FirebaseAnalytics.logEvent({ name, params });
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
