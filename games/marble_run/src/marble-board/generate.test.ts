import { describe, expect, it } from 'vitest';
import {
  generateLevel,
  gateColorsCovered,
  mirrorDistance,
  MIN_ASYMMETRIC_DISTANCE,
  type GenerateParams,
} from './generate.ts';
import { solveLevel } from './solver.ts';
import { CHAR_TO_COLOR, type GateDef } from './types.ts';

const GATES: readonly GateDef[] = [
  { side: 'top', index: 0, color: 'red' },
  { side: 'bottom', index: 5, color: 'blue' },
  { side: 'left', index: 0, color: 'green' },
  { side: 'right', index: 5, color: 'red' },
];

const BASE: GenerateParams = {
  id: 1,
  cols: 6,
  rows: 6,
  gates: GATES,
  colors: ['red', 'blue', 'green'],
  marbleTarget: 14,
  seed: 4242,
};

/** Marbles on the board, by cell. */
function marbleCells(cells: readonly string[]): Array<{ x: number; y: number; ch: string }> {
  const out: Array<{ x: number; y: number; ch: string }> = [];
  cells.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (CHAR_TO_COLOR[ch]) out.push({ x, y, ch });
    });
  });
  return out;
}

describe('solveLevel firstWaveGates', () => {
  it('attributes an exit gate to every wave-1 marble', () => {
    // 3x3, red gate top of col 0, blue gate right of row 2.
    const solved = solveLevel({
      id: 1,
      cols: 3,
      rows: 3,
      cells: ['R..', '...', '..B'],
      gates: [
        { side: 'top', index: 0, color: 'red' },
        { side: 'right', index: 2, color: 'blue' },
      ],
    });
    expect(solved.solvable).toBe(true);
    expect(solved.firstWaveGates).toHaveLength(solved.waves[0]!);
    expect(new Set(solved.firstWaveGates.map((g) => g.color))).toEqual(
      new Set(['red', 'blue']),
    );
  });

  it('reports the field on an unsolvable level', () => {
    // Lone green marble, no green gate anywhere — never movable.
    const solved = solveLevel({
      id: 2,
      cols: 3,
      rows: 3,
      cells: ['...', '.G.', '...'],
      gates: [{ side: 'top', index: 0, color: 'red' }],
    });
    expect(solved.solvable).toBe(false);
    expect(solved.firstWaveGates).toEqual([]);
  });
});

describe('generateLevel back-compat', () => {
  it('is deterministic for a fixed (seed, params)', () => {
    expect(generateLevel(BASE).cells).toEqual(generateLevel(BASE).cells);
  });

  it('produces a solvable level', () => {
    expect(solveLevel(generateLevel(BASE)).solvable).toBe(true);
  });

  it('pins the default-knob output (MRB-7 rebake baseline)', () => {
    // Re-pinned for MRB-7: the gate-coverage bias changed the color pick, so
    // the pre-MRB-7 sequence no longer applies. Every marble color drawn now
    // serves an uncovered gate first, which is the point of the change.
    const level = generateLevel(BASE);
    expect(level.cells).toEqual(['...RRR', '..B.G.', 'B...B.', '.R.GRB', '..G...', '.R.G..']);
    expect(gateColorsCovered(level)).toBe(true);
  });
});

describe('marbleCap', () => {
  it('caps placements below marbleTarget', () => {
    const level = generateLevel({ ...BASE, marbleTarget: 20, marbleCap: 8 });
    expect(marbleCells(level.cells).length).toBeLessThanOrEqual(8);
  });

  it('is a no-op when the cap exceeds the target', () => {
    const capped = generateLevel({ ...BASE, marbleCap: 999 });
    expect(capped.cells).toEqual(generateLevel(BASE).cells);
  });

  it('stays deterministic under a cap', () => {
    const p = { ...BASE, marbleCap: 8 };
    expect(generateLevel(p).cells).toEqual(generateLevel(p).cells);
  });

  it('allows a zero cap without placing any marbles', () => {
    const level = generateLevel({ ...BASE, marbleCap: 0 });
    expect(marbleCells(level.cells)).toEqual([]);
    expect(solveLevel(level).solvable).toBe(true);
  });

  it('allows a zero marble target without placing any marbles', () => {
    const level = generateLevel({ ...BASE, marbleTarget: 0 });
    expect(marbleCells(level.cells)).toEqual([]);
    expect(solveLevel(level).solvable).toBe(true);
  });
});

describe('mirrorDistance', () => {
  it('is 0 for a perfect mirror and counts differing pairs otherwise', () => {
    expect(mirrorDistance(['R..R', '.BB.'], 4)).toBe(0);
    expect(mirrorDistance(['R..B', '.BB.'], 4)).toBe(1);
    expect(mirrorDistance(['RG.B', 'YBB.'], 4)).toBe(3);
  });

  it('treats the centre column of an odd-width board as self-mirrored', () => {
    // The centre 'G' has no partner to disagree with, so it adds nothing.
    expect(mirrorDistance(['R.G.R'], 5)).toBe(0);
    expect(mirrorDistance(['RBGBR'], 5)).toBe(0);
  });

  it('counts board structure, not just marble colors', () => {
    expect(mirrorDistance(['#..R', '....'], 4)).toBe(1);
  });
});

describe('no orphan gates (hard invariant)', () => {
  it('places a marble for every gate color', () => {
    // Six gate colors but a small marble budget — the uniform color pick
    // this replaced routinely left one gate color absent from the board.
    const level = generateLevel({
      ...BASE,
      colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'],
      gates: [
        { side: 'top', index: 0, color: 'red' },
        { side: 'top', index: 5, color: 'blue' },
        { side: 'bottom', index: 0, color: 'green' },
        { side: 'bottom', index: 5, color: 'yellow' },
        { side: 'left', index: 2, color: 'purple' },
        { side: 'right', index: 2, color: 'orange' },
      ],
      marbleTarget: 12,
    });
    expect(gateColorsCovered(level)).toBe(true);
  });

  it('holds across many seeds and both symmetry modes', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const symmetryMode of ['mirror', 'asymmetric'] as const) {
        const level = generateLevel({ ...BASE, seed, symmetryMode });
        expect(gateColorsCovered(level), `seed ${seed} ${symmetryMode}`).toBe(true);
      }
    }
  });

  it('gateColorsCovered detects an orphan gate', () => {
    expect(
      gateColorsCovered({
        id: 1,
        cols: 2,
        rows: 1,
        cells: ['RR'],
        gates: [
          { side: 'top', index: 0, color: 'red' },
          { side: 'top', index: 1, color: 'blue' },
        ],
      }),
    ).toBe(false);
  });
});

describe('bimodal symmetry', () => {
  it("mirror mode emits a PERFECT mirror, not 'symmetric except one piece'", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const level = generateLevel({ ...BASE, seed, symmetryMode: 'mirror' });
      expect(mirrorDistance(level.cells, level.cols), `seed ${seed}`).toBe(0);
      expect(solveLevel(level).solvable).toBe(true);
    }
  });

  it('asymmetric mode is never a near-miss mirror', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const level = generateLevel({ ...BASE, seed, symmetryMode: 'asymmetric' });
      const distance = mirrorDistance(level.cells, level.cols);
      expect(distance, `seed ${seed} distance ${distance}`).toBeGreaterThanOrEqual(
        MIN_ASYMMETRIC_DISTANCE,
      );
    }
  });

  it('handles odd widths and shaped boards, keeping the mirror exact', () => {
    const level = generateLevel({
      ...BASE,
      cols: 5,
      rows: 5,
      shape: ['..#..', '.....', '..X..', '.....', '..#..'],
      gates: [
        { side: 'top', index: 0, color: 'red' },
        { side: 'bottom', index: 4, color: 'blue' },
        { side: 'left', index: 0, color: 'green' },
      ],
      marbleTarget: 8,
      symmetryMode: 'mirror',
    });
    expect(mirrorDistance(level.cells, level.cols)).toBe(0);
    expect(solveLevel(level).solvable).toBe(true);
  });

  it('stays deterministic in both modes', () => {
    for (const symmetryMode of ['mirror', 'asymmetric'] as const) {
      const p: GenerateParams = { ...BASE, symmetryMode };
      expect(generateLevel(p).cells).toEqual(generateLevel(p).cells);
    }
  });
});

describe('openerSpread', () => {
  it('spreads wave-1 exits across distinct gates', () => {
    const level = generateLevel({ ...BASE, openerSpread: true });
    const gates = solveLevel(level).firstWaveGates;
    const distinct = new Set(gates.map((g) => `${g.side}:${g.index}`));
    const expected = Math.min(
      BASE.gates.length,
      new Set(BASE.gates.map((gate) => gate.color)).size,
    );
    expect(distinct.size).toBeGreaterThanOrEqual(expected);
  });

  it('still generates when spread is impossible', () => {
    const level = generateLevel({
      ...BASE,
      gates: [
        { side: 'top', index: 0, color: 'red' },
        { side: 'top', index: 0, color: 'blue' },
      ],
      colors: ['blue'],
      openerSpread: true,
    });
    const solved = solveLevel(level);
    expect(solved.solvable).toBe(true);
    expect(
      new Set(solved.firstWaveGates.map((g) => `${g.side}:${g.index}`)).size,
    ).toBe(1);
  });

  it('leaves output identical when unset', () => {
    expect(generateLevel({ ...BASE, openerSpread: false }).cells).toEqual(
      generateLevel(BASE).cells,
    );
  });
});

describe('lastWavePreference', () => {
  it('gives cascade a final wave at least as big as thin', () => {
    let sawStrictPreference = false;
    for (const seed of [1, 7, 4242, 90210]) {
      const cascade = solveLevel(
        generateLevel({ ...BASE, seed, lastWavePreference: 'cascade' }),
      ).waves;
      const thin = solveLevel(
        generateLevel({ ...BASE, seed, lastWavePreference: 'thin' }),
      ).waves;
      expect(cascade[cascade.length - 1]!).toBeGreaterThanOrEqual(
        thin[thin.length - 1]!,
      );
      if (cascade[cascade.length - 1]! > thin[thin.length - 1]!) {
        sawStrictPreference = true;
      }
    }
    expect(sawStrictPreference).toBe(true);
  });

  it('stops after one extra preference candidate even when the deadline is invalid', () => {
    const level = generateLevel({
      ...BASE,
      seed: 1,
      minWaves: 2,
      minOpeners: 0.65,
      lastWavePreference: 'cascade',
    });
    // Re-pinned for MRB-7 (gate-coverage color bias changed the draw order).
    expect(level.cells).toEqual([
      '.G..R.',
      '..G.B.',
      '...RRG',
      '.R....',
      'RRB..B',
      'B...R.',
    ]);
  });

  it('leaves legacy output untouched when unset', () => {
    expect(generateLevel({ ...BASE }).cells).toEqual(generateLevel(BASE).cells);
  });

  it('stays deterministic with a preference set', () => {
    const p: GenerateParams = { ...BASE, lastWavePreference: 'cascade' };
    expect(generateLevel(p).cells).toEqual(generateLevel(p).cells);
  });
});
