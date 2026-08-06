import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createStorage(initial: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(initial));
  return {
    get length(): number {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => entries.delete(key),
    setItem: (key, value) => entries.set(key, String(value)),
  } as Storage;
}

describe('storage fallback', () => {
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  });

  afterEach(() => {
    vi.resetModules();
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(window, 'localStorage');
    } else {
      Object.defineProperty(window, 'localStorage', originalDescriptor);
    }
  });

  it('installs in-memory storage when the platform getter throws', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('sandboxed', 'SecurityError');
      },
    });

    vi.resetModules();
    await import('../../src/platform/storageFallback');

    expect(() => window.localStorage).not.toThrow();
    window.localStorage.setItem('progress', '5');
    expect(window.localStorage.getItem('progress')).toBe('5');
  });

  it('installs in-memory storage when the platform storage cannot be written', async () => {
    const readOnlyStorage = createStorage();
    readOnlyStorage.setItem = () => {
      throw new DOMException('read only', 'QuotaExceededError');
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: readOnlyStorage,
    });

    vi.resetModules();
    await import('../../src/platform/storageFallback');

    expect(window.localStorage).not.toBe(readOnlyStorage);
    window.localStorage.setItem('progress', '5');
    expect(window.localStorage.getItem('progress')).toBe('5');
  });

  it('preserves usable storage and its existing values', async () => {
    const usableStorage = createStorage({ progress: '5' });
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: usableStorage,
    });

    vi.resetModules();
    await import('../../src/platform/storageFallback');

    expect(window.localStorage).toBe(usableStorage);
    expect(window.localStorage.getItem('progress')).toBe('5');
  });
});
