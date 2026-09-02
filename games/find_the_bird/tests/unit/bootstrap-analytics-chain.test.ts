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
  it('classifies an empty install before eager runtime imports', async () => {
    await import('../../src/bootstrap');
    await vi.waitFor(() => expect(startAnalyticsBootstrap).toHaveBeenCalledWith(false, 'durable'));
  });

  it('preserves established save evidence through the actual bootstrap import', async () => {
    window.localStorage.setItem('ftd_achievements', '{"version":1}');
    await import('../../src/bootstrap');
    await vi.waitFor(() => expect(startAnalyticsBootstrap).toHaveBeenCalledWith(true, 'durable'));
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
    vi.unstubAllGlobals();
  });
});
