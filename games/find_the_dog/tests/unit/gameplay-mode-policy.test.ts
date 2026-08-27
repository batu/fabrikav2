import { describe, expect, it } from 'vitest';

import { resolveGameplayMode } from '../../src/config/gameplayModePolicy';

describe('gameplay mode policy', () => {
  it('forces classic for existing restoration players', () => {
    expect(resolveGameplayMode('classic', 'restoration')).toBe('classic');
  });

  it('can force restoration independently of the saved player setting', () => {
    expect(resolveGameplayMode('restoration', 'classic')).toBe('restoration');
  });

  it('can defer to the saved player setting', () => {
    expect(resolveGameplayMode('player', 'classic')).toBe('classic');
    expect(resolveGameplayMode('player', 'restoration')).toBe('restoration');
  });
});
