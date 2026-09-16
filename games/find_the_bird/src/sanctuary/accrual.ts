/**
 * Sanctuary coin accrual: the idle drip a housed bird produces.
 *
 * Pure and clock-injected. Time is only ever read as "now minus the stored
 * window start", clamped to a cap, so a device clock jump forward cannot mint
 * coins beyond the cap and a jump backward cannot mint any at all.
 */

import type { SanctuaryHouseTier, SanctuaryState } from '../core/GameState';

export interface AccrualConfig {
  /** Coins per hour at tier 1, 2, 3. */
  coinsPerHourByTier: readonly [number, number, number];
  /** Maximum hours of accrual banked while away. */
  capHours: number;
}

export interface SettleResult {
  state: SanctuaryState;
  /** Coins added to `pendingCoins` by this settle (fractional). */
  gained: number;
  /** Hours actually paid out, after the cap. */
  hours: number;
}

const MS_PER_HOUR = 3_600_000;

/** Coins per hour for a tier; 0 when no house is built. */
export function ratePerHour(tier: SanctuaryHouseTier, config: AccrualConfig): number {
  if (tier < 1 || tier > 3) return 0;
  const rate = config.coinsPerHourByTier[tier - 1];
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

/** True when the house has at least one tenant, which is what starts the drip. */
export function hasTenant(state: SanctuaryState): boolean {
  return Object.keys(state.placed).length > 0;
}

/**
 * Advance the accrual window to `nowMs` and bank whatever it earned.
 *
 * - Nothing housed: no coins, and the window is parked (null) so an empty house
 *   cannot silently bank time it never earned.
 * - Housed but no window yet: open one at `now` and pay nothing.
 * - Clock moved backwards: pay nothing, re-anchor the window at `now`.
 */
export function settle(
  state: SanctuaryState,
  nowMs: number,
  config: AccrualConfig,
): SettleResult {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const nowIso = new Date(now).toISOString();

  if (!hasTenant(state) || state.houseTier === 0) {
    const parked = state.accrualStartedAt === null
      ? state
      : { ...state, accrualStartedAt: null };
    return { state: parked, gained: 0, hours: 0 };
  }

  if (state.accrualStartedAt === null) {
    return { state: { ...state, accrualStartedAt: nowIso }, gained: 0, hours: 0 };
  }

  const startedMs = Date.parse(state.accrualStartedAt);
  if (!Number.isFinite(startedMs) || now <= startedMs) {
    return { state: { ...state, accrualStartedAt: nowIso }, gained: 0, hours: 0 };
  }

  const capHours = Number.isFinite(config.capHours) && config.capHours > 0 ? config.capHours : 0;
  const elapsedHours = (now - startedMs) / MS_PER_HOUR;
  const paidHours = Math.min(elapsedHours, capHours);
  const gained = paidHours * ratePerHour(state.houseTier, config);

  return {
    state: {
      ...state,
      accrualStartedAt: nowIso,
      pendingCoins: state.pendingCoins + gained,
    },
    gained,
    hours: paidHours,
  };
}

/** Whole coins the pile is currently offering; the remainder stays pending. */
export function collectableCoins(state: SanctuaryState): number {
  return Math.max(0, Math.floor(state.pendingCoins));
}
