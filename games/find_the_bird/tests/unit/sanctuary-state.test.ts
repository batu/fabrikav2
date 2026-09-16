import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installMemStorage, removeMemStorage } from './support/memStorage';
import { GameState, EMPTY_SANCTUARY_STATE, type SanctuaryState } from '../../src/core/GameState';
import { collectableCoins, hasTenant, ratePerHour, settle, type AccrualConfig } from '../../src/sanctuary/accrual';

const CONFIG: AccrualConfig = { coinsPerHourByTier: [3, 6, 10], capHours: 4 };
const HOUR = 3_600_000;
const T0 = Date.parse('2026-09-16T12:00:00.000Z');

function housed(overrides: Partial<SanctuaryState> = {}): SanctuaryState {
  return {
    ...EMPTY_SANCTUARY_STATE,
    houseTier: 1,
    placed: { 0: 'sparrow' },
    accrualStartedAt: new Date(T0).toISOString(),
    ...overrides,
  };
}

describe('sanctuary persistence', () => {
  beforeEach(() => { installMemStorage(); });
  afterEach(() => { removeMemStorage(); });

  it('starts with no house, no tenant and no pending coins', () => {
    expect(new GameState().sanctuary).toEqual({
      houseTier: 0, placed: {}, accrualStartedAt: null, pendingCoins: 0, tileUnlockPopShown: false,
    });
  });

  it('round-trips a built, occupied house', () => {
    const state = new GameState();
    state.setCoinsForTest(500);
    expect(state.purchaseHouseTier(1, 150)).toBe(true);
    expect(state.placeBird(0, 'sparrow', new Date(T0))).toBe(true);
    const reloaded = new GameState();
    expect(reloaded.sanctuary.houseTier).toBe(1);
    expect(reloaded.sanctuary.placed).toEqual({ 0: 'sparrow' });
    expect(reloaded.sanctuary.accrualStartedAt).toBe(new Date(T0).toISOString());
  });

  it('falls back to defaults for a corrupt record', () => {
    localStorage.setItem('ftb_sanctuary', '{"houseTier": 9, "placed": "nope", "pendingCoins": -3, "accrualStartedAt": "banana"}');
    const loaded = new GameState().sanctuary;
    expect(loaded.houseTier).toBe(0);
    expect(loaded.placed).toEqual({});
    expect(loaded.pendingCoins).toBe(0);
    expect(loaded.accrualStartedAt).toBeNull();
  });
});

describe('buying and upgrading the house', () => {
  beforeEach(() => { installMemStorage(); });
  afterEach(() => { removeMemStorage(); });

  it('refuses one coin short and does not build', () => {
    const state = new GameState();
    state.setCoinsForTest(149);
    expect(state.purchaseHouseTier(1, 150)).toBe(false);
    expect(state.sanctuary.houseTier).toBe(0);
    expect(state.coinBalance).toBe(149);
  });

  it('builds at exactly the price and debits the wallet', () => {
    const state = new GameState();
    state.setCoinsForTest(150);
    expect(state.purchaseHouseTier(1, 150)).toBe(true);
    expect(state.sanctuary.houseTier).toBe(1);
    expect(state.coinBalance).toBe(0);
  });

  it('advances one tier at a time and never skips or reverses', () => {
    const state = new GameState();
    state.setCoinsForTest(10_000);
    expect(state.purchaseHouseTier(2, 300)).toBe(false); // cannot skip tier 1
    expect(state.purchaseHouseTier(1, 150)).toBe(true);
    expect(state.purchaseHouseTier(1, 150)).toBe(false); // cannot re-buy
    expect(state.purchaseHouseTier(2, 300)).toBe(true);
    expect(state.purchaseHouseTier(3, 900)).toBe(true);
    expect(state.purchaseHouseTier(3, 900)).toBe(false); // max tier
    expect(state.sanctuary.houseTier).toBe(3);
    expect(state.coinBalance).toBe(10_000 - 150 - 300 - 900);
  });

  it('will not house a bird before a house exists', () => {
    const state = new GameState();
    expect(state.placeBird(0, 'sparrow')).toBe(false);
    expect(state.sanctuary.placed).toEqual({});
  });

  it('opens the accrual window on the first tenant only', () => {
    const state = new GameState();
    state.setCoinsForTest(500);
    state.purchaseHouseTier(1, 150);
    expect(state.sanctuary.accrualStartedAt).toBeNull();
    state.placeBird(0, 'sparrow', new Date(T0));
    const opened = state.sanctuary.accrualStartedAt;
    state.setSanctuaryForTest({ houseTier: 2 });
    state.placeBird(1, 'sparrow', new Date(T0 + HOUR));
    expect(state.sanctuary.accrualStartedAt).toBe(opened);
  });
});

describe('coin accrual', () => {
  it('pays nothing with no tenant and parks the window', () => {
    const empty = { ...EMPTY_SANCTUARY_STATE, houseTier: 1 as const, accrualStartedAt: new Date(T0).toISOString() };
    const result = settle(empty, T0 + 4 * HOUR, CONFIG);
    expect(result.gained).toBe(0);
    expect(result.state.accrualStartedAt).toBeNull();
    expect(hasTenant(empty)).toBe(false);
  });

  it('pays the tier rate for one hour', () => {
    const result = settle(housed(), T0 + HOUR, CONFIG);
    expect(result.gained).toBeCloseTo(3, 6);
    expect(result.state.pendingCoins).toBeCloseTo(3, 6);
  });

  it('pays per tier', () => {
    expect(ratePerHour(0, CONFIG)).toBe(0);
    expect(settle(housed({ houseTier: 2 }), T0 + HOUR, CONFIG).gained).toBeCloseTo(6, 6);
    expect(settle(housed({ houseTier: 3 }), T0 + HOUR, CONFIG).gained).toBeCloseTo(10, 6);
  });

  it('caps a long absence at the offline cap', () => {
    const result = settle(housed(), T0 + 10 * HOUR, CONFIG);
    expect(result.hours).toBe(4);
    expect(result.gained).toBeCloseTo(12, 6);
  });

  it('carries the fraction instead of losing it', () => {
    const half = settle(housed(), T0 + HOUR / 2, CONFIG);
    expect(half.state.pendingCoins).toBeCloseTo(1.5, 6);
    expect(collectableCoins(half.state)).toBe(1);
    const more = settle(half.state, T0 + HOUR, CONFIG);
    expect(more.state.pendingCoins).toBeCloseTo(3, 6);
    expect(collectableCoins(more.state)).toBe(3);
  });

  it('opens a window rather than paying when none is stored', () => {
    const result = settle(housed({ accrualStartedAt: null }), T0, CONFIG);
    expect(result.gained).toBe(0);
    expect(result.state.accrualStartedAt).toBe(new Date(T0).toISOString());
  });

  it('pays nothing when the clock moves backwards, and re-anchors', () => {
    const result = settle(housed(), T0 - 5 * HOUR, CONFIG);
    expect(result.gained).toBe(0);
    expect(result.state.accrualStartedAt).toBe(new Date(T0 - 5 * HOUR).toISOString());
  });

  it('does not double-pay the same window', () => {
    const first = settle(housed(), T0 + HOUR, CONFIG);
    const second = settle(first.state, T0 + HOUR, CONFIG);
    expect(second.gained).toBe(0);
    expect(second.state.pendingCoins).toBeCloseTo(3, 6);
  });
});

describe('collecting the pile', () => {
  beforeEach(() => { installMemStorage(); });
  afterEach(() => { removeMemStorage(); });

  it('banks whole coins and leaves the remainder pending', () => {
    const state = new GameState();
    state.setCoinsForTest(0);
    state.setSanctuaryForTest({ houseTier: 1, placed: { 0: 'sparrow' }, pendingCoins: 7.4 });
    expect(state.collectSanctuaryCoins()).toBe(7);
    expect(state.coinBalance).toBe(7);
    expect(state.sanctuary.pendingCoins).toBeCloseTo(0.4, 6);
  });

  it('grants nothing below one coin', () => {
    const state = new GameState();
    state.setSanctuaryForTest({ pendingCoins: 0.9 });
    expect(state.collectSanctuaryCoins()).toBe(0);
    expect(state.sanctuary.pendingCoins).toBeCloseTo(0.9, 6);
  });

  it('survives a reload with the remainder intact', () => {
    const state = new GameState();
    state.setSanctuaryForTest({ houseTier: 1, placed: { 0: 'sparrow' }, pendingCoins: 5.5 });
    state.collectSanctuaryCoins();
    expect(new GameState().sanctuary.pendingCoins).toBeCloseTo(0.5, 6);
  });
});
