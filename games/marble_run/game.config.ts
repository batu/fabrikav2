/**
 * Marble Run game manifest. Declares which @fabrikav2/ui screens the shell
 * mounts, the saga size, the economy currency, ad placements, product catalog,
 * and analytics events. The shell reads this; gameplay never touches it. Shape
 * conforms to the kernel `GameConfig` contract and the design-sheets
 * `fabrikav2-game` fixture byte-format (id / title / screens drive the ingester
 * page cards).
 */
import type { GameConfig } from '@fabrikav2/kernel';

export const gameConfig = {
  id: 'marble_run',
  title: 'Marble Run',
  screens: ['HomeMenu', 'SagaMap', 'Settings', 'ResultCard', 'PauseOverlay', 'Toast', 'ConnectivityIndicator'],
  saga: { levels: 20 },
  economy: { softCurrency: 'coins' },
  // Rewarded (hint + fail-save) + level-cadence interstitial. Placement strings
  // match the analytics `placement` param emitted by the SDK wiring.
  adPlacements: ['rewarded_fail_save', 'rewarded_hint', 'interstitial_level'],
  // Catalog product `id`s (see src/sdk/catalog.ts): a no-ads entitlement + coin packs.
  productCatalog: ['no_ads', 'coins_small', 'coins_medium', 'coins_large'],
  // Canonical event set the SDK wiring emits (level / economy / ad / purchase / session).
  analyticsEvents: [
    'session_start',
    'session_end',
    'level_start',
    'level_complete',
    'level_fail',
    'resource_change',
    'ad_request',
    'ad_impression',
    'ad_reward',
    'purchase',
  ],
} as const satisfies GameConfig;
