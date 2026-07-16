import { remoteConfigService } from '../config/RemoteConfigService';
import type { RemoteConfigValues } from '../config/remoteConfigSchema';

export type HintBoosterOptionKind = 'useHint' | 'rewardedAd' | 'coinBundle' | 'coinSingle' | 'shopTopUp';
export type HintBoosterOptionStatus = 'available' | 'insufficientCoins' | 'disabled';

export interface HintBoosterContext {
  hints: number;
  coins: number;
  adsEnabled: boolean;
  hasNoAdsEntitlement: boolean;
  rewardedAdAvailable: boolean;
}

export interface HintBoosterOption {
  kind: HintBoosterOptionKind;
  status: HintBoosterOptionStatus;
  hintAmount: number;
  coinPrice: number;
  reason: string;
}

export interface HintBoosterOfferSet {
  mode: 'spend-existing-hint' | 'choose-acquisition' | 'no-option';
  options: HintBoosterOption[];
}

interface ConfigReader {
  value<TKey extends keyof RemoteConfigValues>(key: TKey): RemoteConfigValues[TKey];
}

export function buildHintBoosterOffers(
  context: HintBoosterContext,
  reader: ConfigReader = remoteConfigService,
): HintBoosterOfferSet {
  if (context.hints > 0) {
    return {
      mode: 'spend-existing-hint',
      options: [{
        kind: 'useHint',
        status: 'available',
        hintAmount: 1,
        coinPrice: 0,
        reason: 'Player has wallet-backed hints available.',
      }],
    };
  }

  const options: HintBoosterOption[] = [];
  if (reader.value('hintRwEnabled') && context.adsEnabled && !context.hasNoAdsEntitlement) {
    options.push({
      kind: 'rewardedAd',
      status: context.rewardedAdAvailable ? 'available' : 'disabled',
      hintAmount: 1,
      coinPrice: 0,
      reason: context.rewardedAdAvailable ? 'Rewarded ad can grant one hint.' : 'Rewarded ad is enabled but unavailable.',
    });
  }

  const bundlePrice = reader.value('hintBoosterBundleCoinPrice');
  const bundleHints = reader.value('hintBoosterBundleHintAmount');
  options.push({
    kind: 'coinBundle',
    status: context.coins >= bundlePrice ? 'available' : 'insufficientCoins',
    hintAmount: bundleHints,
    coinPrice: bundlePrice,
    reason: context.coins >= bundlePrice ? 'Required 3-hint coin bundle is affordable.' : 'Not enough coins for the required hint bundle.',
  });

  const singlePrice = reader.value('hintBoosterSingleCoinPrice');
  options.push({
    kind: 'coinSingle',
    status: context.coins >= singlePrice ? 'available' : 'insufficientCoins',
    hintAmount: 1,
    coinPrice: singlePrice,
    reason: context.coins >= singlePrice ? 'Single-hint coin option is affordable.' : 'Not enough coins for a single hint.',
  });

  if (options.every((option) => option.status !== 'available')) {
    options.push({
      kind: 'shopTopUp',
      status: 'available',
      hintAmount: 0,
      coinPrice: 0,
      reason: 'Route to shop/top-up when no hint acquisition option is usable.',
    });
  }

  return {
    mode: options.some((option) => option.status === 'available') ? 'choose-acquisition' : 'no-option',
    options,
  };
}
