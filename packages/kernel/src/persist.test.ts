import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPersistedJson, savePersistedJson } from './persist.ts';

interface Save {
  v: 1;
  unlocked: number;
  sfx: boolean;
}

const defaults = (): Save => ({ v: 1, unlocked: 1, sfx: true });

/**
 * Explicit in-memory Storage stub — Node 25 ships a built-in
 * localStorage stub (no backing file → methods missing/throwing), so
 * neither the node env global nor a jsdom pragma is dependable here.
 */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe('persisted-state', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns defaults when the key is missing', () => {
    expect(loadPersistedJson('k', defaults)).toEqual(defaults());
  });

  it('round-trips and shallow-merges over defaults', () => {
    savePersistedJson('k', { v: 1, unlocked: 7 });
    expect(loadPersistedJson('k', defaults)).toEqual({ v: 1, unlocked: 7, sfx: true });
  });

  it('returns defaults on parse garbage', () => {
    localStorage.setItem('k', '{nope');
    expect(loadPersistedJson('k', defaults)).toEqual(defaults());
  });

  it('returns defaults when isValid vetoes', () => {
    savePersistedJson('k', { v: 99, unlocked: 7 });
    expect(loadPersistedJson<Save>('k', defaults, (p) => p.v === 1)).toEqual(defaults());
  });

  it('survives storage that throws on access', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadPersistedJson('k', defaults)).toEqual(defaults());
  });

  it('swallows write failures (quota)', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(() => savePersistedJson('k', defaults())).not.toThrow();
  });
});
