/**
 * Unified SDK environment resolver (integration review finding 2A).
 *
 * Three parallel env vocabularies exist across the SDKs — analytics'
 * `AnalyticsEnvironment` ('production' | 'development' | 'test'), attribution's
 * `AdjustEnvironment` ('sandbox' | 'production'), AdMob's `isTesting` boolean,
 * and RevenueCat's sandbox-key detection. A game that hand-maps each of the
 * four independently can silently disagree (an untagged or production-tagged
 * event polluting a live game's analytics is the exact failure this guards).
 *
 * This module collapses that to ONE call: the wiring resolves once from the
 * build environment and reads the four consistent outputs off the result —
 * never re-deriving per SDK. Pure, deterministic, table-driven → unit-testable
 * with zero mocks. The load-bearing invariant is that the `development` row can
 * never yield `analytics: 'production'` or `adjust: 'production'`.
 */
import type { AnalyticsEnvironment } from '../analytics/index.ts';
import type { AdjustEnvironment } from '../attribution/index.ts';

/** The single build-environment input; a game derives it once (e.g. from
 *  `import.meta.env.PROD ? 'production' : 'development'`). */
export type SdkBuildEnv = 'development' | 'production';

export interface SdkEnvironments {
  /** Mandatory `env` tag on every analytics payload. */
  readonly analytics: AnalyticsEnvironment;
  /** Adjust environment for attribution init. */
  readonly adjust: AdjustEnvironment;
  /** AdMob test mode — true forces Google public test unit ids. */
  readonly admobTestMode: boolean;
  /** RevenueCat sandbox — true expects a sandbox (`test_`-prefixed) api key. */
  readonly revenuecatSandbox: boolean;
}

const ENVIRONMENTS: Record<SdkBuildEnv, SdkEnvironments> = {
  development: {
    analytics: 'development',
    adjust: 'sandbox',
    admobTestMode: true,
    revenuecatSandbox: true,
  },
  production: {
    analytics: 'production',
    adjust: 'production',
    admobTestMode: false,
    revenuecatSandbox: false,
  },
};

/**
 * Resolve the four SDK environments from a single build environment. The
 * wiring calls this once at boot and threads the result into each SDK's
 * constructor — the one place the env decision is made.
 */
export function resolveSdkEnvironments(buildEnv: SdkBuildEnv): SdkEnvironments {
  return ENVIRONMENTS[buildEnv];
}
