import { describe, expect, it } from "vitest";

import {
  createHideStateMap,
  hideFoundCount,
  hideObjectView,
  hideObjectViews,
  revealHide,
} from "../../src/game/hideState.ts";
import { loadLidoFixture } from "./lidoFixture.ts";

describe("Cameleon hide state machine", () => {
  it("starts every hide hidden and reveal is idempotent", () => {
    const level = loadLidoFixture();
    const state = createHideStateMap(level);

    expect(hideFoundCount(state)).toBe(0);
    const withReveal = revealHide(state, "li-01");
    expect(hideFoundCount(withReveal)).toBe(1);
    expect(revealHide(withReveal, "li-01")).toBe(withReveal);
  });

  it("keeps painted and white sprites locked to the same alpha", () => {
    const level = loadLidoFixture();
    const hide = level.hides[0]!;

    const painted = hideObjectView(hide, "hidden", "painted", "screenprint");
    expect(painted.alpha).toBe(1);
    expect(painted.painted.visible).toBe(true);
    expect(painted.white.visible).toBe(false);
    expect(painted.painted.alpha).toBe(painted.white.alpha);

    const white = hideObjectView(hide, "hidden", "white", "gouache");
    expect(white.visibleBody).toBe("white");
    expect(white.white.key).toBe(hide.spritePair.white);
    expect(white.painted.key).toBe(hide.spritePair.painted.gouache);
    expect(white.painted.alpha).toBe(white.white.alpha);

    const off = hideObjectView(hide, "found", "off", "roughrender");
    expect(off.visibleBody).toBe("off");
    expect(off.painted.visible).toBe(false);
    expect(off.white.visible).toBe(false);
    expect(off.alpha).toBe(0);
  });

  it("switches found hides to the white sprite in painted debug mode", () => {
    const level = loadLidoFixture();
    const state = revealHide(createHideStateMap(level), "li-02");
    const view = hideObjectViews(level, state, "painted", "screenprint").find((item) => item.id === "li-02");

    expect(view).toMatchObject({
      phase: "found",
      visibleBody: "white",
      hittable: false,
      white: expect.objectContaining({ visible: true }),
      painted: expect.objectContaining({ visible: false }),
    });
  });
});
