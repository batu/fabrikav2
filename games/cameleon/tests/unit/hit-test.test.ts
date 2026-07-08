import { describe, expect, it } from "vitest";

import { createHideStateMap, revealHide } from "../../src/game/hideState.ts";
import { hitTestLevel } from "../../src/game/hitTest.ts";
import { rectCenter } from "../../src/game/level.ts";
import { loadLidoFixture } from "./lidoFixture.ts";

describe("Cameleon hit testing", () => {
  it("classifies taps inside an unfound hide rect", () => {
    const level = loadLidoFixture();
    const state = createHideStateMap(level);
    const result = hitTestLevel(level, rectCenter(level.hides[0]!.rect), state);

    expect(result).toMatchObject({ kind: "hide", hide: expect.objectContaining({ id: "li-01" }) });
  });

  it("classifies decoys when no live hide owns the point", () => {
    const level = loadLidoFixture();
    const state = createHideStateMap(level);
    const result = hitTestLevel(level, rectCenter(level.decoys[0]!.rect), state);

    expect(result).toMatchObject({ kind: "decoy", decoy: expect.objectContaining({ id: "dc-rules-pictograms" }) });
  });

  it("does not let already-found hides be hit again", () => {
    const level = loadLidoFixture();
    const state = revealHide(createHideStateMap(level), "li-01");
    const result = hitTestLevel(level, rectCenter(level.hides[0]!.rect), state);

    expect(result.kind).not.toBe("hide");
  });

  it("returns miss outside authored hide and decoy rects", () => {
    const level = loadLidoFixture();
    const result = hitTestLevel(level, { x: 18, y: 1380 }, createHideStateMap(level));

    expect(result).toEqual({ kind: "miss" });
  });
});
