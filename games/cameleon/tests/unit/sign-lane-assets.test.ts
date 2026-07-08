import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error - shared PNG helper is a plain ESM tool module.
import { decodePng } from "../../../../tools/refcap-compare/src/png.mjs";

const GAME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SPRITES_ROOT = resolve(GAME_ROOT, "public/levels/lido/sprites");

const PALETTES = ["poster", "riso", "night"] as const;
const HIDE_IDS = [
  "li-02-no-diving",
  "li-06-lane-rope",
  "li-07-fifth-poster-figure",
  "li-08-slipping-man",
  "li-10-soft-serve-mascot",
] as const;

interface AlphaImage {
  width: number;
  height: number;
  alpha: Uint8Array;
}

function readAlpha(path: string): AlphaImage {
  const png = decodePng(readFileSync(path)) as { width: number; height: number; data: Uint8Array };
  const alpha = new Uint8Array(png.width * png.height);
  for (let src = 3, dst = 0; src < png.data.length; src += 4, dst += 1) {
    alpha[dst] = png.data[src];
  }
  return { width: png.width, height: png.height, alpha };
}

function spritePath(...parts: string[]): string {
  return resolve(SPRITES_ROOT, ...parts);
}

function firstMismatch(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

describe("Cameleon sign-lane hide sprites", () => {
  it.each(HIDE_IDS)("uses one alpha silhouette for %s across painted and white variants", (hideId) => {
    const white = readAlpha(spritePath("white", `${hideId}-white.png`));
    expect(white.alpha.some((value) => value > 0)).toBe(true);

    for (const palette of PALETTES) {
      const painted = readAlpha(spritePath(palette, `${hideId}-painted.png`));
      expect(painted.width).toBe(white.width);
      expect(painted.height).toBe(white.height);
      expect(firstMismatch(painted.alpha, white.alpha)).toBe(-1);
    }
  });

  it("keeps rendered PNGs tied to committed SVG sources in asset identity", () => {
    const manifest = JSON.parse(readFileSync(resolve(GAME_ROOT, "design/asset-identity.json"), "utf8")) as {
      assets: Record<string, { source?: string; provenance?: { script?: string } }>;
    };

    for (const hideId of HIDE_IDS) {
      for (const palette of [...PALETTES, "white"] as const) {
        const suffix = palette === "white" ? "white" : "painted";
        const pngKey = `public/levels/lido/sprites/${palette}/${hideId}-${suffix}.png`;
        const svgKey = `public/levels/lido/sprites/source/${palette}/${hideId}-${suffix}.svg`;
        expect(manifest.assets[pngKey]?.source).toBe(svgKey);
        expect(manifest.assets[pngKey]?.provenance?.script).toBe("tools/cameleon-sign-lane-assets.mjs");
        expect(manifest.assets[svgKey]?.source).toBe(svgKey);
      }
    }
  });
});
