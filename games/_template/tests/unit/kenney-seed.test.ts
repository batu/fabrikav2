import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface SeedAsset {
  readonly file: string;
  readonly source: { readonly pack: string; readonly path: string };
  readonly dimensions: { readonly width: number; readonly height: number };
  readonly alpha: "required";
  readonly compatibleRoles: readonly string[];
  readonly sha256: string;
}

interface SeedManifest {
  readonly sources: readonly { readonly id: string; readonly license: string; readonly licenseFile: string }[];
  readonly assets: readonly SeedAsset[];
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(dirname, "../..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(templateRoot, "design/kenney-seed.manifest.json"), "utf8"),
) as SeedManifest;

function pngHasAlpha(bytes: Buffer): boolean {
  const colorType = bytes.readUInt8(25);
  return colorType === 4 || colorType === 6 || bytes.includes(Buffer.from("tRNS"));
}

describe("Kenney semantic seed manifest", () => {
  it("keeps 29 semantic PNG fixtures with complete CC0 provenance and copied-byte hashes", () => {
    expect(manifest.sources.map((source) => source.id)).toEqual([
      "kenney-ui-pack-2.0",
      "kenney-game-icons-1.0",
    ]);
    for (const source of manifest.sources) {
      expect(source.license).toBe("CC0-1.0");
      expect(fs.existsSync(path.join(templateRoot, "design", source.licenseFile))).toBe(true);
    }
    expect(manifest.assets).toHaveLength(29);

    for (const asset of manifest.assets) {
      const bytes = fs.readFileSync(path.join(templateRoot, "design", asset.file));
      expect(asset.file).toMatch(/^assets\/[a-z0-9-]+\.png$/);
      expect(asset.source.pack).toMatch(/^kenney-/);
      expect(asset.source.path).toMatch(/^PNG\//);
      expect(asset.compatibleRoles.length).toBeGreaterThan(0);
      expect(asset.alpha).toBe("required");
      expect(pngHasAlpha(bytes)).toBe(true);
      expect(bytes.readUInt32BE(16)).toBe(asset.dimensions.width);
      expect(bytes.readUInt32BE(20)).toBe(asset.dimensions.height);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
    }
  });
});
