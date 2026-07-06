import type { AdProvider, FullScreenAdLifecycle } from './AdProvider.ts';
import { AdMobProvider } from './AdMobProvider.ts';
import { AppLovinMaxProvider } from './AppLovinMaxProvider.ts';
import type { AppLovinConfig, AppLovinConfigResult } from './AppLovinConfig.ts';
import { DisabledAdProvider } from './DisabledAdProvider.ts';

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
  if (platform === 'ios') {
    if (appLovinConfig.platform !== 'ios') {
      return factories.createDisabledProvider(
        `iOS AppLovin MAX unavailable: received ${appLovinConfig.platform} config`,
      );
    }
    if (appLovinConfig.enabled) {
      return factories.createAppLovinMaxProvider(appLovinConfig.config, lifecycle);
    }
    return factories.createDisabledProvider(`iOS AppLovin MAX unavailable: ${appLovinConfig.reason}`);
  }

  if (platform === 'android') {
    if (appLovinConfig.platform !== 'android' && appLovinConfig.requested) {
      return factories.createDisabledProvider(
        `Android AppLovin MAX unavailable: received ${appLovinConfig.platform} config`,
      );
    }
    if (appLovinConfig.enabled) {
      return factories.createAppLovinMaxProvider(appLovinConfig.config, lifecycle);
    }
    if (appLovinConfig.requested) {
      return factories.createDisabledProvider(`Android AppLovin MAX unavailable: ${appLovinConfig.reason}`);
    }
    return factories.createAdMobProvider(lifecycle);
  }

  return factories.createDisabledProvider(`ads disabled on ${platform || 'web'} platform`);
}
