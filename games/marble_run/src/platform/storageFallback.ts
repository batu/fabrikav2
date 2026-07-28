/**
 * Keep the game bootable where `localStorage` is unavailable.
 *
 * Reading `window.localStorage` THROWS (rather than returning null) in a
 * sandboxed document without `allow-same-origin`, and in some private-browsing
 * modes. The portal's build preview sandboxes uploaded bundles deliberately —
 * they are untrusted, and granting same-origin would hand them the portal's
 * session cookie — so the game has to tolerate the restriction rather than the
 * host relaxing it.
 *
 * Before this, the first storage read during boot threw and nothing mounted at
 * all: the preview rendered an empty background.
 *
 * Swaps in an in-memory Storage so progress simply does not persist for that
 * session. Import this FIRST in bootstrap so it runs before any module reads
 * storage at import time.
 */

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length(): number {
      return entries.size;
    },
    clear(): void {
      entries.clear();
    },
    getItem(key: string): string | null {
      return entries.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...entries.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      entries.delete(key);
    },
    setItem(key: string, value: string): void {
      entries.set(key, String(value));
    },
  } as Storage;
}

/** True when the real `localStorage` can be read and written. */
export function storageIsUsable(): boolean {
  try {
    const probe = '__marble_storage_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function installStorageFallback(): boolean {
  if (typeof window === 'undefined') return false;
  if (storageIsUsable()) return false;
  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: (() => {
        const memory = createMemoryStorage();
        return () => memory;
      })(),
    });
    return true;
  } catch {
    // Nothing more to do: the property is locked down. Callers that guard their
    // own access still work; the rest will surface the original error.
    return false;
  }
}

installStorageFallback();
