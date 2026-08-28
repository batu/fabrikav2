export interface CrashlyticsPlugin {
  crash(options: { message: string }): Promise<void>;
  log(options: { message: string }): Promise<void>;
  isEnabled(): Promise<{ enabled: boolean }>;
  didCrashOnPreviousExecution(): Promise<{ crashed: boolean }>;
  sendUnsentReports(): Promise<void>;
}
export type CrashlyticsLoader = () => Promise<{ FirebaseCrashlytics: CrashlyticsPlugin }>;
export interface CrashlyticsProbeState { enabled: boolean | null; crashedLastRun: boolean }

export async function readCrashlyticsState(load: CrashlyticsLoader): Promise<CrashlyticsProbeState> {
  const { FirebaseCrashlytics } = await load();
  let enabled: boolean | null = null;
  try { enabled = (await FirebaseCrashlytics.isEnabled()).enabled; } catch { enabled = null; }
  return { enabled, crashedLastRun: (await FirebaseCrashlytics.didCrashOnPreviousExecution()).crashed };
}
export async function sendUnsentCrashReports(load: CrashlyticsLoader): Promise<void> {
  const { FirebaseCrashlytics } = await load(); await FirebaseCrashlytics.sendUnsentReports();
}
export async function forceCrashForVerification(load: CrashlyticsLoader, testBuild: boolean, marker: string): Promise<void> {
  if (!testBuild) throw new Error('forced Crashlytics crash is unavailable outside test builds');
  const { FirebaseCrashlytics } = await load();
  await FirebaseCrashlytics.log({ message: marker });
  await FirebaseCrashlytics.crash({ message: marker });
}
