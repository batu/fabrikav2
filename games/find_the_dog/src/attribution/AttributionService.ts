import { Capacitor } from '@capacitor/core';
import { AdjustAttributionProvider } from './AdjustAttributionProvider';
import { readAdjustIosConfig, type AdjustConfigResult } from './AdjustConfig';
import type { AttributionEventName, AttributionParams, AttributionProvider } from './AttributionProvider';
import { DisabledAttributionProvider } from './DisabledAttributionProvider';

export interface AttributionProviderFactories {
  createAdjustProvider: (config: Extract<AdjustConfigResult, { enabled: true }>['config']) => AttributionProvider;
  createDisabledProvider: (reason: string) => AttributionProvider;
}

const defaultAttributionProviderFactories: AttributionProviderFactories = {
  createAdjustProvider: (config): AttributionProvider => new AdjustAttributionProvider(config),
  createDisabledProvider: (reason: string): AttributionProvider => new DisabledAttributionProvider(reason),
};

let attributionStartupGate: Promise<void> = Promise.resolve();

export function configureAttributionStartupGate(gate: Promise<void>): void {
  attributionStartupGate = gate.catch((err: unknown): void => {
    console.warn('[attribution] startup gate failed; continuing with attribution fallback', err);
  });
}

export function resetAttributionStartupGateForTest(): void {
  attributionStartupGate = Promise.resolve();
}

export function createFindTheDogAttributionProvider(
  platform: string = Capacitor.getPlatform(),
  adjustConfig: AdjustConfigResult = readAdjustIosConfig(),
  factories: AttributionProviderFactories = defaultAttributionProviderFactories,
): AttributionProvider {
  if (platform !== 'ios') {
    return factories.createDisabledProvider(`Adjust disabled on ${platform || 'web'} platform`);
  }

  if (!adjustConfig.enabled) {
    return factories.createDisabledProvider(`iOS Adjust unavailable: ${adjustConfig.reason}`);
  }

  return factories.createAdjustProvider(adjustConfig.config);
}

export class AttributionService {
  constructor(private readonly provider: AttributionProvider = createFindTheDogAttributionProvider()) {}

  async init(): Promise<void> {
    await attributionStartupGate;
    return this.provider.init();
  }

  appOpen(cohortBucket: number | null = null): Promise<void> {
    const params: AttributionParams = {};
    if (cohortBucket !== null) {
      params.cohort_bucket = cohortBucket;
    }
    return this.trackAfterStartupGate('appOpen', params);
  }

  levelStart(params: { level_id: string; level_name: string }): Promise<void> {
    return this.trackAfterStartupGate('levelStart', params);
  }

  levelComplete(params: {
    level_id: string;
    time_seconds: number;
    hints_used: number;
    wrong_taps: number;
  }): Promise<void> {
    return this.trackAfterStartupGate('levelComplete', params);
  }

  levelFailed(params: { level_id: string; dogs_found: number }): Promise<void> {
    return this.trackAfterStartupGate('levelFailed', params);
  }

  rewardedWatched(params: { placement: string }): Promise<void> {
    return this.trackAfterStartupGate('rewardedWatched', params);
  }

  private async trackAfterStartupGate(eventName: AttributionEventName, params: AttributionParams): Promise<void> {
    await attributionStartupGate;
    return this.provider.track(eventName, params);
  }
}

export const attribution = new AttributionService();
