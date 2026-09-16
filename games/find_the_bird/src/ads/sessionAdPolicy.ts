import type { FirstOpenStorageDurability } from '@fabrikav2/sdk/analytics';

/**
 * Automatic-ad policy v2 (2026-09-16): a new install sees no automatic ads
 * (interstitial, banner) for its whole install day, in UTC so the boundary
 * matches the analytics providers' day cohorts. Optional rewarded ads stay
 * available on every launch. Existing installs (save data present before the
 * policy shipped) are not protected; they never were.
 *
 * The 2026-09-15 `ftb_ad_protection_v1` randomization is retired: it never
 * reached a store build, and the install-day rule replaces both of its arms.
 * A leftover assignment key is ignored.
 */
export const AD_POLICY_VERSION = 'install_day_v2';
export const INSTALL_DAY_STORAGE_KEY = 'ftb_install_day';

export type AdPolicyCohort = 'new_install' | 'existing_install' | 'storage_unavailable';
export type AutomaticAdBlockReason = 'storage_unavailable' | 'install_day' | null;

type PolicyStorage = Pick<Storage, 'getItem' | 'setItem'>;

let durable = true;
let cohort: AdPolicyCohort = 'existing_install';
/** UTC calendar day of the first launch, or null for installs that predate the key. */
let installDay: string | null = null;
let now: () => number = () => Date.now();

export function utcDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

function utcDayStart(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function readInstallDay(storage: PolicyStorage, hadExistingState: boolean): string | null {
  try {
    const saved = storage.getItem(INSTALL_DAY_STORAGE_KEY);
    if (saved !== null && /^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved;
    if (hadExistingState) return null;
    const today = utcDay(now());
    storage.setItem(INSTALL_DAY_STORAGE_KEY, today);
    return storage.getItem(INSTALL_DAY_STORAGE_KEY) === today ? today : null;
  } catch {
    return null;
  }
}

/** Called before eager runtime imports can write default save data. */
export function configureSessionAds(
  hadExistingStateAtBootstrap: boolean,
  storageDurability: FirstOpenStorageDurability,
  storage?: PolicyStorage,
  clock: () => number = () => Date.now(),
): void {
  now = clock;
  durable = storageDurability === 'durable';
  installDay = null;
  if (!durable || storage === undefined) {
    cohort = durable ? 'existing_install' : 'storage_unavailable';
    return;
  }
  installDay = readInstallDay(storage, hadExistingStateAtBootstrap);
  // The key is only ever written for a fresh install, so its presence is the
  // cohort on every later launch. A fresh install whose write did not stick
  // cannot be protected reliably and is treated as existing rather than
  // having its ads suppressed forever.
  cohort = installDay === null ? 'existing_install' : 'new_install';
}

export function adPolicyCohort(): AdPolicyCohort {
  return cohort;
}

export function installDayUtc(): string | null {
  return installDay;
}

/** Whole UTC days since the install day; null when the install day is unknown. */
export function daysSinceInstall(at: number = now()): number | null {
  if (installDay === null) return null;
  return Math.max(0, Math.floor((at - utcDayStart(installDay)) / DAY_MS));
}

/** Identity fields stamped on every analytics event. */
export function adPolicyParams(): Record<string, string> {
  const params: Record<string, string> = { ad_policy: AD_POLICY_VERSION, ad_policy_cohort: cohort };
  if (installDay !== null) params.install_day = installDay;
  return params;
}

/** Automatic ads only: optional rewarded ads remain available on every launch.
 * Read live, so a session that crosses UTC midnight on the install day starts
 * serving without a relaunch. */
export function areAutomaticAdsAllowed(): boolean {
  return automaticAdBlockReason() === null;
}

export function automaticAdBlockReason(): AutomaticAdBlockReason {
  if (!durable) return 'storage_unavailable';
  if (cohort === 'new_install' && installDay !== null && utcDay(now()) === installDay) return 'install_day';
  return null;
}
