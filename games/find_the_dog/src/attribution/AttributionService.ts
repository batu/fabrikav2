import {
  AttributionService as SdkAttributionService,
  createAttributionProvider,
  type AttributionServiceOptions,
} from '@fabrikav2/sdk/attribution';
import { Capacitor } from '@capacitor/core';
import { readAdjustIosConfig, type AdjustConfigResult } from './AdjustConfig';
import type { AttributionParams, AttributionProvider } from './AttributionProvider';

export interface AttributionProviderFactories {
  createAdjustProvider: (config: Extract<AdjustConfigResult, { enabled: true }>['config']) => AttributionProvider;
  createDisabledProvider: (reason: string) => AttributionProvider;
}

export function createFindTheDogAttributionProvider(
  platform: string = Capacitor.getPlatform(),
  adjustConfig: AdjustConfigResult = readAdjustIosConfig(),
  factories?: AttributionProviderFactories,
): AttributionProvider {
  return createAttributionProvider(platform, adjustConfig, factories) as AttributionProvider;
}

/** Compatibility delegate retaining FTD's public vocabulary while the package
 * service owns startup-gate timeout and event dispatch. */
export class AttributionService {
  private delegate: SdkAttributionService;

  constructor(
    provider: AttributionProvider = createFindTheDogAttributionProvider(),
    options: AttributionServiceOptions = {},
  ) {
    this.delegate = new SdkAttributionService(provider, options);
  }

  install(service: SdkAttributionService): void {
    this.delegate = service;
  }

  configureStartupGate(gate: Promise<void>): void {
    this.delegate.configureStartupGate(gate);
  }

  init(): Promise<void> {
    return this.delegate.init();
  }

  appOpen(cohortBucket: number | null = null): Promise<void> {
    const params: AttributionParams = cohortBucket === null ? {} : { cohort_bucket: cohortBucket };
    return this.delegate.appOpen(params);
  }

  levelStart(params: { level_id: string; level_name: string }): Promise<void> {
    return this.delegate.levelStart(params);
  }

  levelComplete(params: {
    level_id: string;
    time_seconds: number;
    hints_used: number;
    wrong_taps: number;
  }): Promise<void> {
    return this.delegate.levelComplete(params);
  }

  levelFailed(params: { level_id: string; dogs_found: number }): Promise<void> {
    return this.delegate.levelFailed(params);
  }

  rewardedWatched(params: { placement: string }): Promise<void> {
    return this.delegate.rewardedWatched(params);
  }
}

export const attribution = new AttributionService();

export function configureAttributionService(service: SdkAttributionService): void {
  attribution.install(service);
}

export function configureAttributionStartupGate(gate: Promise<void>): void {
  attribution.configureStartupGate(gate);
}

export function resetAttributionStartupGateForTest(): void {
  attribution.configureStartupGate(Promise.resolve());
}
