import { adExposureSummary } from '../ads/interstitialCadence';
import { adPolicyParams, daysSinceInstall } from '../ads/sessionAdPolicy';
import { setFirebaseUserProperties } from './FirebaseAnalyticsSink';

/**
 * Per-install user properties that let the retention-by-ad-exposure question
 * be answered from the provider's cohort reports, without a raw-event join:
 *
 * - `install_day`         UTC day of the first launch (matches cohort days)
 * - `ad_policy_cohort`    new_install | existing_install | storage_unavailable
 * - `ad_policy`           policy version in force on this build
 * - `auto_ad_impressions` lifetime automatic (interstitial) impressions
 * - `first_auto_ad_day`   days since install of the first one; -1 until then
 *
 * Refreshed on every app open and after every automatic impression, so the
 * property reflects the install's state at each event.
 */
export function adPolicyUserProperties(): Record<string, string> {
  const exposure = adExposureSummary();
  const days = daysSinceInstall();
  return {
    ...adPolicyParams(),
    auto_ad_impressions: String(exposure.auto_ad_impressions),
    first_auto_ad_day: String(exposure.first_auto_ad_day),
    ...(days === null ? {} : { days_since_install: String(days) }),
  };
}

export async function syncAdPolicyUserProperties(): Promise<void> {
  try {
    await setFirebaseUserProperties(adPolicyUserProperties());
  } catch (err: unknown) {
    console.warn('[ads] user property sync failed', err);
  }
}
