import type { AdProvider, FullScreenAdLifecycle } from './AdProvider.ts';
import { AdMobProvider } from './AdMobProvider.ts';
import { AppLovinMaxProvider } from './AppLovinMaxProvider.ts';
import type { AppLovinConfig, AppLovinConfigResult } from './AppLovinConfig.ts';
import { DisabledAdProvider } from './DisabledAdProvider.ts';

/**
 * Discriminated selection result. Both `createAdProvider` and
 * `createOwnedAdProvider` route through `selectAdProvider` so the two helpers
 * can never drift on which provider they choose for a given platform/config.
 */
type AdProviderSelection =
  | { kind: 'admob' }
  | { kind: 'applovin'; config: AppLovinConfig }
  | { kind: 'disabled'; reason: string };

function selectAdProvider(platform: string, appLovinConfig: AppLovinConfigResult): AdProviderSelection {
  if (platform === 'ios') {
    if (appLovinConfig.platform !== 'ios') {
      return { kind: 'disabled', reason: `iOS AppLovin MAX unavailable: received ${appLovinConfig.platform} config` };
    }
    if (appLovinConfig.enabled) {
      return { kind: 'applovin', config: appLovinConfig.config };
    }
    return { kind: 'disabled', reason: `iOS AppLovin MAX unavailable: ${appLovinConfig.reason}` };
  }

  if (platform === 'android') {
    if (appLovinConfig.platform !== 'android' && appLovinConfig.requested) {
      return {
        kind: 'disabled',
        reason: `Android AppLovin MAX unavailable: received ${appLovinConfig.platform} config`,
      };
    }
    if (appLovinConfig.enabled) {
      return { kind: 'applovin', config: appLovinConfig.config };
    }
    if (appLovinConfig.requested) {
      return { kind: 'disabled', reason: `Android AppLovin MAX unavailable: ${appLovinConfig.reason}` };
    }
    return { kind: 'admob' };
  }

  return { kind: 'disabled', reason: `ads disabled on ${platform || 'web'} platform` };
}

/**
 * Injectable provider constructors so selection is unit-testable without
 * instantiating real (native-bound) providers. Defaults wire the real ones.
 */
export interface AdProviderFactories {
  createAdMobProvider: (lifecycle: FullScreenAdLifecycle) => AdProvider;
  createAppLovinMaxProvider: (config: AppLovinConfig, lifecycle: FullScreenAdLifecycle) => AdProvider;
  createDisabledProvider: (reason: string) => AdProvider;
}

export const defaultAdProviderFactories: AdProviderFactories = {
  createAdMobProvider: (lifecycle): AdProvider => new AdMobProvider(undefined, { lifecycle }),
  createAppLovinMaxProvider: (config, lifecycle): AdProvider => new AppLovinMaxProvider(config, { lifecycle }),
  createDisabledProvider: (reason: string): AdProvider => new DisabledAdProvider(reason),
};

/**
 * Provider-agnostic selection. Generalizes find_the_dog's `Service.ts`:
 *   - iOS  → AppLovin MAX when configured+enabled, else disabled.
 *   - Android → AppLovin MAX when enabled; disabled if it was requested but
 *     misconfigured; otherwise fall back to AdMob.
 *   - anything else (web) → disabled.
 *
 * The v1 game couplings (audio pause, analytics revenue reporting, module
 * singleton) are dropped: audio/analytics travel through the injected
 * `lifecycle` (and the AppLovin adapter's `onAdRevenuePaid`), and the caller
 * owns instance lifetime.
 */
export function createAdProvider(
  platform: string,
  appLovinConfig: AppLovinConfigResult,
  factories: AdProviderFactories = defaultAdProviderFactories,
  lifecycle: FullScreenAdLifecycle = {},
): AdProvider {
  const selection = selectAdProvider(platform, appLovinConfig);
  switch (selection.kind) {
    case 'admob':
      return factories.createAdMobProvider(lifecycle);
    case 'applovin':
      return factories.createAppLovinMaxProvider(selection.config, lifecycle);
    case 'disabled':
      return factories.createDisabledProvider(selection.reason);
  }
}

/**
 * A selected provider bundled with async teardown. Additive to
 * `createAdProvider` — the shared `AdProvider` interface and the
 * `createAdProvider(): AdProvider` signature are unchanged, so game code that
 * only consumes `AdProvider` is untouched. Composition roots that own a native
 * app lifecycle (resume re-arm + pagehide disposal) opt into this helper.
 */
export interface OwnedAdProvider {
  readonly provider: AdProvider;
  /** Tears down the underlying provider (AdMob removes listeners + cancels timers). */
  readonly dispose: () => Promise<void>;
}

export interface OwnedAdProviderDeps {
  /**
   * App-foreground seam handed to AdMob so resume re-arms a stale interstitial
   * (never shows). Production supplies `App.addListener('resume', ...)` from
   * `@capacitor/app`; AppLovin/Disabled ignore it.
   */
  addAppResumeListener?: (onResume: () => void) => Promise<{ remove: () => Promise<void> }>;
}

const NO_OP_DISPOSE = async (): Promise<void> => {};

/**
 * Provider selection with lifecycle ownership. Shares `selectAdProvider` with
 * `createAdProvider` so selection can never diverge. AdMob is constructed
 * concretely here (not through the injectable factories) because only the
 * concrete instance carries `dispose` and the resume seam; AppLovin/Disabled
 * get a no-op dispose.
 */
export function createOwnedAdProvider(
  platform: string,
  appLovinConfig: AppLovinConfigResult,
  deps: OwnedAdProviderDeps = {},
  lifecycle: FullScreenAdLifecycle = {},
): OwnedAdProvider {
  const selection = selectAdProvider(platform, appLovinConfig);
  switch (selection.kind) {
    case 'admob': {
      const provider = new AdMobProvider(undefined, {
        lifecycle,
        addAppResumeListener: deps.addAppResumeListener,
      });
      return { provider, dispose: (): Promise<void> => provider.dispose() };
    }
    case 'applovin':
      return { provider: new AppLovinMaxProvider(selection.config, { lifecycle }), dispose: NO_OP_DISPOSE };
    case 'disabled':
      return { provider: new DisabledAdProvider(selection.reason), dispose: NO_OP_DISPOSE };
  }
}
