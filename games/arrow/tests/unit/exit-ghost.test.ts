/**
 * ExitGhost FX — lavender echo trails after exit anims.
 */

import { describe, expect, it } from "vitest";

import { ExitGhost } from "../../src/game/fx/exit-ghost.js";

describe("ExitGhost", () => {
  it("spawn is a no-op for <2 cells", () => {
    const g = new ExitGhost();
    g.spawn([], "N");
    g.spawn([{ x: 0, y: 0 }], "N");
    // Nothing to assert beyond no-throw; draw on empty is a no-op.
    const ctx = {
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() {}, fill() {}, arc() {}, closePath() {},
      globalAlpha: 1, strokeStyle: "", fillStyle: "", lineCap: "", lineJoin: "", lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    const vp = { w: 400, h: 800, gx: 0, gy: 0, cell: 40 };
    expect(() => g.draw(ctx, vp, "#f00")).not.toThrow();
  });

  it("ghost drops after its lifetime (~200ms)", () => {
    const g = new ExitGhost();
    g.spawn([{ x: 0, y: 0 }, { x: 1, y: 0 }], "E");
    let strokes = 0;
    const ctx = {
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() { strokes++; }, fill() {}, arc() {}, closePath() {},
      globalAlpha: 1, strokeStyle: "", fillStyle: "", lineCap: "", lineJoin: "", lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    const vp = { w: 400, h: 800, gx: 0, gy: 0, cell: 40 };
    // Tick 100ms — still alive.
    g.tick(100);
    g.draw(ctx, vp, "#8b8fc2");
    expect(strokes).toBe(1);
    // Tick past 200ms — dropped.
    g.tick(150);
    strokes = 0;
    g.draw(ctx, vp, "#8b8fc2");
    expect(strokes).toBe(0);
  });

  it("alpha decays linearly from GHOST_ALPHA_START → 0", () => {
    const g = new ExitGhost();
    g.spawn([{ x: 0, y: 0 }, { x: 1, y: 0 }], "E");
    let observedAlpha = 0;
    const ctx = {
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() {}, fill() {}, arc() {}, closePath() {},
      set globalAlpha(v: number) { observedAlpha = v; },
      get globalAlpha() { return observedAlpha; },
      strokeStyle: "", fillStyle: "", lineCap: "", lineJoin: "", lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    const vp = { w: 400, h: 800, gx: 0, gy: 0, cell: 40 };
    g.tick(0);
    g.draw(ctx, vp, "#8b8fc2");
    const initial = observedAlpha;
    g.tick(100); // halfway through 200ms window
    g.draw(ctx, vp, "#8b8fc2");
    expect(observedAlpha).toBeLessThan(initial);
    expect(observedAlpha).toBeGreaterThan(0);
  });
});
