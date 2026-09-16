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
  it('keeps the protected arm suppressed until both a later launch and level 11', async () => {
    values.set('ftb_ad_protection_v1_assignment', 'protected');
    await import('../../src/bootstrap');
    const firstSession = await import('../../src/ads/sessionAdPolicy');
    expect(firstSession.areAutomaticAdsAllowed()).toBe(false);
    window.localStorage.setItem('ftd_level', '1');
    expect(firstSession.areAutomaticAdsAllowed()).toBe(false);
    vi.resetModules();
    await import('../../src/bootstrap');
    const secondSession = await import('../../src/ads/sessionAdPolicy');
    expect(secondSession.areAutomaticAdsAllowed()).toBe(false);
    secondSession.configureAdProgression(() => 11);
    expect(secondSession.areAutomaticAdsAllowed()).toBe(true);
  });
  it('classifies an empty install before eager runtime imports', async () => {
    values.set('ftb_ad_protection_v1_assignment', 'protected');
    await import('../../src/bootstrap');
    await vi.waitFor(() => expect(startAnalyticsBootstrap).toHaveBeenCalledWith(false, 'durable'));
    const { areAutomaticAdsAllowed } = await import('../../src/ads/sessionAdPolicy');
    expect(areAutomaticAdsAllowed()).toBe(false);
    window.localStorage.setItem('ftd_level', '1');
    window.dispatchEvent(new Event('focus'));
    expect(areAutomaticAdsAllowed()).toBe(false);
  });

  it('applies the from-start arm before importing the runtime', async () => {
    values.set('ftb_ad_protection_v1_assignment', 'from_start');
    await import('../../src/bootstrap');
    await vi.waitFor(() => expect(startAnalyticsBootstrap).toHaveBeenCalledWith(false, 'durable'));
    const policy = await import('../../src/ads/sessionAdPolicy');
    expect(policy.areAutomaticAdsAllowed()).toBe(true);
    expect(policy.adExperimentParams().ad_experiment_variant).toBe('from_start');
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
