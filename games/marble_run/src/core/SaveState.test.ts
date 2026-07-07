import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_KEY } from './Constants';
import { SaveState } from './SaveState';

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe('SaveState capture seeding', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces stale progress with the deterministic allstates profile', () => {
    const state = new SaveState();
    state.recordWin(8, 0);
    state.addCoins(500);
    state.grantNoAds();
    state.setSetting('music', false);

    state.resetSave();
    state.seedSave({
      unlockedLevel: 2,
      coins: 25,
      noAds: false,
      sfx: true,
      music: true,
      haptics: true,
    });

    expect(state.currentLevel()).toBe(2);
    expect(state.unlocked).toBe(2);
    expect(state.coins).toBe(25);
    expect(state.noAds).toBe(false);
    expect(state.sfxEnabled).toBe(true);
    expect(state.musicEnabled).toBe(true);
    expect(state.hapticsEnabled).toBe(true);
    expect(JSON.parse(localStorage.getItem(SAVE_KEY)!)).toMatchObject({
      v: 2,
      unlocked: 2,
      coins: 25,
      noAds: false,
      sfx: true,
      music: true,
      haptics: true,
    });
  });
});
