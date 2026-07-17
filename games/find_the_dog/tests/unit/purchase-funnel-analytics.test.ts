import { afterEach, describe, expect, it, vi } from 'vitest';

// RemoteConfigService touches localStorage at module scope (known landmine —
// every unit test that transitively imports it mocks it the same way).
vi.mock('../../src/config/RemoteConfigService', async () => {
  const { REMOTE_CONFIG_DEFAULTS } = await import('../../src/config/remoteConfigSchema');
  return {
    remoteConfigService: {
      value: (key: keyof typeof REMOTE_CONFIG_DEFAULTS) => REMOTE_CONFIG_DEFAULTS[key],
      snapshot: () => ({ values: REMOTE_CONFIG_DEFAULTS }),
    },
  };
});

import { analytics } from '../../src/analytics/AnalyticsService';
import {
  canonicalAnalyticsEvents,
  dashboardImportDimensionKeys,
} from '../../src/analytics/CanonicalAnalyticsEvents';
import { FindTheDogIapService } from '../../src/shop/IapService';

// Runtime access to the service's private sdk so tests can observe emitted
// events without adding a production-only injection seam.
function trackSpy(): ReturnType<typeof vi.spyOn> {
  const sdk = (analytics as unknown as { sdk: { track: (...args: unknown[]) => void } }).sdk;
  return vi.spyOn(sdk, 'track');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('canonical event contract', () => {
  it('every primaryDimension is dashboard-importable (superset invariant)', () => {
    const allowed = new Set<string>(dashboardImportDimensionKeys);
    for (const event of canonicalAnalyticsEvents) {
      for (const dimension of event.primaryDimensions) {
        expect(allowed, `${event.id} dimension '${dimension}' missing from dashboardImportDimensionKeys`).toContain(dimension);
      }
    }
  });

  it('declares the purchase funnel as runtime-instrumented', () => {
    const byId = new Map(canonicalAnalyticsEvents.map((event) => [event.id, event]));
    for (const id of ['product_tapped', 'purchase_initiated', 'purchase_sheet_shown', 'purchase_cancelled', 'purchase_failed', 'iap_state_changed'] as const) {
      expect(byId.get(id)?.instrumentationStatus, id).toBe('runtime');
    }
  });
});

describe('AnalyticsService purchase funnel emitters', () => {
  it('purchaseFailed carries surface, reason, failure_kind and truncates error_message', async () => {
    const spy = trackSpy();
    await analytics.purchaseFailed({
      product_id: 'com.example.hints10x',
      surface: 'fail_continue',
      reason: 'failed',
      failure_kind: 'timeout',
      error_message: 'x'.repeat(300),
    });
    expect(spy).toHaveBeenCalledWith('purchase_failed', expect.objectContaining({
      product_id: 'com.example.hints10x',
      surface: 'fail_continue',
      reason: 'failed',
      failure_kind: 'timeout',
      error_message: 'x'.repeat(96),
    }));
  });

  it('purchaseInitiated / purchaseCancelled carry the surface dimension', async () => {
    const spy = trackSpy();
    await analytics.purchaseInitiated({ product_id: 'p', surface: 'shop' });
    await analytics.purchaseCancelled({ product_id: 'p', surface: 'shop' });
    expect(spy).toHaveBeenCalledWith('purchase_initiated', expect.objectContaining({ surface: 'shop' }));
    expect(spy).toHaveBeenCalledWith('purchase_cancelled', expect.objectContaining({ surface: 'shop' }));
  });
});

describe('FindTheDogIapService analytics wiring', () => {
  it('emits iap_state_changed transitions and purchase_sheet_shown through a real purchase', async () => {
    const stateSpy = vi.spyOn(analytics, 'iapStateChanged').mockResolvedValue();
    const sheetSpy = vi.spyOn(analytics, 'purchaseSheetShown').mockResolvedValue();

    const service = new FindTheDogIapService();
    service.init();
    await service.initPromiseValue;
    expect(stateSpy).toHaveBeenCalledWith({ state: 'initializing', reason: null });
    expect(stateSpy).toHaveBeenCalledWith({ state: 'ready', reason: null });

    const productId = service.snapshot().products[0]?.productId;
    expect(productId).toBeTruthy();
    // The fake provider has no scripted purchase result → the provider throws,
    // but the sheet-dispatch event must still have fired before the failure.
    const result = await service.purchase(productId!);
    expect(sheetSpy).toHaveBeenCalledWith({ product_id: productId });
    expect(result.status).toBe('failed');
    expect(result.failureKind).toBe('store-error');
  });
});
