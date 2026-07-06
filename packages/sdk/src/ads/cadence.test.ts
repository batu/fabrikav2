import { describe, expect, it } from 'vitest';
import { shouldShowInterstitial } from './cadence.ts';

describe('shouldShowInterstitial', (): void => {
  it('fires on every Nth completed level (N=3) and not between', (): void => {
    const policy = { everyNLevels: 3, minLevel: 1 };
    const at = (levelsCompletedThisSession: number): boolean =>
      shouldShowInterstitial(policy, { levelsCompletedThisSession, currentLevel: 99 });

    expect(at(1)).toBe(false);
    expect(at(2)).toBe(false);
    expect(at(3)).toBe(true);
    expect(at(4)).toBe(false);
    expect(at(5)).toBe(false);
    expect(at(6)).toBe(true);
    expect(at(9)).toBe(true);
  });

  it('never fires below the level floor, even on an every-Nth completion', (): void => {
    const policy = { everyNLevels: 3, minLevel: 5 };
    // completion count is a multiple of 3, but currentLevel is under the floor
    expect(shouldShowInterstitial(policy, { levelsCompletedThisSession: 3, currentLevel: 4 })).toBe(false);
    expect(shouldShowInterstitial(policy, { levelsCompletedThisSession: 3, currentLevel: 5 })).toBe(true);
  });

  it('is disabled entirely when everyNLevels <= 0', (): void => {
    expect(shouldShowInterstitial({ everyNLevels: 0, minLevel: 1 }, { levelsCompletedThisSession: 6, currentLevel: 9 })).toBe(false);
    expect(shouldShowInterstitial({ everyNLevels: -1, minLevel: 1 }, { levelsCompletedThisSession: 6, currentLevel: 9 })).toBe(false);
  });

  it('does not fire before any level is completed (count 0)', (): void => {
    expect(shouldShowInterstitial({ everyNLevels: 1, minLevel: 1 }, { levelsCompletedThisSession: 0, currentLevel: 1 })).toBe(false);
  });

  it('requires BOTH the modulo and the floor to pass', (): void => {
    const policy = { everyNLevels: 2, minLevel: 3 };
    // modulo passes, floor fails
    expect(shouldShowInterstitial(policy, { levelsCompletedThisSession: 2, currentLevel: 2 })).toBe(false);
    // floor passes, modulo fails
    expect(shouldShowInterstitial(policy, { levelsCompletedThisSession: 3, currentLevel: 3 })).toBe(false);
    // both pass
    expect(shouldShowInterstitial(policy, { levelsCompletedThisSession: 4, currentLevel: 3 })).toBe(true);
  });
});
