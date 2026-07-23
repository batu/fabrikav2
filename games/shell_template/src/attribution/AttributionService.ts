import {
  DisabledAttributionProvider,
  readAdjustIosConfig,
  readAppsFlyerConfig,
  selectAttributionProvider,
  type AttributionEventName,
  type AttributionParams,
  type AttributionProvider,
} from '@fabrikav2/sdk/attribution';

let attributionStartupGate: Promise<void> = Promise.resolve();

export function configureAttributionStartupGate(gate: Promise<void>): void {
  attributionStartupGate = gate.catch((err: unknown): void => {
    console.warn('[attribution] startup gate failed; continuing with attribution fallback', err);
  });
}

export function resetAttributionStartupGateForTest(): void {
  attributionStartupGate = Promise.resolve();
}

export class AttributionService {
  constructor(private provider: AttributionProvider) {}

  /** SdkContext installs the selected provider (AppsFlyer / Adjust / disabled). */
  configureProvider(provider: AttributionProvider): void {
    this.provider = provider;
  }

  get providerName(): string {
    return this.provider.providerName;
  }

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

export const attribution = new AttributionService(
  new DisabledAttributionProvider('attribution not composed yet; SdkContext installs the provider at bootstrap'),
);

export function createShellTemplateAttributionProvider(
  platform: string,
  env: Record<string, string | boolean | undefined>,
  isProductionBuild: boolean,
): AttributionProvider {
  return selectAttributionProvider({
    platform,
    appsFlyerConfig: readAppsFlyerConfig(platform, env, isProductionBuild),
    adjustConfig: readAdjustIosConfig(env, isProductionBuild),
  });
}
