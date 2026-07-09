import { describe, expect, it } from "vitest";

import { parseCameleonQuery } from "../../src/game/query.ts";

describe("Cameleon query params", () => {
  it("defaults to screenprint/tap/painted", () => {
    expect(parseCameleonQuery("")).toEqual({
      bodies: "painted",
      dir: "screenprint",
      mode: "tap",
    });
  });

  it("accepts body, direction, and mode overrides", () => {
    expect(parseCameleonQuery("?bodies=white&dir=roughrender&mode=confirm")).toEqual({
      bodies: "white",
      dir: "roughrender",
      mode: "confirm",
    });
  });

  it("falls back on unknown override values", () => {
    expect(parseCameleonQuery("?bodies=xray&dir=hotel&mode=panic")).toEqual({
      bodies: "painted",
      dir: "screenprint",
      mode: "tap",
    });
  });
});
