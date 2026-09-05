import type { IapPurchaseResult } from './service.ts';

/** One atomic record per game. Implementations must throw on failed writes. */
export interface PendingPurchaseStore {
  load(): IapPurchaseResult[];
  save(results: readonly IapPurchaseResult[]): void;
}

/** Access storage lazily: importing an SDK must not require a browser. */
export function localStoragePendingPurchaseStore(
  key: string,
  storage: () => Pick<Storage, 'getItem' | 'setItem'> = () => globalThis.localStorage,
): PendingPurchaseStore {
  return {
    load() {
      const raw = storage().getItem(key);
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      assertPendingPurchases(parsed);
      return parsed;
    },
    save(results) {
      // Reject a malformed native result before replacing any durable evidence.
      assertPendingPurchases(results);
      storage().setItem(key, JSON.stringify(results));
    },
  };
}

function assertPendingPurchases(value: unknown): asserts value is IapPurchaseResult[] {
  if (!Array.isArray(value) || !value.every(isPendingPurchase)) {
    throw new Error('invalid pending purchase record: usable transaction identity and customer info required');
  }
  // The service owns at most one outstanding purchase per SKU. Reject rather
  // than silently discard multiple entries when reconstructing its SKU map.
  const products = new Set<string>();
  const transactions = new Set<string>();
  for (const result of value) {
    const transactionId = result.purchaseToken ?? result.purchaseId;
    if (products.has(result.productId) || transactions.has(transactionId!)) {
      throw new Error('invalid pending purchase record: duplicate product or transaction identity');
    }
    products.add(result.productId);
    transactions.add(transactionId!);
  }
}

function hasIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPendingPurchase(value: unknown): value is IapPurchaseResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Partial<IapPurchaseResult>;
  const info = result.customerInfo;
  return result.status === 'purchased'
    && hasIdentity(result.productId)
    && (result.purchaseId === null || typeof result.purchaseId === 'string')
    && (result.purchaseToken === null || typeof result.purchaseToken === 'string')
    && hasIdentity(result.purchaseToken ?? result.purchaseId)
    && (result.storeProductId === undefined || hasIdentity(result.storeProductId))
    && info !== null && typeof info === 'object'
    && Array.isArray(info.allPurchasedProductIdentifiers)
    && info.allPurchasedProductIdentifiers.every((id: unknown) => typeof id === 'string')
    && Array.isArray(info.nonSubscriptionTransactions)
    && info.nonSubscriptionTransactions.every((transaction: unknown) => typeof transaction === 'object'
      && transaction !== null && 'productIdentifier' in transaction && typeof transaction.productIdentifier === 'string');
}
