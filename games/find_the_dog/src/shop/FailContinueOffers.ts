import { remoteConfigService } from '../config/RemoteConfigService';
import type { RemoteConfigValues } from '../config/remoteConfigSchema';

export type FailContinueOptionKind = 'coinContinue' | 'egoOffer' | 'retry';
export type FailContinueOptionStatus = 'available' | 'insufficientCoins' | 'disabled';

export interface FailContinueContext {
  coins: number;
  egoOfferPurchaseAvailable: boolean;
}

export interface FailContinueOption {
  kind: FailContinueOptionKind;
  status: FailContinueOptionStatus;
  coinPrice: number;
  coinAmount: number;
  productId: string | null;
  hintAmount: number;
  reason: string;
}

export interface FailContinueOfferSet {
  options: FailContinueOption[];
}

interface ConfigReader {
  value<TKey extends keyof RemoteConfigValues>(key: TKey): RemoteConfigValues[TKey];
}

export function buildFailContinueOffers(
  context: FailContinueContext,
  reader: ConfigReader = remoteConfigService,
): FailContinueOfferSet {
  const continuePrice = reader.value('levelContinueCoinPrice');
  const options: FailContinueOption[] = [
    {
      kind: 'coinContinue',
      status: context.coins >= continuePrice ? 'available' : 'insufficientCoins',
      coinPrice: continuePrice,
      coinAmount: 0,
      productId: null,
      hintAmount: 0,
      reason: context.coins >= continuePrice ? 'Player can continue with coins.' : 'Not enough coins for level continue.',
    },
  ];

  if (reader.value('egoOfferEnabled')) {
    options.push({
      kind: 'egoOffer',
      status: context.egoOfferPurchaseAvailable ? 'available' : 'disabled',
      coinPrice: 0,
      coinAmount: reader.value('egoOfferCoinAmount'),
      productId: reader.value('egoOfferProductId'),
      hintAmount: reader.value('egoOfferHintAmount'),
      reason: context.egoOfferPurchaseAvailable
        ? 'IAP ego offer can continue and grant hints plus coins.'
        : 'IAP ego offer store metadata is unavailable; ego offer cannot be purchased.',
    });
  }

  options.push({
    kind: 'retry',
    status: 'available',
    coinPrice: 0,
    coinAmount: 0,
    productId: null,
    hintAmount: 0,
    reason: 'Retry is always available and restarts the attempt.',
  });

  return { options };
}
