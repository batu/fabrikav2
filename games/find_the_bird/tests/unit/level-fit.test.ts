import { describe, expect, it } from "vitest";
import { resolveLevelCoverFit, resolveLevelPanBounds } from "../../src/scenes/levelFit";

describe("level cover fit", () => {
  it("fills a portrait viewport without letterbox margins", () => {
    const fit = resolveLevelCoverFit(
      { width: 1200, height: 1200 },
      { width: 1170, height: 2532 },
    );

    expect(fit.scale).toBeCloseTo(2532 / 1200);
    expect(fit.initialScrollX).toBeGreaterThan(0);
    expect(fit.initialScrollY).toBeCloseTo(0);
    expect(fit.displayWidth).toBeGreaterThanOrEqual(1170);
    expect(fit.displayHeight).toBeGreaterThanOrEqual(2532);
  });

  it("centers the deliberate cover crop", () => {
    const fit = resolveLevelCoverFit(
      { width: 1600, height: 1000 },
      { width: 1170, height: 2532 },
    );

    expect(fit.initialScrollX).toBeGreaterThan(0);
    expect(fit.initialScrollY).toBeCloseTo(0);
    expect(fit.initialScrollX).toBeCloseTo((fit.displayWidth - 1170) / 2);
  });

  it("keeps both cropped edges reachable inside positive world bounds", () => {
    const viewport = { width: 1170, height: 2532 };
    const fit = resolveLevelCoverFit({ width: 1200, height: 1200 }, viewport);
    const maxScrollX = fit.displayWidth - viewport.width;

    expect(fit.initialScrollX).toBeCloseTo(maxScrollX / 2);
    expect(0).toBeLessThanOrEqual(fit.initialScrollX);
    expect(fit.initialScrollX).toBeLessThanOrEqual(maxScrollX);
    expect(maxScrollX + viewport.width).toBeCloseTo(fit.displayWidth);
  });

  it("never lets square levels pan beyond the rendered artwork", () => {
    const viewport = { width: 1170, height: 2532 };
    const fit = resolveLevelCoverFit({ width: 4096, height: 4096 }, viewport);
    const bounds = resolveLevelPanBounds(
      { width: 4096, height: 4096 },
      viewport,
      fit,
    );

    expect(bounds).toEqual({
      x: 0,
      y: 0,
      width: fit.displayWidth,
      height: fit.displayHeight,
    });
  });

  it("does not add safe-area overscroll to portrait levels", () => {
    const viewport = { width: 1170, height: 2532 };
    const level = { width: 1200, height: 1800 };
    const fit = resolveLevelCoverFit(level, viewport);
    const bounds = resolveLevelPanBounds(level, viewport, fit);

    expect(bounds.y).toBe(0);
    expect(bounds.height).toBe(fit.displayHeight);
  });
});
