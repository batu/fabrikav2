import { Capacitor } from '@capacitor/core';
import type { FirstOpenStorageDurability } from '@fabrikav2/sdk/analytics';
import { getSdkContext } from '../sdk/SdkContext';
import { remoteConfigService } from '../config/RemoteConfigService';
import { gameState } from '../core/GameState';
import { createCohortResolver } from '../v1core/assets';
import { revealPickupExperiment } from './revealPickupExperiment';
import { withTimeout } from '../utils/withTimeout';

const REMOTE_CONFIG_STARTUP_TIMEOUT_MS = 5000;

/** Awaited before importing runtime.ts, which constructs Phaser and starts providers. */
export async function initializeGameplayExperiment(
  hadExistingState: boolean,
  durability: FirstOpenStorageDurability,
): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return;
  getSdkContext();
  let configReady = false;
  try {
    // Bound support checks and provider initialization too, not only network fetch.
    await withTimeout(remoteConfigService.initAndWait(), REMOTE_CONFIG_STARTUP_TIMEOUT_MS, 'Gameplay remote config');
    configReady = true;
  } catch {
    // Startup failure/timeout may restore durable participation, never enroll.
  }
  // Read the currently validated config once. Late RC completion may refresh the
  // cache, but has no continuation that can change this launch's assignment.
  await revealPickupExperiment.initialize({
    enabled: configReady && remoteConfigService.value('revealPickupExperimentEnabled'),
    killed: remoteConfigService.value('revealPickupExperimentKilled'),
    platform: Capacitor.getPlatform(), durable: durability === 'durable', hadExistingState,
    // Use the throwing storage here, not bootstrapStorage's tolerant null facade.
    storage: window.localStorage,
    resolver: createCohortResolver({ numBuckets: 100 }),
    initializeHints: () => gameState.initializeExperimentHints(),
  });
}
