import { describe, expect, it } from 'vitest';
import { ALL_SHAPE_KINDS, buildShape, landmarkShapes, validGateIndices } from './shapes';
import type { Side } from './types';

const SIZES: readonly (readonly [number, number])[] = [
  [6, 6],
  [8, 8],
  [9, 7],
  [12, 10],
  [14, 14],
];

const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right'];

/** Kinds whose predicate ignores the sign of y as well as x. */
const TOP_BOTTOM_SYMMETRIC = new Set([
  'corners',
  'diamond',
  'ring',
  'cross',
  'hourglass',
  'frame-notch',
  'twin-holes',
  'pillars',
  'checker-plugs',
  'arena',
]);

/** Count of '.' cells reachable from the first '.' by 4-way steps. */
function connectedPlayableCount(shape: readonly string[]): number {
  const rows = shape.length;
  const cols = shape[0]!.length;
  const seen = new Set<string>();

  let start: [number, number] | null = null;
  for (let y = 0; y < rows && !start; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (shape[y]![x] === '.') {
        start = [x, y];
        break;
      }
    }
  }
  if (!start) return 0;

  const queue: [number, number][] = [start];
  seen.add(`${start[0]},${start[1]}`);
  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    for (const [nx, ny] of [
      [x, y - 1],
      [x + 1, y],
      [x, y + 1],
      [x - 1, y],
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const key = `${nx},${ny}`;
      if (seen.has(key) || shape[ny]![nx] !== '.') continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return seen.size;
}

function countPlayable(shape: readonly string[]): number {
  return shape.join('').split('').filter((ch) => ch === '.').length;
}

describe('buildShape', () => {
  for (const kind of ALL_SHAPE_KINDS) {
    for (const [cols, rows] of SIZES) {
      describe(`${kind} at ${cols}x${rows}`, () => {
        const shape = buildShape(kind, cols, rows);

        it('has the requested dimensions', () => {
          expect(shape).toHaveLength(rows);
          for (const row of shape) expect(row).toHaveLength(cols);
        });

        it('uses only legend chars', () => {
          for (const row of shape) expect(row).toMatch(/^[.#X]+$/);
        });

        it('is left-right mirror symmetric', () => {
          for (const row of shape) {
            expect(row).toBe([...row].reverse().join(''));
          }
        });

        if (TOP_BOTTOM_SYMMETRIC.has(kind)) {
          it('is top-bottom mirror symmetric', () => {
            expect(shape).toEqual([...shape].reverse());
          });
        }

        it('has a non-empty, 4-connected playable region', () => {
          const playable = countPlayable(shape);
          expect(playable).toBeGreaterThan(0);
          expect(connectedPlayableCount(shape)).toBe(playable);
        });

        it('admits at least one gate on every side', () => {
          for (const side of SIDES) {
            expect(validGateIndices(shape, side).length).toBeGreaterThan(0);
          }
        });
      });
    }
  }

  it('falls back to plain below 6 in either axis', () => {
    for (const [cols, rows] of [
      [5, 5],
      [6, 4],
      [4, 9],
    ] as const) {
      const plain = buildShape('plain', cols, rows);
      for (const kind of ALL_SHAPE_KINDS) {
        expect(buildShape(kind, cols, rows)).toEqual(plain);
      }
      expect(plain.join('')).toMatch(/^\.+$/);
    }
  });

  it('sculpts at least one non-playable cell for every non-plain kind at 12x10', () => {
    for (const kind of ALL_SHAPE_KINDS) {
      if (kind === 'plain') continue;
      const shape = buildShape(kind, 12, 10);
      expect(countPlayable(shape)).toBeLessThan(12 * 10);
    }
  });

  it('throws on non-integer or non-positive sizes', () => {
    expect(() => buildShape('diamond', 8.5, 7)).toThrow(/invalid size/);
    expect(() => buildShape('plain', 0, 6)).toThrow(/invalid size/);
    expect(() => buildShape('plain', 6, -1)).toThrow(/invalid size/);
  });

  it('throws on an unknown kind regardless of size', () => {
    const bogus = 'zigzag' as never;
    expect(() => buildShape(bogus, 4, 4)).toThrow(/unknown kind/);
    expect(() => buildShape(bogus, 8, 8)).toThrow(/unknown kind/);
  });
});

describe('landmarkShapes', () => {
  it('is a non-empty proper subset of ALL_SHAPE_KINDS', () => {
    expect(landmarkShapes.length).toBeGreaterThan(0);
    expect(landmarkShapes.length).toBeLessThan(ALL_SHAPE_KINDS.length);
    for (const kind of landmarkShapes) expect(ALL_SHAPE_KINDS).toContain(kind);
  });

  it('excludes plain', () => {
    expect(landmarkShapes).not.toContain('plain');
  });
});

describe('validGateIndices', () => {
  it('returns every index on a plain board', () => {
    const shape = buildShape('plain', 8, 6);
    expect(validGateIndices(shape, 'top')).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(validGateIndices(shape, 'left')).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('excludes indices whose mouth cell is not playable', () => {
    const shape = buildShape('cross', 12, 10);
    const top = validGateIndices(shape, 'top');
    expect(top.length).toBeLessThan(12);
    for (const index of top) expect(shape[0]![index]).toBe('.');
  });

  // Only top/bottom: those indices run along x, which every kind mirrors.
  // Left/right indices run along y and are only mirrored for the
  // top-bottom-symmetric kinds.
  it('is mirror symmetric on the top and bottom sides', () => {
    for (const kind of ALL_SHAPE_KINDS) {
      const shape = buildShape(kind, 12, 10);
      for (const side of ['top', 'bottom'] as const) {
        const indices = validGateIndices(shape, side);
        expect(indices.map((i) => 12 - 1 - i).sort((a, b) => a - b)).toEqual(indices);
      }
    }
  });
});
