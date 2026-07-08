/**
 * drawArrows — tests the hiddenIds skip path. When an arrow's ghost
 * is actively rendered via drawGhostArrows (collide hold), drawArrows
 * must not also render the static arrow on grid, otherwise we get a
 * visual duplicate.
 */

import { describe, expect, it } from "vitest";

import { drawArrows, drawCollideVignette, computeViewport } from "../../src/game/render.js";
import { makePathGrid, placePath } from "../../src/game/path.js";

interface Op {
  kind: "moveTo" | "lineTo" | "stroke" | "fill";
  x?: number;
  y?: number;
}

function mockCtx(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    moveTo(x: number, y: number) { ops.push({ kind: "moveTo", x, y }); },
    lineTo(x: number, y: number) { ops.push({ kind: "lineTo", x, y }); },
    stroke() { ops.push({ kind: "stroke" }); },
    fill() { ops.push({ kind: "fill" }); },
    arc() {},
    closePath() {},
    globalAlpha: 1,
    lineCap: "",
    lineJoin: "",
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
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

describe("drawArrows — hiddenIds", () => {
  it("renders arrows whose ids are NOT in hiddenIds", () => {
    const g = makePathGrid(5, 5);
    placePath(g, 1, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    placePath(g, 2, [{ x: 2, y: 2 }, { x: 3, y: 2 }]);
    const vp = computeViewport(g, 400, 800);
    const { ctx, ops } = mockCtx();

    drawArrows(ctx, vp, g, STYLE, null, 0.55, new Set());

    // Each arrow triggers one stroke (body polyline) + one fill (triangle head).
    const strokes = ops.filter((o) => o.kind === "stroke").length;
    const fills = ops.filter((o) => o.kind === "fill").length;
    expect(strokes).toBe(2);
    expect(fills).toBe(2);
  });

  it("skips arrows whose ids are in hiddenIds", () => {
    const g = makePathGrid(5, 5);
    placePath(g, 1, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    placePath(g, 2, [{ x: 2, y: 2 }, { x: 3, y: 2 }]);
    const vp = computeViewport(g, 400, 800);
    const { ctx, ops } = mockCtx();

    // Hide arrow 1 — only arrow 2 should render.
    drawArrows(ctx, vp, g, STYLE, null, 0.55, new Set([1]));

    const strokes = ops.filter((o) => o.kind === "stroke").length;
    const fills = ops.filter((o) => o.kind === "fill").length;
    expect(strokes).toBe(1);
    expect(fills).toBe(1);
  });

  it("defaults to no hiding when hiddenIds is omitted", () => {
    const g = makePathGrid(5, 5);
    placePath(g, 1, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    const vp = computeViewport(g, 400, 800);
    const { ctx, ops } = mockCtx();

    drawArrows(ctx, vp, g, STYLE);

    const strokes = ops.filter((o) => o.kind === "stroke").length;
    expect(strokes).toBe(1);
  });

  it("drawCollideVignette fills the full canvas when intensity > 0", () => {
    const grid = { cols: 5, rows: 5, arrows: new Map(), cellIndex: [] as (number | null)[] };
    const vp = computeViewport(grid, 400, 800);
    let lastFillRect: { x: number; y: number; w: number; h: number } | null = null;
    let usedGradient = false;
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
      fillRect(x: number, y: number, w: number, h: number) { lastFillRect = { x, y, w, h }; },
      createRadialGradient() {
        usedGradient = true;
        return { addColorStop() {} };
      },
      globalAlpha: 1,
      strokeStyle: "",
      fillStyle: "" as unknown as string | CanvasGradient,
      lineCap: "",
      lineJoin: "",
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    drawCollideVignette(ctx, vp, 0.8, STYLE);
    expect(usedGradient).toBe(true);
    expect(lastFillRect).toEqual({ x: 0, y: 0, w: vp.w, h: vp.h });
  });

  it("drawCollideVignette is a no-op when intensity is 0", () => {
    const grid = { cols: 5, rows: 5, arrows: new Map(), cellIndex: [] as (number | null)[] };
    const vp = computeViewport(grid, 400, 800);
    let fillRectCalls = 0;
    const ctx = {
      save() {},
      restore() {},
      fillRect() { fillRectCalls++; },
      createRadialGradient() { return { addColorStop() {} }; },
    } as unknown as CanvasRenderingContext2D;
    drawCollideVignette(ctx, vp, 0, STYLE);
    expect(fillRectCalls).toBe(0);
  });

  it("hiding every arrow yields no body strokes (collision flash still fires if set)", () => {
    const g = makePathGrid(5, 5);
    placePath(g, 1, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    placePath(g, 2, [{ x: 2, y: 2 }, { x: 3, y: 2 }]);
    const vp = computeViewport(g, 400, 800);
    const { ctx, ops } = mockCtx();

    drawArrows(ctx, vp, g, STYLE, { x: 1, y: 0 }, 0.55, new Set([1, 2]));

    const strokes = ops.filter((o) => o.kind === "stroke").length;
    expect(strokes).toBe(0);
    // The collision flash fills a disc — 1 fill expected.
    const fills = ops.filter((o) => o.kind === "fill").length;
    expect(fills).toBe(1);
  });
});
