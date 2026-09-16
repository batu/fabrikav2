import { adExposureSummary } from '../ads/interstitialCadence';
import { adPolicyCohort } from '../ads/sessionAdPolicy';
import type { GameAnalyticsCustomDimension } from './GameAnalyticsSink';

/**
 * GameAnalytics custom dimensions for the retention-by-ad-exposure question.
 * Both are fixed per launch and set before the SDK's first native session, so
 * GameAnalytics's retention and Explore splits can cut cohorts by them.
 *
 * 01: which ad policy cohort the install is in.
 * 02: when this install first saw an automatic ad, as known at launch. An
 *     install that is still unexposed today and sees its first interstitial
 *     tomorrow moves buckets on its next launch; day-N retention split by this
 *     dimension therefore reads "exposure status at the start of that day".
 */
export const AD_POLICY_COHORT_DIMENSION: GameAnalyticsCustomDimension = {
  available: ['ads_v2_new_install', 'ads_v2_existing_install', 'ads_v2_storage_unavailable'],
  value: () => `ads_v2_${adPolicyCohort()}`,
};

export const AD_EXPOSURE_DIMENSION_VALUES = ['auto_ads_none', 'auto_ads_first_d0', 'auto_ads_first_d1', 'auto_ads_first_d2_3', 'auto_ads_first_d4plus'] as const;

export function adExposureBucket(firstAutoAdDay: number): (typeof AD_EXPOSURE_DIMENSION_VALUES)[number] {
  if (firstAutoAdDay < 0) return 'auto_ads_none';
  if (firstAutoAdDay === 0) return 'auto_ads_first_d0';
  if (firstAutoAdDay === 1) return 'auto_ads_first_d1';
  if (firstAutoAdDay <= 3) return 'auto_ads_first_d2_3';
  return 'auto_ads_first_d4plus';
}

export const AD_EXPOSURE_DIMENSION: GameAnalyticsCustomDimension = {
  available: [...AD_EXPOSURE_DIMENSION_VALUES],
  value: () => adExposureBucket(adExposureSummary().first_auto_ad_day),
};
