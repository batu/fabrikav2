import type { AdMobLifecycleEvent, AdMobPaidImpression, AdMobProviderOptions } from '@fabrikav2/sdk/ads';
import { registerLifecycleHooks } from '../platform/gameLifecycle';

/**
 * Find The Dog's AdMob composition seams, kept as a pure function so the
 * wiring is unit-testable without constructing the native provider.
 *
 * - `addAppResumeListener` hands the provider the game's single suspend/resume
 *   authority (`platform/gameLifecycle`): a foreground resume re-opens the
 *   interstitial load budget after three failed loads. Without this seam the
 *   provider never recovers in-process (shipped 1.0.6 (26) composition).
 * - `onAdEvent` is the provider-level lifecycle contract. Banner delivery truth
 *   comes only from here (native `loaded` / `impression` / `load_failed`);
 *   request acceptance is never counted as shown.
 * - `onAdRevenuePaid` fans the native paid callback out to the owned analytics
 *   (`ad_revenue_paid`) and the AppsFlyer value projection.
 */
export interface AdMobCompositionAnalytics {
  adShown: (params: { ad_type: 'banner' | 'interstitial'; placement: string }) => Promise<void>;
  adShowFailed: (params: { ad_type: 'banner' | 'interstitial' | 'rewarded'; placement: string; reason: string }) => Promise<void>;
  adLifecycle: (params: AdLifecycleAnalyticsParams) => Promise<void>;
  adRevenuePaid: (params: {
    ad_type: 'banner' | 'interstitial' | 'rewarded';
    placement: string;
    revenue_usd: number;
    currency?: string;
    precision?: string;
    network_name?: string;
    ad_impression_id?: string;
  }) => Promise<void>;
}

export interface AdLifecycleAnalyticsParams {
  ad_type: 'banner' | 'interstitial' | 'rewarded';
  placement: string;
  stage: AdMobLifecycleEvent['stage'];
  load_id?: string;
  reason?: string;
  attempt?: number;
  cache_age_ms?: number;
}

/** Static placement per format; rewarded placements are reported by the game-level grant events. */
export const AD_FORMAT_PLACEMENT: Readonly<Record<AdMobLifecycleEvent['format'], string>> = {
  banner: 'gameplay',
  interstitial: 'between_levels',
  rewarded: 'rewarded',
};

export type AdMobCompositionOptions = Required<Pick<AdMobProviderOptions, 'addAppResumeListener' | 'onAdEvent' | 'onAdRevenuePaid'>>;

export function createAdMobCompositionOptions(deps: {
  analytics: AdMobCompositionAnalytics;
  forwardAcquisitionValueEvent: (event: {
    type: 'ad_revenue'; revenue: number; currency: string; format: string; placement: string; impressionId: string;
  }) => Promise<boolean>;
  registerHooks?: typeof registerLifecycleHooks;
}): AdMobCompositionOptions {
  const registerHooks = deps.registerHooks ?? registerLifecycleHooks;
  return {
    addAppResumeListener: async (onResume): Promise<{ remove: () => Promise<void> }> => {
      const release = registerHooks('ads-resume', { onResume: (): void => onResume() });
      return { remove: async (): Promise<void> => release() };
    },
    onAdEvent: (event: AdMobLifecycleEvent): void => {
      const placement = AD_FORMAT_PLACEMENT[event.format];
      void deps.analytics.adLifecycle({
        ad_type: event.format,
        placement,
        stage: event.stage,
        load_id: event.loadId,
        reason: event.reason,
        attempt: event.attempt,
        cache_age_ms: event.cacheAgeMs,
      });
      // The banner has no game-level show/terminal path; its canonical
      // ad_shown / ad_show_failed come from the native callbacks alone.
      if (event.format !== 'banner') return;
      if (event.stage === 'impression') {
        void deps.analytics.adShown({ ad_type: 'banner', placement });
      } else if (event.stage === 'load_failed') {
        void deps.analytics.adShowFailed({ ad_type: 'banner', placement, reason: event.reason ?? 'unknown' });
      }
    },
    onAdRevenuePaid: (event: AdMobPaidImpression): void => {
      void deps.analytics.adRevenuePaid({
        ad_type: event.format,
        placement: AD_FORMAT_PLACEMENT[event.format],
        revenue_usd: event.revenue,
        currency: event.currency,
        precision: event.precision,
        network_name: event.networkName,
        ad_impression_id: event.impressionId,
      });
      void deps.forwardAcquisitionValueEvent({
        type: 'ad_revenue', revenue: event.revenue, currency: event.currency,
        format: event.format, placement: event.placement, impressionId: event.impressionId,
      });
    },
  };
}
