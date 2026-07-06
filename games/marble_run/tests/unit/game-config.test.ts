import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@fabrikav2/kernel';
import { gameConfig } from '../../game.config.ts';
import { LEVELS } from '../../src/levels/levels.generated.ts';
import { LEVEL_COUNT } from '../../src/core/Constants.ts';
import { MENU_SAGA_WINDOW } from '../../src/shell/saga.ts';
import { marbleProductIds } from '../../src/sdk/catalog.ts';

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

  it('declares the canonical analytics event set the SDK wiring emits', () => {
    for (const event of [
      'session_start',
      'session_end',
      'level_start',
      'level_complete',
      'level_fail',
      'resource_change',
      'ad_request',
      'ad_impression',
      'ad_reward',
      'purchase',
    ]) {
      expect(gameConfig.analyticsEvents).toContain(event);
    }
  });

  it('declares the rewarded + interstitial ad placements the wiring uses', () => {
    for (const placement of ['rewarded_fail_save', 'rewarded_hint', 'interstitial_level']) {
      expect(gameConfig.adPlacements).toContain(placement);
    }
  });

  it('declares the IAP catalog product ids in lockstep with the catalog fixture', () => {
    expect(gameConfig.productCatalog).toContain('no_ads');
    expect([...gameConfig.productCatalog].sort()).toEqual([...marbleProductIds].sort());
  });
});
