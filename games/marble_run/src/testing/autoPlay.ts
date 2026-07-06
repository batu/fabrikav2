/**
 * Deterministic solver-bound auto-play drivers (Batu, 2026-07-06).
 *
 * Gameplay-to-terminal-state is bound to the in-game deterministic solver, never
 * to random rolls or an LLM policy: winning replays the A-star search solver's
 * exact winning tap order; losing taps genuinely-blocked marbles (allMarbles
 * minus movableMarbles) until hearts deplete. Both gate every step on a live
 * gameStatus() query so they never assume a state they have not confirmed.
 *
 * These are extracted from the harness (App.harness().autoWin/autoFail) so the
 * driver can be unit-tested headlessly against a BoardEngine — the harness layer
 * itself needs WebGL/DOM (Stage, canvas) and cannot run in vitest. The harness
 * delegates here, passing controller.tapCell as `tap` so on-device play still
 * goes through the real input path; tests pass engine.tap directly.
 */
import type { BoardEngine } from '../engine/board';
import type { Cell, LevelDef } from '../engine/types';
import { solveLevel } from '../puzzle/marble-board/solver';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Replay the solver's winning tap order for `level` against `engine`, tapping via
 * `tap`. Stops early if the board leaves 'playing'. Resolves true iff won.
 */
export async function driveAutoWin(
  engine: BoardEngine,
  level: LevelDef,
  tap: (cell: Cell) => void,
  stepMs = 260,
): Promise<boolean> {
  const plan = solveLevel(level);
  if (!plan.solvable) return false;
  for (const cell of plan.order) {
    if (engine.gameStatus() !== 'playing') break;
    tap(cell);
    if (stepMs > 0) await sleep(stepMs);
  }
  return engine.gameStatus() === 'won';
}

/**
 * Tap genuinely-blocked marbles (allMarbles minus movableMarbles) via `tap`,
 * burning a heart each time, until the board fails or no blocked marble remains.
 * Resolves true iff failed.
 */
export async function driveAutoFail(
  engine: BoardEngine,
  tap: (cell: Cell) => void,
  stepMs = 260,
): Promise<boolean> {
  for (let i = 0; i < 100; i += 1) {
    if (engine.gameStatus() !== 'playing') break;
    const movableIds = new Set(engine.movableMarbles().map((m) => m.id));
    const blocked = engine.allMarbles().find((m) => !movableIds.has(m.id));
    if (!blocked) break; // no blocked marble to burn a heart on
    tap(blocked.cell);
    if (stepMs > 0) await sleep(stepMs);
  }
  return engine.gameStatus() === 'failed';
}
