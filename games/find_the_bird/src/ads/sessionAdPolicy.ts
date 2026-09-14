import type { FirstOpenStorageDurability } from '@fabrikav2/sdk/analytics';

let automaticAdsAllowed = true;

/** Called before eager runtime imports can write default save data. */
export function configureSessionAds(
  hadExistingStateAtBootstrap: boolean,
  storageDurability: FirstOpenStorageDurability,
): void {
  automaticAdsAllowed = storageDurability === 'durable' && hadExistingStateAtBootstrap;
}

/** Automatic ads only: optional rewarded ads remain available on every launch.
 * Frozen for this app launch; background/resume does not end the first session. */
export function areAutomaticAdsAllowed(): boolean {
  return automaticAdsAllowed;
}
