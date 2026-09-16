import type { FirstOpenStorageDurability } from '@fabrikav2/sdk/analytics';

export const AD_PROTECTION_EXPERIMENT_ID = 'ftb_ad_protection_v1';
export const AD_PROTECTION_STORAGE_KEY = 'ftb_ad_protection_v1_assignment';
type Variant = 'protected' | 'from_start' | 'existing';
let variant: Variant = 'existing';
let durable = true;
let returningSession = true;
let currentLevelNumber = (): number => 1;

/** Independent of the level-set cohort. Never re-randomize an existing install. */
function assignVariant(hadExistingState: boolean, storage: Pick<Storage, 'getItem' | 'setItem'>): Variant {
  try {
    const saved = storage.getItem(AD_PROTECTION_STORAGE_KEY);
    if (saved === 'protected' || saved === 'from_start' || saved === 'existing') return saved;
    if (saved !== null) { durable = false; return 'existing'; }
    const assigned: Variant = hadExistingState ? 'existing'
      : crypto.getRandomValues(new Uint32Array(1))[0]! < 0x80000000 ? 'protected' : 'from_start';
    storage.setItem(AD_PROTECTION_STORAGE_KEY, assigned);
    if (storage.getItem(AD_PROTECTION_STORAGE_KEY) !== assigned) { durable = false; return 'existing'; }
    return assigned;
  } catch {
    durable = false;
    return 'existing';
  }
}

/** Called before eager runtime imports can write default save data. */
export function configureSessionAds(
  hadExistingStateAtBootstrap: boolean,
  storageDurability: FirstOpenStorageDurability,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  durable = storageDurability === 'durable';
  returningSession = hadExistingStateAtBootstrap;
  variant = durable && storage ? assignVariant(hadExistingStateAtBootstrap, storage) : 'existing';
}

export function configureAdProgression(reader: () => number): void {
  currentLevelNumber = reader;
}

export function adExperimentParams(): Record<string, string> {
  return durable && variant !== 'existing'
    ? { ad_experiment_id: AD_PROTECTION_EXPERIMENT_ID, ad_experiment_variant: variant }
    : {};
}

/** Optional rewards are unaffected. Session status is frozen for the cold launch;
 * background/resume does not end the first session. Progression is read live. */
export function areAutomaticAdsAllowed(): boolean {
  return automaticAdBlockReason() === null;
}

export function automaticAdBlockReason(): 'storage_unavailable' | 'first_session' | 'first_ten_levels' | null {
  if (!durable) return 'storage_unavailable';
  if (variant === 'from_start') return null;
  if (!returningSession) return 'first_session';
  if (variant === 'protected' && !(currentLevelNumber() > 10)) return 'first_ten_levels';
  return null;
}
