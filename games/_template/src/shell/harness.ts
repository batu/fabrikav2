/**
 * Template test-harness stub — the contract shape a real port fills in.
 *
 * This implements the portfolio {@link GameHarness} contract
 * (`@fabrikav2/testkit/harness`) with PLACEHOLDER verbs. A port replaces the
 * placeholders with real engine calls, but keeps the SHAPE — the REQUIRED debug
 * harness (`reference-fidelity-harness.md`): the STATE half (`snapshot()` with
 * scene+status+inputReady) and the ACTION half — the standard core
 * (`gotoState`/`startLevel`/`sagaNodes` + cheats), the typed primitive `verbs`
 * extension point, and the solver-bound goal verbs (`winLevel`/`failLevel`) — plus
 * the optional witnesses (`perf`/`capture`/`drainEvents`). A new game is thus born
 * REQUIRING the harness (a game shipping without it does not pass audit/review).
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
import { driveTo as driveToState } from '../testing/driveTo.ts';

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

  function snapshot(): { scene: string; status: string; inputReady: boolean } {
    // A port returns its real state fingerprint (marble_run: controller state +
    // scene). The contract REQUIRES at least scene+status+inputReady so a driver
    // gates transitions on queryable state (reference-fidelity-harness.md);
    // a port adds hearts/score/board as needed. Placeholder: the first screen,
    // idle status, input open.
    return { scene: states[0] ?? 'HomeMenu', status: 'idle', inputReady: true };
  }

  // ── DETERMINISTIC solver-bound goal verbs (deterministic in-game AI only) ─────
  // These are the ACTION half's terminal tier. They MUST be bound to an in-game
  // DETERMINISTIC AI (A-star/search/solver replaying its solution) — NEVER an llm
  // or Math.random — so a driven run reproduces byte-for-byte. A game WITHOUT a
  // solver ships a SCRIPTED deterministic move list here (the placeholder below).
  // Each resolves true iff the terminal state was reached AND confirmed via
  // snapshot(); false otherwise — an honest "did not reach", never a bare `true`.
  async function winLevel(): Promise<boolean> {
    // TODO(port): drive this game's SOLVER to a win. Replay solver output through
    // the real input path (marble_run: driveAutoWin replays solveLevel().order via
    // controller.tapCell), gating each step on snapshot().status. With no solver,
    // replay a fixed scripted move list seeded from the kernel rng (`rand` above)
    // — deterministic in-game AI only, never llm/random. Confirm arrival:
    //   return snapshot().status === 'won';
    return false;
  }
  async function failLevel(): Promise<boolean> {
    // TODO(port): drive this game's SOLVER (or scripted move list) to a LOSS the
    // same way (marble_run: driveAutoFail taps genuinely-blocked marbles). Confirm:
    //   return snapshot().status === 'lost';
    return false;
  }

  /**
   * Deterministically navigate to a canonical capture state (fidelity-diff
   * ledger C5; `../testing/driveTo.ts`). Wires the pure driver's deps to this
   * game's transitions; `autoWin`/`autoFail` delegate to `winLevel`/`failLevel`
   * above. TODO(port): `gotoMenu`/`openSettings`/`pause` are no-ops here — a
   * port wires each to its real flow-machine transition (marble_run:
   * `App.ts`'s private `driveTo`), which is also what makes the confirm polls
   * in `driveTo.ts` actually resolve `true` instead of an honest timeout.
   */
  function driveTo(state: string): Promise<boolean> {
    return driveToState(
      {
        gotoMenu(): void {
          // TODO(port): drive the flow machine to its menu state.
        },
        startLevel(_id: number): void {
          // TODO(port): start the level (marble_run: startLevelId).
        },
        openSettings(): void {
          // TODO(port): open this game's settings modal.
        },
        pause(): void {
          // TODO(port): pause the flow machine.
        },
        autoWin: () => winLevel(),
        autoFail: () => failLevel(),
        snapshot: () => snapshot(),
      },
      state,
    );
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
    winLevel,
    failLevel,
    driveTo,
    perf(): PerfSample {
      return perf.sample();
    },
    snapshotEnvelope(): SnapshotEnvelope {
      return wrapSnapshot(snapshot(), meta);
    },
  };
}
