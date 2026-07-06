import { describe, expect, test } from 'vitest';

import { seedStatesFromConfig } from './seedFromConfig.ts';

describe('seedStatesFromConfig', (): void => {
  test('derives the ordered state list from gameConfig.screens', (): void => {
    const config = { screens: ['HomeMenu', 'Level', 'Result'] } as const;
    expect(seedStatesFromConfig(config)).toEqual(['HomeMenu', 'Level', 'Result']);
  });

  test('de-duplicates while preserving first-seen order', (): void => {
    const config = { screens: ['HomeMenu', 'Level', 'HomeMenu'] } as const;
    expect(seedStatesFromConfig(config)).toEqual(['HomeMenu', 'Level']);
  });
});
