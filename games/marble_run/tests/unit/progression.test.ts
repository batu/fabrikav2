import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/levels/levels.generated';
import { REPLAY_START_LEVEL, contentLevelNumber } from '../../src/levels/progression';

describe('endless progression (first pass 1…110, then loops 20…110)', () => {
  it('plays the set in order on the first pass', () => {
    expect(contentLevelNumber(0)).toBe(1);
    expect(contentLevelNumber(18)).toBe(19);
    expect(contentLevelNumber(LEVELS.length - 1)).toBe(LEVELS.length);
  });

  it('wraps to the replay start instead of running off the end of the content', () => {
    // Regression: LEVELS[110] is undefined; the board engine was previously
    // constructed with it once a save passed the final level.
    expect(contentLevelNumber(LEVELS.length)).toBe(REPLAY_START_LEVEL);
    expect(contentLevelNumber(LEVELS.length + 1)).toBe(REPLAY_START_LEVEL + 1);
  });

  it('cycles the tail forever without revisiting the tutorial ramp', () => {
    for (let index = LEVELS.length; index < LEVELS.length + 400; index += 1) {
      const level = contentLevelNumber(index);
      expect(level).toBeGreaterThanOrEqual(REPLAY_START_LEVEL);
      expect(level).toBeLessThanOrEqual(LEVELS.length);
    }
  });

  it('closes the loop: the level after the last is the replay start again', () => {
    const cycle = LEVELS.length - REPLAY_START_LEVEL + 1;
    expect(contentLevelNumber(LEVELS.length + cycle - 1)).toBe(LEVELS.length);
    expect(contentLevelNumber(LEVELS.length + cycle)).toBe(REPLAY_START_LEVEL);
  });

  it('always indexes real content', () => {
    for (const index of [0, 55, 109, 110, 300, 1000]) {
      expect(LEVELS[contentLevelNumber(index) - 1]).toBeDefined();
    }
  });

  it('is defensive about junk progress values', () => {
    expect(contentLevelNumber(-5)).toBe(1);
    expect(contentLevelNumber(Number.NaN)).toBe(1);
  });
});
