import { describe, expect, it } from "vitest";
import {
  advance,
  assertConservation,
  createGame,
  isThreadClear,
  releaseThread,
  type WoolCrushLevel,
  type WoolCrushState,
} from "../../src/game/WoolCrushEngine.ts";
import { WOOL_CRUSH_LEVELS } from "../../src/game/levels.ts";

function mustRelease(state: WoolCrushState, id: string): WoolCrushState {
  const result = releaseThread(state, id);
  expect(result.ok, result.ok ? undefined : result.reason).toBe(true);
  return result.state;
}

function drain(state: WoolCrushState, limit = 100): WoolCrushState {
  for (let turn = 0; turn < limit && state.status === "playing"; turn += 1) state = advance(state);
  return state;
}

function finishSpool(state: WoolCrushState, threadId: string, limit = 100): WoolCrushState {
  for (let turn = 0; turn < limit && state.status === "playing" && state.spools.some((spool) => spool?.threadId === threadId); turn += 1) {
    state = advance(state);
  }
  return state;
}

const geometryLevel: WoolCrushLevel = {
  id: "geometry",
  width: 4,
  height: 2,
  visibleSections: 2,
  catDistance: 4,
  threads: [
    { id: "blocked", color: "red", cells: [{ x: 0, y: 0 }], exit: { x: 1, y: 0 } },
    { id: "blocker", color: "blue", cells: [{ x: 2, y: 0 }], exit: { x: 0, y: 1 } },
  ],
  dragon: ["red", "blue"],
};

describe("WoolCrushEngine board and slots", () => {
  it("allows release only when the entire straight exit corridor is clear", () => {
    let state = createGame(geometryLevel);
    expect(isThreadClear(state, "blocked")).toBe(false);
    expect(releaseThread(state, "blocked")).toMatchObject({ ok: false, reason: "blocked" });
    state = mustRelease(state, "blocker");
    expect(isThreadClear(state, "blocked")).toBe(true);
  });

  it("uses the leftmost free one of exactly four slots and rejects a fifth spool", () => {
    const level: WoolCrushLevel = {
      id: "slots", width: 1, height: 5, visibleSections: 5, catDistance: 5,
      threads: ["a", "b", "c", "d", "e"].map((color, y) => ({ id: color, color, cells: [{ x: 0, y }], exit: { x: 1, y: 0 } })),
      dragon: ["a", "b", "c", "d", "e"],
    };
    let state = createGame(level);
    for (const [slot, id] of ["a", "b", "c", "d"].entries()) {
      const result = releaseThread(state, id);
      expect(result).toMatchObject({ ok: true, slot });
      state = result.state;
    }
    expect(releaseThread(state, "e")).toMatchObject({ ok: false, reason: "slots-full" });
    state = advance(state);
    const reused = releaseThread(state, "e");
    expect(reused).toMatchObject({ ok: true, slot: 0 });
  });
});

describe("WoolCrushEngine dragon resolution", () => {
  it("pulls the closest visible matching section and closes the middle gap", () => {
    const level: WoolCrushLevel = {
      id: "gap", width: 2, height: 2, visibleSections: 3, catDistance: 3,
      threads: [
        { id: "blue", color: "blue", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }], exit: { x: 1, y: 0 } },
        { id: "red", color: "red", cells: [{ x: 1, y: 1 }], exit: { x: 1, y: 0 } },
      ],
      dragon: ["red", "blue", "blue"],
    };
    let state = mustRelease(createGame(level), "blue");
    state = advance(state);
    expect(state.dragon).toEqual(["red", "blue"]);
    expect(state.headDistance).toBe(3);
  });

  it("gives closest-to-finish spool precedence, then frees its slot", () => {
    const level: WoolCrushLevel = {
      id: "precedence", width: 3, height: 2, visibleSections: 4, catDistance: 4,
      threads: [
        { id: "long", color: "red", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], exit: { x: 1, y: 0 } },
        { id: "short", color: "blue", cells: [{ x: 2, y: 1 }], exit: { x: 1, y: 0 } },
      ],
      dragon: ["red", "blue", "red", "red"],
    };
    let state = mustRelease(createGame(level), "long");
    state = mustRelease(state, "short");
    state = advance(state);
    expect(state.dragon).toEqual(["red", "red", "red"]);
    expect(state.spools[1]).toBeNull();
    expect(state.spools[0]?.remaining).toBe(3);
  });

  it("limits matching to the front-K window; idle spools hold progress while the dragon advances", () => {
    const level: WoolCrushLevel = {
      id: "visibility", width: 2, height: 2, visibleSections: 2, catDistance: 3,
      threads: [
        { id: "teal", color: "teal", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }], exit: { x: 1, y: 0 } },
        { id: "red", color: "red", cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }], exit: { x: 1, y: 0 } },
      ],
      dragon: ["red", "red", "teal", "teal"],
    };
    let state = mustRelease(createGame(level), "teal");
    state = advance(state);
    expect(state.headDistance).toBe(2);
    expect(state.spools[0]?.remaining).toBe(2);
    expect(state.dragon).toEqual(["red", "red", "teal", "teal"]);
  });

  it("fails instantly when an unpullable head reaches the cat", () => {
    const level: WoolCrushLevel = {
      id: "fail", width: 1, height: 1, visibleSections: 1, catDistance: 1,
      threads: [{ id: "blue", color: "blue", cells: [{ x: 0, y: 0 }], exit: { x: 1, y: 0 } }], dragon: ["blue"],
    };
    expect(advance(createGame(level))).toMatchObject({ status: "failed", headDistance: 0 });
  });

  it("wins only after the board, dragon, and every spool are empty", () => {
    const level: WoolCrushLevel = {
      id: "win", width: 1, height: 1, visibleSections: 1, catDistance: 1,
      threads: [{ id: "red", color: "red", cells: [{ x: 0, y: 0 }], exit: { x: 1, y: 0 } }], dragon: ["red"],
    };
    const released = mustRelease(createGame(level), "red");
    expect(released.status).toBe("playing");
    expect(advance(released).status).toBe("won");
  });
});

describe("bundled Wool Crush levels", () => {
  it("contain 3, 4, and 5 colors and satisfy conservation", () => {
    expect(WOOL_CRUSH_LEVELS).toHaveLength(3);
    expect(WOOL_CRUSH_LEVELS.map((level) => new Set(level.dragon).size)).toEqual([3, 4, 5]);
    for (const level of WOOL_CRUSH_LEVELS) assertConservation(createGame(level));
  });

  it.each([
    ["wool-01", ["red", "blue", "gold"]],
    ["wool-02", ["coral-long", "mint", "lilac", "sky", "coral-short"]],
    ["wool-03", ["red-a", "blue", "green", "gold", "purple", "red-b"]],
  ])("proves %s is winnable with a legal release sequence", (levelId, releases) => {
    const level = WOOL_CRUSH_LEVELS.find((candidate) => candidate.id === levelId)!;
    let state = createGame(level);
    for (const id of releases) {
      state = mustRelease(state, id);
      state = finishSpool(state, id);
      if (state.status === "won") break;
    }
    state = drain(state);
    expect(state.status).toBe("won");
    expect(state.threads).toHaveLength(0);
    expect(state.dragon).toHaveLength(0);
    expect(state.spools.every((spool) => spool === null)).toBe(true);
  });
});
