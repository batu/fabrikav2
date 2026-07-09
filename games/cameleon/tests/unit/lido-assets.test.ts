import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error - shared PNG helper is a plain ESM tool module.
import { decodePng } from "../../../../tools/refcap-compare/src/png.mjs";

import { assetEntriesForLevel, resolveCameleonAsset, type CameleonAssetEntry } from "../../src/game/assets.ts";
import { CAMELEON_DIRECTIONS, CAMELEON_LEVEL_IDS } from "../../src/game/level.ts";
import { createHideStateMap } from "../../src/game/hideState.ts";
import { hitTestLevel } from "../../src/game/hitTest.ts";
import { rectCenter } from "../../src/game/level.ts";
import { loadAllCameleonLevelFixtures, loadLidoFixture } from "./lidoFixture.ts";

const GAME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ORGANIC_HIDE_IDS = ["li-01", "li-03", "li-04", "li-05", "li-09"] as const;

interface AssetIdentityManifest {
  assets?: Record<string, { provenance?: unknown }>;
  "conductor-art-v1"?: Array<{ path?: string }>;
  "derived-lido-art-v1"?: Array<{ path?: string }>;
  "conductor-art-v2"?: Array<{ path?: string }>;
}

interface AlphaImage {
  width: number;
  height: number;
  alpha: Uint8Array;
}

function manifest(): AssetIdentityManifest {
  return JSON.parse(readFileSync(resolve(GAME_ROOT, "design/asset-identity.json"), "utf8")) as AssetIdentityManifest;
}

function physicalPath(entry: CameleonAssetEntry): string {
  return resolve(GAME_ROOT, "public", entry.publicPath);
}

function manifestKey(entry: CameleonAssetEntry): string {
  return `public/${entry.publicPath}`;
}

function hasProvenance(entry: CameleonAssetEntry, identity: AssetIdentityManifest): boolean {
  const key = manifestKey(entry);
  return Boolean(
    identity.assets?.[key]?.provenance ||
    identity["conductor-art-v1"]?.some((item) => item.path === key) ||
    identity["derived-lido-art-v1"]?.some((item) => item.path === key) ||
    identity["conductor-art-v2"]?.some((item) => item.path === key),
  );
}

function readAlpha(entry: CameleonAssetEntry): AlphaImage {
  const png = decodePng(readFileSync(physicalPath(entry))) as { width: number; height: number; data: Uint8Array };
  const alpha = new Uint8Array(png.width * png.height);
  for (let src = 3, dst = 0; src < png.data.length; src += 4, dst += 1) {
    alpha[dst] = png.data[src];
  }
  return { width: png.width, height: png.height, alpha };
}

function firstMismatch(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

describe("Cameleon production assets", () => {
  it("resolves every level key to a committed file with provenance", () => {
    const levels = loadAllCameleonLevelFixtures();
    const identity = manifest();

    for (const level of levels) {
      const entries = assetEntriesForLevel(level);
      expect(entries).toHaveLength(new Set(entries.map((entry) => entry.key)).size);
      for (const entry of entries) {
        expect(existsSync(physicalPath(entry)), `${level.id}:${entry.key}`).toBe(true);
        expect(hasProvenance(entry, identity), `${level.id}:${entry.key}`).toBe(true);
      }
    }
  });

  it("keeps per-direction panels real files in conductor order (no temporary aliases)", () => {
    const level = loadLidoFixture();

    for (const direction of CAMELEON_DIRECTIONS) {
      expect(level.assetKeys.zonePanels[direction].map((key) => resolveCameleonAsset(key).publicPath)).toEqual([
        `levels/lido/panels/${direction}/panel-a.png`,
        `levels/lido/panels/${direction}/panel-b.png`,
        `levels/lido/panels/${direction}/panel-c.png`,
      ]);
    }

    const aliases = CAMELEON_DIRECTIONS.flatMap((direction) =>
      level.assetKeys.zonePanels[direction].map((key) => resolveCameleonAsset(key))
    ).filter((entry) => entry.temporary);
    expect(aliases).toHaveLength(0);
  });

  it("maps new-level gouache and roughrender keys to documented temporary screenprint aliases", () => {
    const newLevels = loadAllCameleonLevelFixtures().filter((level) => level.id !== "lido");

    expect(newLevels.map((level) => level.id)).toEqual(CAMELEON_LEVEL_IDS.filter((levelId) => levelId !== "lido"));
    for (const level of newLevels) {
      for (const direction of ["gouache", "roughrender"] as const) {
        const panelEntries = level.assetKeys.zonePanels[direction].map((key) => resolveCameleonAsset(key));
        expect(panelEntries).toHaveLength(3);
        for (const [index, entry] of panelEntries.entries()) {
          expect(entry).toMatchObject({
            publicPath: `levels/${level.id}/panels/screenprint/panel-${String.fromCharCode(97 + index)}.png`,
            aliasOf: `${level.id}.screenprint.panel-${String.fromCharCode(97 + index)}`,
            temporary: true,
            note: "conductor generates gouache/roughrender variants",
          });
        }

        for (const hide of level.hides) {
          expect(resolveCameleonAsset(hide.spritePair.painted[direction])).toMatchObject({
            publicPath: `levels/${level.id}/sprites/screenprint/${hide.id}-painted.png`,
            aliasOf: `${level.id}.screenprint.${hide.id}.painted`,
            temporary: true,
            note: "conductor generates gouache/roughrender variants",
          });
        }
      }
    }
  });

  it("keeps derived organic variants alpha-locked to the white reveal", () => {
    for (const hideId of ORGANIC_HIDE_IDS) {
      const white = readAlpha(resolveCameleonAsset(`lido.${hideId}.white`));
      expect(white.alpha.some((value) => value > 0)).toBe(true);

      for (const direction of CAMELEON_DIRECTIONS) {
        const painted = readAlpha(resolveCameleonAsset(`lido.${direction}.${hideId}.painted`));
        expect(painted.width).toBe(white.width);
        expect(painted.height).toBe(white.height);
        expect(firstMismatch(painted.alpha, white.alpha), `${hideId} ${direction}`).toBe(-1);
      }
    }
  });

  it("keeps seam overlays visual-only", () => {
    const level = loadLidoFixture();
    const hideState = createHideStateMap(level);

    expect(level.visualOverlays).toHaveLength(2);
    for (const overlay of level.visualOverlays) {
      expect(hitTestLevel(level, rectCenter(overlay.rect), hideState)).toEqual({ kind: "miss" });
    }
  });
});
