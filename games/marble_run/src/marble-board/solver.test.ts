import { describe, expect, it } from 'vitest';
import { LEVELS } from '../levels/levels.generated';
import { generateLevel, type GenerateParams } from './generate';
import { createLevelSolvabilityChecker, isLevelSolvable, solveLevel } from './solver';
import type { LevelDef } from './types';

const GENERATED_BASE: GenerateParams = {
  id: 10_001,
  cols: 6,
  rows: 6,
  gates: [
    { side: 'top', index: 0, color: 'red' },
    { side: 'bottom', index: 5, color: 'blue' },
    { side: 'left', index: 2, color: 'green' },
  ],
  colors: ['red', 'blue', 'green'],
  marbleTarget: 14,
  seed: 1,
};

function expectEquivalent(level: LevelDef): void {
  expect(isLevelSolvable(level), `level ${level.id}`).toBe(solveLevel(level).solvable);
}

describe('isLevelSolvable', () => {
  it('reuses a compiled checker without retaining prior board state', () => {
    const contract = {
      cols: 3,
      rows: 3,
      gates: [{ side: 'top', index: 0, color: 'red' }] as const,
    };
    const check = createLevelSolvabilityChecker(contract);
    expect(check(['R..', '...', '...'])).toBe(true);
    expect(check(['BBB', 'BRB', 'BBB'])).toBe(false);
    expect(check(['...', '...', '...'])).toBe(true);
    expect(check(['R..', '...', '...'])).toBe(true);
  });

  it('rebuilds component gate masks when empty-space topology changes', () => {
    const contract = {
      cols: 3,
      rows: 3,
      gates: [
        { side: 'top', index: 0, color: 'red' },
        { side: 'bottom', index: 2, color: 'blue' },
      ] as const,
    };
    const check = createLevelSolvabilityChecker(contract);
    const boards = [
      ['R..', '...', '..B'],
      ['R#B', '###', 'B#R'],
      ['...', '.#.', '...'],
      ['R..', '...', '..B'],
    ];
    for (const [index, cells] of boards.entries()) {
      expect(check(cells), `reuse ${index}`).toBe(
        solveLevel({ id: 25_000 + index, ...contract, cells }).solvable,
      );
    }
  });

  it('matches the route-producing solver for all shipped boards', () => {
    for (const level of LEVELS) expectEquivalent(level);
  });

  it('matches the route-producing solver for generated board variants', () => {
    for (const seed of [1, 7, 4242, 90_210]) {
      expectEquivalent(generateLevel({ ...GENERATED_BASE, seed }));
      expectEquivalent(
        generateLevel({ ...GENERATED_BASE, seed, symmetryMode: 'asymmetric' }),
      );
      expectEquivalent(
        generateLevel({
          ...GENERATED_BASE,
          seed,
          cols: 5,
          rows: 5,
          marbleTarget: 8,
          shape: ['..#..', '.....', '..X..', '.....', '..#..'],
          gates: [
            { side: 'top', index: 0, color: 'red' },
            { side: 'bottom', index: 4, color: 'blue' },
            { side: 'left', index: 1, color: 'green' },
          ],
          symmetryMode: 'mirror',
        }),
      );
    }
  });

  it('matches on empty, blocked, gate-mouth, void, and plug edge cases', () => {
    const cases: LevelDef[] = [
      { id: 20_001, cols: 2, rows: 2, cells: ['..', '..'], gates: [] },
      {
        id: 20_002,
        cols: 3,
        rows: 3,
        cells: ['...', '.G.', '...'],
        gates: [{ side: 'top', index: 0, color: 'red' }],
      },
      {
        id: 20_003,
        cols: 3,
        rows: 3,
        cells: ['RBB', 'BBB', 'BBB'],
        gates: [
          { side: 'top', index: 0, color: 'red' },
          { side: 'bottom', index: 1, color: 'blue' },
        ],
      },
      {
        id: 20_004,
        cols: 5,
        rows: 3,
        cells: ['R#..B', '.#X#.', 'G...G'],
        gates: [
          { side: 'top', index: 0, color: 'red' },
          { side: 'right', index: 0, color: 'blue' },
          { side: 'bottom', index: 4, color: 'green' },
        ],
      },
    ];
    for (const level of cases) expectEquivalent(level);
  });

  it('matches across arbitrary partial-placement boards', () => {
    let state = 0x6d2b79f5;
    const random = (): number => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
    };
    const contents = ['.', '.', '.', 'R', 'B', 'G', '#', 'X'] as const;
    for (let id = 0; id < 250; id += 1) {
      const cells = Array.from({ length: 5 }, () =>
        Array.from({ length: 5 }, () => contents[Math.floor(random() * contents.length)]!).join(''),
      );
      expectEquivalent({
        id: 30_000 + id,
        cols: 5,
        rows: 5,
        cells,
        gates: [
          { side: 'top', index: 0, color: 'red' },
          { side: 'bottom', index: 4, color: 'blue' },
          { side: 'left', index: 2, color: 'green' },
        ],
      });
    }
  });
});
