import { afterEach, describe, expect, it } from 'vitest';

import {
  isFrameRateUncapped,
  pulseHighFrameRate,
  resetFrameRateGovernor,
  settleFrameRate,
} from '../../src/core/FrameRateGovernor';

/** Minimal stand-in for Phaser's TimeStep: only the fields the governor uses. */
function fakeGame(limit = 30): { loop: { _limitRate: number; fpsLimit: number } } {
  return { loop: { _limitRate: 1000 / limit, fpsLimit: limit } };
}

afterEach(() => resetFrameRateGovernor());

describe('frame rate governor', () => {
  it('zeroes the limit rate so the limited step passes every frame', () => {
    const game = fakeGame();
    expect(game.loop._limitRate).toBeCloseTo(1000 / 30);
    pulseHighFrameRate(game as never);
    expect(game.loop._limitRate).toBe(0);
    expect(isFrameRateUncapped()).toBe(true);
  });

  it('keeps the cap lifted while pulses keep arriving', () => {
    const game = fakeGame();
    pulseHighFrameRate(game as never);
    settleFrameRate(game as never);
    expect(game.loop._limitRate).toBe(0);
  });

  it('restores the CONFIGURED cap once the tail elapses', async () => {
    const game = fakeGame(30);
    pulseHighFrameRate(game as never);
    await new Promise((r) => setTimeout(r, 260));
    settleFrameRate(game as never);
    expect(game.loop._limitRate).toBeCloseTo(1000 / 30);
    expect(isFrameRateUncapped()).toBe(false);
  });

  it('never invents a rate for a differently configured cap', async () => {
    const game = fakeGame(24);
    pulseHighFrameRate(game as never);
    await new Promise((r) => setTimeout(r, 260));
    settleFrameRate(game as never);
    expect(game.loop._limitRate).toBeCloseTo(1000 / 24);
  });

  it('is inert when the loop has no limiter (uncapped config)', () => {
    const game = { loop: {} } as never;
    expect(() => pulseHighFrameRate(game)).not.toThrow();
    expect(isFrameRateUncapped()).toBe(false);
  });
});
