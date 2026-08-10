// Crash-reporting probe for the SDK verifier pane. Crashlytics is the only SDK
// here whose success path is "the app dies", so the readouts matter as much as
// the trigger: `didCrashOnPreviousExecution` is the in-app proof that the last
// run actually crashed, and the report only uploads on the NEXT launch.
//
// Lazy-loaded exactly like the Firebase analytics sink in SdkContext: the native
// plugin is only bundled when the Firebase env config is complete, so importing
// it eagerly would break web/dev builds that ship no Firebase.

interface CrashlyticsPlugin {
  crash(options: { message: string }): Promise<void>;
  log(options: { message: string }): Promise<void>;
  setEnabled(options: { enabled: boolean }): Promise<void>;
  isEnabled(): Promise<{ enabled: boolean }>;
  didCrashOnPreviousExecution(): Promise<{ crashed: boolean }>;
  sendUnsentReports(): Promise<void>;
}

export type CrashlyticsLoader = () => Promise<{ FirebaseCrashlytics: CrashlyticsPlugin }>;

const defaultLoader: CrashlyticsLoader = () => import('@capacitor-firebase/crashlytics');

/** Last readout, so the pane's synchronous getStatus() has something to show. */
let lastStatus = 'unknown — press Read state';

export function crashlyticsStatus(): string {
  return lastStatus;
}

/** Reset for tests; the pane holds no other state. */
export function resetCrashlyticsStatus(): void {
  lastStatus = 'unknown — press Read state';
}

export async function readCrashlyticsState(load: CrashlyticsLoader = defaultLoader): Promise<string> {
  const { FirebaseCrashlytics } = await load();
  // isEnabled() is iOS-only in the plugin; on Android it rejects, and an
  // unknown collection flag must not hide the crashed-last-run answer.
  let enabled: string;
  try {
    enabled = String((await FirebaseCrashlytics.isEnabled()).enabled);
  } catch {
    enabled = 'unavailable (android)';
  }
  const { crashed } = await FirebaseCrashlytics.didCrashOnPreviousExecution();
  lastStatus = `collection ${enabled} / crashed last run: ${crashed}`;
  return lastStatus;
}

export async function enableCrashlyticsCollection(
  load: CrashlyticsLoader = defaultLoader,
): Promise<string> {
  const { FirebaseCrashlytics } = await load();
  await FirebaseCrashlytics.setEnabled({ enabled: true });
  // Firebase documents this as taking effect on the next run, so say so rather
  // than implying the current session started reporting.
  return 'collection enabled — applies from the next launch';
}

export async function sendUnsentCrashReports(
  load: CrashlyticsLoader = defaultLoader,
): Promise<string> {
  const { FirebaseCrashlytics } = await load();
  await FirebaseCrashlytics.sendUnsentReports();
  return 'unsent reports queued for upload';
}

/**
 * Deliberately kills the app. The breadcrumb is logged first so the report
 * carries an unambiguous marker identifying it as this test rather than a real
 * defect. Never returns on a native build.
 */
export async function forceCrash(load: CrashlyticsLoader = defaultLoader): Promise<string> {
  const { FirebaseCrashlytics } = await load();
  const marker = `sdk_verifier_forced_crash ${new Date().toISOString()}`;
  await FirebaseCrashlytics.log({ message: marker });
  await FirebaseCrashlytics.crash({ message: marker });
  return marker;
}
