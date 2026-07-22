import { GAMEPLAY } from './Constants';

const STORAGE_KEYS = {
  HINTS: 'ftd_hints',
  LEVEL: 'ftd_level',
  LEVEL_ORDER_REVISION: 'ftd_level_order_revision',
  SETTINGS: 'ftd_settings',
  TUTORIAL_SHOWN: 'ftd_tutorial_shown',
  REWARDED_HINTS_TODAY: 'ftd_rewarded_hints_today',
  REWARDED_HINTS_DATE: 'ftd_rewarded_hints_date',
  STREAK_DAYS: 'ftd_streak_days',
  STREAK_LAST_DATE: 'ftd_streak_last_date',
  BEST_TIMES: 'ftd_best_times',
  TOTAL_LEVELS_COMPLETED: 'ftd_total_levels_completed',
  RATE_PROMPT_SHOWN: 'ftd_rate_prompt_shown',
  RATE_DECLINED: 'ftd_rate_declined',
  COINS: 'ftd_wallet_coins',
  NO_ADS_ENTITLEMENT: 'ftd_wallet_no_ads_entitlement',
  PREMIUM_ENTITLEMENT: 'ftd_wallet_premium_entitlement',
  REWARD_PROGRESS_COUNT: 'ftd_wallet_reward_progress_count',
  PROCESSED_PURCHASE_IDS: 'ftd_wallet_processed_purchase_ids',
  WALLET_COUNTERS: 'ftd_wallet_counters',
  ACTIVE_COMPLETION_TRANSACTION: 'ftd_active_completion_transaction',
  COMPLETION_SEQUENCE: 'ftd_completion_sequence',
} as const;

const CURRENT_LEVEL_ORDER_REVISION = 'bundled-v2';
const LEGACY_BUNDLED_LEVEL_ORDER_V1 = [
  'fairytale_forest_enchanted_stream_crossing_cat_67d0',
  'fairytale_forest_fairy_ring_picnic_cat_fad2',
  'fairytale_forest_giant_hollow_tree_library_cat_7bf1',
  'fairytale_forest_mushroom_cottage_glade_cat_db20',
  'fairytale_forest_witches_herb_hut_cat_863b',
  'france_alsace_wine_village_dog_c93d',
  'france_nice_promenade_market_dog_55a4',
  'france_nice_promenade_market_dog_fb98',
  'france_provence_lavender_village_dog_84eb',
  'hawaii_luau_sunset_courtyard_dog_a810',
  'hawaii_north_shore_surf_shack_dog_9e25',
  'hawaii_rainforest_waterfall_dog_72fa',
  'hawaii_rainforest_waterfall_dog_ae00',
  'hawaii_volcano_national_park_dog_c37f',
  'hawaii_waikiki_beach_market_dog_ed5c',
  'italy_amalfi_cliff_lemons_cat_0e1b',
  'italy_roman_ruins_piazza_dog_9792',
  'japan_festival_grounds_dog_2332',
  'japan_festival_grounds_dog_411e',
  'japan_morning_market_dog_08fb',
  'japan_night_harbor_dog_0e5c',
  'japan_river_bridge_district_dog_0052',
  'japan_river_bridge_district_dog_b55a',
  'japan_temple_garden_dog_1041',
  'mexico_dia_de_muertos_plaza_dog_670d',
  'mexico_oaxaca_market_capybara_9e24',
  'mexico_yucatan_cenote_ruins_dog_0779',
  'nordic_cold_bergen_harbor_teddy_bear_df90',
  'nordic_cold_finnish_forest_sauna_teddy_bear_19d2',
  'nordic_cold_icelandic_geothermal_town_teddy_bear_340f',
  'nordic_cold_sami_aurora_camp_teddy_bear_7e58',
  'nordic_cold_stockholm_christmas_market_teddy_bear_27ac',
  'uk_cotswolds_village_teddy_bear_40d5',
  'uk_london_high_street_teddy_bear_759f',
  'uk_seaside_pier_teddy_bear_57f5',
] as const;

const LEGACY_LEVEL_REPLACEMENTS: Partial<
  Record<(typeof LEGACY_BUNDLED_LEVEL_ORDER_V1)[number], string>
> = {
  mexico_dia_de_muertos_plaza_dog_670d: 'mexico_guanajuato_rainbow_alley_dog_795d',
  mexico_oaxaca_market_capybara_9e24: 'mexico_baja_fishing_beach_taqueria_dog_63d2',
  mexico_yucatan_cenote_ruins_dog_0779: 'mexico_yucatan_cenote_ruins_dog_65e4',
} as const;

/** Total completions at which the rate-me prompt triggers (exactly once). */
export const RATE_PROMPT_THRESHOLD = 5;

/** Max rewarded hints a player can earn per day. Families-policy friendly. */
export const MAX_REWARDED_HINTS_PER_DAY = 5;

export type WalletMutationSource =
  | 'gameplayHint'
  | 'levelComplete'
  | 'rewardedHint'
  | 'rewardProgress'
  | 'shop'
  | 'iap'
  | 'tutorial'
  | 'test';

export interface WalletCounters {
  coinsGranted: number;
  coinsSpent: number;
  hintsGranted: number;
  hintsSpent: number;
  levelCompleteCoinGrants: number;
  rewardedHintGrants: number;
}

export type CompletionFallbackReason = 'exact-load-failed' | 'exact-package-unavailable';

export interface CompletionTransaction {
  id: string;
  levelId: string;
  levelIndex: number;
  timeSeconds: number;
  intendedLevelId?: string;
  servedLevelId?: string;
  sequenceVersion?: string | null;
  catalogRevision?: string;
  fallbackReason?: CompletionFallbackReason | null;
  previousBestSeconds?: number;
  newBest: boolean;
  baseCoinReward: number;
  baseCoinsGranted: boolean;
  completionStatsRegistered: boolean;
  bonusCoinsGranted: boolean;
  rewardProgressApplied: boolean;
  advanced: boolean;
  createdAtMs: number;
}

export interface CompletionTransactionInput {
  levelId: string;
  levelIndex: number;
  timeSeconds: number;
  baseCoinReward: number;
  intendedLevelId?: string;
  servedLevelId?: string;
  sequenceVersion?: string | null;
  catalogRevision?: string;
  fallbackReason?: CompletionFallbackReason | null;
}

export interface CompletionTransactionResult {
  transaction: CompletionTransaction;
  previousBest?: number;
  newBest: boolean;
  baseCoinsGrantedNow: boolean;
  completionStatsRegisteredNow: boolean;
}

export interface WalletSnapshot {
  coins: number;
  hints: number;
  hasNoAdsEntitlement: boolean;
  hasPremiumEntitlement: boolean;
  rewardProgressCount: number;
  processedPurchaseIds: string[];
  activeCompletionTransaction: CompletionTransaction | null;
  counters: WalletCounters;
}

const EMPTY_WALLET_COUNTERS: WalletCounters = {
  coinsGranted: 0,
  coinsSpent: 0,
  hintsGranted: 0,
  hintsSpent: 0,
  levelCompleteCoinGrants: 0,
  rewardedHintGrants: 0,
};

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Parse a "YYYY-MM-DD" stamp into a local-midnight Date. Using the
 * explicit (year, month-1, day) constructor avoids the DST-fragile
 * behaviour of `new Date('YYYY-MM-DDT00:00:00')` which varies by browser.
 */
function parseDateStamp(stamp: string): Date {
  const [y, m, d] = stamp.split('-').map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d);
}

/** Days between two YYYY-MM-DD stamps, local-date semantics (ignores DST). */
function dayDiff(from: string, to: string): number {
  const a = parseDateStamp(from);
  const b = parseDateStamp(to);
  // Round because DST transitions make the hour count non-integer-days.
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Gameplay mode for the find-the-dog round.
 *
 * - 'classic': original Voronoi-reveal behaviour — tap a dog, reveal its
 *   cell to color.png underneath a grayscale of the same image.
 * - 'restoration': tap a dog to remove it from the scene instantly
 *   revealing bg_NN.png (clean, pre-dog backdrop) underneath.
 *   Requires `assets.bgImages` on the level's manifest entry and sprite
 *   cleanup metadata on every dog.
 */
export type GameMode = 'classic' | 'restoration';

export interface GameSettings {
  voronoiReveal: boolean;
  /** Legacy combined audio toggle. Kept so older saved settings can migrate to the split controls. */
  soundOn: boolean;
  musicOn: boolean;
  soundEffectsOn: boolean;
  hapticsOn: boolean;
  showDebugOverlay: boolean;
  /** When false, ALL ad surfaces (banner, interstitial, rewarded) are suppressed
   *  at runtime. Rewarded ads WERE exempt in the initial design — they're
   *  user-initiated — but the promise of the toggle ("turn off ads") was read
   *  by users as "no ads at all," so rewarded is gated too. */
  adsEnabled: boolean;
  /** When false, no local retention reminders are scheduled and pending ones
   *  are cancelled. OS-level permission is a separate gate on top of this. */
  notificationsOn: boolean;
  /** When false, the rate-me prompt is suppressed regardless of completion count. */
  ratePromptEnabled: boolean;
  /**
   * When true (default), the first-play experience shows the tutorial bubble +
   * highlight-ring. When false, the game goes straight into play with no
   * on-canvas instructions. Toggleable so returning players who skip the
   * tutorial can also turn it off for fresh installs on another device.
   *
   * Future: a dedicated 3-dog onboarding level will replace the bubble
   * overlay; this same toggle will switch between the two modes.
   */
  tutorialEnabled: boolean;
  /**
   * Classic vs Restoration. See {@link GameMode} for semantics.
   * Restoration is the player-facing default; Classic remains available
   * for targeted diagnostics and tests.
   */
  gameMode: GameMode;
}

function safeParseInt(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function safeParseNonNegativeInteger(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function wrappedLevelIndex(index: number, levelCount: number): number {
  if (!Number.isSafeInteger(index) || index < 0) return 0;
  return index % levelCount;
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseRecord(value: string | null): Record<string, unknown> | null {
  const parsed = parseJson(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function parseStringArray(value: string | null): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (typeof item === 'string' && item.length > 0) seen.add(item);
  }
  return [...seen];
}

function nonNegativeIntegerOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function parseWalletCounters(value: string | null): WalletCounters {
  const parsed = parseRecord(value);
  if (parsed === null) return { ...EMPTY_WALLET_COUNTERS };
  return {
    coinsGranted: nonNegativeIntegerOrZero(parsed.coinsGranted),
    coinsSpent: nonNegativeIntegerOrZero(parsed.coinsSpent),
    hintsGranted: nonNegativeIntegerOrZero(parsed.hintsGranted),
    hintsSpent: nonNegativeIntegerOrZero(parsed.hintsSpent),
    levelCompleteCoinGrants: nonNegativeIntegerOrZero(parsed.levelCompleteCoinGrants),
    rewardedHintGrants: nonNegativeIntegerOrZero(parsed.rewardedHintGrants),
  };
}

function cloneCompletionTransaction(transaction: CompletionTransaction): CompletionTransaction {
  return { ...transaction };
}

function isCompletionFallbackReason(value: unknown): value is CompletionFallbackReason {
  return value === 'exact-load-failed' || value === 'exact-package-unavailable';
}

function parseCompletionTransaction(value: string | null): CompletionTransaction | null {
  const record = parseRecord(value);
  if (record === null) return null;
  const id = record.id;
  const levelId = record.levelId;
  const levelIndex = record.levelIndex;
  const timeSeconds = record.timeSeconds;
  const baseCoinReward = record.baseCoinReward;
  const createdAtMs = record.createdAtMs;
  const previousBestSeconds = record.previousBestSeconds;
  const newBest = record.newBest;
  const baseCoinsGranted = record.baseCoinsGranted;
  const completionStatsRegistered = record.completionStatsRegistered;
  const bonusCoinsGranted = record.bonusCoinsGranted;
  const rewardProgressApplied = record.rewardProgressApplied;
  const advanced = record.advanced;
  const intendedLevelId = record.intendedLevelId;
  const servedLevelId = record.servedLevelId;
  const sequenceVersion = record.sequenceVersion;
  const catalogRevision = record.catalogRevision;
  const fallbackReason = record.fallbackReason;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof levelId !== 'string' || levelId.length === 0) return null;
  if (typeof levelIndex !== 'number' || !Number.isSafeInteger(levelIndex) || levelIndex < 0) return null;
  if (typeof timeSeconds !== 'number' || !Number.isSafeInteger(timeSeconds) || timeSeconds < 0) return null;
  if (typeof baseCoinReward !== 'number' || !Number.isSafeInteger(baseCoinReward) || baseCoinReward < 0) return null;
  if (typeof createdAtMs !== 'number' || !Number.isSafeInteger(createdAtMs) || createdAtMs < 0) return null;
  if (previousBestSeconds !== undefined && (typeof previousBestSeconds !== 'number' || !Number.isSafeInteger(previousBestSeconds) || previousBestSeconds < 0)) return null;
  if (typeof newBest !== 'boolean') return null;
  if (typeof baseCoinsGranted !== 'boolean') return null;
  if (typeof completionStatsRegistered !== 'boolean') return null;
  if (typeof bonusCoinsGranted !== 'boolean') return null;
  if (typeof rewardProgressApplied !== 'boolean') return null;
  if (typeof advanced !== 'boolean') return null;
  if (intendedLevelId !== undefined && (typeof intendedLevelId !== 'string' || intendedLevelId.length === 0)) return null;
  if (servedLevelId !== undefined && (typeof servedLevelId !== 'string' || servedLevelId.length === 0)) return null;
  if (sequenceVersion !== undefined && sequenceVersion !== null && (typeof sequenceVersion !== 'string' || sequenceVersion.length === 0)) return null;
  if (catalogRevision !== undefined && (typeof catalogRevision !== 'string' || catalogRevision.length === 0)) return null;
  if (fallbackReason !== undefined && fallbackReason !== null && !isCompletionFallbackReason(fallbackReason)) return null;
  return {
    id,
    levelId,
    levelIndex,
    timeSeconds,
    ...(intendedLevelId !== undefined ? { intendedLevelId } : {}),
    ...(servedLevelId !== undefined ? { servedLevelId } : {}),
    ...(sequenceVersion !== undefined ? { sequenceVersion } : {}),
    ...(catalogRevision !== undefined ? { catalogRevision } : {}),
    ...(fallbackReason !== undefined ? { fallbackReason } : {}),
    previousBestSeconds,
    newBest,
    baseCoinReward,
    baseCoinsGranted,
    completionStatsRegistered,
    bonusCoinsGranted,
    rewardProgressApplied,
    advanced,
    createdAtMs,
  };
}

function sequenceFromCompletionId(id: string): number {
  const match = /^completion:(\d+):/.exec(id);
  if (match === null) return 0;
  return Number(match[1]);
}

export class GameState {
  lives: number = GAMEPLAY.LIVES_PER_LEVEL;
  currentLevelIndex: number = 0;
  foundDogIds: Set<string> = new Set();
  hintCircleActive: boolean = false;
  settings: GameSettings = {
    voronoiReveal: true,
    soundOn: true,
    musicOn: true,
    soundEffectsOn: true,
    hapticsOn: true,
    showDebugOverlay: false,
    adsEnabled: true,
    notificationsOn: true,
    ratePromptEnabled: true,
    tutorialEnabled: true,
    // Shell template default: 'classic'. Restoration mode is an FTD gameplay
    // mode that requires per-level bg assets the stub levels don't ship.
    gameMode: 'classic',
  };
  penaltyCooldownUntil: number = 0;
  tutorialShown: boolean = false;
  /** Session-only: counter for interstitial cadence. Resets every app launch. */
  levelsCompletedThisSession: number = 0;
  private levelIndexWasPersisted: boolean = false;

  // --- invariant-enforced state (private backing + public readonly getters).
  // External reads via the getters; writes go through the helper methods
  // (`grantRewardedHint`, `rolloverRewardedIfNeeded`, `registerLevelComplete`,
  // `markRatePromptShown`, `markRateDeclined`, and wallet mutation methods)
  // which own the rules.
  private _hintBalance: number = GAMEPLAY.INITIAL_HINTS;
  private _coinBalance: number = 0;
  private _noAdsEntitlement: boolean = false;
  private _premiumEntitlement: boolean = false;
  private _rewardProgressCount: number = 0;
  private _processedPurchaseIds: string[] = [];
  private _activeCompletionTransaction: CompletionTransaction | null = null;
  private _completionSequence: number = 0;
  private _walletCounters: WalletCounters = { ...EMPTY_WALLET_COUNTERS };
  private _rewardedHintsToday: number = 0;
  private _rewardedHintsDate: string = todayString();
  private _streakDays: number = 0;
  private _streakLastDate: string = '';
  private _bestTimes: Record<string, number> = {};
  private _totalLevelsCompleted: number = 0;
  private _ratePromptShown: boolean = false;
  private _rateDeclined: boolean = false;

  get hintsRemaining(): number {
    return this._hintBalance;
  }
  get coinBalance(): number {
    return this._coinBalance;
  }
  get hasNoAdsEntitlement(): boolean {
    return this._noAdsEntitlement;
  }
  get hasPremiumEntitlement(): boolean {
    return this._premiumEntitlement;
  }
  get rewardProgressCount(): number {
    return this._rewardProgressCount;
  }
  get rewardedHintsToday(): number {
    return this._rewardedHintsToday;
  }
  get streakDays(): number {
    return this._streakDays;
  }
  get totalLevelsCompleted(): number {
    return this._totalLevelsCompleted;
  }
  /** True when a level completion was registered today (streak already safe). */
  playedToday(): boolean {
    return this._streakLastDate === todayString();
  }
  get bestTimes(): Readonly<Record<string, number>> {
    return this._bestTimes;
  }
  get ratePromptShown(): boolean {
    return this._ratePromptShown;
  }
  get rateDeclined(): boolean {
    return this._rateDeclined;
  }

  constructor() {
    this.load();
    this.rolloverRewardedIfNeeded();
  }

  walletSnapshot(): WalletSnapshot {
    return {
      coins: this._coinBalance,
      hints: this._hintBalance,
      hasNoAdsEntitlement: this._noAdsEntitlement,
      hasPremiumEntitlement: this._premiumEntitlement,
      rewardProgressCount: this._rewardProgressCount,
      processedPurchaseIds: [...this._processedPurchaseIds],
      activeCompletionTransaction: this.completionTransactionSnapshot(),
      counters: { ...this._walletCounters },
    };
  }

  grantCoins(amount: number, _source: WalletMutationSource): void {
    const safeAmount = nonNegativeInteger(amount, 'coin grant amount');
    if (safeAmount === 0) return;
    this._coinBalance += safeAmount;
    this._walletCounters.coinsGranted += safeAmount;
    this.save();
  }

  spendCoins(amount: number, _source: WalletMutationSource): boolean {
    const safeAmount = nonNegativeInteger(amount, 'coin spend amount');
    if (safeAmount === 0) return true;
    if (this._coinBalance < safeAmount) return false;
    this._coinBalance -= safeAmount;
    this._walletCounters.coinsSpent += safeAmount;
    this.save();
    return true;
  }

  private applyHintGrant(amount: number, reason: string): number {
    const safeAmount = nonNegativeInteger(amount, reason);
    if (safeAmount === 0) return 0;
    const availableRoom = Math.max(0, GAMEPLAY.MAX_HINT_BALANCE - this._hintBalance);
    const appliedAmount = Math.min(safeAmount, availableRoom);
    if (appliedAmount === 0) return 0;
    this._hintBalance += appliedAmount;
    this._walletCounters.hintsGranted += appliedAmount;
    return appliedAmount;
  }

  grantHints(amount: number, _source: WalletMutationSource): number {
    const appliedAmount = this.applyHintGrant(amount, 'hint grant amount');
    if (appliedAmount === 0) return 0;
    this.save();
    return appliedAmount;
  }

  spendHint(_source: WalletMutationSource): boolean {
    if (this._hintBalance <= 0) return false;
    this._hintBalance -= 1;
    this._walletCounters.hintsSpent += 1;
    this.save();
    return true;
  }

  setCoinsForTest(amount: number): void {
    this._coinBalance = nonNegativeInteger(amount, 'test coin balance');
    this.save();
  }

  setHintsForTest(amount: number): void {
    this._hintBalance = nonNegativeInteger(amount, 'test hint balance');
    this.save();
  }

  /** Seed prior progress for drives/tests (e.g. suppress the level-1 tutorial
   *  hand by making totalLevelsCompleted > 0). Mirrors v1's recordWin seeding. */
  setTotalLevelsCompletedForTest(count: number): void {
    this._totalLevelsCompleted = nonNegativeInteger(count, 'test levels completed');
    this.save();
  }

  ensureMinimumHints(amount: number, _source: WalletMutationSource): number {
    const safeAmount = nonNegativeInteger(amount, 'minimum hint balance');
    const targetAmount = Math.min(safeAmount, GAMEPLAY.MAX_HINT_BALANCE);
    if (this._hintBalance >= targetAmount) return 0;
    const appliedAmount = this.applyHintGrant(targetAmount - this._hintBalance, 'minimum hint grant amount');
    if (appliedAmount === 0) return 0;
    this.save();
    return appliedAmount;
  }

  grantNoAdsEntitlement(): void {
    this._noAdsEntitlement = true;
    this.settings.adsEnabled = false;
    this.save();
  }

  grantPremiumEntitlement(): void {
    this._premiumEntitlement = true;
    this.save();
  }

  setRewardProgressForTest(count: number): void {
    this._rewardProgressCount = nonNegativeInteger(count, 'test reward progress count');
    this.save();
  }

  incrementRewardProgress(): void {
    this._rewardProgressCount += 1;
    this.save();
  }

  resetRewardProgress(): void {
    this._rewardProgressCount = 0;
    this.save();
  }

  applyRewardProgressToActiveCompletion(goal: number, hintRewardAmount: number): { applied: boolean; rewardGranted: boolean; hintsGranted: number } {
    const safeGoal = nonNegativeInteger(goal, 'reward progress goal');
    const safeHintRewardAmount = nonNegativeInteger(hintRewardAmount, 'reward hint amount');
    const transaction = this._activeCompletionTransaction;
    if (transaction === null || transaction.rewardProgressApplied || safeGoal === 0) {
      return { applied: false, rewardGranted: false, hintsGranted: 0 };
    }

    this._rewardProgressCount += 1;
    let rewardGranted = false;
    let hintsGranted = 0;
    if (this._rewardProgressCount >= safeGoal) {
      hintsGranted = this.applyHintGrant(safeHintRewardAmount, 'reward hint grant amount');
      // Only consume the cycle when the reward actually lands (or there is
      // nothing to land). When the player is at MAX_HINT_BALANCE the grant
      // yields 0; holding the accumulated count (>= goal) until there is
      // room mirrors grantRewardedHint, which does not consume its daily
      // slot when applyHintGrant yields 0. Without this guard the count
      // was wiped to 0 on every goal-crossing while capped — a live bug
      // for hint-hoarding players, who start at the cap by default.
      if (hintsGranted > 0 || safeHintRewardAmount === 0) {
        this._rewardProgressCount = 0;
        rewardGranted = safeHintRewardAmount > 0;
      }
    }

    transaction.rewardProgressApplied = true;
    this.save();
    return { applied: true, rewardGranted, hintsGranted };
  }

  hasProcessedPurchaseId(id: string): boolean {
    return this._processedPurchaseIds.includes(id);
  }

  markProcessedPurchaseId(id: string): boolean {
    if (id.length === 0) throw new Error('processed purchase id must not be empty');
    if (this._processedPurchaseIds.includes(id)) return false;
    this._processedPurchaseIds = [...this._processedPurchaseIds, id];
    this.save();
    return true;
  }

  applyPurchaseGrantOnce(
    id: string,
    grant: { noAds: boolean; hints: number; coins: number; continueLevel: boolean },
    _source: Extract<WalletMutationSource, 'iap'>,
  ): { noAds: boolean; hints: number; coins: number; continueLevel: boolean } | null {
    if (id.length === 0) throw new Error('processed purchase id must not be empty');
    if (this._processedPurchaseIds.includes(id)) return null;

    const hintAmount = nonNegativeInteger(grant.hints, 'iap hint grant amount');
    const coinAmount = nonNegativeInteger(grant.coins, 'iap coin grant amount');

    if (grant.noAds) {
      this._noAdsEntitlement = true;
      this.settings.adsEnabled = false;
    }
    // Paid hints bypass the free-hint cap: a purchase must deliver the full
    // amount the player paid for. MAX_HINT_BALANCE only stops *free* hint
    // accrual (reward progress, rewarded ad, starting hints) — see applyHintGrant.
    let appliedHintAmount = 0;
    if (hintAmount > 0) {
      this._hintBalance += hintAmount;
      this._walletCounters.hintsGranted += hintAmount;
      appliedHintAmount = hintAmount;
    }
    if (coinAmount > 0) {
      this._coinBalance += coinAmount;
      this._walletCounters.coinsGranted += coinAmount;
    }
    this._processedPurchaseIds = [...this._processedPurchaseIds, id];
    this.save();
    return { ...grant, hints: appliedHintAmount };
  }

  completionTransactionSnapshot(): CompletionTransaction | null {
    return this._activeCompletionTransaction === null
      ? null
      : cloneCompletionTransaction(this._activeCompletionTransaction);
  }

  beginLevelCompletionTransaction(input: CompletionTransactionInput): CompletionTransactionResult {
    if (input.levelId.length === 0) throw new Error('level id must not be empty');
    const levelIndex = nonNegativeInteger(input.levelIndex, 'level index');
    const timeSeconds = nonNegativeInteger(input.timeSeconds, 'completion time seconds');
    const baseCoinReward = nonNegativeInteger(input.baseCoinReward, 'level complete coin reward');

    let transaction = this._activeCompletionTransaction;
    const canReuse =
      transaction !== null &&
      !transaction.advanced &&
      transaction.levelId === input.levelId &&
      transaction.levelIndex === levelIndex;

    if (!canReuse) {
      const previousBest = this._bestTimes[input.levelId];
      this._completionSequence += 1;
      transaction = {
        id: `completion:${this._completionSequence}:${levelIndex}:${input.levelId}`,
        levelId: input.levelId,
        levelIndex,
        timeSeconds,
        previousBestSeconds: previousBest,
        newBest: previousBest === undefined || timeSeconds < previousBest,
        baseCoinReward,
        ...(input.intendedLevelId !== undefined ? { intendedLevelId: input.intendedLevelId } : {}),
        ...(input.servedLevelId !== undefined ? { servedLevelId: input.servedLevelId } : {}),
        ...(input.sequenceVersion !== undefined ? { sequenceVersion: input.sequenceVersion } : {}),
        ...(input.catalogRevision !== undefined ? { catalogRevision: input.catalogRevision } : {}),
        ...(input.fallbackReason !== undefined ? { fallbackReason: input.fallbackReason } : {}),
        baseCoinsGranted: false,
        completionStatsRegistered: false,
        bonusCoinsGranted: false,
        rewardProgressApplied: false,
        advanced: false,
        createdAtMs: Date.now(),
      };
      this._activeCompletionTransaction = transaction;
    }
    if (transaction === null) throw new Error('completion transaction was not created');

    let completionStatsRegisteredNow = false;
    if (!transaction.completionStatsRegistered) {
      const { newBest } = this.registerLevelComplete(transaction.levelId, transaction.timeSeconds);
      transaction.newBest = newBest;
      transaction.completionStatsRegistered = true;
      completionStatsRegisteredNow = true;
    }

    let baseCoinsGrantedNow = false;
    if (!transaction.baseCoinsGranted && transaction.baseCoinReward > 0) {
      this._coinBalance += transaction.baseCoinReward;
      this._walletCounters.coinsGranted += transaction.baseCoinReward;
      this._walletCounters.levelCompleteCoinGrants += 1;
      transaction.baseCoinsGranted = true;
      baseCoinsGrantedNow = true;
    }

    this.save();
    return {
      transaction: cloneCompletionTransaction(transaction),
      previousBest: transaction.previousBestSeconds,
      newBest: transaction.newBest,
      baseCoinsGrantedNow,
      completionStatsRegisteredNow,
    };
  }

  claimActiveCompletionBonusCoins(transactionId: string, amount: number): { granted: boolean; coinsGranted: number } {
    const safeAmount = nonNegativeInteger(amount, 'completion bonus coin reward');
    const transaction = this._activeCompletionTransaction;
    if (transaction === null) return { granted: false, coinsGranted: 0 };
    if (transaction.id !== transactionId) return { granted: false, coinsGranted: 0 };
    if (transaction.advanced) return { granted: false, coinsGranted: 0 };
    if (!transaction.baseCoinsGranted) return { granted: false, coinsGranted: 0 };
    if (transaction.bonusCoinsGranted) return { granted: false, coinsGranted: 0 };
    if (safeAmount === 0) {
      transaction.bonusCoinsGranted = true;
      this.save();
      return { granted: true, coinsGranted: 0 };
    }

    this._coinBalance += safeAmount;
    this._walletCounters.coinsGranted += safeAmount;
    transaction.bonusCoinsGranted = true;
    this.save();
    return { granted: true, coinsGranted: safeAmount };
  }

  markActiveCompletionAdvanced(nextLevelIndex: number): void {
    this.currentLevelIndex = nonNegativeInteger(nextLevelIndex, 'next level index');
    if (this._activeCompletionTransaction !== null) {
      this._activeCompletionTransaction.advanced = true;
      this._activeCompletionTransaction = null;
    }
    this.save();
  }

  grantLevelCompleteCoins(levelId: string, amount: number): void {
    if (levelId.length === 0) throw new Error('level id must not be empty');
    const safeAmount = nonNegativeInteger(amount, 'level complete coin reward');
    if (safeAmount === 0) return;
    this._coinBalance += safeAmount;
    this._walletCounters.coinsGranted += safeAmount;
    this._walletCounters.levelCompleteCoinGrants += 1;
    this.save();
  }

  /** If the persisted date is not today, reset today's rewarded-hint counter. */
  private rolloverRewardedIfNeeded(): void {
    const today = todayString();
    if (this._rewardedHintsDate !== today) {
      this._rewardedHintsToday = 0;
      this._rewardedHintsDate = today;
      this.save();
    }
  }

  /** True iff the player has already maxed out today's 5 rewarded-ad hints. */
  isRewardedHintCapped(): boolean {
    this.rolloverRewardedIfNeeded();
    return this._rewardedHintsToday >= MAX_REWARDED_HINTS_PER_DAY;
  }

  /**
   * Grant +1 hint from a watched rewarded ad. Rolls over the daily counter
   * if we've crossed midnight since the last grant. Returns false if already capped.
   */
  grantRewardedHint(): boolean {
    this.rolloverRewardedIfNeeded();
    if (this._rewardedHintsToday >= MAX_REWARDED_HINTS_PER_DAY) return false;
    const appliedHintAmount = this.applyHintGrant(1, 'rewarded hint grant amount');
    if (appliedHintAmount === 0) return false;
    this._walletCounters.rewardedHintGrants += appliedHintAmount;
    this._rewardedHintsToday += 1;
    this.save();
    return true;
  }

  /**
   * Register a level completion for streak + best-time bookkeeping.
   * - Streak: increments on first completion of a new day; resets to 1 if
   *   more than 1 day has elapsed since the last completion.
   * - Best time: updates `bestTimes[levelId]` if `timeSeconds` is a new low.
   *
   * Returns whether the time was a new personal best (for celebration UI).
   */
  registerLevelComplete(levelId: string, timeSeconds: number): { newBest: boolean } {
    const today = todayString();

    if (this._streakLastDate !== today) {
      // First completion today. If yesterday was the last one, continue the
      // streak; otherwise reset. An empty streakLastDate means first-ever.
      if (this._streakLastDate === '') {
        this._streakDays = 1;
      } else {
        const daysBetween = dayDiff(this._streakLastDate, today);
        this._streakDays = daysBetween === 1 ? this._streakDays + 1 : 1;
      }
      this._streakLastDate = today;
    }

    const previousBest = this._bestTimes[levelId];
    const newBest = previousBest === undefined || timeSeconds < previousBest;
    if (newBest) {
      this._bestTimes[levelId] = timeSeconds;
    }

    this._totalLevelsCompleted += 1;

    this.save();
    return { newBest };
  }

  /**
   * Read-side streak: the stored `streakDays` is only written in
   * `registerLevelComplete`, so between multi-day gaps the HUD pill
   * would render a stale "🔥 5" even though the next completion will
   * reset to 1. This getter returns 0 when the gap is > 1 day, so the
   * pill displays the truth.
   *
   * Kept as a read-only computed value rather than lazily writing on
   * load/render so the reset is deterministic at the single call site
   * (`registerLevelComplete` owns the actual streak mutation).
   */
  currentStreakDays(): number {
    if (this._streakDays <= 0 || this._streakLastDate === '') return 0;
    const today = todayString();
    if (this._streakLastDate === today) return this._streakDays;
    const gap = dayDiff(this._streakLastDate, today);
    // gap=1 means "last played yesterday, streak still alive today"
    // (they just haven't logged today's completion yet).
    return gap <= 1 ? this._streakDays : 0;
  }

  /** True when it's time to show the one-shot rate-me prompt. */
  shouldShowRatePrompt(): boolean {
    if (!this.settings.ratePromptEnabled) return false;
    if (this._ratePromptShown || this._rateDeclined) return false;
    return this._totalLevelsCompleted >= RATE_PROMPT_THRESHOLD;
  }

  /**
   * Mark the player as having accepted the rate prompt. Persist immediately
   * so app-close mid-flow doesn't lose the acknowledgement.
   */
  markRatePromptShown(): void {
    this._ratePromptShown = true;
    this.save();
  }

  /**
   * Mark the player as having declined the prompt. Suppresses the prompt
   * forever — don't nag.
   */
  markRateDeclined(): void {
    this._rateDeclined = true;
    this.save();
  }

  reconcileLevelOrder(currentLevelIds: readonly string[]): void {
    if (currentLevelIds.length === 0) return;
    try {
      const savedRevision = localStorage.getItem(STORAGE_KEYS.LEVEL_ORDER_REVISION);
      let shouldPersistLevel = false;

      if (savedRevision !== CURRENT_LEVEL_ORDER_REVISION && this.levelIndexWasPersisted) {
        const legacyIndex = wrappedLevelIndex(this.currentLevelIndex, LEGACY_BUNDLED_LEVEL_ORDER_V1.length);
        const legacyLevelId = LEGACY_BUNDLED_LEVEL_ORDER_V1[legacyIndex];
        const replacementLevelId = LEGACY_LEVEL_REPLACEMENTS[legacyLevelId];
        const migratedIndex = currentLevelIds.indexOf(legacyLevelId);
        const replacementIndex = replacementLevelId === undefined
          ? -1
          : currentLevelIds.indexOf(replacementLevelId);
        const resolvedIndex = migratedIndex >= 0 ? migratedIndex : replacementIndex;
        if (resolvedIndex >= 0) {
          this.currentLevelIndex = resolvedIndex;
          shouldPersistLevel = true;
        }
      }

      if (savedRevision !== CURRENT_LEVEL_ORDER_REVISION) {
        localStorage.setItem(STORAGE_KEYS.LEVEL_ORDER_REVISION, CURRENT_LEVEL_ORDER_REVISION);
      }

      if (shouldPersistLevel) localStorage.setItem(STORAGE_KEYS.LEVEL, String(this.currentLevelIndex));
    } catch {
      // localStorage unavailable — keep the in-memory index.
    }
  }

  /** Reset for a new level attempt — lives reset, hints preserved. */
  reset(): void {
    this.lives = GAMEPLAY.LIVES_PER_LEVEL;
    this.foundDogIds = new Set();
    this.hintCircleActive = false;
    this.penaltyCooldownUntil = 0;
  }

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEYS.HINTS, String(this._hintBalance));
      localStorage.setItem(STORAGE_KEYS.LEVEL, String(this.currentLevelIndex));
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(this.settings));
      localStorage.setItem(STORAGE_KEYS.TUTORIAL_SHOWN, this.tutorialShown ? '1' : '0');
      localStorage.setItem(STORAGE_KEYS.REWARDED_HINTS_TODAY, String(this._rewardedHintsToday));
      localStorage.setItem(STORAGE_KEYS.REWARDED_HINTS_DATE, this._rewardedHintsDate);
      localStorage.setItem(STORAGE_KEYS.STREAK_DAYS, String(this._streakDays));
      localStorage.setItem(STORAGE_KEYS.STREAK_LAST_DATE, this._streakLastDate);
      localStorage.setItem(STORAGE_KEYS.BEST_TIMES, JSON.stringify(this._bestTimes));
      localStorage.setItem(STORAGE_KEYS.TOTAL_LEVELS_COMPLETED, String(this._totalLevelsCompleted));
      localStorage.setItem(STORAGE_KEYS.RATE_PROMPT_SHOWN, this._ratePromptShown ? '1' : '0');
      localStorage.setItem(STORAGE_KEYS.RATE_DECLINED, this._rateDeclined ? '1' : '0');
      localStorage.setItem(STORAGE_KEYS.COINS, String(this._coinBalance));
      localStorage.setItem(STORAGE_KEYS.NO_ADS_ENTITLEMENT, this._noAdsEntitlement ? '1' : '0');
      localStorage.setItem(STORAGE_KEYS.PREMIUM_ENTITLEMENT, this._premiumEntitlement ? '1' : '0');
      localStorage.setItem(STORAGE_KEYS.REWARD_PROGRESS_COUNT, String(this._rewardProgressCount));
      localStorage.setItem(STORAGE_KEYS.PROCESSED_PURCHASE_IDS, JSON.stringify(this._processedPurchaseIds));
      if (this._activeCompletionTransaction === null) {
        localStorage.removeItem(STORAGE_KEYS.ACTIVE_COMPLETION_TRANSACTION);
      } else {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_COMPLETION_TRANSACTION, JSON.stringify(this._activeCompletionTransaction));
      }
      localStorage.setItem(STORAGE_KEYS.COMPLETION_SEQUENCE, String(this._completionSequence));
      localStorage.setItem(STORAGE_KEYS.WALLET_COUNTERS, JSON.stringify(this._walletCounters));
    } catch {
      // localStorage unavailable — silently ignore
    }
  }

  load(): void {
    try {
      this._hintBalance = safeParseNonNegativeInteger(
        localStorage.getItem(STORAGE_KEYS.HINTS),
        GAMEPLAY.INITIAL_HINTS,
      );
      const persistedLevelIndex = localStorage.getItem(STORAGE_KEYS.LEVEL);
      this.levelIndexWasPersisted = persistedLevelIndex !== null;
      this.currentLevelIndex = safeParseInt(persistedLevelIndex, 0);

      this.tutorialShown = localStorage.getItem(STORAGE_KEYS.TUTORIAL_SHOWN) === '1';

      this._rewardedHintsToday = safeParseNonNegativeInteger(
        localStorage.getItem(STORAGE_KEYS.REWARDED_HINTS_TODAY),
        0,
      );
      const persistedDate = localStorage.getItem(STORAGE_KEYS.REWARDED_HINTS_DATE);
      if (persistedDate) this._rewardedHintsDate = persistedDate;

      this._streakDays = safeParseInt(localStorage.getItem(STORAGE_KEYS.STREAK_DAYS), 0);
      const streakDate = localStorage.getItem(STORAGE_KEYS.STREAK_LAST_DATE);
      if (streakDate) this._streakLastDate = streakDate;

      this._totalLevelsCompleted = safeParseInt(
        localStorage.getItem(STORAGE_KEYS.TOTAL_LEVELS_COMPLETED),
        0,
      );
      this._ratePromptShown = localStorage.getItem(STORAGE_KEYS.RATE_PROMPT_SHOWN) === '1';
      this._rateDeclined = localStorage.getItem(STORAGE_KEYS.RATE_DECLINED) === '1';

      this._coinBalance = safeParseNonNegativeInteger(localStorage.getItem(STORAGE_KEYS.COINS), 0);
      this._noAdsEntitlement = localStorage.getItem(STORAGE_KEYS.NO_ADS_ENTITLEMENT) === '1';
      this._premiumEntitlement = localStorage.getItem(STORAGE_KEYS.PREMIUM_ENTITLEMENT) === '1';
      this._rewardProgressCount = safeParseNonNegativeInteger(localStorage.getItem(STORAGE_KEYS.REWARD_PROGRESS_COUNT), 0);
      this._processedPurchaseIds = parseStringArray(localStorage.getItem(STORAGE_KEYS.PROCESSED_PURCHASE_IDS));
      this._activeCompletionTransaction = parseCompletionTransaction(localStorage.getItem(STORAGE_KEYS.ACTIVE_COMPLETION_TRANSACTION));
      this._completionSequence = safeParseNonNegativeInteger(localStorage.getItem(STORAGE_KEYS.COMPLETION_SEQUENCE), 0);
      if (this._activeCompletionTransaction !== null) {
        this._completionSequence = Math.max(
          this._completionSequence,
          sequenceFromCompletionId(this._activeCompletionTransaction.id),
        );
      }
      this._walletCounters = parseWalletCounters(localStorage.getItem(STORAGE_KEYS.WALLET_COUNTERS));

      const bestTimes = parseRecord(localStorage.getItem(STORAGE_KEYS.BEST_TIMES));
      if (bestTimes !== null) {
        const obj: Record<string, number> = {};
        for (const [k, v] of Object.entries(bestTimes)) {
          if (typeof v === 'number' && Number.isFinite(v)) obj[k] = v;
        }
        this._bestTimes = obj;
      }

      const settings = parseRecord(localStorage.getItem(STORAGE_KEYS.SETTINGS));
      if (settings !== null) {
        if (typeof settings.voronoiReveal === 'boolean') this.settings.voronoiReveal = settings.voronoiReveal;
        if (typeof settings.soundOn === 'boolean') {
          this.settings.soundOn = settings.soundOn;
          this.settings.musicOn = settings.soundOn;
          this.settings.soundEffectsOn = settings.soundOn;
        }
        if (typeof settings.musicOn === 'boolean') this.settings.musicOn = settings.musicOn;
        if (typeof settings.soundEffectsOn === 'boolean') this.settings.soundEffectsOn = settings.soundEffectsOn;
        if (typeof settings.hapticsOn === 'boolean') this.settings.hapticsOn = settings.hapticsOn;
        if (typeof settings.showDebugOverlay === 'boolean') this.settings.showDebugOverlay = settings.showDebugOverlay;
        if (typeof settings.adsEnabled === 'boolean') this.settings.adsEnabled = settings.adsEnabled;
        if (typeof settings.notificationsOn === 'boolean') this.settings.notificationsOn = settings.notificationsOn;
        if (typeof settings.ratePromptEnabled === 'boolean') this.settings.ratePromptEnabled = settings.ratePromptEnabled;
        if (typeof settings.tutorialEnabled === 'boolean') this.settings.tutorialEnabled = settings.tutorialEnabled;
        // Game mode is no longer user-selectable. Ignore legacy persisted
        // Classic saves so returning players use the restoration path.
        // (Legacy `artStyle` key is ignored — the art-style feature
        // was removed when we moved to a single color.png per level.)
      }
    } catch {
      // localStorage unavailable — use defaults
    } finally {
      if (this._noAdsEntitlement) this.settings.adsEnabled = false;
    }
  }
}

export const gameState = new GameState();
