import { describe, expect, it } from 'vitest';
import {
  PIXELSMITH_STATE_LEVELS,
  PIXELSMITH_TOUR_STATES,
  isGameplayState,
  isPixelsmithState,
} from './pixelsmithStates.ts';
import { LEVELS } from '../levels/levels.generated.ts';

/**
 * The state→level map must mirror v1 sugar3d exactly (1/8/6/1) against the
 * byte-identical 110-level set. These guards fail loudly if the map drifts or
 * if a level regeneration moves the plug/void board that plugs/voids target.
 */
describe('PIXELSMITH_STATE_LEVELS', () => {
  it('mirrors v1 sugar3d indices (opener 1, plugs 8, voids 6, teach 1)', () => {
    expect(PIXELSMITH_STATE_LEVELS).toEqual({
      'gameplay-opener': 1,
      'gameplay-plugs': 8,
      'gameplay-voids': 6,
      'gameplay-teach': 1,
    });
  });

  it('points plugs at a board that actually contains a wooden plug (X)', () => {
    const level = LEVELS[PIXELSMITH_STATE_LEVELS['gameplay-plugs'] - 1];
    expect(level.cells.join('')).toContain('X');
  });

  it('points voids at a board that actually contains a void cell (#)', () => {
    const level = LEVELS[PIXELSMITH_STATE_LEVELS['gameplay-voids'] - 1];
    expect(level.cells.join('')).toContain('#');
  });

  it('opener and teach share level 1 (differentiated by save progress, not index)', () => {
    expect(PIXELSMITH_STATE_LEVELS['gameplay-opener']).toBe(1);
    expect(PIXELSMITH_STATE_LEVELS['gameplay-teach']).toBe(1);
  });
});

describe('pixelsmith state guards', () => {
  it('classifies the four gameplay states', () => {
    for (const state of ['gameplay-opener', 'gameplay-plugs', 'gameplay-voids', 'gameplay-teach']) {
      expect(isGameplayState(state)).toBe(true);
    }
    expect(isGameplayState('win')).toBe(false);
    expect(isGameplayState('home-fresh')).toBe(false);
  });

  it('recognises every declared tour state', () => {
    for (const state of PIXELSMITH_TOUR_STATES) {
      expect(isPixelsmithState(state)).toBe(true);
    }
    expect(isPixelsmithState('not-a-state')).toBe(false);
  });
});
