import { describe, expect, it } from 'vitest';
import { BoardEngine } from '../../src/engine/board';
import { LEVELS } from '../../src/levels/levels.generated';
import { driveAutoWin, driveAutoFail } from '../../src/testing/autoPlay';

/**
 * The real acceptance for the solver-bound harness (Batu, 2026-07-06): the
 * drivers behind App.harness().autoWin / autoFail must reach terminal states
 * DETERMINISTICALLY — bound to the in-game solver and to genuinely-blocked
 * marbles, never to random rolls or an LLM policy.
 *
 * The harness layer itself needs WebGL/DOM (Stage, canvas) and can't run in
 * vitest, so we exercise the extracted drivers (src/testing/autoPlay) against a
 * headless BoardEngine, tapping via engine.tap — the same terminal-state logic
 * the harness wraps. stepMs=0 keeps the run instant and free of timers.
 */
describe('driveAutoWin — solver-bound win', () => {
  it('startLevel(1) → replays solveLevel().order → engine status is "won"', async () => {
    const level = LEVELS[0]!;
    const engine = new BoardEngine(level);
    expect(engine.gameStatus()).toBe('playing');

    const won = await driveAutoWin(engine, level, (cell) => void engine.tap(cell), 0);

    expect(won).toBe(true);
    expect(engine.gameStatus()).toBe('won');
    expect(engine.remainingCount()).toBe(0);
  });

  it('is deterministic — two independent runs reach the identical won state', async () => {
    const level = LEVELS[0]!;
    const a = new BoardEngine(level);
    const b = new BoardEngine(level);
    const wonA = await driveAutoWin(a, level, (cell) => void a.tap(cell), 0);
    const wonB = await driveAutoWin(b, level, (cell) => void b.tap(cell), 0);
    expect(wonA).toBe(true);
    expect(wonB).toBe(true);
    // No random: identical replay leaves identical hearts (and thus star grade).
    expect(a.hearts()).toBe(b.hearts());
  });
});

describe('driveAutoFail — blocked-marble loss', () => {
  it('startLevel(1) (has a blocked marble) → taps blocked marbles → status is "failed"', async () => {
    const level = LEVELS[0]!;
    const engine = new BoardEngine(level);
    // Precondition: the level genuinely has a blocked marble to burn hearts on.
    const movableIds = new Set(engine.movableMarbles().map((m) => m.id));
    const blocked = engine.allMarbles().filter((m) => !movableIds.has(m.id));
    expect(blocked.length).toBeGreaterThan(0);

    const failed = await driveAutoFail(engine, (cell) => void engine.tap(cell), 0);

    expect(failed).toBe(true);
    expect(engine.gameStatus()).toBe('failed');
    expect(engine.hearts()).toBe(0);
  });
});
