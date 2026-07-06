/**
 * FirebaseSink — the third-party GA4 egress, ported from FTD's
 * `FirebaseAnalyticsSink` (a thin forwarder to `@capacitor-firebase/analytics`)
 * and generalised behind an injectable `FirebaseTransport`.
 *
 * The native Firebase bundle only accepts string/number param values — it
 * silently drops booleans — so this sink coerces booleans to `'true'`/`'false'`
 * exactly as FTD's `sanitizeFirebaseParams` did. Because it flattens through
 * `toWirePayload`, the environment marker rides along as a normal param (GA4
 * has no first-class env dimension); dev builds ALSO point at a separate
 * Firebase project via credentials, so the marker is defence-in-depth against
 * the FTD-pollution risk, not the only guard.
 *
 * The Capacitor plugin itself is NOT imported here — packages/sdk is
 * source-shipped and `@capacitor-firebase/analytics` is an optional, native
 * dependency. The game's native shell constructs the real transport; unit tests
 * pass a fake. That keeps this sink typecheckable and testable with zero native
 * deps.
 */
import type { AnalyticsEvent } from './contract.ts';
import { toWirePayload } from './contract.ts';
import type { AnalyticsSink } from './sink.ts';

/**
 * The minimal surface FTD's live sink used. Implemented by the native shell
 * over `FirebaseAnalytics.logEvent(...)`; may be async (the facade ignores the
 * returned promise) — a fake in tests can be sync.
 */
export interface FirebaseTransport {
  logEvent(
    name: string,
    params: Readonly<Record<string, string | number>>,
  ): void | Promise<void>;
}

/** Coerce booleans to strings; the native bundle drops boolean-valued params. */
function forFirebase(
  payload: Readonly<Record<string, string | number | boolean>>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const key of Object.keys(payload)) {
    const value = payload[key];
    out[key] = typeof value === 'boolean' ? String(value) : value;
  }
  return out;
}

export function createFirebaseSink(transport: FirebaseTransport): AnalyticsSink {
  return {
    name: 'firebase',
    emit(event: AnalyticsEvent): void {
      // Swallow transport rejection: a dead analytics backend must never
      // surface as an unhandled rejection in the game (mirrors haptics' policy).
      void Promise.resolve(
        transport.logEvent(event.name, forFirebase(toWirePayload(event))),
      ).catch(() => {});
    },
  };
}
