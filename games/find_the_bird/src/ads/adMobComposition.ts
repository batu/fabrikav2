import type { AdMobLifecycleEvent, AdMobProviderOptions } from '@fabrikav2/sdk/ads';

/**
 * Find the Bird's AdMob lifecycle seam, ported from Find the Dog
 * (`games/find_the_dog/src/ads/adMobComposition.ts`) as a pure function so
 * the wiring is unit-testable without constructing the native provider.
 *
 * Scope (handoff 2026-09-14, instrumentation only): `onAdEvent` fans every
 * provider stage out to the canonical `ad_lifecycle` event. Banner delivery
 * truth and the app-resume load-budget seam that FTD also composes here are
 * behaviour changes and stay out of this port.
 */
export interface AdMobCompositionAnalytics {
  adLifecycle: (params: AdLifecycleAnalyticsParams) => Promise<void>;
}

export interface AdLifecycleAnalyticsParams {
  ad_type: 'banner' | 'interstitial' | 'rewarded';
  placement: string;
  stage: AdMobLifecycleEvent['stage'];
  reason?: string;
  attempt?: number;
  cache_age_ms?: number;
  level_index?: number;
}

/** Static placement per format; rewarded placements are reported by the game-level grant events. */
export const AD_FORMAT_PLACEMENT: Readonly<Record<AdMobLifecycleEvent['format'], string>> = {
  banner: 'gameplay',
  interstitial: 'between_levels',
  rewarded: 'rewarded',
};

export type AdMobCompositionOptions = Required<Pick<AdMobProviderOptions, 'onAdEvent'>>;

export function createAdMobCompositionOptions(deps: {
  analytics: AdMobCompositionAnalytics;
  /** Zero-based index of the level the player is on (or just completed). */
  currentLevelIndex: () => number;
}): AdMobCompositionOptions {
  return {
    onAdEvent: (event: AdMobLifecycleEvent): void => {
      void deps.analytics.adLifecycle({
        ad_type: event.format,
        placement: AD_FORMAT_PLACEMENT[event.format],
        stage: event.stage,
        reason: event.reason,
        attempt: event.attempt,
        cache_age_ms: event.cacheAgeMs,
        level_index: deps.currentLevelIndex(),
      });
    },
  };
}
