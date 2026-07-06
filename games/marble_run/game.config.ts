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
  adPlacements: ['rewarded_fail_save'],
  productCatalog: [],
  analyticsEvents: ['level_start', 'level_complete', 'level_fail'],
} as const satisfies GameConfig;
