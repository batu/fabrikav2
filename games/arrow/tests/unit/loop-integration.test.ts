/**
 * Loop integration — no mocks. Exercises state + history + hint
 * on the polyline model together so cross-module regressions
 * surface. Browser-only bits (AudioContext, Path2D, RAF, pointer
 * events) are exercised in the actual runtime, not here.
 */

import { describe, expect, it } from "vitest";

import {
  applyTap,
  arrowsRemaining,
  initialState,
  loadLevel,
  MAX_LIVES,
  type LevelSpec,
} from "../../src/game/state.js";
import { cellOwner } from "../../src/game/path.js";
import { History } from "../../src/game/history.js";
import { findLegalArrow } from "../../src/game/hint.js";

// Three arrows, all exit independently — safe-order playground.
const SIMPLE_LEVEL: LevelSpec = {
  index: 1,
  cols: 5,
  rows: 5,
  paths: [
    { id: 1, cells: [{ x: 1, y: 0 }, { x: 0, y: 0 }] }, // head (0,0), dir W — exits left
    { id: 2, cells: [{ x: 2, y: 4 }, { x: 2, y: 3 }] }, // head (2,3), dir N — blocked? checks (2,2)(2,1)(2,0) all empty → exits top
    { id: 3, cells: [{ x: 4, y: 2 }, { x: 4, y: 1 }] }, // head (4,1), dir N — exits top
  ],
};

// Two arrows on the same column pointing at each other — mutual block.
const MUTUAL_BLOCK: LevelSpec = {
  index: 1,
  cols: 3,
  rows: 5,
  paths: [
    { id: 1, cells: [{ x: 1, y: 4 }, { x: 1, y: 3 }] }, // head (1,3), dir N — blocked by B at (1,1)
    { id: 2, cells: [{ x: 1, y: 0 }, { x: 1, y: 1 }] }, // head (1,1), dir S — blocked by A at (1,3)
  ],
};

describe("loop integration (state + history + hint)", () => {
  it("push-before-tap semantics: undo after a clear restores exactly the previous board", () => {
    const s = initialState();
    loadLevel(s, SIMPLE_LEVEL);
    const h = new History();
    h.markInitial(s);

    h.push(s);
    const tap = applyTap(s, 0, 0);
    expect(tap?.blocked).toBe(false);
    expect(arrowsRemaining(s)).toBe(2);
    expect(h.undo(s)).toBe(true);
    expect(arrowsRemaining(s)).toBe(3);
    expect(cellOwner(s.grid, 0, 0)).toBe(1);
  });

  it("three blocked taps drain lives to zero then block further plays", () => {
    const s = initialState();
    loadLevel(s, MUTUAL_BLOCK);

    for (let i = 0; i < MAX_LIVES; i++) {
      const r = applyTap(s, 1, 3);
      expect(r?.blocked).toBe(true);
    }
    expect(s.lives).toBe(0);
    expect(s.status).toBe("lost");
    expect(applyTap(s, 1, 3)).toBeNull();
  });

  it("reset after failing returns to initial lives and positions", () => {
    const s = initialState();
    loadLevel(s, MUTUAL_BLOCK);
    const h = new History();
    h.markInitial(s);
    h.push(s);
    applyTap(s, 1, 3);
    expect(s.lives).toBe(2);
    h.reset(s);
    expect(s.lives).toBe(MAX_LIVES);
    expect(s.status).toBe("playing");
    expect(arrowsRemaining(s)).toBe(2);
  });

  it("findLegalArrow returns a cell whose applyTap would clear", () => {
    const s = initialState();
    loadLevel(s, SIMPLE_LEVEL);
    const legal = findLegalArrow(s.grid);
    expect(legal).not.toBeNull();
    if (legal) {
      const r = applyTap(s, legal.x, legal.y);
      expect(r?.blocked).toBe(false);
    }
  });

  it("undo from lost restores lives and flips status back to playing", () => {
    const s = initialState();
    loadLevel(s, MUTUAL_BLOCK);
    const h = new History();
    h.markInitial(s);
    h.push(s); applyTap(s, 1, 3);
    h.push(s); applyTap(s, 1, 3);
    h.push(s); applyTap(s, 1, 3);
    expect(s.status).toBe("lost");
    h.undo(s);
    expect(s.status).toBe("playing");
    expect(s.lives).toBe(1);
  });

  it("tap-on-body activates regardless of which cell of the path is tapped", () => {
    const s = initialState();
    loadLevel(s, {
      index: 1,
      cols: 5,
      rows: 5,
      paths: [
        { id: 1, cells: [{ x: 0, y: 4 }, { x: 0, y: 3 }, { x: 0, y: 2 }, { x: 0, y: 1 }] },
      ],
    });
    // Tap on the tail should activate the same arrow as tapping the head.
    const r = applyTap(s, 0, 4);
    expect(r?.blocked).toBe(false);
    expect(r?.arrowId).toBe(1);
    expect(arrowsRemaining(s)).toBe(0);
  });
});
