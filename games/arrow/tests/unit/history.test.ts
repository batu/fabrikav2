/**
 * History — undo stack + reset target for the polyline model.
 */

import { describe, expect, it } from "vitest";

import { applyTap, arrowsRemaining, initialState, loadLevel, type LevelSpec } from "../../src/game/state.js";
import { cellOwner, type Path } from "../../src/game/path.js";
import { History, restore, type StateSnapshot } from "../../src/game/history.js";

function mkState(paths: Path[], cols = 4, rows = 5): ReturnType<typeof initialState> {
  const s = initialState();
  const spec: LevelSpec = { index: 1, cols, rows, paths };
  loadLevel(s, spec);
  return s;
}

describe("History", () => {
  it("canUndo is false before any push", () => {
    const h = new History();
    const s = mkState([{ id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]);
    h.markInitial(s);
    expect(h.canUndo).toBe(false);
  });

  it("undo after push restores the arrow that was cleared", () => {
    const h = new History();
    const s = mkState([{ id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]);
    h.markInitial(s);
    h.push(s);
    applyTap(s, 1, 0);
    expect(arrowsRemaining(s)).toBe(0);
    expect(h.undo(s)).toBe(true);
    expect(arrowsRemaining(s)).toBe(1);
    expect(cellOwner(s.grid, 0, 0)).toBe(1);
    expect(cellOwner(s.grid, 1, 0)).toBe(1);
  });

  it("undo restores lives after a blocked tap", () => {
    const h = new History();
    const s = mkState([
      { id: 1, cells: [{ x: 1, y: 0 }, { x: 1, y: 1 }] },
      { id: 2, cells: [{ x: 1, y: 3 }, { x: 1, y: 2 }] },
    ]);
    h.markInitial(s);
    h.push(s);
    applyTap(s, 1, 1);
    expect(s.lives).toBe(2);
    expect(h.undo(s)).toBe(true);
    expect(s.lives).toBe(3);
  });

  it("reset returns to initial snapshot even after several moves", () => {
    const h = new History();
    const s = mkState([
      { id: 1, cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }] }, // head S, exits
      { id: 2, cells: [{ x: 3, y: 0 }, { x: 3, y: 1 }] }, // head S, exits
    ]);
    h.markInitial(s);
    h.push(s);
    applyTap(s, 0, 1);
    h.push(s);
    applyTap(s, 3, 1);
    expect(arrowsRemaining(s)).toBe(0);
    h.reset(s);
    expect(arrowsRemaining(s)).toBe(2);
    expect(s.lives).toBe(3);
    expect(h.canUndo).toBe(false);
  });

  it("markInitial clears the undo stack (level advance drops prior history)", () => {
    const h = new History();
    const s = mkState([{ id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]);
    h.markInitial(s);
    h.push(s);
    expect(h.canUndo).toBe(true);
    loadLevel(s, {
      index: 2,
      cols: 5,
      rows: 5,
      paths: [{ id: 1, cells: [{ x: 2, y: 2 }, { x: 2, y: 1 }] }],
    });
    h.markInitial(s);
    expect(h.canUndo).toBe(false);
  });

  it("restore with lives=0 stays lost even when the snapshot has no arrows", () => {
    // A losing-move snapshot: the last arrow was cleared on the same
    // tick that dropped lives to 0. Ordering must prefer lost over won.
    const s = mkState([{ id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]);
    const snap: StateSnapshot = { lives: 0, arrows: [] };
    restore(s, snap);
    expect(s.status).toBe("lost");
  });

  it("restore with lives>0 and arrows empty becomes won", () => {
    const s = mkState([{ id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]);
    const snap: StateSnapshot = { lives: 2, arrows: [] };
    restore(s, snap);
    expect(s.status).toBe("won");
  });

  it("caps the undo stack at 16 frames", () => {
    const h = new History();
    const s = mkState([{ id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]);
    h.markInitial(s);
    for (let i = 0; i < 30; i++) h.push(s);
    let undos = 0;
    while (h.canUndo) {
      h.undo(s);
      undos++;
    }
    expect(undos).toBeLessThanOrEqual(16);
  });
});
