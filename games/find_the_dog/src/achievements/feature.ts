/**
 * Achievements are disabled in normal production builds. Production-mode
 * verification builds may explicitly include the test harness so the existing
 * achievement regression tours remain usable without exposing the feature in
 * the App Store artifact.
 */
export function resolveAchievementsEnabled(environment: {
  readonly prod: boolean;
  readonly testHarness: boolean;
}): boolean {
  return !environment.prod || environment.testHarness;
}

export const ACHIEVEMENTS_ENABLED: boolean = resolveAchievementsEnabled({
  prod: import.meta.env.PROD,
  testHarness: String(import.meta.env.VITE_ENABLE_TEST_HARNESS) === 'true',
});
