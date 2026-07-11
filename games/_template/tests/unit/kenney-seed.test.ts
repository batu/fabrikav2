import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseShellAssetCatalog } from "@fabrikav2/kernel";
import { describe, expect, it } from "vitest";
import { pngFacts } from "./png-facts.mjs";

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

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
}

function opaquePngWithTrnsText(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("tEXt", Buffer.from("Comment\0contains tRNS text", "latin1")),
    pngChunk("IDAT", Buffer.alloc(0)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
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
      const facts = pngFacts(bytes);
      expect(facts.hasAlpha).toBe(asset.hasAlpha);
      expect(facts.width).toBe(asset.width);
      expect(facts.height).toBe(asset.height);
      expect(bytes.byteLength).toBe(asset.bytes);
      expect(`sha256-${createHash("sha256").update(bytes).digest("hex")}`).toBe(asset.sha256);
      expect(asset.provenance.sourceHash).toBe(asset.sha256);
      expect(asset.provenance.license).toBe("CC0-1.0");
    }
  });

  it("recognizes transparency only from a real PNG chunk", () => {
    expect(pngFacts(opaquePngWithTrnsText()).hasAlpha).toBe(false);
  });
});
