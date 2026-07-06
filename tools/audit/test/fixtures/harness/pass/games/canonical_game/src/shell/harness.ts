// Fixture: a new game scaffolded from the template — canonical harness surface.
import { type GameHarness } from '@fabrikav2/testkit/harness';

export function createHarness(): GameHarness<'tap'> {
  function snapshot() {
    return { scene: 'HomeMenu', status: 'idle', inputReady: true };
  }
  return {
    gotoState() {},
    startLevel() {},
    snapshot,
    sagaNodes: () => [],
    unlockAll() {},
    grantCoins() {},
    verbs: { tap: { run() {}, clientPoint: () => ({ x: 0, y: 0 }) } },
    async winLevel() {
      return snapshot().status === 'won';
    },
    async failLevel() {
      return snapshot().status === 'lost';
    },
  };
}
