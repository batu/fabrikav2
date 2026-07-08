import { describe, expect, it } from "vitest";

import { parseCameleonQuery } from "../../src/game/query.ts";

describe("Cameleon query params", () => {
  it("defaults to poster/tap/painted", () => {
    expect(parseCameleonQuery("")).toEqual({
      bodies: "painted",
      dir: "poster",
      mode: "tap",
    });
  });

  it("accepts body, direction, and mode overrides", () => {
    expect(parseCameleonQuery("?bodies=white&dir=night&mode=confirm")).toEqual({
      bodies: "white",
      dir: "night",
      mode: "confirm",
    });
  });

  it("falls back on unknown override values", () => {
    expect(parseCameleonQuery("?bodies=xray&dir=hotel&mode=panic")).toEqual({
      bodies: "painted",
      dir: "poster",
      mode: "tap",
    });
  });
});
