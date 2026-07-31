import { describe, expect, it } from "vitest";
import { isPlayableLevelAspect } from "../../src/data/playableAspect";

describe("playable level aspect", () => {
  it("accepts portrait, square, and wide level formats", () => {
    expect(isPlayableLevelAspect(768, 1376)).toBe(true);
    expect(isPlayableLevelAspect(4096, 4096)).toBe(true);
    expect(isPlayableLevelAspect(2400, 1376)).toBe(true);
  });

  it("continues rejecting unsupported mildly-landscape packages", () => {
    expect(isPlayableLevelAspect(1400, 1200)).toBe(false);
  });
});
