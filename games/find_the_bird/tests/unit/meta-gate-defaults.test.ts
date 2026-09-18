/**
 * The shipped values of the gates and the sparrow ladder.
 *
 * The rest of the suite reads these numbers out of config to build its
 * expectations, which makes those assertions true for any value — reverting
 * a gate would not fail a single test. This file pins the numbers themselves,
 * so a change to them has to be deliberate and has to come here.
 *
 * They are not arbitrary: tools/birdtypes/cadence_report.py walks a player
 * through all 92 levels and checks the progression order holds. Re-run it
 * (and --coverage) before changing anything here.
 */
import { describe, expect, it } from 'vitest';
import { REMOTE_CONFIG_DEFAULTS } from '../../src/config/remoteConfigSchema';
import { RATE_PROMPT_THRESHOLD } from '../../src/core/GameState';

describe('meta gate + ladder defaults', () => {
  it('opens the Collection at level 5 and the Sanctuary at level 10', () => {
    expect(REMOTE_CONFIG_DEFAULTS.collectionUnlockLevel).toBe(5);
    expect(REMOTE_CONFIG_DEFAULTS.sanctuaryUnlockLevel).toBe(10);
  });

  it('keeps the Sanctuary behind the Collection', () => {
    expect(REMOTE_CONFIG_DEFAULTS.sanctuaryUnlockLevel)
      .toBeGreaterThanOrEqual(REMOTE_CONFIG_DEFAULTS.collectionUnlockLevel);
  });

  it('pins the sparrow ladder the cadence report was run against', () => {
    expect(REMOTE_CONFIG_DEFAULTS.sparrowTeaseCount).toBe(2);
    expect(REMOTE_CONFIG_DEFAULTS.sparrowUnlockCount).toBe(5);
    expect(REMOTE_CONFIG_DEFAULTS.sparrowHatCount).toBe(50);
    expect(REMOTE_CONFIG_DEFAULTS.sparrowCardiganCount).toBe(150);
  });

  it('keeps every ladder monotonic, tease before unlock', () => {
    for (const bird of ['sparrow', 'robin', 'bluebird'] as const) {
      const unlock = REMOTE_CONFIG_DEFAULTS[`${bird}UnlockCount`];
      const hat = REMOTE_CONFIG_DEFAULTS[`${bird}HatCount`];
      const cardigan = REMOTE_CONFIG_DEFAULTS[`${bird}CardiganCount`];
      expect(unlock, bird).toBeLessThan(hat);
      expect(hat, bird).toBeLessThan(cardigan);
    }
    expect(REMOTE_CONFIG_DEFAULTS.sparrowTeaseCount)
      .toBeLessThan(REMOTE_CONFIG_DEFAULTS.sparrowUnlockCount);
  });

  it('lands the nest box on the level the Sanctuary opens', () => {
    // 45 coins a level, banked from level 1: the price is the stock a player
    // holds on arrival at the gate. 400 -> L10, which is why it moved off 500.
    expect(REMOTE_CONFIG_DEFAULTS.housePriceTier1).toBe(400);
    const banked = 45 * (REMOTE_CONFIG_DEFAULTS.sanctuaryUnlockLevel - 1);
    expect(REMOTE_CONFIG_DEFAULTS.housePriceTier1).toBeLessThanOrEqual(banked);
  });

  it('asks for a review only after both meta features have opened', () => {
    // Both gates are arrival-based, so the Sanctuary's level-10 gate is nine
    // completions. The ask must land after that, not before either feature
    // exists for the player.
    expect(RATE_PROMPT_THRESHOLD).toBe(15);
    expect(RATE_PROMPT_THRESHOLD)
      .toBeGreaterThan(REMOTE_CONFIG_DEFAULTS.sanctuaryUnlockLevel - 1);
    expect(RATE_PROMPT_THRESHOLD)
      .toBeGreaterThan(REMOTE_CONFIG_DEFAULTS.collectionUnlockLevel - 1);
  });
});
