import type { FirstOpenStorageDurability } from '@fabrikav2/sdk/analytics';

export interface BootstrapStorage extends Pick<Storage, 'getItem' | 'setItem'> {
  readonly durability: FirstOpenStorageDurability;
}

function detectStorageDurability(): FirstOpenStorageDurability {
  if (typeof window === 'undefined') return 'volatile';
  try {
    const storage = window.localStorage;
    const probe = '__ftd_bootstrap_storage_probe__';
    const previous = storage.getItem(probe);
    storage.setItem(probe, '1');
    if (storage.getItem(probe) !== '1') return 'volatile';
    if (previous === null) storage.removeItem(probe);
    else storage.setItem(probe, previous);
    return 'durable';
  } catch {
    return 'volatile';
  }
}

/** One guarded dependency shared by install detection and SDK composition. */
export const bootstrapStorage: BootstrapStorage = {
  durability: detectStorageDurability(),
  getItem(key): string | null {
    try {
      return typeof window === 'undefined' ? null : window.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key, value): void {
    try {
      window.localStorage?.setItem(key, value);
    } catch {
      // Analytics and attribution persistence fail closed; gameplay continues.
    }
  },
};

export function hasExistingInstallState(keys: readonly string[]): boolean {
  try {
    return keys.some((key) => bootstrapStorage.getItem(key) !== null);
  } catch {
    return false;
  }
}
