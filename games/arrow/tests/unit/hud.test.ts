/**
 * HUD hit-test logic — the click routing is the most error-prone
 * surface (gear vs sheet vs grid), so a sanity test per branch.
 */

import { describe, expect, it } from "vitest";

import { hitHudButton } from "../../src/game/hud.js";

describe("hitHudButton", () => {
  const CSS_W = 400;
  const CSS_H = 800;

  // Layout constants (kept in sync with hud.ts sheetBtns):
  //   sheetH = cssH * 0.55 = 440, sheetTop = 360
  //   rowY(i) = sheetTop + 44 + i * 56
  //   Row 0 hint y=404..452, 1 undo 460..508, 2 reset 516..564,
  //   3 restart 572..620, 4 juice 628..676, 5 mute 684..732,
  //   6 close 740+6..740+6+38.4

  it("returns 'gear' when tapping near the top-right corner (sheet closed)", () => {
    // Gear center: r = min(400*0.045, 22) = 18; x = 400 - 24 - 18 = 358, y = 40 + 18 = 58.
    expect(hitHudButton(358, 58, CSS_W, CSS_H, false)).toBe("gear");
  });

  it("returns null for taps nowhere near the gear (sheet closed)", () => {
    expect(hitHudButton(50, 400, CSS_W, CSS_H, false)).toBeNull();
  });

  it("returns 'sheet-close' when sheet is open and tap lands on the dim backdrop", () => {
    // Backdrop is anything above sheetTop. With sheetH = cssH*0.55 and
    // hitTest threshold at cssH*0.45 (= 360), taps at y<360 close.
    expect(hitHudButton(200, 300, CSS_W, CSS_H, true)).toBe("sheet-close");
  });

  it("returns 'sheet-hint' when tapping the first row inside the open sheet", () => {
    expect(hitHudButton(200, 420, CSS_W, CSS_H, true)).toBe("sheet-hint");
  });

  it("returns 'sheet-undo' when tapping the second row", () => {
    expect(hitHudButton(200, 480, CSS_W, CSS_H, true)).toBe("sheet-undo");
  });

  it("returns 'sheet-reset' when tapping the third row", () => {
    expect(hitHudButton(200, 540, CSS_W, CSS_H, true)).toBe("sheet-reset");
  });

  it("returns 'sheet-restart' when tapping the fourth row", () => {
    expect(hitHudButton(200, 590, CSS_W, CSS_H, true)).toBe("sheet-restart");
  });

  it("returns 'sheet-juice' when tapping the fifth row", () => {
    expect(hitHudButton(200, 650, CSS_W, CSS_H, true)).toBe("sheet-juice");
  });

  it("returns 'sheet-packs' when tapping the sixth row", () => {
    expect(hitHudButton(200, 696, CSS_W, CSS_H, true)).toBe("sheet-packs");
  });

  it("returns 'sheet-mute' when tapping the seventh row", () => {
    expect(hitHudButton(200, 752, CSS_W, CSS_H, true)).toBe("sheet-mute");
  });

  describe("juice sub-sheet", () => {
    it("tapping a minus button returns juice-<key>-minus", () => {
      // juiceSheetBtns: rowY(i) = sheetTop + 52 + i * 68
      // Row 0 (windup) y=412..468, minus at x=padX..padX+56 = 32..88
      const r = hitHudButton(60, 440, CSS_W, CSS_H, false, true);
      expect(r).toBe("juice-windup-minus");
    });

    it("tapping a plus button returns juice-<key>-plus", () => {
      // Row 0 plus: x = cssW - padX - 56 = 400 - 32 - 56 = 312..368
      const r = hitHudButton(340, 440, CSS_W, CSS_H, false, true);
      expect(r).toBe("juice-windup-plus");
    });

    it("rows correspond to windup / speed / hold / skip in order", () => {
      const y0 = 440; // row 0 (windup)
      const y1 = y0 + 68; // row 1 (speed)
      const y2 = y0 + 136; // row 2 (hold)
      const y3 = y0 + 204; // row 3 (skip)
      expect(hitHudButton(60, y0, CSS_W, CSS_H, false, true)).toBe("juice-windup-minus");
      expect(hitHudButton(60, y1, CSS_W, CSS_H, false, true)).toBe("juice-speed-minus");
      expect(hitHudButton(60, y2, CSS_W, CSS_H, false, true)).toBe("juice-hold-minus");
      expect(hitHudButton(60, y3, CSS_W, CSS_H, false, true)).toBe("juice-skip-minus");
      expect(hitHudButton(340, y3, CSS_W, CSS_H, false, true)).toBe("juice-skip-plus");
    });

    it("backdrop tap (above sheet) returns juice-close", () => {
      expect(hitHudButton(200, 100, CSS_W, CSS_H, false, true)).toBe("juice-close");
    });
  });
});
