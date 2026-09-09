import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameState } from '../../src/core/GameState';

describe('experiment starting wallet', () => {
  beforeEach(() => localStorage.clear());
  it.each(['0', '2', '27', 'bad', ''])('never resets an existing or corrupt wallet %s', (raw) => {
    localStorage.setItem('ftd_hints', raw);
    const state = new GameState();
    const balance = state.hintsRemaining;
    expect(state.initializeExperimentHints()).toBe(false);
    expect(state.hintsRemaining).toBe(balance);
    expect(localStorage.getItem('ftd_hints')).toBe(raw);
  });
  it('preserves the start above the unchanged free cap through spend/save/reload', () => {
    const state = new GameState();
    expect(state.initializeExperimentHints()).toBe(true);
    state.save();
    expect(new GameState().hintsRemaining).toBe(10);
    expect(state.grantHints(1, 'gameplayHint')).toBe(0);
    expect(state.grantRewardedHint()).toBe(true);
    expect(state.hintsRemaining).toBe(11);
    expect(new GameState().hintsRemaining).toBe(11);
    for (let i = 0; i < 9; i++) expect(state.spendHint('gameplayHint')).toBe(true);
    const reloaded = new GameState();
    expect(reloaded.hintsRemaining).toBe(2);
    expect(reloaded.initializeExperimentHints()).toBe(false);
    expect(reloaded.grantRewardedHint()).toBe(true);
    expect(new GameState().hintsRemaining).toBe(3);
  });
  it('does not adopt an unpersisted starting grant', () => {
    const state = new GameState();
    vi.stubGlobal('localStorage', {
      getItem: localStorage.getItem.bind(localStorage),
      setItem: () => { throw new Error('quota'); },
    });
    try {
      expect(state.initializeExperimentHints()).toBe(false);
      expect(state.hintsRemaining).toBe(3);
    } finally { vi.unstubAllGlobals(); }
  });
  it('rejects a purchase checkpoint even when the plain hint key is missing', () => {
    localStorage.setItem('ftd_wallet_purchase_checkpoint_v1', '{}');
    expect(new GameState().initializeExperimentHints()).toBe(false);
    expect(localStorage.getItem('ftd_hints')).toBeNull();
  });
  it('persists ten starting hints exactly once through the actual wallet', () => {
    const state = new GameState();
    expect(state.initializeExperimentHints()).toBe(true);
    expect(state.hintsRemaining).toBe(10);
    expect(localStorage.getItem('ftd_hints')).toBe('10');
    expect(state.initializeExperimentHints()).toBe(false);
    expect(new GameState().hintsRemaining).toBe(10);
  });
});
