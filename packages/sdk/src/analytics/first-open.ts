export type FirstOpenStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type FirstOpenStorageDurability = 'durable' | 'volatile';

export interface FirstOpenLockManager {
  request(name: string, callback: () => boolean | Promise<boolean>): Promise<boolean>;
}

export interface FirstOpenAtomicStore {
  /** Atomically inserts key, returning true only for the unique winner. */
  claim(key: string): Promise<boolean>;
}

export interface FirstOpenClaimOptions {
  readonly storage: FirstOpenStorage;
  readonly storageDurability: FirstOpenStorageDurability;
  readonly profile?: string;
  readonly existingStateKeys?: readonly string[];
  /** Install evidence captured before eager imports can create save keys. */
  readonly hadExistingStateAtBootstrap?: boolean;
  readonly locks?: FirstOpenLockManager | null;
  readonly atomicStore?: FirstOpenAtomicStore | null;
}

const FIRST_OPEN_KEY = 'analytics-first-open-claimed';
const CLAIM_DATABASE = 'fabrikav2-analytics';
const CLAIM_STORE = 'first-open-claims';

function browserLocks(): FirstOpenLockManager | null {
  try {
    if (typeof navigator === 'undefined' || navigator.locks === undefined) return null;
    return navigator.locks as FirstOpenLockManager;
  } catch {
    return null;
  }
}

function indexedDbAtomicStore(): FirstOpenAtomicStore | null {
  try {
    if (typeof indexedDB === 'undefined') return null;
    return {
      claim: (key) => new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open(CLAIM_DATABASE, 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains(CLAIM_STORE)) {
            open.result.createObjectStore(CLAIM_STORE);
          }
        };
        open.onerror = () => reject(open.error ?? new Error('IndexedDB open failed'));
        open.onblocked = () => reject(new Error('IndexedDB open blocked'));
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction(CLAIM_STORE, 'readwrite');
          const request = transaction.objectStore(CLAIM_STORE).add(1, key);
          let claimed = false;
          request.onsuccess = () => { claimed = true; };
          request.onerror = (event) => {
            if (request.error?.name === 'ConstraintError') {
              event.preventDefault();
              event.stopPropagation();
            } else {
              reject(request.error ?? new Error('IndexedDB claim failed'));
            }
          };
          transaction.oncomplete = () => {
            database.close();
            resolve(claimed);
          };
          transaction.onabort = () => {
            database.close();
            reject(transaction.error ?? new Error('IndexedDB claim transaction aborted'));
          };
        };
      }),
    };
  } catch {
    return null;
  }
}

function inspectInstall(storage: FirstOpenStorage, key: string, existingStateKeys: readonly string[], capturedEvidence?: boolean): {
  readonly alreadyClaimed: boolean;
  readonly upgradedInstall: boolean;
} {
  return {
    alreadyClaimed: storage.getItem(key) !== null,
    upgradedInstall: capturedEvidence ?? existingStateKeys.some((existingKey) => storage.getItem(existingKey) !== null),
  };
}

/**
 * Atomically claims the install/profile's first analytics open. Web Locks
 * serialize localStorage where available; IndexedDB unique insertion covers
 * older supported browser/native engines. Existing durable game state is
 * migrated without being reported as a new install. If every atomic mechanism
 * or durable store is unavailable, this fails closed.
 */
export async function claimFirstOpen(options: FirstOpenClaimOptions): Promise<boolean> {
  const { storage, profile, existingStateKeys = [], hadExistingStateAtBootstrap } = options;
  if (options.storageDurability === 'volatile') return false;
  const locks = options.locks === undefined ? browserLocks() : options.locks;
  const key = profile === undefined ? FIRST_OPEN_KEY : `${FIRST_OPEN_KEY}:${profile}`;

  try {
    if (locks !== null) {
      return await locks.request(`fabrikav2:${key}`, () => {
        const install = inspectInstall(storage, key, existingStateKeys, hadExistingStateAtBootstrap);
        if (install.alreadyClaimed) return false;
        storage.setItem(key, '1');
        if (storage.getItem(key) !== '1') return false;
        return !install.upgradedInstall;
      });
    }

    const atomicStore = options.atomicStore === undefined ? indexedDbAtomicStore() : options.atomicStore;
    if (atomicStore === null) return false;
    const install = inspectInstall(storage, key, existingStateKeys, hadExistingStateAtBootstrap);
    if (install.alreadyClaimed) return false;
    if (!await atomicStore.claim(key)) return false;
    try {
      storage.setItem(key, '1');
    } catch {
      // IndexedDB remains the durable atomic marker when localStorage is denied.
    }
    return !install.upgradedInstall;
  } catch {
    return false;
  }
}
