import { adMobIosConfigPresent, readAdMobConfig, type AdMobIosPublicConfig } from '../ads/AdMobConfig';

// Capacitor loads every included native plugin at WebView start. The
// Firebase native plugins configure FirebaseApp during native startup and can
// abort when GoogleService-Info.plist is absent. Gating JavaScript is not
// enough: each Firebase plugin must be explicitly selected for the native build.
// Find releases permit Crashlytics only; Firebase Analytics is never selected. capacitor.config.ts is TS executed by
// the Capacitor CLI, so it can read process.env at sync time to compute an
// explicit includePlugins allowlist.
//
// NOTE: ios:sync must run with the same env as the build so the presence check
// matches what the bundle actually ships. Bundling GoogleService-Info.plist when
// config IS present is FTD-PARITY-2's apply-ios-firebase tool's job, not this one.

/** Plugins always safe to load — no config-dependent native call at boot. */
export const ALWAYS_INCLUDED_PLUGINS: readonly string[] = [
  '@capacitor/app',
  '@capacitor/haptics',
  '@capacitor/local-notifications',
  '@revenuecat/purchases-capacitor',
];

type EnvLike = Record<string, string | boolean | undefined>;

function present(value: string | boolean | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True when API_KEY, PROJECT_ID, and APP_ID are all present — mirrors V1
 * firebaseOptions() completeness and the SdkContext JS gate. */
export function firebaseConfigPresentInEnv(env: EnvLike): boolean {
  return present(env.VITE_FIREBASE_API_KEY)
    && present(env.VITE_FIREBASE_PROJECT_ID)
    && present(env.VITE_FIREBASE_APP_ID);
}

/** Compute the native plugin allowlist. Crashlytics requires both explicit
 * enablement and complete Firebase config. Analytics is deliberately absent. */
export function computeIncludePlugins(env: EnvLike, adMobPublicConfig?: AdMobIosPublicConfig): string[] {
  const plugins = [...ALWAYS_INCLUDED_PLUGINS];
  if (adMobIosConfigPresent(env, adMobPublicConfig) || readAdMobConfig('android', env).enabled) {
    plugins.push('@capacitor-community/admob');
  }
  if (env.VITE_FIREBASE_CRASHLYTICS_ENABLED === 'true' && (firebaseConfigPresentInEnv(env) || present(env.FIREBASE_ANDROID_CONFIG_PATH))) {
    plugins.push('@capacitor-firebase/crashlytics');
  }
  return plugins;
}
