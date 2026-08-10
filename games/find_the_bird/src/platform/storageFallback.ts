/**
 * Keep the game bootable where `localStorage` is unavailable.
 *
 * Reading `window.localStorage` throws in a sandboxed document without
 * `allow-same-origin`, and in some private-browsing modes. Portal deliberately
 * keeps uploaded previews on an opaque origin, so the game must tolerate the
 * restriction instead of weakening the host sandbox.
 *
 * Progress remains in memory for that session. Import this first in bootstrap
 * so it runs before any module reads storage during evaluation.
 */

import { localStorageOrNull } from './localStorage';

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

function storageIsUsable(): boolean {
  const storage = localStorageOrNull();
  if (storage === null) return false;
  try {
    const probe = '__ftb_storage_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function installStorageFallback(): void {
  if (typeof window === 'undefined') return;
  if (storageIsUsable()) return;
  try {
    const memoryStorage = createMemoryStorage();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => memoryStorage,
    });
  } catch {
    // Callers that guard storage access still work if the property cannot be
    // replaced; unguarded reads will surface the original platform error.
  }
}

installStorageFallback();

export {};
