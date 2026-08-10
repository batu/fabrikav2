import { describe, expect, it } from 'vitest';
import { LEVEL_TOTAL, boardSizeFor, slotFor } from '../../src/levels/funnel-schedule';

describe('generated board shape', () => {
  it('never generates a board taller than 1.5x its width', () => {
    // `rows = ceil(area / cols)` overshoots the intended ~1.2 ratio at small
    // marble counts. Level 13 came out 5x9 (1.80) — the most extreme board in
    // the game and the one players report as hard to tap.
    const extreme: string[] = [];
    for (let id = 1; id <= LEVEL_TOTAL; id += 1) {
      if (slotFor(id) === 'climax') continue; // fixed 11x13 by design
      const { cols, rows } = boardSizeFor(id);
      if (rows > cols * 1.5) extreme.push(`L${id} ${cols}x${rows}`);
    }
    expect(extreme).toEqual([]);
  });

  it('widens level 13 rather than shortening it, so capacity is not lost', () => {
    const { cols, rows, marbleTarget } = boardSizeFor(13);
    expect({ cols, rows }).toEqual({ cols: 6, rows: 9 });
    // It previously had 45 cells for a wanted area of 50 — the only early board
    // packed past its own target. Shortening to fix the ratio would have made
    // that worse.
    expect(cols * rows).toBeGreaterThanOrEqual(marbleTarget * 2);
  });
});
