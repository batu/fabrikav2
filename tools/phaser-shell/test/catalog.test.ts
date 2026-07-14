import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { parseShellAssetCatalogDocument } from '@fabrikav2/kernel';
import {
  parseCatalog,
  validateCatalog,
  validateEditorPack,
  validateEditorAssetBytes,
  toShellAssetCatalog,
  indexById,
  type Catalog,
  type SeedAsset,
} from '../src/authoring/catalog.ts';
import { readJson, repoPath } from './helpers.ts';

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

  it('ships every editor-pack byte at its declared URL with the frozen source hash', () => {
    const pack = readJson(...PACK_PATH) as Record<string, { files: Array<Record<string, unknown>> }>;
    const files = pack['shell-authoring'].files;
    const expectedHashes = new Map(catalog.entries.map((entry) => [entry.path, entry.sha256]));
    expectedHashes.set(
      'fonts/kenney-future.ttf',
      'sha256-7a55b07f5968fac872648a7c5e959bd2b93e06f63153b585d56e4d5298ddff61',
    );
    expectedHashes.set(
      'fonts/kenney-future-narrow.ttf',
      'sha256-17e182587a3264dcf9e5b17c055715d5597187546ce81925c64e9184c26d597f',
    );

    expect(files).toHaveLength(expectedHashes.size);
    for (const file of files) {
      const url = String(file['url']);
      const bytes = readFileSync(repoPath(
        'games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'public', url,
      ));
      const digest = `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
      expect(digest, url).toBe(expectedHashes.get(url));
    }
    expect(statSync(repoPath(
      'games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'public', 'publicroot',
    )).size).toBe(0);

    const bytesByUrl = new Map(files.map((file) => {
      const url = String(file['url']);
      return [url, readFileSync(repoPath(
        'games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'public', url,
      ))];
    }));
    expect(validateEditorAssetBytes(pack, catalog, bytesByUrl)).toEqual([]);
  });

  it('declares raw TTFs with Phaser Editor 5 font-file metadata', () => {
    const pack = readJson(...PACK_PATH) as Record<string, { files: Array<Record<string, unknown>> }>;
    const fonts = pack['shell-authoring'].files.filter((file) => String(file['url']).endsWith('.ttf'));
    expect(fonts).toEqual([
      {
        url: 'fonts/kenney-future.ttf',
        type: 'font',
        key: 'kenney_future',
        format: 'truetype',
        descriptors: {},
      },
      {
        url: 'fonts/kenney-future-narrow.ttf',
        type: 'font',
        key: 'kenney_future_narrow',
        format: 'truetype',
        descriptors: {},
      },
    ]);
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
      pack['shell-authoring'].files.push({ url: 'fonts/evil.ttf', type: 'font', key: 'evil_font' });
      const issues = validateEditorPack(pack, catalog);
      expect(issues.some((i) => i.code === 'unexpected-font')).toBe(true);
    });

    it('rejects a frozen font declared with the wrong Phaser Editor asset type', () => {
      const pack = readJson(...PACK_PATH) as Record<string, { files: Array<Record<string, unknown>> }>;
      const font = pack['shell-authoring'].files.find((file) => file['key'] === 'kenney_future')!;
      font['type'] = 'bitmapFont';
      const issues = validateEditorPack(pack, catalog);
      expect(issues.some((i) => i.code === 'font-schema-drift')).toBe(true);
    });

    it('rejects a missing or byte-drifted editor payload', () => {
      const pack = readJson(...PACK_PATH) as Record<string, { files: Array<Record<string, unknown>> }>;
      const files = pack['shell-authoring'].files;
      const bytesByUrl = new Map(files.map((file) => {
        const url = String(file['url']);
        return [url, readFileSync(repoPath(
          'games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'public', url,
        ))];
      }));
      bytesByUrl.delete('fonts/kenney-future.ttf');
      bytesByUrl.set('assets/icon-control-play.png', Buffer.from('tampered'));
      const issues = validateEditorAssetBytes(pack, catalog, bytesByUrl);
      expect(issues.some((i) => i.code === 'asset-file-missing')).toBe(true);
      expect(issues.some((i) => i.code === 'asset-hash-drift')).toBe(true);
    });
  });

  it('indexById gives O(1) lookup', () => {
    const index = indexById(catalog);
    expect(index.get(catalog.entries[0].id)?.id).toBe(catalog.entries[0].id);
  });
});
