import {
  mountSdkVerifierPane,
  removeSdkVerifierPane,
  type SdkVerifierEntry,
  type SdkVerifierPane,
} from '@fabrikav2/testkit/debug';
import { redactAppLovinSdkKey } from './redact';
import { analytics } from '../analytics/AnalyticsService';
import { attribution } from '../attribution/AttributionService';
import type { GameSdkContext } from '../sdk/SdkContext';

let mounted: SdkVerifierPane | null = null;

/** Dev-gated toggle wired to bootstrap's reserved 4-tap gesture. */
export function toggleSdkVerifierPane(context: GameSdkContext, doc: Document = document): boolean {
  if (mounted !== null) {
    mounted.remove();
    mounted = null;
    removeSdkVerifierPane(doc);
    return false;
  }
  mounted = mountSdkVerifierPane({ document: doc, entries: buildEntries(context) });
  return true;
}

export function buildEntries(context: GameSdkContext): SdkVerifierEntry[] {
  const { ads, meta, attributionProvider, configuredIds, extraSinks, selection } = context;

  const appLovinIds: Record<string, string | null> = configuredIds.appLovin.enabled
    ? {
        sdkKey: redactAppLovinSdkKey(configuredIds.appLovin.config.sdkKey),
        banner: emptyAsNull(configuredIds.appLovin.config.adUnitIds.banner),
        interstitial: emptyAsNull(configuredIds.appLovin.config.adUnitIds.interstitial),
        rewarded: emptyAsNull(configuredIds.appLovin.config.adUnitIds.rewarded),
      }
    : { reason: configuredIds.appLovin.reason };

  return [
    {
      name: `ads (${selection.ads})`,
      configuredIds: appLovinIds,
      getStatus: (): string => `provider: ${ads.providerName}`,
      actions: [
        { label: 'Init ads', run: async (): Promise<string> => { await ads.init(); return 'init resolved'; } },
        { label: 'Load interstitial', run: async (): Promise<string> => { await ads.preloadInterstitial(); return 'preload resolved'; } },
        { label: 'Show interstitial', run: async (): Promise<string> => `shown=${await ads.maybeShowInterstitial({ minIntervalMs: 0 })}` },
        { label: 'Load rewarded', run: async (): Promise<string> => { await ads.preloadRewarded(); return 'preload resolved'; } },
        { label: 'Show rewarded', run: async (): Promise<string> => `granted=${(await ads.showRewardedAd()).granted}` },
      ],
    },
    {
      name: `attribution (${selection.attribution})`,
      configuredIds: { appleAppId: configuredIds.appsFlyerAppleAppId },
      getStatus: (): string => `provider: ${attributionProvider.providerName}`,
      actions: [
        { label: 'Init attribution', run: async (): Promise<string> => { await attribution.init(); return 'init resolved'; } },
        { label: 'Send appOpen', run: async (): Promise<string> => { await attribution.appOpen(); return 'sent'; } },
        {
          label: 'Send levelComplete',
          run: async (): Promise<string> => {
            await attribution.levelComplete({ level_id: 'sdk_verifier', time_seconds: 1, hints_used: 0, wrong_taps: 0 });
            return 'sent';
          },
        },
      ],
    },
    {
      name: 'firebase analytics',
      configuredIds: { configPresent: String(configuredIds.firebasePresent), sinks: extraSinks.map((s) => s.name).join(',') || null },
      getStatus: (): string => (configuredIds.firebasePresent ? `sink attached (${selection.analyticsSinks.join(', ')})` : 'not configured: firebase env absent'),
      actions: [
        {
          label: 'Fire test event',
          run: async (): Promise<string> => {
            await analytics.settingsChanged({ setting_name: 'sdk_verifier_ping', new_value: new Date().toISOString() });
            return 'settings_changed dispatched';
          },
        },
      ],
    },
    {
      name: `facebook (${selection.meta})`,
      configuredIds: configuredIds.meta.enabled
        ? { appId: configuredIds.meta.config.appId }
        : { reason: configuredIds.meta.reason },
      getStatus: (): string => describeMetaStatus(meta.getStatus()),
      actions: [
        { label: 'Init FB', run: async (): Promise<string> => { await meta.init(); return describeMetaStatus(meta.getStatus()); } },
        { label: 'Send FB event', run: async (): Promise<string> => { await meta.logEvent('sdk_verifier_ping'); return 'logEvent dispatched'; } },
      ],
    },
  ];
}

function describeMetaStatus(status: ReturnType<GameSdkContext['meta']['getStatus']>): string {
  switch (status.state) {
    case 'not-configured':
      return `not configured: ${status.reason}`;
    case 'error':
      return `error: ${status.reason}`;
    default:
      return status.state;
  }
}

function emptyAsNull(value: string): string | null {
  return value === '' ? null : value;
}
