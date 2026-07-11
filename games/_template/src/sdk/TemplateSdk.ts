import { AUDIO_CHANNELS, Mixer, type AudioChannel } from "@fabrikav2/sdk/audio";
import {
  createAnalytics,
  createRingBufferSink,
  type AnalyticsEvent,
  type RingBufferSink,
} from "@fabrikav2/sdk/analytics";
import { createHaptics, NotificationType } from "@fabrikav2/sdk/haptics";
import { DisabledAdProvider } from "../../../../packages/sdk/src/ads/DisabledAdProvider.ts";
import type { AdProvider } from "../../../../packages/sdk/src/ads/AdProvider.ts";

export type TemplateSettingKey = "music" | "sfx" | "haptics";
export type TemplateAudioSettings = Readonly<Record<AudioChannel, boolean>>;

type TemplateAnalyticsEvent = "template_setting_changed" | "template_pause" | "template_resume";

export interface TemplateSdk {
  readonly adProvider: AdProvider;
  readonly mixer: Mixer;
  syncAudioSettings(settings: TemplateAudioSettings): void;
  levelStarted(levelId: number): void;
  levelCompleted(levelId: number, currency: number, rewardAmount: number): void;
  levelFailed(levelId: number): void;
  settingChanged(key: TemplateSettingKey, enabled: boolean): void;
  paused(): void;
  resumed(): void;
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
 * analytics fan into a bounded in-memory RingBuffer and ads use the shared
 * disabled provider. The direct source import avoids the public ads barrel,
 * which eagerly re-exports optional native adapters the web template does not
 * install. No credentials, device identifiers, or transport setup are part of
 * this starter shell.
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
  const adProvider = new DisabledAdProvider("template shell has no ad placements");

  return {
    adProvider,
    mixer,
    syncAudioSettings,
    levelStarted(levelId: number): void {
      analytics.levelStart({ level_id: String(levelId), level_index: levelId });
    },
    levelCompleted(levelId: number, currency: number, rewardAmount: number): void {
      analytics.levelComplete({ level_id: String(levelId), level_index: levelId });
      if (rewardAmount > 0) {
        analytics.resourceChange({
          currency: "coins",
          amount: rewardAmount,
          flow: "source",
          reason: "template_level_reward",
          balance: currency,
        });
      }
      haptics.notification(NotificationType.Success);
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
    trace(): readonly AnalyticsEvent[] {
      return traceSink.snapshot();
    },
    drainTrace(): AnalyticsEvent[] {
      return traceSink.drain();
    },
  };
}
