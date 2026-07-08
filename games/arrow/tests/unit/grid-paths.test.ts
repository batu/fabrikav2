import { describe, expect, it } from "vitest";

import {
  arrowCount,
  cellOwner,
  clearPath,
  headDir,
  makePathGrid,
  placePath,
} from "../../src/game/path.js";

describe("makePathGrid", () => {
  it("starts empty — every cell null, no arrows", () => {
    const g = makePathGrid(4, 5);
    expect(g.cellIndex.length).toBe(20);
    expect(g.cellIndex.every((v) => v === null)).toBe(true);
    expect(arrowCount(g)).toBe(0);
  });
});

describe("placePath invariants", () => {
  it("rejects paths of length < 2", () => {
    const g = makePathGrid(4, 4);
    expect(() => placePath(g, 1, [{ x: 0, y: 0 }])).toThrow(/length >= 2/);
  });

  it("rejects duplicate cells (self-intersecting)", () => {
    const g = makePathGrid(4, 4);
    expect(() =>
      placePath(g, 1, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).toThrow(/self-intersecting/);
  });

  it("rejects non-4-connected steps (diagonal)", () => {
    const g = makePathGrid(4, 4);
    expect(() =>
      placePath(g, 1, [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toThrow(/not 4-connected/);
  });

  it("rejects non-4-connected steps (jump of 2)", () => {
    const g = makePathGrid(4, 4);
    expect(() =>
      placePath(g, 1, [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ]),
    ).toThrow(/not 4-connected/);
  });

  it("rejects out-of-bounds cells", () => {
    const g = makePathGrid(3, 3);
    expect(() =>
      placePath(g, 1, [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ]),
    ).toThrow(/out of bounds/);
  });

  it("rejects overlap with an existing arrow", () => {
    const g = makePathGrid(5, 5);
    placePath(g, 1, [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
    expect(() =>
      placePath(g, 2, [
        { x: 3, y: 0 },
        { x: 3, y: 1 }, // collides with arrow 1
      ]),
    ).toThrow(/already owned by arrow 1/);
  });

  it("rejects reuse of the same id", () => {
    const g = makePathGrid(4, 4);
    placePath(g, 1, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(() =>
      placePath(g, 1, [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]),
    ).toThrow(/already placed/);
  });
});

describe("placePath — cellIndex + forward index stay in sync", () => {
  it("populates cellIndex for every cell on a straight path", () => {
    const g = makePathGrid(5, 5);
    placePath(g, 7, [
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
    expect(cellOwner(g, 0, 2)).toBe(7);
    expect(cellOwner(g, 1, 2)).toBe(7);
    expect(cellOwner(g, 2, 2)).toBe(7);
    expect(cellOwner(g, 3, 2)).toBe(7);
    expect(cellOwner(g, 4, 2)).toBe(null);
    expect(arrowCount(g)).toBe(1);
  });

  it("populates cellIndex for every cell on an L-shaped path", () => {
    const g = makePathGrid(5, 5);
    placePath(g, 3, [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(cellOwner(g, 0, 0)).toBe(3);
    expect(cellOwner(g, 0, 1)).toBe(3);
    expect(cellOwner(g, 0, 2)).toBe(3);
    expect(cellOwner(g, 1, 2)).toBe(3);
    expect(cellOwner(g, 2, 2)).toBe(3);
    // Interior cells not on the path stay empty.
    expect(cellOwner(g, 1, 0)).toBe(null);
    expect(cellOwner(g, 1, 1)).toBe(null);
  });

  it("supports two disjoint arrows on the same grid", () => {
    const g = makePathGrid(5, 5);
    placePath(g, 1, [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ]);
    placePath(g, 2, [
      { x: 4, y: 4 },
      { x: 4, y: 3 },
    ]);
    expect(arrowCount(g)).toBe(2);
    expect(cellOwner(g, 0, 0)).toBe(1);
    expect(cellOwner(g, 4, 3)).toBe(2);
  });
});

describe("clearPath", () => {
  it("removes every cell of the target arrow and leaves others intact", () => {
    const g = makePathGrid(5, 5);
    placePath(g, 1, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    placePath(g, 2, [
      { x: 0, y: 4 },
      { x: 1, y: 4 },
    ]);
    clearPath(g, 1);
    expect(arrowCount(g)).toBe(1);
    expect(cellOwner(g, 0, 0)).toBe(null);
    expect(cellOwner(g, 1, 0)).toBe(null);
    expect(cellOwner(g, 2, 0)).toBe(null);
    // Arrow 2 untouched.
    expect(cellOwner(g, 0, 4)).toBe(2);
    expect(cellOwner(g, 1, 4)).toBe(2);
  });

  it("is a no-op for an unknown id", () => {
    const g = makePathGrid(3, 3);
    placePath(g, 1, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    clearPath(g, 99);
    expect(arrowCount(g)).toBe(1);
    expect(cellOwner(g, 0, 0)).toBe(1);
  });

  it("allows re-placing an id after it was cleared", () => {
    const g = makePathGrid(4, 4);
    placePath(g, 5, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    clearPath(g, 5);
    placePath(g, 5, [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
    expect(cellOwner(g, 2, 2)).toBe(5);
    expect(cellOwner(g, 0, 0)).toBe(null);
  });
});

describe("placePath — validate-then-mutate (no partial state on throw)", () => {
  it("leaves grid unchanged after rejecting a mid-path out-of-bounds step", () => {
    const g = makePathGrid(4, 4);
    expect(() =>
      placePath(g, 1, [
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 }, // off the edge
      ]),
    ).toThrow(/out of bounds/);
    expect(arrowCount(g)).toBe(0);
    expect(g.cellIndex.every((v) => v === null)).toBe(true);
    // Same id can still be used for a valid placement.
    placePath(g, 1, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(cellOwner(g, 0, 0)).toBe(1);
  });

  it("leaves grid unchanged after rejecting a mid-path non-4-connected step", () => {
    const g = makePathGrid(5, 5);
    expect(() =>
      placePath(g, 1, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 3, y: 0 }, // jump of 2
      ]),
    ).toThrow(/not 4-connected/);
    expect(arrowCount(g)).toBe(0);
    expect(g.cellIndex.every((v) => v === null)).toBe(true);
  });
});

describe("cellOwner — edge cases", () => {
  it("returns null for out-of-bounds coordinates (positive overflow)", () => {
    const g = makePathGrid(3, 3);
    expect(cellOwner(g, 3, 0)).toBe(null);
    expect(cellOwner(g, 0, 3)).toBe(null);
  });

  it("returns null for negative coordinates", () => {
    const g = makePathGrid(3, 3);
    expect(cellOwner(g, -1, 0)).toBe(null);
    expect(cellOwner(g, 0, -1)).toBe(null);
  });

  it("distinguishes owned-by-id-0 from empty", () => {
    const g = makePathGrid(3, 3);
    placePath(g, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(cellOwner(g, 0, 0)).toBe(0);
    expect(cellOwner(g, 2, 2)).toBe(null);
  });
});

describe("clearPath — idempotency", () => {
  it("is safe to call twice on the same id", () => {
    const g = makePathGrid(3, 3);
    placePath(g, 1, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    clearPath(g, 1);
    clearPath(g, 1); // second call on now-unknown id
    expect(arrowCount(g)).toBe(0);
    expect(cellOwner(g, 0, 0)).toBe(null);
  });
});

describe("headDir", () => {
  it("throws on a 1-cell path", () => {
    expect(() => headDir({ id: 1, cells: [{ x: 0, y: 0 }] })).toThrow(
      /length 1, need >= 2/,
    );
  });

  it("throws on a 0-cell path", () => {
    expect(() => headDir({ id: 1, cells: [] })).toThrow(/length 0/);
  });

  it("throws on a non-4-connected last step (diagonal)", () => {
    expect(() =>
      headDir({
        id: 2,
        cells: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      }),
    ).toThrow(/not 4-connected/);
  });

  it("returns E for a horizontal step to the right", () => {
    expect(
      headDir({
        id: 1,
        cells: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      }),
    ).toBe("E");
  });

  it("returns W for a horizontal step to the left", () => {
    expect(
      headDir({
        id: 1,
        cells: [
          { x: 3, y: 2 },
          { x: 2, y: 2 },
        ],
      }),
    ).toBe("W");
  });

  it("returns S for a downward step", () => {
    expect(
      headDir({
        id: 1,
        cells: [
          { x: 1, y: 1 },
          { x: 1, y: 2 },
        ],
      }),
    ).toBe("S");
  });

  it("returns N for an upward step", () => {
    expect(
      headDir({
        id: 1,
        cells: [
          { x: 1, y: 2 },
          { x: 1, y: 1 },
        ],
      }),
    ).toBe("N");
  });

  it("uses only the last two cells (ignores earlier bends)", () => {
    // L-shape that turns down then right — head-dir should be E.
    expect(
      headDir({
        id: 1,
        cells: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
        ],
      }),
    ).toBe("E");
  });
});
