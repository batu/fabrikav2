/**
 * SdkContext / GameSdk — the marble_run composition root. It only *calls* the
 * already-landed `@fabrikav2/sdk` + `@fabrikav2/services` factories and threads
 * their ports through one object; it vendors no utilities (shared code lives in
 * sdk/kernel). The shell (App) and gameplay (GameController) hold a `GameSdk`
 * and call its game-facing methods — they never touch a provider directly, so
 * CI/web inject Disabled/Fake providers with zero production-code branches.
 *
 * Env resolution goes through the single `resolveSdkEnvironments` call (finding
 * 2A): the four SDK environments are read off one result, never hand-mapped.
 * All pilot traffic is tagged `env: 'development'`.
 */
import { Capacitor } from '@capacitor/core';
import {
  resolveSdkEnvironments,
  type SdkBuildEnv,
  type SdkEnvironments,
} from '@fabrikav2/sdk';
import {
  createAdProvider,
  readAppLovinConfigForPlatform,
  shouldShowInterstitial,
  type AdProvider,
} from '@fabrikav2/sdk/ads';
import {
  createAnalytics,
  createConsoleSink,
  type Analytics,
  type AnalyticsSink,
} from '@fabrikav2/sdk/analytics';
import {
  FakePurchaseProvider,
  IapService,
  type CatalogProduct,
  type IapPurchaseResult,
  type IapRestoreResult,
} from '@fabrikav2/sdk/iap';
import {
  AttributionService,
  createAttributionProvider,
} from '@fabrikav2/sdk/attribution';
import {
  createRemoteConfigService,
  type RemoteConfigService,
} from '@fabrikav2/services/remote-config';
import {
  fakeStoreProductsFromCatalog,
  marbleCatalogProducts,
  marbleGrantForProduct,
  marbleRestoreGrantForProduct,
  type MarbleGrant,
} from './catalog.ts';
import { marbleRemoteConfigSchema, type MarbleRemoteConfigSchema } from './remoteConfig.ts';

/** The game's soft-currency id (matches game.config economy.softCurrency). */
const SOFT_CURRENCY = 'coins';
/** Placeholder web/CI RevenueCat sandbox key — `test_`-prefixed so
 *  `isSandboxApiKey` reads it as sandbox. The real native key is Blocked-on-Batu. */
const SANDBOX_API_KEY = 'test_marble_run_sandbox';

/**
 * The game-side bridge to persisted economy state. Production adapts the
 * SaveState singleton; tests pass an in-memory fake. Keeps GameSdk decoupled
 * from concrete persistence.
 */
export interface GameEconomyBridge {
  addCoins(amount: number): void;
  grantNoAds(): void;
  hasNoAds(): boolean;
  coinBalance(): number;
}

export interface GameSdkPorts {
  readonly analytics: Analytics;
  readonly ads: AdProvider;
  readonly iap: IapService<MarbleGrant>;
  readonly attribution: AttributionService;
  readonly remoteConfig: RemoteConfigService<MarbleRemoteConfigSchema>;
  readonly economy: GameEconomyBridge;
  readonly environments: SdkEnvironments;
  /** Injectable clock (tests); defaults to Date.now. */
  readonly now?: () => number;
}

function priceUsd(product: CatalogProduct<MarbleGrant>): number {
  return Number(product.displayPrice.replace(/[^0-9.]/g, '')) || 0;
}

/**
 * GameSdk — the game-facing façade over the four SDKs. Every gameplay/shell
 * touchpoint (level lifecycle, rewarded ads, interstitial cadence, purchases)
 * routes through a method here so the wiring is centralised and testable.
 */
export class GameSdk {
  private levelsCompletedThisSession = 0;
  private readonly catalogByStoreId: Map<string, CatalogProduct<MarbleGrant>>;

  constructor(
    private readonly ports: GameSdkPorts,
    private readonly firstOpen: boolean = false,
  ) {
    this.catalogByStoreId = new Map(marbleCatalogProducts.map((p) => [p.productId, p]));
  }

  /** The live IAP service — the shop page's single source of truth. */
  get iap(): IapService<MarbleGrant> {
    return this.ports.iap;
  }

  get environments(): SdkEnvironments {
    return this.ports.environments;
  }

  /** Boot all four SDKs (each swallows its own errors) + open the analytics
   *  session. Never throws — a provider failure must not wedge the game boot. */
  async init(): Promise<void> {
    this.ports.analytics.sessionStart({ first_open: this.firstOpen });
    await Promise.allSettled([
      this.ports.ads.init(),
      this.ports.iap.init(),
      this.ports.attribution.init(),
      this.ports.remoteConfig.refresh(),
    ]);
    void this.ports.attribution.appOpen();
  }

  // ── Level lifecycle (canonical analytics + attribution) ─────────

  levelStart(levelId: number): void {
    this.ports.analytics.levelStart({ level_id: String(levelId), level_index: levelId });
    void this.ports.attribution.levelStart({ level_id: String(levelId) });
  }

  levelComplete(levelId: number, reward: number, balanceAfter?: number): void {
    this.levelsCompletedThisSession += 1;
    this.ports.analytics.levelComplete({ level_id: String(levelId), level_index: levelId });
    if (reward > 0) {
      this.ports.analytics.resourceChange({
        currency: SOFT_CURRENCY,
        amount: reward,
        flow: 'source',
        reason: 'level_reward',
        balance: balanceAfter,
      });
    }
    void this.ports.attribution.levelComplete({ level_id: String(levelId) });
  }

  levelFail(levelId: number, reason?: string): void {
    this.ports.analytics.levelFail({ level_id: String(levelId), level_index: levelId, reason });
    void this.ports.attribution.levelFailed({ level_id: String(levelId) });
  }

  /** Report a soft-currency spend (hint, etc.) for the economy analytics leg. */
  recordSpend(amount: number, reason: string, balanceAfter?: number): void {
    this.ports.analytics.resourceChange({
      currency: SOFT_CURRENCY,
      amount,
      flow: 'sink',
      reason,
      balance: balanceAfter,
    });
  }

  // ── Rewarded ads ────────────────────────────────────────────────

  /** Rewarded-ad-instead-of-pay for a hint. Gated by remote config. Resolves
   *  true only if the player actually earned the reward. */
  async tryRewardedHint(): Promise<boolean> {
    if (!this.ports.remoteConfig.value('hintRewardedEnabled')) return false;
    return this.showRewarded('rewarded_hint', 'hint');
  }

  /** Rewarded fail-save (the lose-screen "watch ad" affordance). */
  async tryRewardedFailSave(): Promise<boolean> {
    return this.showRewarded('rewarded_fail_save', 'continue');
  }

  private async showRewarded(placement: string, rewardType: string): Promise<boolean> {
    const provider = this.ports.ads.providerName;
    this.ports.analytics.adRequest({ ad_format: 'rewarded', placement, provider });
    const result = await this.ports.ads.showRewardedAd();
    if (result.granted) {
      this.ports.analytics.adImpression({ ad_format: 'rewarded', placement, provider });
      this.ports.analytics.adReward({
        ad_format: 'rewarded',
        placement,
        provider,
        reward_type: rewardType,
      });
    }
    return result.granted;
  }

  // ── Interstitial cadence (remote-config driven, no-ads gated) ────

  /** Consider an interstitial after a completed level. Suppressed entirely once
   *  the no-ads entitlement is owned (the iap → ads cross-SDK invariant). */
  async maybeShowInterstitialAfterLevel(currentLevel: number): Promise<void> {
    if (this.isNoAdsOwned()) return;
    const policy = {
      everyNLevels: this.ports.remoteConfig.value('interstitialEveryNLevels'),
      minLevel: this.ports.remoteConfig.value('interstitialMinLevel'),
    };
    const state = {
      levelsCompletedThisSession: this.levelsCompletedThisSession,
      currentLevel,
    };
    if (!shouldShowInterstitial(policy, state)) return;
    const minIntervalMs = this.ports.remoteConfig.value('interstitialMinIntervalS') * 1000;
    const provider = this.ports.ads.providerName;
    this.ports.analytics.adRequest({
      ad_format: 'interstitial',
      placement: 'interstitial_level',
      provider,
    });
    const shown = await this.ports.ads.maybeShowInterstitial({ minIntervalMs });
    if (shown) {
      this.ports.analytics.adImpression({
        ad_format: 'interstitial',
        placement: 'interstitial_level',
        provider,
      });
    }
  }

  // ── IAP ─────────────────────────────────────────────────────────

  async purchase(storeProductId: string): Promise<IapPurchaseResult> {
    const result = await this.ports.iap.purchase(storeProductId);
    this.applyPurchaseResult(result);
    return result;
  }

  async restore(): Promise<IapRestoreResult> {
    const result = await this.ports.iap.restore();
    this.applyRestoreResult(result);
    return result;
  }

  /** Apply a settled purchase's grant + emit purchase/economy analytics. Safe to
   *  call from the ShopPage `onPurchase` hook (it settles the same result). */
  applyPurchaseResult(result: IapPurchaseResult): void {
    if (result.status !== 'purchased') return;
    const product = this.catalogByStoreId.get(result.productId);
    if (product === undefined) return;
    const grant = marbleGrantForProduct(product);
    this.applyGrant(grant);
    this.ports.analytics.purchase({
      product_id: result.productId,
      price_usd: priceUsd(product),
      currency: 'USD',
      quantity: 1,
    });
    if (grant.coins > 0) {
      this.ports.analytics.resourceChange({
        currency: SOFT_CURRENCY,
        amount: grant.coins,
        flow: 'source',
        reason: 'iap_purchase',
        balance: this.ports.economy.coinBalance(),
      });
    }
  }

  /** Re-apply recovered entitlements from a settled restore (entitlement half
   *  only — consumables never restore). */
  applyRestoreResult(result: IapRestoreResult): void {
    if (result.status !== 'restored') return;
    for (const ownedId of result.ownedProductIds) {
      const product = this.catalogByStoreId.get(ownedId);
      if (product === undefined) continue;
      const grant = marbleRestoreGrantForProduct(product);
      if (grant !== null) this.applyGrant(grant);
    }
  }

  isNoAdsOwned(): boolean {
    return this.ports.economy.hasNoAds();
  }

  private applyGrant(grant: MarbleGrant): void {
    if (grant.noAds) this.ports.economy.grantNoAds();
    if (grant.coins > 0) this.ports.economy.addCoins(grant.coins);
  }

  // ── Session teardown ────────────────────────────────────────────

  endSession(durationMs?: number): void {
    this.ports.analytics.sessionEnd(durationMs === undefined ? undefined : { duration_ms: durationMs });
    void this.ports.analytics.flush();
  }
}

/**
 * Build the production GameSdk. On web (the pilot dev target) the ad + attribution
 * providers resolve to Disabled by construction, and IAP runs on a seeded
 * FakePurchaseProvider with the sandbox key. Native shells (Blocked-on-Batu)
 * later swap in AppLovin/AdMob, Adjust, and RevenueCat.
 */
export function createGameSdk(deps: {
  economy: GameEconomyBridge;
  buildEnv?: SdkBuildEnv;
  firstOpen?: boolean;
  /** Extra analytics sinks fanned beside the console sink. The test harness
   *  injects a RingBufferSink here so `drainEvents()` can witness the trace;
   *  empty in production. */
  analyticsSinks?: readonly AnalyticsSink[];
}): GameSdk {
  const buildEnv: SdkBuildEnv = deps.buildEnv ?? (import.meta.env.PROD ? 'production' : 'development');
  const environments = resolveSdkEnvironments(buildEnv);
  const platform = Capacitor.getPlatform();

  const appLovinConfig = readAppLovinConfigForPlatform(platform === 'ios' ? 'ios' : 'android');
  const ads = createAdProvider(platform, appLovinConfig);

  const analytics = createAnalytics({
    env: environments.analytics,
    sessionId: crypto.randomUUID(),
    sinks: [createConsoleSink(), ...(deps.analyticsSinks ?? [])],
    globalParams: { platform },
  });

  const fakeProvider = new FakePurchaseProvider({ products: fakeStoreProductsFromCatalog() });
  const iap = new IapService<MarbleGrant>({
    isNativePlatform: () => Capacitor.isNativePlatform(),
    platform: () => normalizePlatform(platform),
    apiKey: () => SANDBOX_API_KEY,
    catalogProducts: () => marbleCatalogProducts,
    provider: () => fakeProvider,
    operationTimeoutMs: () => 15_000,
  });

  const attribution = new AttributionService(createAttributionProvider(platform));

  const remoteConfig = createRemoteConfigService(marbleRemoteConfigSchema);

  return new GameSdk(
    { analytics, ads, iap, attribution, remoteConfig, economy: deps.economy, environments },
    deps.firstOpen,
  );
}

function normalizePlatform(platform: string): 'android' | 'ios' | 'web' {
  return platform === 'ios' || platform === 'android' ? platform : 'web';
}
