import type { HarnessContract } from '@fabrikav2/testkit/harness';

export const harness: HarnessContract = {
  snapshot: () => ({ scene: 'menu', status: 'idle', inputReady: true }),
  verbs: {},
  winLevel: () => undefined,
  failLevel: () => undefined,
};
