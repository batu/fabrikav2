import { describe, expect, it } from 'vitest';
import {
  claimFirstOpen,
  type FirstOpenClaimOptions,
  type FirstOpenLockManager,
} from './first-open.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function claimDurably(options: Omit<FirstOpenClaimOptions, 'storageDurability'>): Promise<boolean> {
  return claimFirstOpen({ ...options, storageDurability: 'durable' });
}

function serialLocks(): FirstOpenLockManager {
  let pending = Promise.resolve();
  return {
    request: async (_name, callback) => {
      const previous = pending;
      let release = (): void => {};
      pending = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await callback();
      } finally {
        release();
      }
    },
  };
}

describe('claimFirstOpen', () => {
  it('claims the first open once for a durable install profile', async () => {
    const storage = memoryStorage();
    const locks = serialLocks();

    await expect(claimDurably({ storage, locks })).resolves.toBe(true);
    await expect(claimDurably({ storage, locks })).resolves.toBe(false);
  });

  it('keeps claims independent when Find games share a browser profile', async () => {
    const storage = memoryStorage();
    const locks = serialLocks();

    await expect(claimDurably({ storage, locks, profile: 'find_the_dog' })).resolves.toBe(true);
    await expect(claimDurably({ storage, locks, profile: 'find_the_bird' })).resolves.toBe(true);
    await expect(claimDurably({ storage, locks, profile: 'find_the_dog' })).resolves.toBe(false);
  });

  it('migrates an upgraded install marker without emitting first_open', async () => {
    const storage = memoryStorage({ ftd_total_levels_completed: '3' });

    await expect(claimDurably({
      storage,
      locks: serialLocks(),
      profile: 'find_the_dog',
      existingStateKeys: ['ftd_total_levels_completed', 'ftd_achievements'],
    })).resolves.toBe(false);
    expect(storage.getItem('analytics-first-open-claimed:find_the_dog')).toBe('1');
  });

  it('uses install evidence captured before eager state persistence', async () => {
    const storage = memoryStorage({ ftd_achievements: '{"created":"during-bootstrap"}' });

    await expect(claimDurably({
      storage,
      locks: serialLocks(),
      profile: 'find_the_dog',
      existingStateKeys: ['ftd_achievements'],
      hadExistingStateAtBootstrap: false,
    })).resolves.toBe(true);
  });

  it('preserves captured upgrade evidence if eager state later disappears', async () => {
    const storage = memoryStorage();

    await expect(claimDurably({
      storage,
      locks: serialLocks(),
      profile: 'find_the_dog',
      existingStateKeys: ['ftd_achievements'],
      hadExistingStateAtBootstrap: true,
    })).resolves.toBe(false);
  });

  it('serializes concurrent documents so exactly one claims first_open', async () => {
    const storage = memoryStorage();
    const locks = serialLocks();

    const results = await Promise.all([
      claimDurably({ storage, locks, profile: 'find_the_dog' }),
      claimDurably({ storage, locks, profile: 'find_the_dog' }),
    ]);

    expect(results.sort()).toEqual([false, true]);
  });

  it('uses atomic uniqueness when Web Locks are unavailable on a supported browser', async () => {
    const storage = memoryStorage();
    const claimed = new Set<string>();
    const atomicStore = {
      claim: async (key: string) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
    };

    const results = await Promise.all([
      claimDurably({ storage, locks: null, atomicStore, profile: 'find_the_dog' }),
      claimDurably({ storage, locks: null, atomicStore, profile: 'find_the_dog' }),
    ]);

    expect(results.sort()).toEqual([false, true]);
  });

  it('fails closed without touching volatile storage even when Web Locks are available', async () => {
    const storage = memoryStorage();
    let lockRequested = false;
    const locks = {
      request: async (_name: string, callback: () => boolean | Promise<boolean>) => {
        lockRequested = true;
        return callback();
      },
    };

    await expect(claimFirstOpen({
      storage,
      storageDurability: 'volatile',
      locks,
    })).resolves.toBe(false);
    expect(lockRequested).toBe(false);
    expect(storage.getItem('analytics-first-open-claimed')).toBeNull();
  });

  it('fails closed when no atomic claim mechanism is available', async () => {
    const storage = memoryStorage();

    await expect(claimDurably({ storage, locks: null, atomicStore: null })).resolves.toBe(false);
    expect(storage.getItem('analytics-first-open-claimed')).toBeNull();
  });

  it('fails closed when storage cannot persist the claim', async () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('storage unavailable'); },
    };

    await expect(claimDurably({ storage, locks: serialLocks() })).resolves.toBe(false);
    await expect(claimDurably({ storage, locks: serialLocks() })).resolves.toBe(false);
  });

  it('does not overwrite or expose an existing profile marker', async () => {
    const storage = memoryStorage({ 'analytics-first-open-claimed': '1' });

    await expect(claimDurably({ storage, locks: serialLocks() })).resolves.toBe(false);
  });
});
