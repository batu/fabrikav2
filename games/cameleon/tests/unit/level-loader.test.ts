import { describe, expect, it } from "vitest";

import { CAMELEON_DIRECTIONS, CAMELEON_LEVEL_IDS, parseLevelDefinition, worldXForZone, zoneForWorldX } from "../../src/game/level.ts";
import { loadLevelDefinition, levelUrlForId } from "../../src/game/levelLoader.ts";
import { loadAllCameleonLevelFixtures, loadCameleonLevelFixture, loadLidoFixture } from "./lidoFixture.ts";

describe("Cameleon level schema", () => {
  it.each(CAMELEON_LEVEL_IDS)("loads the authored %s roster and per-direction asset keys", (levelId) => {
    const level = loadCameleonLevelFixture(levelId);

    expect(level.world).toEqual({ width: 4320, height: 1440, zoneWidth: 1440 });
    expect(level.winAt).toBe(8);
    expect(level.hides).toHaveLength(10);
    expect(level.hides.every((hide) => hide.zone >= 1 && hide.zone <= 5)).toBe(true);

    for (const direction of CAMELEON_DIRECTIONS) {
      expect(level.assetKeys.zonePanels[direction]).toHaveLength(3);
      for (const hide of level.hides) {
        expect(hide.spritePair.painted[direction]).toContain(direction);
        expect(hide.spritePair.white).toContain(hide.id);
      }
    }
  });

  it("keeps Lido's sprite-backed decoys and overlay seam contract", () => {
    const level = loadLidoFixture();

    expect(level.decoys).toHaveLength(12);
    expect(level.visualOverlays.map((overlay) => overlay.id)).toEqual([
      "seam-pillar-a-b",
      "seam-pillar-b-c",
    ]);
    for (const decoy of level.decoys) {
      expect(decoy.spriteKey).toMatch(/^lido\.screenprint\.decoy-/);
    }
  });

  it("keeps new-level baked decoys as hitbox-only entries", () => {
    const levels = loadAllCameleonLevelFixtures().filter((level) => level.id !== "lido");

    expect(levels.map((level) => [level.id, level.decoys.length])).toEqual([
      ["bathhouse", 4],
      ["waterpark", 4],
      ["museum", 4],
    ]);
    for (const level of levels) {
      expect(level.visualOverlays).toHaveLength(0);
      expect(level.decoys.every((decoy) => decoy.spriteKey === undefined)).toBe(true);
    }
    expect(levels.find((level) => level.id === "bathhouse")?.hides.find((hide) => hide.id === "bh-06")?.fx).toEqual({
      alpha: 0.55,
      tint: [188, 212, 200],
      tintAmt: 0.45,
    });
  });

  it("maps the three-panel world into five logical tour zones", () => {
    const level = loadLidoFixture();

    expect(CAMELEON_DIRECTIONS.map((direction) => level.assetKeys.zonePanels[direction].length)).toEqual([3, 3, 3]);
    expect([1, 2, 3, 4, 5].map((zone) => zoneForWorldX(level.world, worldXForZone(level.world, zone as 1 | 2 | 3 | 4 | 5)))).toEqual([
      1,
      2,
      3,
      4,
      5,
    ]);
    expect(zoneForWorldX(level.world, level.world.width - 1)).toBe(5);
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
    const levels = Object.fromEntries(loadAllCameleonLevelFixtures().map((level) => [level.id, level]));
    const fetcher = async (url: RequestInfo | URL): Promise<Response> =>
      new Response(JSON.stringify(levels[String(url).split("/").at(-2) ?? ""]), { status: String(url).endsWith("level.json") ? 200 : 404 });

    await expect(loadLevelDefinition("bathhouse", fetcher)).resolves.toMatchObject({
      id: "bathhouse",
      hides: expect.arrayContaining([expect.objectContaining({ id: "bh-10" })]),
    });
    expect(levelUrlForId("museum")).toBe("/levels/museum/level.json");
  });
});
