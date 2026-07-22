/**
 * Integration coverage for the SDK composition layer (GameSdk). Exercises the
 * canonical analytics events, rewarded-ad flows, remote-config-driven
 * interstitial cadence + no-ads suppression, and the IAP purchase/restore grant
 * path — all with Fake/Disabled providers (the CI contract; native delivery is
 * Blocked-on-Batu). It drives GameSdk directly (no Three.js / DOM) so it runs
 * headless.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createAnalytics,
  type AnalyticsEvent,
  type AnalyticsSink,
} from '@fabrikav2/sdk/analytics';
import type { AdProvider } from '@fabrikav2/sdk/ads';
import {
  FakePurchaseProvider,
  IapService,
  validateCatalog,
  type CustomerInfoLike,
  type PurchaseTransaction,
} from '@fabrikav2/sdk/iap';
import { AttributionService, createAttributionProvider } from '@fabrikav2/sdk/attribution';
import { createRemoteConfigService } from '@fabrikav2/services/remote-config';
import { resolveSdkEnvironments } from '@fabrikav2/sdk';
import {
  createGameSdk,
  GameSdk,
  type GameEconomyBridge,
  type GameSdkPorts,
} from '../../src/sdk/SdkContext.ts';
import {
  marbleCatalog,
  marbleCatalogProducts,
  NO_ADS_PRODUCT_ID,
  fakeStoreProductsFromCatalog,
  type MarbleGrant,
} from '../../src/sdk/catalog.ts';
import { marbleRemoteConfigSchema } from '../../src/sdk/remoteConfig.ts';

const NO_ADS_STORE_ID = marbleCatalogProducts.find((p) => p.id === NO_ADS_PRODUCT_ID)!.productId;
const COINS_SMALL_STORE_ID = marbleCatalogProducts.find((p) => p.id === 'coins_small')!.productId;

function customerInfoWith(...productIds: string[]): CustomerInfoLike {
  return {
    allPurchasedProductIdentifiers: productIds,
    nonSubscriptionTransactions: productIds.map((productIdentifier) => ({ productIdentifier })),
  };
}

function txnFor(storeId: string): PurchaseTransaction {
  return {
    productIdentifier: storeId,
    transactionId: `txn-${storeId}`,
    purchaseToken: null,
    customerInfo: customerInfoWith(storeId),
  };
}

interface FakeAds {
  provider: AdProvider;
  maybeShowInterstitial: ReturnType<typeof vi.fn>;
  showRewardedAd: ReturnType<typeof vi.fn>;
}

function makeFakeAds(opts: { rewardGranted?: boolean; interstitialShown?: boolean } = {}): FakeAds {
  const maybeShowInterstitial = vi.fn(async () => opts.interstitialShown ?? false);
  const showRewardedAd = vi.fn(async () => ({ granted: opts.rewardGranted ?? false }));
  const provider: AdProvider = {
    providerName: 'fake',
    init: async () => {},
    preloadInterstitial: async () => {},
    maybeShowInterstitial: () => maybeShowInterstitial(),
    showBanner: async () => false,
    hideBanner: async () => {},
    preloadRewarded: async () => {},
    showRewardedAd: () => showRewardedAd(),
  };
  return { provider, maybeShowInterstitial, showRewardedAd };
}

interface FakeEconomy extends GameEconomyBridge {
  coins: number;
  noAds: boolean;
}

function makeEconomy(): FakeEconomy {
  return {
    coins: 0,
    noAds: false,
    addCoins(amount: number): void {
      this.coins += amount;
    },
    grantNoAds(): void {
      this.noAds = true;
    },
    hasNoAds(): boolean {
      return this.noAds;
    },
    coinBalance(): number {
      return this.coins;
    },
  };
}

interface Harness {
  sdk: GameSdk;
  events: AnalyticsEvent[];
  ads: FakeAds;
  economy: FakeEconomy;
  iap: IapService<MarbleGrant>;
}

async function makeHarness(opts: {
  ads?: FakeAds;
  economy?: FakeEconomy;
  purchaseResults?: Record<string, PurchaseTransaction>;
  restoreCustomerInfo?: CustomerInfoLike;
} = {}): Promise<Harness> {
  const events: AnalyticsEvent[] = [];
  const captureSink: AnalyticsSink = { name: 'capture', emit: (e) => events.push(e) };
  const environments = resolveSdkEnvironments('development');
  const analytics = createAnalytics({
    env: environments.analytics,
    sessionId: 'test-session',
    sinks: [captureSink],
  });
  const ads = opts.ads ?? makeFakeAds();
  const economy = opts.economy ?? makeEconomy();

  const provider = new FakePurchaseProvider({
    products: fakeStoreProductsFromCatalog(),
    purchaseResults: opts.purchaseResults,
    restoreCustomerInfo: opts.restoreCustomerInfo,
  });
  const iap = new IapService<MarbleGrant>({
    isNativePlatform: () => true,
    platform: () => 'ios',
    apiKey: () => 'test_marble_run_sandbox',
    catalogProducts: () => marbleCatalogProducts,
    provider: () => provider,
    operationTimeoutMs: () => 1_000,
  });
  await iap.init();

  const attribution = new AttributionService(createAttributionProvider('web'));
  const remoteConfig = createRemoteConfigService(marbleRemoteConfigSchema);

  const ports: GameSdkPorts = {
    analytics,
    ads: ads.provider,
    iap,
    attribution,
    remoteConfig,
    economy,
    environments,
  };
  return { sdk: new GameSdk(ports, true), events, ads, economy, iap };
}

function names(events: AnalyticsEvent[]): string[] {
  return events.map((e) => e.name);
}

describe('marble_run catalog fixture', () => {
  it('is schema-valid (no-ads entitlement + coin packs)', () => {
    expect(validateCatalog(marbleCatalog)).toEqual([]);
    expect(marbleCatalogProducts.some((p) => p.kind === 'entitlement' && p.payload.noAds)).toBe(true);
    expect(marbleCatalogProducts.filter((p) => p.kind === 'consumable').length).toBeGreaterThan(0);
  });
});

describe('createGameSdk composition root (web/dev)', () => {
  it('composes all four SDKs and boots without throwing', async () => {
    const economy = makeEconomy();
    const sdk = createGameSdk({ economy, buildEnv: 'development' });
    // init() runs ads.init + iap.init + attribution.init + remoteConfig.refresh.
    await expect(sdk.init()).resolves.toBeUndefined();
    // Env resolved through the single resolver → dev row (pollution guard).
    expect(sdk.environments).toMatchObject({ analytics: 'development', adjust: 'sandbox' });
    // On web the IAP service is unsupported-platform by construction (native store
    // is Blocked-on-Batu); the service still constructs + the shop can mount.
    expect(sdk.iap.snapshot().state).toBe('unsupported-platform');
  });
});

describe('GameSdk ad-provider teardown wiring', () => {
  it('invokes the ad-owner disposal on session teardown (even if pagehide repeats)', () => {
    const disposeAds = vi.fn(async () => {});
    const ports: GameSdkPorts = {
      analytics: createAnalytics({ env: 'development', sessionId: 's', sinks: [] }),
      ads: makeFakeAds().provider,
      iap: new IapService<MarbleGrant>({
        isNativePlatform: () => false,
        platform: () => 'web',
        apiKey: () => 'test_marble_run_sandbox',
        catalogProducts: () => marbleCatalogProducts,
        provider: () => new FakePurchaseProvider({ products: fakeStoreProductsFromCatalog() }),
        operationTimeoutMs: () => 1_000,
      }),
      attribution: new AttributionService(createAttributionProvider('web')),
      remoteConfig: createRemoteConfigService(marbleRemoteConfigSchema),
      economy: makeEconomy(),
      environments: resolveSdkEnvironments('development'),
      disposeAds,
    };
    const sdk = new GameSdk(ports, false);

    sdk.endSession();
    sdk.endSession(); // pagehide fired twice; dispose is idempotent downstream

    expect(disposeAds).toHaveBeenCalledTimes(2);
  });
});

describe('GameSdk analytics wiring', () => {
  it('emits the canonical level + economy events tagged env=development', async () => {
    const { sdk, events } = await makeHarness();
    await sdk.init();
    sdk.levelStart(1);
    sdk.levelComplete(1, 25, 25);
    sdk.levelFail(2, 'out_of_moves');

    expect(names(events)).toEqual(
      expect.arrayContaining([
        'session_start',
        'level_start',
        'level_complete',
        'resource_change',
        'level_fail',
      ]),
    );
    // Env marker rides on every event (FTD-pollution guard); toWirePayload
    // injects it into the transmitted params at the sink boundary.
    expect(events.every((e) => e.env === 'development')).toBe(true);

    const reward = events.find((e) => e.name === 'resource_change');
    expect(reward?.params).toMatchObject({ currency: 'coins', amount: 25, flow: 'source' });
    const fail = events.find((e) => e.name === 'level_fail');
    expect(fail?.params).toMatchObject({ level_id: '2', reason: 'out_of_moves' });
  });
});

describe('GameSdk rewarded ads', () => {
  it('grants a free hint when the rewarded ad is watched (ad_request/impression/reward emitted)', async () => {
    const ads = makeFakeAds({ rewardGranted: true });
    const { sdk, events } = await makeHarness({ ads });
    const granted = await sdk.tryRewardedHint();
    expect(granted).toBe(true);
    expect(ads.showRewardedAd).toHaveBeenCalledTimes(1);
    expect(names(events)).toEqual(
      expect.arrayContaining(['ad_request', 'ad_impression', 'ad_reward']),
    );
    const reward = events.find((e) => e.name === 'ad_reward');
    expect(reward?.params).toMatchObject({ ad_format: 'rewarded', placement: 'rewarded_hint' });
  });

  it('falls back (returns false) when no ad is available — fail-save unavailable path', async () => {
    const ads = makeFakeAds({ rewardGranted: false });
    const { sdk, events } = await makeHarness({ ads });
    const granted = await sdk.tryRewardedFailSave();
    expect(granted).toBe(false);
    // Requested, but no impression/reward on a denied ad.
    expect(names(events)).toContain('ad_request');
    expect(names(events)).not.toContain('ad_reward');
  });
});

describe('GameSdk interstitial cadence', () => {
  it('shows an interstitial once the level cadence hits (default every 3 levels)', async () => {
    const ads = makeFakeAds({ interstitialShown: true });
    const { sdk } = await makeHarness({ ads });
    sdk.levelComplete(1, 0);
    sdk.levelComplete(2, 0);
    sdk.levelComplete(3, 0);
    await sdk.maybeShowInterstitialAfterLevel(3);
    expect(ads.maybeShowInterstitial).toHaveBeenCalledTimes(1);
  });

  it('suppresses interstitials entirely once no-ads is owned (iap → ads invariant)', async () => {
    const ads = makeFakeAds({ interstitialShown: true });
    const economy = makeEconomy();
    economy.noAds = true;
    const { sdk } = await makeHarness({ ads, economy });
    sdk.levelComplete(1, 0);
    sdk.levelComplete(2, 0);
    sdk.levelComplete(3, 0);
    await sdk.maybeShowInterstitialAfterLevel(3);
    expect(ads.maybeShowInterstitial).not.toHaveBeenCalled();
  });
});

describe('GameSdk IAP', () => {
  it('purchases the no-ads entitlement → grants it + emits a purchase event', async () => {
    const economy = makeEconomy();
    const { sdk, events } = await makeHarness({
      economy,
      purchaseResults: { [NO_ADS_STORE_ID]: txnFor(NO_ADS_STORE_ID) },
    });
    const result = await sdk.purchase(NO_ADS_STORE_ID);
    expect(result.status).toBe('purchased');
    expect(economy.noAds).toBe(true);
    expect(sdk.isNoAdsOwned()).toBe(true);
    const purchase = events.find((e) => e.name === 'purchase');
    expect(purchase?.params).toMatchObject({ product_id: NO_ADS_STORE_ID });
  });

  it('purchases a coin pack → credits coins + emits a resource_change source', async () => {
    const economy = makeEconomy();
    const { sdk, events } = await makeHarness({
      economy,
      purchaseResults: { [COINS_SMALL_STORE_ID]: txnFor(COINS_SMALL_STORE_ID) },
    });
    const result = await sdk.purchase(COINS_SMALL_STORE_ID);
    expect(result.status).toBe('purchased');
    expect(economy.coins).toBe(500);
    const flows = events.filter((e) => e.name === 'resource_change');
    expect(flows.some((e) => e.params.reason === 'iap_purchase' && e.params.flow === 'source')).toBe(true);
  });

  it('restores the no-ads entitlement (consumables never restore)', async () => {
    const economy = makeEconomy();
    const { sdk } = await makeHarness({
      economy,
      restoreCustomerInfo: customerInfoWith(NO_ADS_STORE_ID, COINS_SMALL_STORE_ID),
    });
    const result = await sdk.restore();
    expect(result.status).toBe('restored');
    expect(economy.noAds).toBe(true);
    // Coin packs are consumable — a restore must not re-credit coins.
    expect(economy.coins).toBe(0);
  });
});
