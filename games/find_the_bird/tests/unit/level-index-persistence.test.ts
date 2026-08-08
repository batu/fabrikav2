import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameState } from '../../src/core/GameState';

describe('active level index persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes only the progression index when a level starts', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    gameState.selectLevelIndex(7);

    expect(gameState.currentLevelIndex).toBe(7);
    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith('ftd_level', '7');
  });
});
