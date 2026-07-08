import { describe, expect, it } from "vitest";

import { CAMELEON_DIRECTIONS, parseLevelDefinition } from "../../src/game/level.ts";
import { loadLevelDefinition } from "../../src/game/levelLoader.ts";
import { loadLidoFixture } from "./lidoFixture.ts";

describe("Cameleon Lido level schema", () => {
  it("loads the authored Sunwash Lido roster and per-direction asset keys", () => {
    const level = loadLidoFixture();

    expect(level.world).toEqual({ width: 4800, height: 1440, zoneWidth: 960 });
    expect(level.winAt).toBe(8);
    expect(level.hides.map((hide) => hide.id)).toEqual([
      "li-01",
      "li-02",
      "li-03",
      "li-04",
      "li-05",
      "li-06",
      "li-07",
      "li-08",
      "li-09",
      "li-10",
    ]);
    expect(new Set(level.hides.map((hide) => hide.zone))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(level.decoys).toHaveLength(10);

    for (const direction of CAMELEON_DIRECTIONS) {
      expect(level.assetKeys.zonePanels[direction]).toHaveLength(5);
      for (const hide of level.hides) {
        expect(hide.spritePair.painted[direction]).toContain(direction);
        expect(hide.spritePair.white).toContain(hide.id);
      }
    }
  });

  it("rejects bad hide rectangles before runtime starts", () => {
    const level = loadLidoFixture();
    const broken = {
      ...level,
      hides: [
        {
          ...level.hides[0],
          rect: { x: 100, y: 100, w: 50, h: 100 },
        },
      ],
    };

    expect(() => parseLevelDefinition(broken)).toThrow(/minimum hide edge/);
  });

  it("loads via the public JSON fetch contract", async () => {
    const level = loadLidoFixture();
    const fetcher = async (url: RequestInfo | URL): Promise<Response> =>
      new Response(JSON.stringify(level), { status: String(url).endsWith("level.json") ? 200 : 404 });

    await expect(loadLevelDefinition("/levels/lido/level.json", fetcher)).resolves.toMatchObject({
      id: "lido",
      hides: expect.arrayContaining([expect.objectContaining({ id: "li-10" })]),
    });
  });
});
