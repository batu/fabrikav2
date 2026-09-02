import { afterEach, describe, expect, it, vi } from 'vitest';

// Keep purchase-funnel coverage focused on analytics; the real remote-config
// composition and storage guards have dedicated coverage.
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

  it('declares progression events in the Find the Bird namespace used by the runtime mapping', () => {
    const byId = new Map(canonicalAnalyticsEvents.map((event) => [event.id, event]));

    expect(byId.get('level_start')?.gameAnalyticsName).toBe('Progression start find_the_bird:<level_id>');
    expect(byId.get('level_complete')?.gameAnalyticsName).toBe('Progression complete find_the_bird:<level_id>');
    expect(byId.get('level_failed')?.gameAnalyticsName).toBe('Progression fail find_the_bird:<level_id>');
  });
});

describe('AnalyticsService purchase funnel emitters', () => {
  it('resourceChanged emits one canonical economy envelope instead of a duplicate SDK resource event', async () => {
    const sdk = (analytics as unknown as {
      sdk: { track: (...args: unknown[]) => void; resourceChange: (...args: unknown[]) => void };
    }).sdk;
    const track = vi.spyOn(sdk, 'track');
    const resourceChange = vi.spyOn(sdk, 'resourceChange');

    await analytics.resourceChanged({
      flow_type: 'source', currency: 'coins', amount: 10,
      item_type: 'level', item_id: 'level_complete', level_id: 'level_1',
    });

    expect(resourceChange).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('resource_changed', expect.objectContaining({
      flow_type: 'source', currency: 'coins', amount: 10,
      item_type: 'level', item_id: 'level_complete', level_id: 'level_1',
    }));
  });

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
  it('retries initialization after the native store initially returns no products', async () => {
    let productLoads = 0;
    const provider = {
      configure: vi.fn(async () => undefined),
      getProducts: vi.fn(async (productIds: readonly string[]) => {
        productLoads += 1;
        if (productLoads === 1) return [];
        return productIds.slice(0, 1).map((productId) => ({
          productId,
          title: 'Recovered product',
          description: 'Recovered product',
          price: 1.99,
          priceString: '$1.99',
          currencyCode: 'USD',
        }));
      }),
      purchaseProduct: vi.fn(),
      restorePurchases: vi.fn(),
      addCustomerInfoUpdateListener: vi.fn(async () => undefined),
      removeCustomerInfoUpdateListener: vi.fn(async () => undefined),
    };
    const service = new FindTheDogIapService({
      isNativePlatform: () => true,
      platform: () => 'ios',
      apiKey: () => 'appl_test',
      provider: () => provider,
    });

    service.init();
    await service.initPromiseValue;
    expect(service.snapshot().state).toBe('load-failed');

    service.init();
    await service.initPromiseValue;
    expect(service.snapshot().state).toBe('ready');
    expect(provider.getProducts).toHaveBeenCalledTimes(2);
  });

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
