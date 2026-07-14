import { AUDIO_CHANNELS, Mixer, type AudioChannel } from "@fabrikav2/sdk/audio";
import {
  createAnalytics,
  createRingBufferSink,
  type AnalyticsEvent,
  type RingBufferSink,
} from "@fabrikav2/sdk/analytics";
import { createHaptics, NotificationType } from "@fabrikav2/sdk/haptics";
import { FakePurchaseProvider, IapService } from "@fabrikav2/sdk/iap";
import type { AdProvider, RewardedAdResult } from "../../../../packages/sdk/src/ads/AdProvider.ts";
import {
  fakeStoreProductsFromProofCatalog,
  proofCatalogProducts,
  proofPurchaseResults,
  proofRestoreCustomerInfo,
  type ProofShopPayload,
} from "./proofShopCatalog.ts";

export type TemplateSettingKey = "music" | "sfx" | "haptics";
export type TemplateAudioSettings = Readonly<Record<AudioChannel, boolean>>;

type TemplateAnalyticsEvent = "template_setting_changed" | "template_pause" | "template_resume";

/**
 * Deterministic proof rewarded-ad seam: it grants iff `available`, so the win
 * CLAIM 2x path is exercisable both ways (granted and "ad unavailable / try
 * later") without a real ad SDK. Every method swallows errors and resolves to a
 * safe value — an ad failure must never block gameplay, matching AdProvider.
 */
export class ProofRewardedAdProvider implements AdProvider {
  readonly providerName = "proof-rewarded";
  available = true;

  async init(): Promise<void> {}
  async preloadInterstitial(): Promise<void> {}
  async maybeShowInterstitial(): Promise<boolean> {
    return false;
  }
  async showBanner(): Promise<boolean> {
    return false;
  }
  async hideBanner(): Promise<void> {}
  async preloadRewarded(): Promise<void> {}
  async showRewardedAd(): Promise<RewardedAdResult> {
    return { granted: this.available };
  }
}

export interface TemplateSdk {
  readonly adProvider: AdProvider;
  readonly iap: IapService<ProofShopPayload>;
  readonly mixer: Mixer;
  syncAudioSettings(settings: TemplateAudioSettings): void;
  levelStarted(levelId: number): void;
  levelCompleted(levelId: number): void;
  /** The win-claim grant seam: emitted when a claim path actually pays out. */
  rewardClaimed(amount: number, balance: number, doubled: boolean): void;
  /** The fail-rescue coin-continue seam: emitted when coins are spent to resume. */
  continueUsed(cost: number, balance: number): void;
  levelFailed(levelId: number): void;
  settingChanged(key: TemplateSettingKey, enabled: boolean): void;
  paused(): void;
  resumed(): void;
  isRewardedAdAvailable(): boolean;
  setRewardedAdAvailable(available: boolean): void;
  trace(): readonly AnalyticsEvent[];
  drainTrace(): AnalyticsEvent[];
}

export interface CreateTemplateSdkOptions {
  readonly audioSettings: TemplateAudioSettings;
  readonly isHapticsEnabled: () => boolean;
  readonly now?: () => number;
}

/**
 * The template's real SDK composition, deliberately kept deterministic:
 * analytics fan into a bounded in-memory RingBuffer, a deterministic proof
 * rewarded-ad provider backs the win CLAIM 2x seam, and the real IapService over
 * the seeded fake provider backs the shop restore and the fail-rescue bundle.
 * No credentials, device identifiers, or transport setup are part of this
 * starter shell, and no purchase is ever fulfilled.
 */
export function createTemplateSdk(options: CreateTemplateSdkOptions): TemplateSdk {
  const traceSink: RingBufferSink = createRingBufferSink();
  const analytics = createAnalytics<TemplateAnalyticsEvent>({
    env: "test",
    sessionId: "template-shell",
    sinks: [traceSink],
    now: options.now ?? (() => 0),
  });
  const mixer = new Mixer();
  const syncAudioSettings = (settings: TemplateAudioSettings): void => {
    for (const channel of AUDIO_CHANNELS) {
      mixer.setMuted(channel, !settings[channel]);
    }
  };
  syncAudioSettings(options.audioSettings);
  const haptics = createHaptics({ isEnabled: options.isHapticsEnabled });
  const adProvider = new ProofRewardedAdProvider();
  // Real IapService over the seeded fake provider: deterministic `ready`
  // snapshots, live-looking prices, a restore that recovers exactly the owned
  // sample entitlement, and a priced rescue bundle. No fulfillment — nothing is
  // granted on purchase.
  const fakePurchaseProvider = new FakePurchaseProvider({
    products: fakeStoreProductsFromProofCatalog(),
    purchaseResults: proofPurchaseResults(),
    restoreCustomerInfo: proofRestoreCustomerInfo(),
  });
  const iap = new IapService<ProofShopPayload>({
    isNativePlatform: () => true,
    platform: () => "android",
    apiKey: () => "test_shell_proof_sandbox",
    catalogProducts: () => proofCatalogProducts,
    provider: () => fakePurchaseProvider,
    operationTimeoutMs: () => 15_000,
  });
  // Eager, idempotent: the seeded fake provider resolves on the microtask
  // queue, so the shop snapshot is `ready` before any user can reach it.
  void iap.init();

  return {
    adProvider,
    iap,
    mixer,
    syncAudioSettings,
    levelStarted(levelId: number): void {
      analytics.levelStart({ level_id: String(levelId), level_index: levelId });
    },
    levelCompleted(levelId: number): void {
      analytics.levelComplete({ level_id: String(levelId), level_index: levelId });
      haptics.notification(NotificationType.Success);
    },
    rewardClaimed(amount: number, balance: number, doubled: boolean): void {
      analytics.resourceChange({
        currency: "coins",
        amount,
        flow: "source",
        reason: doubled ? "template_reward_double" : "template_level_reward",
        balance,
      });
      haptics.impact();
    },
    continueUsed(cost: number, balance: number): void {
      analytics.resourceChange({
        currency: "coins",
        amount: cost,
        flow: "sink",
        reason: "template_level_continue",
        balance,
      });
      haptics.impact();
    },
    levelFailed(levelId: number): void {
      analytics.levelFail({ level_id: String(levelId), level_index: levelId });
      haptics.notification(NotificationType.Error);
    },
    settingChanged(key: TemplateSettingKey, enabled: boolean): void {
      if (key === "music" || key === "sfx") mixer.setMuted(key, !enabled);
      analytics.track("template_setting_changed", { setting: key, enabled });
      haptics.impact();
    },
    paused(): void {
      analytics.track("template_pause");
    },
    resumed(): void {
      analytics.track("template_resume");
    },
    isRewardedAdAvailable(): boolean {
      return adProvider.available;
    },
    setRewardedAdAvailable(available: boolean): void {
      adProvider.available = available;
    },
    trace(): readonly AnalyticsEvent[] {
      return traceSink.snapshot();
    },
    drainTrace(): AnalyticsEvent[] {
      return traceSink.drain();
    },
  };
}
