/**
 * Deterministic per-state navigation for capture (fidelity-diff ledger C5).
 *
 * Templatized from `games/marble_run/src/testing/driveTo.ts` (card vFSI5FwY):
 * `driveTo(state)` makes capture-every-state ONE call — it normalises to the
 * menu, drives forward to the requested state, and — the whole point —
 * CONFIRMS arrival by polling `snapshot()` before resolving, so a caller never
 * screenshots a state the game has not actually reached (the "did I actually
 * win?" failure the harness thesis fixes).
 *
 * This module is GAME-AGNOSTIC: it composes over the small {@link DriveToDeps}
 * interface only, never a concrete engine. `../shell/harness.ts` wires the
 * deps to this game's real transitions; this file itself stays pure. Confirmed by
 * `tests/unit/drive-to.test.ts` against a fake deps object.
 */

/** The canonical states `driveTo` can navigate to (shared device-capture
 *  vocabulary — `tools/refcap-compare/src/manifest.mjs` `CANONICAL_STATES`). */
export type DriveState = 'menu' | 'level' | 'win' | 'fail' | 'settings' | 'pause';

const DRIVE_STATES: readonly DriveState[] = [
  'menu',
  'level',
  'win',
  'fail',
  'settings',
  'pause',
];

/**
 * The transitions `driveTo` composes. A port wires each to its real engine
 * call (marble_run: `gotoMenu`→`toMenu`, `startLevel`→`startLevelId`,
 * `openSettings`→`openSettings(false)`, `pause`→`pauseGame`); `autoWin`/
 * `autoFail` delegate to the harness's solver-bound `winLevel`/`failLevel`;
 * `snapshot` is the state-query the confirms gate on.
 */
export interface DriveToDeps {
  gotoMenu(): void;
  startLevel(id: number): void;
  openSettings(): void;
  pause(): void;
  autoWin(): Promise<boolean>;
  autoFail(): Promise<boolean>;
  snapshot(): Record<string, unknown>;
}

export interface DriveToOptions {
  /** Poll cadence for state confirmation (ms). Test override → 0 for instant. */
  readonly pollMs?: number;
  /** Max confirmation polls before giving up. */
  readonly maxPolls?: number;
  /** Injectable sleep — the headless test passes a no-op to avoid real timers. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `snapshot()` until `predicate` holds or the poll budget is exhausted. */
async function confirm(
  deps: DriveToDeps,
  predicate: (snap: Record<string, unknown>) => boolean,
  pollMs: number,
  maxPolls: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let i = 0; i < maxPolls; i += 1) {
    if (predicate(deps.snapshot())) return true;
    if (pollMs > 0) await sleep(pollMs);
  }
  return predicate(deps.snapshot());
}

const sceneIs = (want: string) => (snap: Record<string, unknown>): boolean =>
  snap.scene === want;

const playingReady = (snap: Record<string, unknown>): boolean =>
  snap.scene === 'playing' && snap.inputReady === true;

export function isDriveState(state: string): state is DriveState {
  return (DRIVE_STATES as readonly string[]).includes(state);
}

/**
 * Deterministically navigate to `state` and CONFIRM arrival via `snapshot()`.
 * Always normalises to the menu first so the drive is robust from any prior
 * state (a `complete`/`failed` board can't `start` directly). Resolves true iff
 * the target state was reached and confirmed; false on an unknown state, an
 * unsolvable win/fail, or a confirmation timeout — an honest "did not reach",
 * never an unverified success.
 *
 * The predicates use the shared kernel FlowStates names surfaced by App.snapshot().
 */
export async function driveTo(
  deps: DriveToDeps,
  state: string,
  opts: DriveToOptions = {},
): Promise<boolean> {
  if (!isDriveState(state)) return false;

  const pollMs = opts.pollMs ?? 50;
  const maxPolls = opts.maxPolls ?? 60;
  const sleep = opts.sleep ?? defaultSleep;
  const settle = (
    predicate: (snap: Record<string, unknown>) => boolean,
  ): Promise<boolean> => confirm(deps, predicate, pollMs, maxPolls, sleep);

  // Normalise: every drive starts from a confirmed menu.
  deps.gotoMenu();
  const atMenu = await settle(sceneIs('menu'));

  switch (state) {
    case 'menu':
      return atMenu;

    case 'settings':
      deps.openSettings();
      return settle((snap) => snap.settingsOpen === true);

    case 'level':
      deps.startLevel(1);
      return settle(sceneIs('playing'));

    case 'win': {
      deps.startLevel(1);
      if (!(await settle(playingReady))) return false;
      await deps.autoWin();
      return settle(sceneIs('complete'));
    }

    case 'fail': {
      deps.startLevel(1);
      if (!(await settle(playingReady))) return false;
      await deps.autoFail();
      return settle(sceneIs('failed'));
    }

    case 'pause': {
      deps.startLevel(1);
      if (!(await settle(playingReady))) return false;
      deps.pause();
      return settle(sceneIs('paused'));
    }
  }
}
