/**
 * Contract test for applyZoom + hitTest round-trip.
 *
 * Pinch-to-zoom work in the game depends on a single invariant: for
 * any zoom level and cell coordinate, the screen pixel computed by
 * `cellCenter(applyZoom(baseVp, cols, rows, zoom), x, y)` must, when
 * fed back through `hitTest(applyZoom(...), grid, px, py)`, return
 * the same `(x, y)`.
 *
 * Prior to card vlAvsnFt, the zoom math was duplicated at loop.ts:112
 * and :522; a drift would silently desync hit-test from render. This
 * test pins the shared helper's contract.
 *
 * Learnings reference: 2026-04-14-camera-world-vs-screen-coords-in-
 * phaser-taps.md — always verify inverse-transform via simulated tap
 * before shipping camera work.
 */

import { describe, expect, it } from "vitest";

import { makePathGrid } from "../../src/game/path.js";
import { applyZoom, hitTest, type ViewportGeometry } from "../../src/game/render.js";

function cellCenter(vp: ViewportGeometry, x: number, y: number): { px: number; py: number } {
  return {
    px: vp.gx + x * vp.cell + vp.cell / 2,
    py: vp.gy + y * vp.cell + vp.cell / 2,
  };
}

function baseViewport(cell = 40): ViewportGeometry {
  // Pixel 6a-ish canvas (411×840 css at DPR 1 for simplicity — tests
  // don't care about DPR for inverse-transform correctness, only for
  // consistency between render and hit-test, which is verified by the
  // DPR test case below).
  return { w: 411, h: 840, gx: 16, gy: 184, cell };
}

describe("applyZoom identity", () => {
  it("returns the same viewport when zoom === 1.0", () => {
    const base = baseViewport();
    expect(applyZoom(base, 10, 12, 1.0)).toBe(base);
  });
});

describe("applyZoom + hitTest round-trip across (scale, grid) combos", () => {
  const grid = makePathGrid(10, 12);
  const cases: Array<{ zoom: number; x: number; y: number }> = [
    { zoom: 1.0, x: 0, y: 0 },
    { zoom: 1.0, x: 9, y: 11 },
    { zoom: 1.0, x: 5, y: 6 },
    { zoom: 1.2, x: 0, y: 0 },
    { zoom: 1.2, x: 9, y: 11 },
    { zoom: 1.2, x: 5, y: 6 },
    { zoom: 1.5, x: 0, y: 0 },
    { zoom: 1.5, x: 9, y: 11 },
    { zoom: 1.5, x: 5, y: 6 },
    { zoom: 1.5, x: 3, y: 8 },
  ];

  it.each(cases)(
    "cellCenter → hitTest returns the same cell (zoom=$zoom, x=$x, y=$y)",
    ({ zoom, x, y }) => {
      const vp = applyZoom(baseViewport(), grid.cols, grid.rows, zoom);
      const { px, py } = cellCenter(vp, x, y);
      expect(hitTest(vp, grid, px, py)).toEqual({ x, y });
    },
  );
});

describe("applyZoom — 100-fuzz over random (zoom, cell) combos", () => {
  // Deterministic PRNG — no seedable rng in deps; use a simple LCG so
  // the fuzz is reproducible across machines.
  function prng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  it("100 random (zoom, x, y) combinations round-trip", () => {
    const rand = prng(0xdeadbeef);
    const grid = makePathGrid(15, 18);
    for (let i = 0; i < 100; i++) {
      const zoom = 1.0 + rand() * 0.5; // within [1.0, 1.5] — the current clamp
      const x = Math.floor(rand() * grid.cols);
      const y = Math.floor(rand() * grid.rows);
      const vp = applyZoom(baseViewport(), grid.cols, grid.rows, zoom);
      const { px, py } = cellCenter(vp, x, y);
      expect(hitTest(vp, grid, px, py)).toEqual({ x, y });
    }
  });
});

describe("applyZoom — DPR composition", () => {
  // Pixel 6a DPR = 2.625. The viewport geometry is expressed in CSS
  // pixels; the canvas itself is scaled by DPR at draw time via
  // ctx.setTransform (see main.ts). applyZoom operates purely in CSS
  // coords, so DPR does not appear here — but the CALLER must pass
  // CSS-space pointer coords to hitTest, not device-space. This test
  // documents that contract by exercising the same round-trip with a
  // cell size chosen to mimic what computeViewport produces on a
  // Pixel 6a for a 20×25 pictogram grid.
  it("round-trips for Pixel 6a-sized cell (~19px) under zoom 1.5", () => {
    const vp = applyZoom(
      { w: 411, h: 840, gx: 16, gy: 184, cell: 18.9 },
      20,
      25,
      1.5,
    );
    const grid = makePathGrid(20, 25);
    for (const [x, y] of [
      [0, 0],
      [19, 24],
      [10, 12],
      [7, 20],
    ] as const) {
      const { px, py } = cellCenter(vp, x, y);
      expect(hitTest(vp, grid, px, py)).toEqual({ x, y });
    }
  });
});

describe("applyZoom — grid stays centered under zoom", () => {
  it("the grid center pixel is invariant under zoom", () => {
    const base = baseViewport();
    const cols = 10;
    const rows = 12;
    const centerBefore = {
      px: base.gx + (base.cell * cols) / 2,
      py: base.gy + (base.cell * rows) / 2,
    };
    const zoomed = applyZoom(base, cols, rows, 1.3);
    const centerAfter = {
      px: zoomed.gx + (zoomed.cell * cols) / 2,
      py: zoomed.gy + (zoomed.cell * rows) / 2,
    };
    expect(centerAfter.px).toBeCloseTo(centerBefore.px);
    expect(centerAfter.py).toBeCloseTo(centerBefore.py);
  });
});
