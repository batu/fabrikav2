import { bootstrapStorage, hasExistingInstallState } from './platform/bootstrapStorage';
import { EXISTING_FIND_THE_DOG_STATE_KEYS } from './analytics/installState';

// Capture legacy evidence before importing the runtime: GameState persists
// default achievement state as an eager module side effect.
const hadExistingStateAtBootstrap = hasExistingInstallState(EXISTING_FIND_THE_DOG_STATE_KEYS);

void import('./runtime').then(({ startAnalyticsBootstrap }) =>
  startAnalyticsBootstrap(hadExistingStateAtBootstrap, bootstrapStorage.durability),
).catch((err: unknown): void => {
  console.warn('[bootstrap] runtime initialization failed', err);
});
