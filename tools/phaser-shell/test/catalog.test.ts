import { describe, it, expect } from 'vitest';
import { parseShellAssetCatalogDocument } from '@fabrikav2/kernel';
import {
  parseCatalog,
  validateCatalog,
  validateEditorPack,
  toShellAssetCatalog,
  indexById,
  type Catalog,
  type SeedAsset,
} from '../src/authoring/catalog.ts';
import { readJson } from './helpers.ts';

const CATALOG_PATH = ['games', 'shell_proof_phaser', 'authoring', 'catalog', 'catalog.json'];
const PACK_PATH = [
  'games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'public', 'assets', 'asset-pack.json',
];
const SEED_PATH = ['games', 'shell_proof_phaser', 'design', 'kenney-seed.manifest.json'];

function loadSeedAssets(): SeedAsset[] {
  const seed = readJson(...SEED_PATH) as {
    assetCatalog: { assets: SeedAsset[] };
  };
  return seed.assetCatalog.assets;
}

describe('P2 curated R9 catalog', () => {
  const catalog = parseCatalog(readJson(...CATALOG_PATH)) as Catalog;
  const seed = loadSeedAssets();

  it('every entry resolves to a frozen seed raster with contract-consistent metadata', () => {
    const issues = validateCatalog(catalog, seed);
    expect(issues).toEqual([]);
  });

  it('has the full 24-asset curated tray with unique ids and pack keys', () => {
    expect(catalog.entries.length).toBe(seed.length);
    const ids = new Set(catalog.entries.map((e) => e.id));
    const keys = new Set(catalog.entries.map((e) => e.packKey));
    expect(ids.size).toBe(catalog.entries.length);
    expect(keys.size).toBe(catalog.entries.length);
  });

  it('carries the full R9 metadata set on every entry', () => {
    for (const entry of catalog.entries) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.purpose.length).toBeGreaterThan(0);
      expect(entry.slotCompatibility.length).toBeGreaterThan(0);
      expect(entry.dimensions.width).toBeGreaterThan(0);
      expect(['allowed', 'required', 'forbidden']).toContain(entry.alphaPolicy);
      expect(entry.provenance.license.length).toBeGreaterThan(0);
    }
  });

  it('projects onto a kernel ShellAssetCatalog the kernel accepts', () => {
    const shellCatalog = toShellAssetCatalog(catalog);
    // Round-trips through the kernel's own strict parser.
    const parsed = parseShellAssetCatalogDocument(shellCatalog);
    expect(parsed.assets.length).toBe(catalog.entries.length);
  });

  it('editor asset-pack keys correspond 1:1 to the catalog and only frozen fonts are declared', () => {
    const pack = readJson(...PACK_PATH);
    const issues = validateEditorPack(pack, catalog);
    expect(issues).toEqual([]);
  });

  describe('fails closed on drift', () => {
    it('rejects an entry pointing at a non-seed asset', () => {
      const mutated: Catalog = structuredClone(catalog);
      mutated.entries[0].id = 'cat.not.a.seed.asset';
      const issues = validateCatalog(mutated, seed);
      expect(issues.some((i) => i.code === 'not-in-seed')).toBe(true);
    });

    it('rejects a slot-compatibility that disagrees with the contract', () => {
      const mutated: Catalog = structuredClone(catalog);
      mutated.entries[0].slotCompatibility = ['not-a-role'];
      const issues = validateCatalog(mutated, seed);
      expect(issues.some((i) => i.code === 'slot-compatibility-drift')).toBe(true);
    });

    it('rejects a tampered sha256', () => {
      const mutated: Catalog = structuredClone(catalog);
      mutated.entries[0].sha256 = 'sha256-deadbeef';
      const issues = validateCatalog(mutated, seed);
      expect(issues.some((i) => i.code === 'hash-drift')).toBe(true);
    });

    it('rejects an editor pack that declares a non-frozen font', () => {
      const pack = readJson(...PACK_PATH) as Record<string, { files: Array<Record<string, unknown>> }>;
      pack['shell-authoring'].files.push({ url: 'fonts/evil.ttf', type: 'bitmapFont', key: 'evil_font' });
      const issues = validateEditorPack(pack, catalog);
      expect(issues.some((i) => i.code === 'unexpected-font')).toBe(true);
    });
  });

  it('indexById gives O(1) lookup', () => {
    const index = indexById(catalog);
    expect(index.get(catalog.entries[0].id)?.id).toBe(catalog.entries[0].id);
  });
});
