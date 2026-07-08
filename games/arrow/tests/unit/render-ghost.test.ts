/**
 * drawGhostArrows geometry — verifies the polyline hinges through
 * head.cell so bent arrows don't diagonal-shortcut across corners
 * during mid-bend slither.
 */

import { describe, expect, it } from "vitest";

import { drawGhostArrows, computeViewport } from "../../src/game/render.js";
import type { AnimFrame } from "../../src/game/slither-anim.js";

interface Op {
  kind: "moveTo" | "lineTo";
  x: number;
  y: number;
}

function mockCtx(): { ctx: CanvasRenderingContext2D; strokePaths: Op[][] } {
  // Paths are segmented by beginPath(); stroke() commits the current
  // path to `strokePaths`; fill() discards it (so triangle paths
  // don't pollute the stroke list we care about).
  const strokePaths: Op[][] = [];
  let current: Op[] = [];
  const ctx = {
    save() {},
    restore() {},
    beginPath() { current = []; },
    moveTo(x: number, y: number) { current.push({ kind: "moveTo", x, y }); },
    lineTo(x: number, y: number) { current.push({ kind: "lineTo", x, y }); },
    stroke() { strokePaths.push(current); current = []; },
    fill() { current = []; },
    arc() {},
    closePath() {},
    globalAlpha: 1,
    lineCap: "",
    lineJoin: "",
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D;
  return { ctx, strokePaths };
}

const STYLE = {
  bg: "#fff",
  ink: "#000",
  lavender: "#a0a",
  heart: "#e33",
  error: "#e00",
  accentSoft: "#eee",
  activeBlue: "#4a5fff",
};

describe("drawGhostArrows color by anim kind", () => {
  function captureStrokeStyle(frameKind: "exit" | "collide"): string {
    const frame: AnimFrame = {
      kind: frameKind,
      bodyCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      head: { cell: { x: 2, y: 0 }, nextCell: null, frac: 0 },
      headFacing: "E",
      tailFrac: 0,
      alpha: 1,
      shake: { dx: 0, dy: 0 },
      tailStretch: 0,
      tailAnchor: { x: -1, y: 0 },
      activationBlend: 1,
      impactJustHappened: false,
    };
    const grid = { cols: 5, rows: 5, arrows: new Map(), cellIndex: [] as (number | null)[] };
    const vp = computeViewport(grid, 400, 800);
    let observed = "";
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fill() {},
      arc() {},
      closePath() {},
      get strokeStyle() { return observed; },
      set strokeStyle(v: string) { observed = v; },
      fillStyle: "",
      globalAlpha: 1,
      lineCap: "",
      lineJoin: "",
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    drawGhostArrows(ctx, vp, [frame], STYLE);
    return observed;
  }

  it("exit frames stroke with style.activeBlue", () => {
    expect(captureStrokeStyle("exit")).toBe(STYLE.activeBlue);
  });

  it("collide frames stroke with style.ink", () => {
    expect(captureStrokeStyle("collide")).toBe(STYLE.ink);
  });
});

describe("drawGhostArrows geometry", () => {
  it("includes head.cell as a waypoint so bent paths hinge through the corner", () => {
    // L-bend: body ends going south at (2,1); head is at (2,2) about
    // to lerp east toward (3,2). Without the head.cell waypoint, the
    // stroke would go (2,1) → lerpPx, shortcutting the corner.
    const frame: AnimFrame = {
      bodyCells: [
        { x: 2, y: 0 },
        { x: 2, y: 1 },
      ],
      head: {
        cell: { x: 2, y: 2 },
        nextCell: { x: 3, y: 2 },
        frac: 0.5,
      },
      alpha: 1,
      shake: { dx: 0, dy: 0 },
      tailStretch: 0,
      tailAnchor: { x: 0, y: 0 },
      kind: "exit",
      activationBlend: 1,
      impactJustHappened: false,
      headFacing: "N",
      tailFrac: 0,
    };
    const grid = { cols: 5, rows: 5, arrows: new Map(), cellIndex: [] as (number | null)[] };
    const vp = computeViewport(grid, 400, 800);
    const { ctx, strokePaths } = mockCtx();
    drawGhostArrows(ctx, vp, [frame], STYLE);

    // Exactly one stroked polyline — for the body+head chain.
    expect(strokePaths.length).toBe(1);
    const path = strokePaths[0]!;
    // moveTo(body[0]) + lineTo(body[1]) + lineTo(head.cell) + lineTo(headPx) = 4 points.
    expect(path.length).toBe(4);

    const cellX = (c: { x: number; y: number }): number =>
      vp.gx + c.x * vp.cell + vp.cell / 2;
    const cellY = (c: { x: number; y: number }): number =>
      vp.gy + c.y * vp.cell + vp.cell / 2;
    const headCellPx = { x: cellX(frame.head.cell), y: cellY(frame.head.cell) };
    // 3rd point (zero-indexed 2) should be head.cell, not the lerped px.
    expect(path[2]?.x).toBeCloseTo(headCellPx.x, 1);
    expect(path[2]?.y).toBeCloseTo(headCellPx.y, 1);
  });

  it("does not add a lerp waypoint when frac is 0", () => {
    const frame: AnimFrame = {
      bodyCells: [
        { x: 0, y: 0 },
      ],
      head: {
        cell: { x: 1, y: 0 },
        nextCell: { x: 2, y: 0 },
        frac: 0,
      },
      alpha: 1,
      shake: { dx: 0, dy: 0 },
      tailStretch: 0,
      tailAnchor: { x: 0, y: 0 },
      kind: "exit",
      activationBlend: 1,
      impactJustHappened: false,
      headFacing: "N",
      tailFrac: 0,
    };
    const grid = { cols: 5, rows: 5, arrows: new Map(), cellIndex: [] as (number | null)[] };
    const vp = computeViewport(grid, 400, 800);
    const { ctx, strokePaths } = mockCtx();
    drawGhostArrows(ctx, vp, [frame], STYLE);

    expect(strokePaths.length).toBe(1);
    // moveTo(body[0]) + lineTo(head.cell). No trailing lerp.
    expect(strokePaths[0]?.length).toBe(2);
  });

  it("bowstring wind-up: tail extends backward past body[0] toward tailAnchor; head stays at rest", () => {
    // Straight east-pointing body with tailAnchor one cell west of tail.
    // At tailStretch=0.3, the rendered polyline's first point is
    // body[0] lerped 30% toward tailAnchor = (-0.3, 0).
    // Then lineTo body[0], body[1], ..., head.cell. Head end NOT retracted.
    const bodyCells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    const head = { cell: { x: 3, y: 0 }, nextCell: null, frac: 0 };
    const tailAnchor = { x: -1, y: 0 }; // one cell west of body[0]
    const frame: AnimFrame = {
      bodyCells,
      head,
      headFacing: "E",
      tailFrac: 0,
      alpha: 1,
      shake: { dx: 0, dy: 0 },
      tailStretch: 0.3,
      kind: "exit",
      activationBlend: 1,
      impactJustHappened: false,
      tailAnchor,
    };
    const grid = { cols: 5, rows: 5, arrows: new Map(), cellIndex: [] as (number | null)[] };
    const vp = computeViewport(grid, 400, 800);
    const { ctx, strokePaths } = mockCtx();
    drawGhostArrows(ctx, vp, [frame], STYLE);

    expect(strokePaths.length).toBe(1);
    const path = strokePaths[0]!;

    const pxCenter = (c: { x: number; y: number }) => ({
      x: vp.gx + c.x * vp.cell + vp.cell / 2,
      y: vp.gy + c.y * vp.cell + vp.cell / 2,
    });

    // First stroked point = body[0] lerped 0.3 toward tailAnchor = (-0.3, 0).
    const expectedStart = pxCenter({ x: -0.3, y: 0 });
    expect(path[0]?.x).toBeCloseTo(expectedStart.x, 1);
    expect(path[0]?.y).toBeCloseTo(expectedStart.y, 1);
    // Final stroked point = head.cell at its rest position (NOT retracted).
    const endpoint = path[path.length - 1]!;
    const expectedHead = pxCenter({ x: 3, y: 0 });
    expect(endpoint.x).toBeCloseTo(expectedHead.x, 1);
    expect(endpoint.y).toBeCloseTo(expectedHead.y, 1);
  });

  it("bowstring wind-up on L-shape: extension follows tail arm, NOT opposite head-direction", () => {
    // L body [(3,0),(2,0),(1,0),(0,0),(0,1)] → head (0,2). head-dir = S.
    // Tail arm is east (body[0] - body[1] = E). tailAnchor = (4, 0).
    // At tailStretch=0.3, first stroke point = body[0] + 0.3*(anchor - body[0]) = (3.3, 0).
    // If we used head-dir-reversed (N) the extension would be (3, -0.3) — wrong.
    const bodyCells = [
      { x: 3, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ];
    const head = { cell: { x: 0, y: 2 }, nextCell: null, frac: 0 };
    const tailAnchor = { x: 4, y: 0 };
    const frame: AnimFrame = {
      bodyCells,
      head,
      headFacing: "S",
      tailFrac: 0,
      alpha: 1,
      shake: { dx: 0, dy: 0 },
      tailStretch: 0.3,
      kind: "exit",
      activationBlend: 1,
      impactJustHappened: false,
      tailAnchor,
    };
    const grid = { cols: 5, rows: 5, arrows: new Map(), cellIndex: [] as (number | null)[] };
    const vp = computeViewport(grid, 400, 800);
    const { ctx, strokePaths } = mockCtx();
    drawGhostArrows(ctx, vp, [frame], STYLE);

    const path = strokePaths[0]!;
    const pxCenter = (c: { x: number; y: number }) => ({
      x: vp.gx + c.x * vp.cell + vp.cell / 2,
      y: vp.gy + c.y * vp.cell + vp.cell / 2,
    });
    // First point: (3.3, 0) — extension along tail arm (east).
    const expected = pxCenter({ x: 3.3, y: 0 });
    expect(path[0]?.x).toBeCloseTo(expected.x, 1);
    expect(path[0]?.y).toBeCloseTo(expected.y, 1);
    // Sanity: NOT the head-dir-reversed answer at (3, -0.3).
    const wrongAnswer = pxCenter({ x: 3, y: -0.3 });
    expect(path[0]?.y).not.toBeCloseTo(wrongAnswer.y, 1);
  });

  it("with tailStretch=0 all cells sit at their base centers (no motion)", () => {
    const frame: AnimFrame = {
      bodyCells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      head: { cell: { x: 2, y: 0 }, nextCell: null, frac: 0 },
      headFacing: "E",
      tailFrac: 0,
      alpha: 1,
      shake: { dx: 0, dy: 0 },
      tailStretch: 0,
      tailAnchor: { x: 0, y: 0 },
      kind: "exit",
      activationBlend: 1,
      impactJustHappened: false,
    };
    const grid = { cols: 5, rows: 5, arrows: new Map(), cellIndex: [] as (number | null)[] };
    const vp = computeViewport(grid, 400, 800);
    const { ctx, strokePaths } = mockCtx();
    drawGhostArrows(ctx, vp, [frame], STYLE);
    const path = strokePaths[0]!;
    expect(path.length).toBe(3);
    const pxCenter = (c: { x: number; y: number }) => ({
      x: vp.gx + c.x * vp.cell + vp.cell / 2,
      y: vp.gy + c.y * vp.cell + vp.cell / 2,
    });
    expect(path[0]?.x).toBeCloseTo(pxCenter({ x: 0, y: 0 }).x, 1);
    expect(path[1]?.x).toBeCloseTo(pxCenter({ x: 1, y: 0 }).x, 1);
    expect(path[2]?.x).toBeCloseTo(pxCenter({ x: 2, y: 0 }).x, 1);
  });

  it("body-less frames emit no stroke (degenerate, can't stroke one point)", () => {
    const frame: AnimFrame = {
      bodyCells: [],
      head: { cell: { x: 1, y: 1 }, nextCell: null, frac: 0 },
      alpha: 1,
      shake: { dx: 0, dy: 0 },
      tailStretch: 0,
      tailAnchor: { x: 0, y: 0 },
      kind: "exit",
      activationBlend: 1,
      impactJustHappened: false,
      headFacing: "N",
      tailFrac: 0,
    };
    const grid = { cols: 5, rows: 5, arrows: new Map(), cellIndex: [] as (number | null)[] };
    const vp = computeViewport(grid, 400, 800);
    const { ctx, strokePaths } = mockCtx();
    drawGhostArrows(ctx, vp, [frame], STYLE);
    expect(strokePaths.length).toBe(0);
  });
});
