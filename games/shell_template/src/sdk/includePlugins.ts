// Capacitor loads every included native plugin at WebView start. The
// @capacitor-firebase/analytics pod runs FirebaseApp.configure() unconditionally
// in its native load(), which throws an NSException at boot when the build ships
// no Firebase config. Gating the JS sink is not enough — the pod must be
// excluded from the native build entirely. capacitor.config.ts is TS executed by
// the Capacitor CLI, so it can read process.env at sync time to compute an
// explicit includePlugins allowlist. (Pattern lifted from find_the_dog.)
//
// NOTE: ios:sync / android:sync must run with the same env as the build so the
// presence check matches what the bundle actually ships.

/** Plugins always safe to load — no config-dependent native call at boot. */
export const ALWAYS_INCLUDED_PLUGINS: readonly string[] = [
  '@capacitor/app',
  '@capacitor/haptics',
  '@capacitor/local-notifications',
];

type EnvLike = Record<string, string | undefined>;

function present(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True when API_KEY, PROJECT_ID, and APP_ID are all present — mirrors the
 * SdkContext JS gate for the Firebase sink. */
export function firebaseConfigPresentInEnv(env: EnvLike): boolean {
  return present(env.VITE_FIREBASE_API_KEY)
    && present(env.VITE_FIREBASE_PROJECT_ID)
    && present(env.VITE_FIREBASE_APP_ID);
}

/** Compute the native plugin allowlist. Firebase analytics is included ONLY when
 * the Firebase env config is complete, so a config-less build never bundles the
 * pod that crashes at +[FIRApp configure]. */
export function computeIncludePlugins(env: EnvLike): string[] {
  const plugins = [...ALWAYS_INCLUDED_PLUGINS];
  if (firebaseConfigPresentInEnv(env)) {
    plugins.push('@capacitor-firebase/analytics');
  }
  return plugins;
}
