import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseShellAssetCatalog } from "@fabrikav2/kernel";
import { describe, expect, it } from "vitest";

interface SeedSource {
  readonly id: string;
  readonly approvedSourcePath: string;
  readonly license: string;
  readonly licenseSourcePath: string;
  readonly licenseFile: string;
  readonly licenseSourceSha256: string;
  readonly licenseSha256: string;
}

interface SeedManifest {
  readonly schemaVersion: number;
  readonly seedKind: string;
  readonly canonicalStates: readonly string[];
  readonly sources: readonly SeedSource[];
  readonly assetCatalog: unknown;
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(dirname, "../..");
const assetsRoot = path.join(templateRoot, "design/assets");
const manifestBytes = fs.readFileSync(
  path.join(templateRoot, "design/kenney-seed.manifest.json"),
  "utf8",
);
const manifest = JSON.parse(manifestBytes) as SeedManifest;

function pngHasAlpha(bytes: Buffer): boolean {
  const colorType = bytes.readUInt8(25);
  return colorType === 4 || colorType === 6 || bytes.includes(Buffer.from("tRNS"));
}

describe("Kenney semantic seed manifest", () => {
  it("wraps one canonical U1 asset catalog without a parallel role authority", () => {
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.seedKind).toBe("behavior-neutral-semantic-fixtures");
    expect(manifest.canonicalStates).toEqual([
      "menu",
      "level",
      "settings",
      "pause",
      "win",
      "fail",
    ]);
    expect(manifestBytes).not.toContain("compatibleRoles");
    expect(Object.keys(manifest)).toEqual([
      "schemaVersion",
      "seedKind",
      "canonicalStates",
      "sources",
      "assetCatalog",
    ]);

    const catalog = parseShellAssetCatalog(manifest.assetCatalog);
    expect(catalog.assets).toHaveLength(23);

    const ids = catalog.assets.map((asset) => asset.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids)).toHaveLength(ids.length);

    for (const asset of catalog.assets) {
      const semanticName = asset.id.slice(asset.slotId.length + 1);
      expect(asset.id.startsWith(`${asset.slotId}.`)).toBe(true);
      expect(semanticName.length).toBeGreaterThan(0);
      expect(asset.path).toBe(
        `assets/${asset.slotId}-${semanticName.replaceAll(".", "-")}.png`,
      );
      expect(asset.name.trim().length).toBeGreaterThanOrEqual(4);
      expect(asset.description.trim().length).toBeGreaterThanOrEqual(60);
      expect(asset.description).not.toMatch(/placeholder|compatible role/i);
    }
  });

  it("keeps the two audited CC0 sources and pinned license copies", () => {
    expect(manifest.sources.map((source) => source.id)).toEqual([
      "kenney-ui-pack-2.0",
      "kenney-game-icons-1.0",
    ]);
    for (const source of manifest.sources) {
      expect(source.license).toBe("CC0-1.0");
      expect(path.isAbsolute(source.approvedSourcePath)).toBe(false);
      expect(source.approvedSourcePath.split(/[\\/]/)).not.toContain("..");
      expect(source.licenseSourcePath).toBe("License.txt");
      expect(source.licenseSourceSha256).toMatch(/^[a-f0-9]{64}$/);
      const licenseBytes = fs.readFileSync(path.join(templateRoot, "design", source.licenseFile));
      expect(createHash("sha256").update(licenseBytes).digest("hex")).toBe(
        source.licenseSha256,
      );
    }
  });

  it("matches every committed PNG to its canonical byte facts", () => {
    const catalog = parseShellAssetCatalog(manifest.assetCatalog);
    const committedPngs = fs
      .readdirSync(assetsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
      .map((entry) => `assets/${entry.name}`)
      .sort();

    expect(committedPngs).toEqual(catalog.assets.map((asset) => asset.path).sort());

    for (const asset of catalog.assets) {
      const bytes = fs.readFileSync(path.join(templateRoot, "design", asset.path));
      expect(asset.mimeType).toBe("image/png");
      expect(asset.hasAlpha).toBe(true);
      expect(pngHasAlpha(bytes)).toBe(asset.hasAlpha);
      expect(bytes.readUInt32BE(16)).toBe(asset.width);
      expect(bytes.readUInt32BE(20)).toBe(asset.height);
      expect(bytes.byteLength).toBe(asset.bytes);
      expect(`sha256-${createHash("sha256").update(bytes).digest("hex")}`).toBe(asset.sha256);
      expect(asset.provenance.sourceHash).toBe(asset.sha256);
      expect(asset.provenance.license).toBe("CC0-1.0");
    }
  });
});
