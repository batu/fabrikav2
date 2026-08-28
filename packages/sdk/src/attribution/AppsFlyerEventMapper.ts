export type AppsFlyerCanonicalEvent =
  | { type: 'tutorial_completed'; tutorialId: string }
  | { type: 'progression_milestone'; level: number }
  | { type: 'purchase_verified'; revenue: number; currency: string; productId: string; transactionId: string }
  | { type: 'ad_revenue'; revenue: number; currency: string; format: string; placement: string; impressionId: string }
  | { type: 'retention_milestone'; day: 1 | 3 | 7 | 14 | 30 };

export interface AppsFlyerMappedEvent { eventName: string; eventValues: Record<string, string> }
export interface DedupeStore { has(key: string): boolean; add(key: string): void }

export function createLocalStorageDedupeStore(storage: Pick<Storage, 'getItem' | 'setItem'>, key = 'appsflyer-value-event-dedupe'): DedupeStore {
  const read = (): Set<string> => {
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? '[]');
      return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(-500) : []);
    } catch { return new Set(); }
  };
  return {
    has: (value) => read().has(value),
    add: (value) => {
      const values = read(); values.add(value);
      try { storage.setItem(key, JSON.stringify([...values].slice(-500))); } catch { /* fail open for gameplay; in-memory dedupe remains */ }
    },
  };
}

export class AppsFlyerEventMapper {
  private readonly seen = new Set<string>();
  constructor(private readonly durable?: DedupeStore) {}

  map(event: AppsFlyerCanonicalEvent): AppsFlyerMappedEvent | null {
    switch (event.type) {
      case 'tutorial_completed':
        return bounded(event.tutorialId) ? mapped('af_tutorial_completion', { af_tutorial_id: event.tutorialId }) : null;
      case 'progression_milestone':
        return Number.isInteger(event.level) && event.level > 0 ? mapped('af_level_achieved', { af_level: event.level }) : null;
      case 'retention_milestone':
        return mapped('retention_milestone', { day: event.day });
      case 'purchase_verified':
        return this.revenue('purchase', event.transactionId, event.revenue, event.currency, {
          af_content_id: event.productId,
          transaction_id: event.transactionId,
        });
      case 'ad_revenue':
        return this.revenue('ad', event.impressionId, event.revenue, event.currency, {
          ad_format: event.format,
          placement: event.placement,
          impression_id: event.impressionId,
        });
    }
  }

  private revenue(kind: 'purchase' | 'ad', id: string, revenue: number, currency: string, values: Record<string, string>): AppsFlyerMappedEvent | null {
    if (!bounded(id) || !Number.isFinite(revenue) || revenue <= 0 || !/^[A-Z]{3}$/.test(currency)) return null;
    if (Object.values(values).some((value) => !bounded(value))) return null;
    const key = `${kind}:${id}`;
    if (this.seen.has(key) || this.durable?.has(key)) return null;
    this.seen.add(key); this.durable?.add(key);
    return mapped(kind === 'purchase' ? 'af_purchase' : 'af_ad_revenue', { ...values, af_revenue: revenue, af_currency: currency });
  }
}

function mapped(eventName: string, values: Record<string, string | number>): AppsFlyerMappedEvent {
  return { eventName, eventValues: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])) };
}
function bounded(value: string): boolean { return value.length > 0 && value.length <= 128; }
