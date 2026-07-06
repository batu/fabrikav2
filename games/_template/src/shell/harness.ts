/**
 * Template test-harness stub — the contract shape a real port fills in.
 *
 * This implements the portfolio {@link GameHarness} contract
 * (`@fabrikav2/testkit/harness`) with PLACEHOLDER verbs. A port replaces the
 * placeholders with real engine calls, but keeps the SHAPE: the standard core
 * (`gotoState`/`startLevel`/`snapshot`/`sagaNodes` + cheats), the typed
 * `verbs` extension point, and the optional witnesses (`perf`/`capture`/
 * `drainEvents`).
 *
 * SEEDED-RAND RULE (CONDUCTOR comment (6);
 * `docs/architecture/reference-fidelity-harness.md` forced-change #3): any
 * randomness a game (or its harness) uses MUST route through the kernel seeded
 * generator (`mulberry32`), seeded from a fixed value under test — never
 * `Math.random()`. That is what makes a chaos/e2e run REPRODUCIBLE: the same
 * seed replays the same sequence byte-for-byte. This stub seeds one so the rule
 * is demonstrated at the point a port will copy.
 *
 * STATE SOURCE OF TRUTH (CONDUCTOR comment (5)): `gotoState` targets are derived
 * from `gameConfig.screens` via {@link seedStatesFromConfig} — one declaration
 * of "what states exist", shared with the refs/manifest generator, never
 * re-typed here.
 */
import { mulberry32 } from '@fabrikav2/kernel';
import {
  createPerfRecorder,
  seedStatesFromConfig,
  wrapSnapshot,
  type GameHarness,
  type GameVerbHandler,
  type PerfSample,
  type SnapshotEnvelope,
} from '@fabrikav2/testkit/harness';

import { gameConfig } from '../../game.config.ts';

/** This game's extra verbs. A port lists its input verbs here (the mirror of
 *  the sdk `Analytics<GameEvent>` extension point). */
export type TemplateVerb = 'placeholderTap';

/** Fixed seed so a harness-driven run is reproducible (seeded-rand rule). A port
 *  threads the scenario seed in instead of this constant. */
const HARNESS_SEED = 0x9e3779b9;

export interface TemplateHarness extends GameHarness<TemplateVerb> {
  /** The stamped snapshot envelope (wrong-package guard). Ports keep this. */
  snapshotEnvelope(): SnapshotEnvelope;
}

/**
 * Build the template harness. `buildVersion` / `packageId` are injected by the
 * shell (from the build) so the snapshot envelope carries the identity of the
 * build it came from — the wrong-package guard.
 */
export function createTemplateHarness(meta: { buildVersion: string; packageId: string }): TemplateHarness {
  // Seeded RNG — kernel generator only. A placeholder verb below reads it so a
  // port sees where deterministic randomness plugs in.
  const rand = mulberry32(HARNESS_SEED);
  const perf = createPerfRecorder();

  // gotoState targets, derived from the config (single source of truth).
  const states = seedStatesFromConfig(gameConfig);

  // A placeholder input verb in BOTH flavors: `run` is the state-drive (engine
  // call, for setup); `clientPoint` is the input-drive accessor the generic
  // driveInputAt dispatches a REAL pointer event at. A port writes the accessor,
  // never the input logic.
  const placeholderTap: GameVerbHandler<[number, number]> = {
    run(_x: number, _y: number): 'hit' | 'miss' {
      // A port calls the engine here (marble_run: controller.tapCell). The
      // placeholder draws a DETERMINISTIC outcome from the SEEDED kernel rng
      // (never Math.random) — the seeded-rand rule in action: the same seed
      // replays the same sequence, so a chaos run is reproducible.
      return rand() < 0.5 ? 'miss' : 'hit';
    },
    clientPoint(x: number, y: number) {
      // A port maps grid/world coords → client pixels (marble_run:
      // controller.cellClientPoint). The generic driveInputAt dispatches a REAL
      // pointer event at whatever this returns.
      return { x, y };
    },
  };

  function snapshot(): { scene: string } {
    // A port returns its real state fingerprint (marble_run: controller state +
    // scene). Placeholder: the first declared screen.
    return { scene: states[0] ?? 'HomeMenu' };
  }

  return {
    gotoState(state: string): void {
      // A port drives its flow machine to `state`. Placeholder validates the
      // target is a declared screen so a typo fails loudly under test.
      if (!states.includes(state as (typeof states)[number])) {
        throw new Error(`gotoState: "${state}" is not a declared gameConfig.screens state.`);
      }
    },
    startLevel(_id: number): void {
      // A port starts the level (marble_run: startLevelId).
    },
    snapshot,
    sagaNodes(): readonly number[] {
      return [];
    },
    unlockAll(): void {
      // A port unlocks all levels (marble_run: recordWin over the level range).
    },
    grantCoins(_amount: number): void {
      // A port credits soft currency (marble_run: saveState.addCoins).
    },
    verbs: { placeholderTap },
    perf(): PerfSample {
      return perf.sample();
    },
    snapshotEnvelope(): SnapshotEnvelope {
      return wrapSnapshot(snapshot(), meta);
    },
  };
}
