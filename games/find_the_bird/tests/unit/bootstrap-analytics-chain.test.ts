import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const startAnalyticsBootstrap = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../src/runtime', () => ({ startAnalyticsBootstrap }));
const originalWindow = window;
const originalStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
const values = new Map<string, string>();
const storage = {
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  removeItem: (key: string) => values.delete(key),
  setItem: (key: string, value: string) => values.set(key, value),
};

beforeEach(() => {
  vi.resetModules();
  startAnalyticsBootstrap.mockClear();
  values.clear();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
});

afterAll(() => {
  if (originalStorageDescriptor === undefined) Reflect.deleteProperty(window, 'localStorage');
  else Object.defineProperty(window, 'localStorage', originalStorageDescriptor);
});

describe('production bootstrap install evidence', () => {
  it('protects a fresh install for its whole UTC install day, across launches, and serves the next day', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-16T20:00:00.000Z'));
      await import('../../src/bootstrap');
      const firstLaunch = await import('../../src/ads/sessionAdPolicy');
      expect(firstLaunch.areAutomaticAdsAllowed()).toBe(false);
      expect(firstLaunch.automaticAdBlockReason()).toBe('install_day');
      expect(values.get('ftb_install_day')).toBe('2026-09-16');
      window.localStorage.setItem('ftd_level', '1');
      vi.resetModules();
      vi.setSystemTime(new Date('2026-09-16T23:30:00.000Z'));
      await import('../../src/bootstrap');
      const secondLaunch = await import('../../src/ads/sessionAdPolicy');
      expect(secondLaunch.areAutomaticAdsAllowed()).toBe(false);
      expect(secondLaunch.adPolicyParams()).toEqual({ ad_policy: 'install_day_v2', ad_policy_cohort: 'new_install', install_day: '2026-09-16' });
      // Midnight UTC passes mid-session: the block lifts without a relaunch.
      vi.setSystemTime(new Date('2026-09-17T00:00:01.000Z'));
      expect(secondLaunch.areAutomaticAdsAllowed()).toBe(true);
      expect(secondLaunch.daysSinceInstall()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('classifies an empty install before eager runtime imports', async () => {
    await import('../../src/bootstrap');
    await vi.waitFor(() => expect(startAnalyticsBootstrap).toHaveBeenCalledWith(false, 'durable'));
    const { areAutomaticAdsAllowed } = await import('../../src/ads/sessionAdPolicy');
    expect(areAutomaticAdsAllowed()).toBe(false);
    window.localStorage.setItem('ftd_level', '1');
    window.dispatchEvent(new Event('focus'));
    expect(areAutomaticAdsAllowed()).toBe(false);
  });

  it('ignores a leftover ftb_ad_protection_v1 assignment', async () => {
    values.set('ftb_ad_protection_v1_assignment', 'from_start');
    await import('../../src/bootstrap');
    const policy = await import('../../src/ads/sessionAdPolicy');
    expect(policy.areAutomaticAdsAllowed()).toBe(false);
    expect(policy.adPolicyParams().ad_policy_cohort).toBe('new_install');
  });

  it('preserves established save evidence through the actual bootstrap import', async () => {
    window.localStorage.setItem('ftd_achievements', '{"version":1}');
    await import('../../src/bootstrap');
    await vi.waitFor(() => expect(startAnalyticsBootstrap).toHaveBeenCalledWith(true, 'durable'));
    const { areAutomaticAdsAllowed } = await import('../../src/ads/sessionAdPolicy');
    expect(areAutomaticAdsAllowed()).toBe(true);
  });

  it('boots when window.localStorage throws and cannot be replaced', async () => {
    vi.stubGlobal('window', new Proxy(originalWindow, {
      get(target, property, receiver) {
        if (property === 'localStorage') throw new DOMException('denied', 'SecurityError');
        return Reflect.get(target, property, receiver);
      },
      defineProperty: () => false,
    }));
    vi.resetModules();
    await import('../../src/bootstrap');
    await vi.waitFor(() => expect(startAnalyticsBootstrap).toHaveBeenCalledWith(false, 'volatile'));
    const { areAutomaticAdsAllowed } = await import('../../src/ads/sessionAdPolicy');
    expect(areAutomaticAdsAllowed()).toBe(false);
    vi.unstubAllGlobals();
  });
});
