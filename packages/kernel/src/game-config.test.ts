import { describe, expect, it } from 'vitest';
import type { GameConfig, GameScreenName } from './game-config.ts';

// The GameConfig contract is pure types (no runtime). This suite is a
// compile-time regression anchor: it fails to typecheck if a required field is
// renamed/removed or the screen union drifts, and asserts a well-formed manifest
// is assignable. The behavioural validation of a real game's literal lives in
// that game's own game-config test (e.g. games/marble_run/tests/unit).
describe('GameConfig contract', () => {
  const sample: GameConfig = {
    id: 'sample',
    title: 'Sample',
    screens: ['HomeMenu', 'ResultCard'],
    saga: { levels: 10 },
    economy: { softCurrency: 'coins' },
    adPlacements: [],
    productCatalog: [],
    analyticsEvents: ['level_start'],
  };

  it('accepts a well-formed manifest', () => {
    expect(sample.id).toBe('sample');
    expect(sample.saga.levels).toBe(10);
    expect(sample.screens).toContain('HomeMenu');
  });

  it('keeps the screen union aligned with the @fabrikav2/ui surfaces', () => {
    const screens: GameScreenName[] = [
      'HomeMenu',
      'SagaMap',
      'Settings',
      'ResultCard',
      'PauseOverlay',
      'Toast',
      'ConnectivityIndicator',
    ];
    expect(screens).toHaveLength(7);
  });
});
