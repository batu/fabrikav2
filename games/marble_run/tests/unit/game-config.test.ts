import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@fabrikav2/kernel';
import { gameConfig } from '../../game.config.ts';
import { LEVELS } from '../../src/levels/levels.generated.ts';
import { LEVEL_COUNT } from '../../src/core/Constants.ts';
import { MENU_SAGA_WINDOW } from '../../src/shell/saga.ts';

// AC leg: validate the game.config.ts literal against the kernel GameConfig
// contract and marble's structural invariants. The `satisfies GameConfig` in
// game.config.ts is the compile-time half; these assert the runtime values.
describe('gameConfig', () => {
  it('satisfies the kernel GameConfig contract at runtime', () => {
    // Assigning through the type is the structural check; unknown/missing keys
    // would fail typecheck. Here we assert it is a usable object.
    const cfg: GameConfig = gameConfig;
    expect(cfg).toBeTruthy();
    expect(typeof cfg.id).toBe('string');
    expect(typeof cfg.title).toBe('string');
  });

  it('identifies the marble_run pilot', () => {
    expect(gameConfig.id).toBe('marble_run');
    expect(gameConfig.title).toBe('Marble Run');
  });

  it('declares a saga size matching the committed level set', () => {
    expect(gameConfig.saga.levels).toBe(LEVELS.length);
    expect(gameConfig.saga.levels).toBe(LEVEL_COUNT);
    expect(gameConfig.saga.levels).toBe(20);
  });

  it('keeps the saga window non-negative and within the level count', () => {
    expect(MENU_SAGA_WINDOW.ahead).toBeGreaterThanOrEqual(0);
    expect(MENU_SAGA_WINDOW.behind).toBeGreaterThanOrEqual(0);
    expect(MENU_SAGA_WINDOW.ahead).toBeLessThan(gameConfig.saga.levels);
  });

  it('uses coins as the soft currency', () => {
    expect(gameConfig.economy.softCurrency).toBe('coins');
  });

  it('mounts exactly the ui screens the shell wires', () => {
    for (const screen of ['HomeMenu', 'SagaMap', 'Settings', 'ResultCard', 'PauseOverlay'] as const) {
      expect(gameConfig.screens).toContain(screen);
    }
  });

  it('declares the canonical level lifecycle analytics events', () => {
    for (const event of ['level_start', 'level_complete', 'level_fail']) {
      expect(gameConfig.analyticsEvents).toContain(event);
    }
  });

  it('ships no IAP products in the pilot', () => {
    expect(gameConfig.productCatalog).toHaveLength(0);
  });
});
