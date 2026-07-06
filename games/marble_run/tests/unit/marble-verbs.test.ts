import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@fabrikav2/kernel';
import { pickByRoll, blockedMarbles } from '../../src/shell/marbleVerbs';

/**
 * Unit coverage for the game-verb selection logic behind the typed harness
 * `verbs` map (`tapUnlockedMarble` / `tapBlockedMarble`). The load-bearing
 * property is that selection is a PURE function of `(pool, roll)`: the verb's
 * `run` and `clientPoint` flavours must never disagree on which marble is the
 * target, and a seeded chaos run must replay identically.
 */

interface FakeMarble {
  readonly id: number;
  readonly cell: { readonly x: number; readonly y: number };
}

function marbles(...ids: number[]): FakeMarble[] {
  return ids.map((id) => ({ id, cell: { x: id, y: id } }));
}

describe('pickByRoll — deterministic marble selection', () => {
  const pool = marbles(10, 20, 30, 40);

  it('returns null for an empty pool (no legal target)', () => {
    expect(pickByRoll([], 0.5)).toBeNull();
  });

  it('maps the roll range across every slot', () => {
    expect(pickByRoll(pool, 0)!.id).toBe(10);
    expect(pickByRoll(pool, 0.25)!.id).toBe(20);
    expect(pickByRoll(pool, 0.5)!.id).toBe(30);
    expect(pickByRoll(pool, 0.75)!.id).toBe(40);
  });

  it('clamps a roll of exactly 1 (or out of range) into the last slot', () => {
    expect(pickByRoll(pool, 1)!.id).toBe(40);
    expect(pickByRoll(pool, 1.5)!.id).toBe(40);
    expect(pickByRoll(pool, -3)!.id).toBe(10);
    expect(pickByRoll(pool, Number.NaN)!.id).toBe(10);
  });

  it('is pure: the same roll always picks the same element (run/clientPoint agreement)', () => {
    const roll = mulberry32(7)();
    expect(pickByRoll(pool, roll)!.id).toBe(pickByRoll(pool, roll)!.id);
  });

  it('replays a seeded sequence identically', () => {
    const rngA = mulberry32(123);
    const rngB = mulberry32(123);
    const seqA = Array.from({ length: 6 }, () => pickByRoll(pool, rngA())!.id);
    const seqB = Array.from({ length: 6 }, () => pickByRoll(pool, rngB())!.id);
    expect(seqA).toEqual(seqB);
  });
});

describe('blockedMarbles — adversarial pool by exclusion', () => {
  it('is every marble minus the movable set', () => {
    const all = marbles(1, 2, 3, 4, 5);
    const movable = marbles(2, 4);
    expect(blockedMarbles(all, movable).map((m) => m.id)).toEqual([1, 3, 5]);
  });

  it('is empty when all marbles are movable', () => {
    const all = marbles(1, 2);
    expect(blockedMarbles(all, all)).toEqual([]);
  });

  it('is the whole board when nothing is movable (fully blocked)', () => {
    const all = marbles(1, 2, 3);
    expect(blockedMarbles(all, []).map((m) => m.id)).toEqual([1, 2, 3]);
  });
});
