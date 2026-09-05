import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameState } from '../../src/core/GameState';

const CHECKPOINT = 'ftd_wallet_purchase_checkpoint_v1';
const PURCHASE = { noAds: true, coins: 100, hints: 2, continueLevel: false };
let data: Map<string, string>;

beforeEach(() => {
  data = new Map();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, String(value)); }),
    removeItem: vi.fn((key: string) => { data.delete(key); }),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function failWritesTo(key: string): void {
  vi.mocked(localStorage.setItem).mockImplementation((candidate, value) => {
    if (candidate === key) throw new Error('QuotaExceededError');
    data.set(candidate, String(value));
  });
}

describe('durable purchase wallet', () => {
  it('migrates legacy balances and purchase IDs into one recoverable purchase checkpoint', () => {
    data.set('ftd_wallet_coins', '7');
    data.set('ftd_hints', '3');
    data.set('ftd_wallet_processed_purchase_ids', JSON.stringify(['legacy-purchase']));
    const state = new GameState();
    expect(state.applyPurchaseGrantOnce('new-purchase', PURCHASE, 'iap')).toEqual(PURCHASE);
    const loaded = new GameState();
    expect(loaded.walletSnapshot()).toEqual(state.walletSnapshot());
    expect(loaded.coinBalance).toBe(107);
    expect(loaded.hintsRemaining).toBe(5);
    expect(loaded.settings.adsEnabled).toBe(false);
    expect(loaded.applyPurchaseGrantOnce('new-purchase', PURCHASE, 'iap')).toBeNull();
    expect(loaded.hasProcessedPurchaseId('legacy-purchase')).toBe(true);
    expect(data.has(CHECKPOINT)).toBe(true);
  });

  it('throws on checkpoint failure without granting or marking the purchase, then permits retry', () => {
    const state = new GameState();
    state.setCoinsForTest(9);
    const before = state.walletSnapshot();
    const adsEnabled = state.settings.adsEnabled;
    const persisted = new Map(data);
    failWritesTo(CHECKPOINT);
    expect(() => state.applyPurchaseGrantOnce('retry-purchase', PURCHASE, 'iap')).toThrow('QuotaExceededError');
    expect(state.walletSnapshot()).toEqual(before);
    expect(state.settings.adsEnabled).toBe(adsEnabled);
    expect(data).toEqual(persisted);
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => { data.set(key, String(value)); });
    expect(state.applyPurchaseGrantOnce('retry-purchase', PURCHASE, 'iap')).toEqual(PURCHASE);
    expect(new GameState().hasProcessedPurchaseId('retry-purchase')).toBe(true);
  });

  it('recovers a committed purchase even when a legacy balance mirror cannot be written', () => {
    const state = new GameState();
    const before = state.walletSnapshot();
    failWritesTo('ftd_wallet_coins');
    expect(state.applyPurchaseGrantOnce('mirror-purchase', PURCHASE, 'iap')).toEqual(PURCHASE);
    const loaded = new GameState();
    expect(loaded.coinBalance).toBe(before.coins + PURCHASE.coins);
    expect(loaded.hintsRemaining).toBe(before.hints + PURCHASE.hints);
    expect(loaded.hasProcessedPurchaseId('mirror-purchase')).toBe(true);
    expect(loaded.applyPurchaseGrantOnce('mirror-purchase', PURCHASE, 'iap')).toBeNull();
  });

  it('keeps later spending current in the checkpoint even if a legacy mirror fails', () => {
    const state = new GameState();
    state.applyPurchaseGrantOnce('spent-purchase', PURCHASE, 'iap');
    failWritesTo('ftd_hints');
    expect(state.spendCoins(20, 'shop')).toBe(true);
    expect(state.spendHint('gameplayHint')).toBe(true);
    const expected = state.walletSnapshot();
    const loaded = new GameState();
    expect(loaded.walletSnapshot()).toEqual(expected);
    expect(loaded.coinBalance).toBe(80);
    expect(loaded.hasProcessedPurchaseId('spent-purchase')).toBe(true);
  });

  it.each(['ftd_wallet_coins', CHECKPOINT])('recovers purchase then achievement settlement once after a torn %s write', (failedKey) => {
    const state = new GameState({ achievementsEnabled: true });
    state.applyPurchaseGrantOnce('achievement-purchase', PURCHASE, 'iap');
    const fact = {
      kind: 'level-completion' as const,
      occurrenceId: 'post-purchase-completion',
      transactionId: 'post-purchase-completion',
      masteryLevelId: 'post-purchase-level',
      servedLevelId: 'post-purchase-level',
      progressionIndex: 0,
      totalCompletions: 1,
      streakDays: 1,
      timeSeconds: 20,
      newBest: true,
    };
    const claim = () => state.applyAchievementFact(fact);
    const before = state.walletSnapshot();
    let writes = 0;
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      if (key === failedKey && ++writes === 2) throw new Error('QuotaExceededError');
      data.set(key, String(value));
    });
    expect(claim).toThrow('QuotaExceededError');
    expect(state.achievementRecordSnapshot().pendingSettlement).not.toBeNull();
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => { data.set(key, String(value)); });
    const loaded = new GameState({ achievementsEnabled: true });
    expect(loaded.coinBalance).toBe(before.coins + 45);
    expect(loaded.achievementRecordSnapshot().pendingSettlement).toBeNull();
    expect(loaded.hasProcessedPurchaseId('achievement-purchase')).toBe(true);
    expect(loaded.applyPurchaseGrantOnce('achievement-purchase', PURCHASE, 'iap')).toBeNull();
    expect((new GameState({ achievementsEnabled: true })).walletSnapshot()).toEqual(loaded.walletSnapshot());
  });

  it('fails closed on an unreadable existing checkpoint instead of overwriting the ledger', () => {
    data.set(CHECKPOINT, '{broken');
    const state = new GameState();
    const before = state.walletSnapshot();
    expect(() => state.applyPurchaseGrantOnce('unknown-ledger', PURCHASE, 'iap')).toThrow();
    expect(state.walletSnapshot()).toEqual(before);
    expect(data.get(CHECKPOINT)).toBe('{broken');
  });
});
