import { describe, expect, it } from 'vitest';
import { BoardEngine } from './board.ts';
import { solveLevel } from './solver.ts';
import { generateLevel } from './generate.ts';
import type { LevelDef } from './types.ts';

/**
 * 3x3 board, red gate on top of column 0, blue gate right of row 2.
 *
 *     v(red)
 *   R . .
 *   . B .
 *   . . B   < (blue)
 */
const TINY: LevelDef = {
  id: 999,
  cols: 3,
  rows: 3,
  cells: ['R..', '.B.', '..B'],
  gates: [
    { side: 'top', index: 0, color: 'red' },
    { side: 'right', index: 2, color: 'blue' },
  ],
};

describe('BoardEngine', () => {
  it('parses marbles and exposes state', () => {
    const e = new BoardEngine(TINY);
    expect(e.remainingCount()).toBe(3);
    expect(e.hearts()).toBe(5);
    expect(e.marbleAt({ x: 0, y: 0 })?.color).toBe('red');
    expect(e.contentAt({ x: -1, y: 0 }).kind).toBe('void');
  });

  it('rolls a marble sitting on its own gate mouth', () => {
    const e = new BoardEngine(TINY);
    const change = e.tap({ x: 0, y: 0 });
    expect(change?.kind).toBe('rolled');
    if (change?.kind !== 'rolled') return;
    expect(change.path).toEqual([{ x: 0, y: 0 }]);
    expect(change.remaining).toBe(2);
    expect(change.won).toBe(false);
  });

  it('previews a route without mutating board state or hearts', () => {
    const e = new BoardEngine(TINY);
    const preview = e.previewTap({ x: 0, y: 0 });
    expect(preview).toEqual({
      marbleId: 1,
      color: 'red',
      cell: { x: 0, y: 0 },
      path: [{ x: 0, y: 0 }],
      gate: { side: 'top', index: 0, color: 'red' },
    });
    expect(e.remainingCount()).toBe(3);
    expect(e.hearts()).toBe(5);
    expect(e.marbleAt({ x: 0, y: 0 })?.color).toBe('red');
  });

  it('blocks a marble whose gate mouth is occupied, then opens after the mouth clears', () => {
    const e = new BoardEngine(TINY);
    // Blue at (1,1): mouth (2,2) is occupied by the other blue marble.
    const blockedFirst = e.tap({ x: 1, y: 1 });
    expect(blockedFirst?.kind).toBe('blocked');

    // Mouth marble exits trivially…
    const mouth = e.tap({ x: 2, y: 2 });
    expect(mouth?.kind).toBe('rolled');

    // …and now (1,1) has an open path ending at the mouth.
    const change = e.tap({ x: 1, y: 1 });
    expect(change?.kind).toBe('rolled');
    if (change?.kind !== 'rolled') return;
    const last = change.path[change.path.length - 1];
    expect(last).toEqual({ x: 2, y: 2 });
  });

  it('loses a heart on blocked tap and fails at zero', () => {
    // Red marble fully boxed in by blues; only gate is red's at top of col 1
    // but mouth (1,0) holds a blue marble → red is blocked.
    const boxed: LevelDef = {
      id: 998,
      cols: 3,
      rows: 3,
      cells: ['BBB', 'BRB', 'BBB'],
      gates: [{ side: 'top', index: 1, color: 'red' }],
      hearts: 2,
    };
    const e = new BoardEngine(boxed);
    const first = e.tap({ x: 1, y: 1 });
    expect(first?.kind).toBe('blocked');
    if (first?.kind !== 'blocked') return;
    expect(first.heartsLeft).toBe(1);
    expect(first.failed).toBe(false);

    const second = e.tap({ x: 1, y: 1 });
    expect(second?.kind).toBe('blocked');
    if (second?.kind !== 'blocked') return;
    expect(second.failed).toBe(true);
    expect(e.gameStatus()).toBe('failed');
    expect(e.tap({ x: 0, y: 0 })).toBeNull();
  });

  it('can continue a failed board with restored hearts', () => {
    const boxed: LevelDef = {
      id: 994,
      cols: 3,
      rows: 3,
      cells: ['BBB', 'BRB', 'BBB'],
      gates: [{ side: 'top', index: 1, color: 'red' }],
      hearts: 2,
    };
    const e = new BoardEngine(boxed);
    expect(e.tap({ x: 1, y: 1 })?.kind).toBe('blocked');
    expect(e.tap({ x: 1, y: 1 })?.kind).toBe('blocked');
    expect(e.gameStatus()).toBe('failed');

    expect(e.continueAfterFail(1)).toBe(true);
    expect(e.gameStatus()).toBe('playing');
    expect(e.hearts()).toBe(1);
    const blockedAgain = e.tap({ x: 1, y: 1 });
    expect(blockedAgain?.kind).toBe('blocked');
    if (blockedAgain?.kind !== 'blocked') return;
    expect(blockedAgain.failed).toBe(true);
  });

  it('does not continue while a board is still playing', () => {
    const e = new BoardEngine(TINY);
    expect(e.continueAfterFail(1)).toBe(false);
    expect(e.gameStatus()).toBe('playing');
    expect(e.hearts()).toBe(5);
  });

  it('wins with 3 stars when no hearts lost', () => {
    const e = new BoardEngine(TINY);
    expect(e.tap({ x: 0, y: 0 })?.kind).toBe('rolled');
    expect(e.tap({ x: 2, y: 2 })?.kind).toBe('rolled'); // mouth marble first
    const last = e.tap({ x: 1, y: 1 });
    expect(last?.kind).toBe('rolled');
    if (last?.kind !== 'rolled') return;
    expect(last.won).toBe(true);
    expect(last.stars).toBe(3);
    expect(e.gameStatus()).toBe('won');
  });

  it('treats plugs and voids as impassable', () => {
    const walled: LevelDef = {
      id: 997,
      cols: 3,
      rows: 1,
      cells: ['RX.'],
      gates: [{ side: 'right', index: 0, color: 'red' }],
    };
    const e = new BoardEngine(walled);
    const change = e.tap({ x: 0, y: 0 });
    expect(change?.kind).toBe('blocked');
  });

  it('streak counts consecutive rolls and resets on block', () => {
    const lvl: LevelDef = {
      id: 996,
      cols: 3,
      rows: 1,
      cells: ['RRB'],
      gates: [{ side: 'left', index: 0, color: 'red' }],
    };
    const e = new BoardEngine(lvl);
    const a = e.tap({ x: 0, y: 0 });
    if (a?.kind !== 'rolled') throw new Error('expected roll');
    expect(a.streak).toBe(1);
    const b = e.tap({ x: 1, y: 0 });
    if (b?.kind !== 'rolled') throw new Error('expected roll');
    expect(b.streak).toBe(2);
    const c = e.tap({ x: 2, y: 0 }); // blue has no gate → blocked
    expect(c?.kind).toBe('blocked');
    expect(e.currentStreak()).toBe(0);
  });
});

describe('solveLevel', () => {
  it('solves the tiny level in waves', () => {
    const result = solveLevel(TINY);
    expect(result.solvable).toBe(true);
    expect(result.order.length).toBe(3);
  });

  it('detects unsolvable levels', () => {
    const jammed: LevelDef = {
      id: 995,
      cols: 2,
      rows: 1,
      cells: ['RB'],
      gates: [{ side: 'right', index: 0, color: 'red' }],
      // red must exit right but blue sits on the mouth and has no gate
    };
    const result = solveLevel(jammed);
    expect(result.solvable).toBe(false);
    expect(result.stuck).toBe(2);
  });
});

describe('generateLevel', () => {
  it('is deterministic for a fixed seed and always solvable', () => {
    const params = {
      id: 1,
      cols: 5,
      rows: 6,
      gates: [
        { side: 'top', index: 2, color: 'red' },
        { side: 'bottom', index: 2, color: 'blue' },
      ],
      colors: ['red', 'blue'],
      marbleTarget: 18,
      seed: 42,
    } as const;
    const a = generateLevel(params);
    const b = generateLevel(params);
    expect(a.cells).toEqual(b.cells);
    expect(solveLevel(a).solvable).toBe(true);
    const marbleCount = a.cells.join('').replace(/[^RGBYPO]/g, '').length;
    expect(marbleCount).toBeGreaterThanOrEqual(12);
  });
});
