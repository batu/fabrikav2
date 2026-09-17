/**
 * Remote Config -> feature config. One place that knows the key names, so the
 * pure modules stay testable with plain objects and the UI never reads keys
 * directly.
 */

import { remoteConfigService } from '../config/RemoteConfigService';
import type { CollectionThresholds } from './thresholds';
import type { BirdId } from './birds';
import type { AccrualConfig } from '../sanctuary/accrual';

export function collectionThresholds(bird: BirdId = 'sparrow'): CollectionThresholds {
  return {
    unlock: remoteConfigService.value(`${bird}UnlockCount`),
    hat: remoteConfigService.value(`${bird}HatCount`),
    cardigan: remoteConfigService.value(`${bird}CardiganCount`),
  };
}

export function collectionUnlockLevel(): number {
  return remoteConfigService.value('collectionUnlockLevel');
}

export function collectionTeaseCount(): number {
  return remoteConfigService.value('sparrowTeaseCount');
}

export function sanctuaryUnlockLevel(): number {
  return remoteConfigService.value('sanctuaryUnlockLevel');
}

export function accrualConfig(): AccrualConfig {
  return {
    coinsPerHourByTier: [
      remoteConfigService.value('sanctuaryCoinsPerHourTier1'),
      remoteConfigService.value('sanctuaryCoinsPerHourTier2'),
      remoteConfigService.value('sanctuaryCoinsPerHourTier3'),
    ],
    capHours: remoteConfigService.value('sanctuaryOfflineCapHours'),
  };
}

/** Coin price to reach `tier`; 0 for an out-of-range tier. */
export function housePrice(tier: number): number {
  if (tier === 1) return remoteConfigService.value('housePriceTier1');
  if (tier === 2) return remoteConfigService.value('housePriceTier2');
  if (tier === 3) return remoteConfigService.value('housePriceTier3');
  return 0;
}

export const MAX_HOUSE_TIER = 3;
