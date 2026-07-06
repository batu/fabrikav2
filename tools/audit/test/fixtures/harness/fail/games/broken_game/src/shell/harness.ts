// Fixture: a game whose harness has STATE + primitive verbs but NO solver-bound
// goal verb (no winLevel/autoWin, no failLevel/autoFail) — must be flagged.
import { type GameHarness } from '@fabrikav2/testkit/harness';

export function createHarness(): GameHarness<'tap'> {
  return {
    gotoState() {},
    startLevel() {},
    snapshot: () => ({ scene: 'HomeMenu', status: 'idle', inputReady: true }),
    sagaNodes: () => [],
    unlockAll() {},
    grantCoins() {},
    verbs: { tap: { run() {}, clientPoint: () => ({ x: 0, y: 0 }) } },
  };
}
