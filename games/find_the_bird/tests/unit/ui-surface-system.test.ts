import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface SurfaceManifest {
  textures: Record<string, {
    runtime: string;
    tileSize: [number, number];
    edgeMeanAbsoluteError: { horizontal: number; vertical: number };
    sha256: string;
  }>;
  nineSliceSurfaces: Record<string, {
    runtime: string;
    size: [number, number];
    slice: number;
    center: string;
    sha256: string;
  }>;
}

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "design/ui-surfaces.json"), "utf8"),
) as SurfaceManifest;
const css = readFileSync(join(process.cwd(), "src/ui/styles.css"), "utf8");

function publicFile(runtime: string): string {
  return join(process.cwd(), "public", runtime.replace(/^\//, ""));
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("Cozy Garden UI surface system", () => {
  it("pins four exact seamless textures", () => {
    expect(Object.keys(manifest.textures).sort()).toEqual([
      "canvas-cream",
      "painted-olive",
      "painted-sky",
      "wood-honey",
    ]);
    for (const texture of Object.values(manifest.textures)) {
      expect(texture.tileSize).toEqual([256, 256]);
      expect(texture.edgeMeanAbsoluteError).toEqual({ horizontal: 0, vertical: 0 });
      expect(sha256(publicFile(texture.runtime))).toBe(texture.sha256);
    }
  });

  it("pins reusable transparent-center nine-slice frames", () => {
    expect(Object.keys(manifest.nineSliceSurfaces).sort()).toEqual([
      "button-olive",
      "button-sky",
      "panel-honey",
      "panel-olive",
    ]);
    for (const surface of Object.values(manifest.nineSliceSurfaces)) {
      expect(surface.slice).toBeGreaterThan(0);
      expect(surface.slice * 2).toBeLessThanOrEqual(Math.min(...surface.size));
      expect(surface.center).toBe("transparent");
      expect(sha256(publicFile(surface.runtime))).toBe(surface.sha256);
    }
  });

  it("keeps the later generated surface pass archived outside reachable viewport widths", () => {
    expect(css).toContain("@media (max-width: 0px) and (min-width: 1px)");
    expect(css).toContain("Archived complete-surface pass");
    expect(css).toContain("border-image-source: var(--cg-frame-panel-honey)");
    expect(css).toContain("var(--cg-texture-canvas)");
    expect(css).toContain(".home-page-settings *::after");
    expect(css).toContain("background-image: none !important");
    expect(css).toMatch(
      /\.home-map-stage \.fab-levelmap-node\.current::before\s*\{[^}]*content:\s*none;/s,
    );
    expect(css).toMatch(
      /\.home-page-settings \{\s*background-color:\s*#f4ead1;/s,
    );
  });
});
