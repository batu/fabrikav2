/**
 * Persisted interstitial cadence (ad policy v2, 2026-09-16).
 *
 * Replaces the per-cold-launch `levelsCompletedThisSession % N` counter, which
 * with 1-2 completions per session fired about once per six completions
 * instead of once per three. Progress now survives launches, saturates at N
 * (one pending opportunity, never several owed ads), and resets only when an
 * interstitial was confirmed presented or a rewarded ad actually started.
 *
 * Time caps stay where they were: the interstitial-to-interstitial interval is
 * the provider's in-memory frequency cap. This module adds the rewarded-to-
 * interstitial cooldown, persisted so a restart cannot skip it.
 */
export const INTERSTITIAL_CADENCE_STORAGE_KEY = 'ftb_interstitial_cadence_v1';
export const REWARDED_TO_INTERSTITIAL_COOLDOWN_MS = 120_000;

type CadenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface CadenceRecord {
  /** Countable completions since the last reset, saturated at the threshold in force. */
  progress: number;
  /** Completion transaction that last incremented progress; guards duplicate Next callbacks. */
  lastCountedTransactionId: string | null;
  /** Wall-clock ms of the last rewarded dismissal (earned or abandoned). */
  lastRewardedDismissedAt: number | null;
  /** Lifetime automatic (interstitial) impressions on this install. */
  autoAdImpressions: number;
  /** Days since install of the first automatic impression; null until one shows. */
  firstAutoAdDay: number | null;
}

const EMPTY: CadenceRecord = {
  progress: 0,
  lastCountedTransactionId: null,
  lastRewardedDismissedAt: null,
  autoAdImpressions: 0,
  firstAutoAdDay: null,
};

let storage: CadenceStorage | null = null;
let now: () => number = () => Date.now();
let record: CadenceRecord = { ...EMPTY };
let loaded = false;
/** Not persisted: a rewarded ad open when the process died is not open now. */
let rewardedInFlight = false;

function defaultStorage(): CadenceStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function load(): void {
  if (loaded) return;
  loaded = true;
  storage ??= defaultStorage();
  try {
    const raw = storage?.getItem(INTERSTITIAL_CADENCE_STORAGE_KEY) ?? null;
    if (raw === null) return;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return;
    const value = parsed as Record<string, unknown>;
    record = {
      progress: nonNegativeInt(value.progress),
      lastCountedTransactionId: typeof value.lastCountedTransactionId === 'string' ? value.lastCountedTransactionId : null,
      lastRewardedDismissedAt: typeof value.lastRewardedDismissedAt === 'number' && Number.isFinite(value.lastRewardedDismissedAt)
        ? value.lastRewardedDismissedAt : null,
      autoAdImpressions: nonNegativeInt(value.autoAdImpressions),
      firstAutoAdDay: typeof value.firstAutoAdDay === 'number' && Number.isFinite(value.firstAutoAdDay)
        ? Math.max(0, Math.floor(value.firstAutoAdDay)) : null,
    };
  } catch {
    record = { ...EMPTY };
  }
}

function save(): void {
  try {
    storage?.setItem(INTERSTITIAL_CADENCE_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // A failed write only costs persistence of this step; in-memory state stays coherent.
  }
}

/** Test seam. Production uses localStorage and Date.now. */
export function configureInterstitialCadence(options: { storage?: CadenceStorage | null; clock?: () => number } = {}): void {
  storage = options.storage === undefined ? defaultStorage() : options.storage;
  now = options.clock ?? (() => Date.now());
  record = { ...EMPTY };
  loaded = false;
  rewardedInFlight = false;
}

export function resetInterstitialCadenceForTest(): void {
  configureInterstitialCadence({ storage: null });
}

export function cadenceProgress(): number {
  load();
  return record.progress;
}

/**
 * Counts one committed completion toward the next interstitial. Returns the
 * progress after the call. `countable` is false while automatic ads are
 * blocked (install day, storage): protected completions never become ad debt.
 * Saturates at `everyN` so a run of missed opportunities owes one ad, not many.
 */
export function recordCompletion(transactionId: string, everyN: number, countable: boolean): number {
  load();
  if (!countable || everyN <= 0) return record.progress;
  if (record.lastCountedTransactionId === transactionId) return record.progress;
  record.lastCountedTransactionId = transactionId;
  record.progress = Math.min(everyN, record.progress + 1);
  save();
  return record.progress;
}

/** Confirmed interstitial presentation (the provider resolved `true` after the terminal event). */
export function recordInterstitialShown(daysSinceInstall: number | null): void {
  load();
  record.progress = 0;
  record.autoAdImpressions += 1;
  if (record.firstAutoAdDay === null && daysSinceInstall !== null) record.firstAutoAdDay = daysSinceInstall;
  save();
}

/** A rewarded ad actually started presenting (provider lifecycle, not the show call). */
export function recordRewardedStarted(): void {
  load();
  rewardedInFlight = true;
  record.progress = 0;
  save();
}

/** Rewarded dismissed, earned or abandoned; starts the interstitial cooldown either way. */
export function recordRewardedFinished(): void {
  load();
  rewardedInFlight = false;
  record.lastRewardedDismissedAt = now();
  save();
}

export function rewardedAdInFlight(): boolean {
  return rewardedInFlight;
}

export function rewardedCooldownRemainingMs(cooldownMs: number = REWARDED_TO_INTERSTITIAL_COOLDOWN_MS): number {
  load();
  if (record.lastRewardedDismissedAt === null) return 0;
  return Math.max(0, record.lastRewardedDismissedAt + cooldownMs - now());
}

export interface AdExposureSummary {
  auto_ad_impressions: number;
  /** Days since install of the first automatic impression, or -1 when none has shown. */
  first_auto_ad_day: number;
}

/** Per-install exposure, for user properties and the retention-by-exposure cut. */
export function adExposureSummary(): AdExposureSummary {
  load();
  return { auto_ad_impressions: record.autoAdImpressions, first_auto_ad_day: record.firstAutoAdDay ?? -1 };
}
