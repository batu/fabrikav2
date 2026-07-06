// Fixture: the reference-impl shape (marble_run) — legacy autoWin/autoFail aliases.
import { type GameHarness } from '@fabrikav2/testkit/harness';

export class App {
  harness(): GameHarness<'tapCell'> {
    return {
      gotoState: () => {},
      startLevel: () => {},
      snapshot: () => ({ scene: 'level', status: 'playing', inputReady: true }),
      sagaNodes: () => [],
      unlockAll: () => {},
      grantCoins: () => {},
      verbs: { tapCell: { run: () => {}, clientPoint: () => ({ x: 1, y: 1 }) } },
      // Legacy solver-bound goal verbs — accepted aliases of winLevel/failLevel.
      autoWin: () => Promise.resolve(true),
      autoFail: () => Promise.resolve(true),
    };
  }
}
