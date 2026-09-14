import { bootstrapStorage, hasExistingInstallState } from './platform/bootstrapStorage';
import { EXISTING_FIND_THE_BIRD_STATE_KEYS } from './analytics/installState';
import { configureSessionAds } from './ads/sessionAdPolicy';

// Capture legacy evidence before importing the runtime: GameState persists
// default achievement state as an eager module side effect.
const hadExistingStateAtBootstrap = hasExistingInstallState(EXISTING_FIND_THE_BIRD_STATE_KEYS);
configureSessionAds(hadExistingStateAtBootstrap, bootstrapStorage.durability);

void import('./runtime').then(({ startAnalyticsBootstrap }) =>
  startAnalyticsBootstrap(hadExistingStateAtBootstrap, bootstrapStorage.durability),
).catch((err: unknown): void => {
  console.warn('[bootstrap] runtime initialization failed', err);
});
