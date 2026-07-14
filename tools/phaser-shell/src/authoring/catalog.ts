// Curated R9 asset catalog for the Phaser Editor authoring lane (U5, KTD-E).
//
// The catalog is DATA (`authoring/catalog/catalog.json`): the design owner's
// curated tray. Every entry is a frozen `design/assets/*.png` source raster with
// the full R9 metadata set — id, human name, detailed purpose, slot
// compatibility, source dimensions, alpha policy, provenance. This module loads
// and VALIDATES it against two authorities:
//   1. the frozen kernel v2 contract — the slot must exist, its compatible roles
//      and alpha policy must match what the catalog claims;
//   2. the frozen seed manifest — the bytes (path/dimensions/sha256/provenance)
//      must match `design/kenney-seed.manifest.json`, so the tray can never point
//      at a non-seed or altered raster.
// It also validates the editor `asset-pack.json`: pack keys correspond 1:1 to the
// catalog, and the ONLY font entries are the two frozen hash-bound TTFs.
import { shellPresentationContractV2 } from '@fabrikav2/kernel';
import { sha256 } from '../publish/manifest.ts';
import type {
  ShellAssetCatalog,
  ShellAssetProvenance,
} from '@fabrikav2/kernel';

export interface CatalogEntry {
  id: string;
  packKey: string;
  name: string;
  purpose: string;
  slotId: string;
  slotCompatibility: string[];
  dimensions: { width: number; height: number };
  alphaPolicy: 'allowed' | 'required' | 'forbidden';
  path: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: number;
  hasAlpha: boolean;
  sha256: string;
  provenance: ShellAssetProvenance;
}

export interface Catalog {
  contractId: string;
  contractVersion: string;
  description: string;
  entries: CatalogEntry[];
}

/** A seed asset as recorded in `design/kenney-seed.manifest.json` (byte authority). */
export interface SeedAsset {
  id: string;
  slotId: string;
  path: string;
  width: number;
  height: number;
  sha256: string;
  provenance: ShellAssetProvenance;
}

export interface CatalogIssue {
  entry: string;
  code: string;
  detail: string;
}

const contract = shellPresentationContractV2;
const slotsById = new Map(contract.assetSlots.map((slot) => [slot.id, slot]));

/** Parse a raw catalog document; throws TypeError on a structurally invalid shape. */
export function parseCatalog(raw: unknown): Catalog {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('catalog document must be an object');
  }
  const doc = raw as Record<string, unknown>;
  if (!Array.isArray(doc['entries'])) {
    throw new TypeError('catalog.entries must be an array');
  }
  return doc as unknown as Catalog;
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((value) => set.has(value));
}

/**
 * Validate the curated catalog against the frozen contract and the seed manifest.
 * Returns an array of issues; an empty array means the catalog is well-formed and
 * every entry resolves to a frozen seed raster with contract-consistent metadata.
 */
export function validateCatalog(
  catalog: Catalog,
  seedAssets: readonly SeedAsset[],
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const seedById = new Map(seedAssets.map((asset) => [asset.id, asset]));
  const seenIds = new Set<string>();
  const seenPackKeys = new Set<string>();

  if (catalog.contractId !== contract.contractId) {
    issues.push({ entry: '$', code: 'contract-mismatch', detail: `contractId ${catalog.contractId}` });
  }
  if (catalog.contractVersion !== contract.contractVersion) {
    issues.push({ entry: '$', code: 'contract-mismatch', detail: `contractVersion ${catalog.contractVersion}` });
  }

  for (const entry of catalog.entries) {
    const at = entry.id || '(unnamed)';
    if (seenIds.has(entry.id)) issues.push({ entry: at, code: 'duplicate-id', detail: entry.id });
    seenIds.add(entry.id);
    if (seenPackKeys.has(entry.packKey)) {
      issues.push({ entry: at, code: 'duplicate-pack-key', detail: entry.packKey });
    }
    seenPackKeys.add(entry.packKey);

    const slot = slotsById.get(entry.slotId);
    if (!slot) {
      issues.push({ entry: at, code: 'unknown-slot', detail: entry.slotId });
      continue;
    }
    if (!sameStringSet(entry.slotCompatibility, slot.compatibleRoleIds)) {
      issues.push({
        entry: at,
        code: 'slot-compatibility-drift',
        detail: `expected ${JSON.stringify(slot.compatibleRoleIds)}`,
      });
    }
    if (entry.alphaPolicy !== slot.alpha) {
      issues.push({ entry: at, code: 'alpha-policy-drift', detail: `expected ${slot.alpha}` });
    }

    const seed = seedById.get(entry.id);
    if (!seed) {
      issues.push({ entry: at, code: 'not-in-seed', detail: 'no frozen seed asset with this id' });
      continue;
    }
    if (seed.path !== entry.path) {
      issues.push({ entry: at, code: 'path-drift', detail: `seed path ${seed.path}` });
    }
    if (seed.slotId !== entry.slotId) {
      issues.push({ entry: at, code: 'slot-drift', detail: `seed slot ${seed.slotId}` });
    }
    if (seed.width !== entry.dimensions.width || seed.height !== entry.dimensions.height) {
      issues.push({ entry: at, code: 'dimension-drift', detail: `seed ${seed.width}x${seed.height}` });
    }
    if (seed.sha256 !== entry.sha256) {
      issues.push({ entry: at, code: 'hash-drift', detail: 'sha256 differs from the frozen seed' });
    }
    if (seed.provenance.license !== entry.provenance.license) {
      issues.push({ entry: at, code: 'provenance-drift', detail: `seed license ${seed.provenance.license}` });
    }
  }
  return issues;
}

/** Exact raw-font declarations accepted by Phaser Editor 5's FontImporter. */
export const ALLOWED_EDITOR_FONTS = [
  {
    key: 'kenney_future',
    url: 'fonts/kenney-future.ttf',
    type: 'font',
    format: 'truetype',
    sha256: 'sha256-7a55b07f5968fac872648a7c5e959bd2b93e06f63153b585d56e4d5298ddff61',
  },
  {
    key: 'kenney_future_narrow',
    url: 'fonts/kenney-future-narrow.ttf',
    type: 'font',
    format: 'truetype',
    sha256: 'sha256-17e182587a3264dcf9e5b17c055715d5597187546ce81925c64e9184c26d597f',
  },
] as const;

export interface EditorPackFile {
  type?: unknown;
  key?: unknown;
  url?: unknown;
  format?: unknown;
  descriptors?: unknown;
}

/** Flatten every declared file from every non-meta asset-pack section. */
export function editorPackFiles(pack: unknown): EditorPackFile[] {
  if (pack === null || typeof pack !== 'object') return [];
  const files: EditorPackFile[] = [];
  for (const [section, value] of Object.entries(pack as Record<string, unknown>)) {
    if (section === 'meta' || value === null || typeof value !== 'object') continue;
    const sectionFiles = (value as Record<string, unknown>)['files'];
    if (Array.isArray(sectionFiles)) files.push(...(sectionFiles as EditorPackFile[]));
  }
  return files;
}

function isEmptyRecord(value: unknown): boolean {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).length === 0;
}

/**
 * Validate the editor `asset-pack.json`: every image key corresponds to a catalog
 * entry (and vice versa), and the only non-image entries are the two frozen fonts.
 */
export function validateEditorPack(pack: unknown, catalog: Catalog): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  if (pack === null || typeof pack !== 'object') {
    return [{ entry: '$', code: 'invalid-pack', detail: 'asset-pack must be an object' }];
  }
  const files = editorPackFiles(pack);
  const catalogByKey = new Map(catalog.entries.map((entry) => [entry.packKey, entry]));
  const fontsByKey = new Map<string, (typeof ALLOWED_EDITOR_FONTS)[number]>(
    ALLOWED_EDITOR_FONTS.map((font) => [font.key, font]),
  );
  const seen = new Set<string>();
  const imageKeys = new Set<string>();
  const fontKeys = new Set<string>();

  for (const file of files) {
    const key = String(file.key ?? '');
    if (seen.has(key)) {
      issues.push({ entry: key || '(missing)', code: 'duplicate-pack-key', detail: key });
    }
    seen.add(key);

    const catalogEntry = catalogByKey.get(key);
    if (catalogEntry) {
      imageKeys.add(key);
      if (file.type !== 'image' || file.url !== catalogEntry.path) {
        issues.push({
          entry: key,
          code: 'pack-schema-drift',
          detail: `expected image ${catalogEntry.path}`,
        });
      }
      continue;
    }

    const font = fontsByKey.get(key);
    if (font) {
      fontKeys.add(key);
      if (
        file.type !== font.type
        || file.url !== font.url
        || file.format !== font.format
        || !isEmptyRecord(file.descriptors)
      ) {
        issues.push({
          entry: key,
          code: 'font-schema-drift',
          detail: `expected raw ${font.format} font at ${font.url}`,
        });
      }
      continue;
    }

    if (file.type === 'image') {
      issues.push({ entry: key, code: 'pack-key-orphan', detail: key });
    } else {
      issues.push({ entry: key, code: 'unexpected-font', detail: `${key} is not a frozen TTF` });
    }
  }

  for (const entry of catalog.entries) {
    if (!imageKeys.has(entry.packKey)) {
      issues.push({ entry: entry.id, code: 'pack-key-missing', detail: entry.packKey });
    }
  }
  for (const font of ALLOWED_EDITOR_FONTS) {
    if (!fontKeys.has(font.key)) {
      issues.push({ entry: font.key, code: 'pack-font-missing', detail: font.url });
    }
  }
  return issues;
}

/**
 * Validate the bytes resolved by the editor pack. The map is keyed by each
 * pack-relative URL (for example `assets/icon-control-play.png`).
 */
export function validateEditorAssetBytes(
  pack: unknown,
  catalog: Catalog,
  bytesByUrl: ReadonlyMap<string, Buffer>,
): CatalogIssue[] {
  const issues = validateEditorPack(pack, catalog);
  const catalogByKey = new Map(catalog.entries.map((entry) => [entry.packKey, entry]));
  const fontsByKey = new Map<string, (typeof ALLOWED_EDITOR_FONTS)[number]>(
    ALLOWED_EDITOR_FONTS.map((font) => [font.key, font]),
  );

  for (const file of editorPackFiles(pack)) {
    const key = String(file.key ?? '');
    const url = String(file.url ?? '');
    const bytes = bytesByUrl.get(url);
    if (!bytes) {
      issues.push({ entry: key || url, code: 'asset-file-missing', detail: url });
      continue;
    }
    const expected = catalogByKey.get(key)?.sha256 ?? fontsByKey.get(key)?.sha256;
    if (!expected) continue;
    const actual = sha256(bytes);
    if (actual !== expected) {
      issues.push({ entry: key, code: 'asset-hash-drift', detail: `${url} hash differs from frozen source` });
    }
  }
  return issues;
}

/** Project the curated catalog onto the kernel `ShellAssetCatalog` used by the parser. */
export function toShellAssetCatalog(catalog: Catalog): ShellAssetCatalog {
  return {
    contractId: catalog.contractId,
    contractVersion: catalog.contractVersion,
    assets: catalog.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.purpose,
      slotId: entry.slotId,
      path: entry.path,
      mimeType: entry.mimeType,
      width: entry.dimensions.width,
      height: entry.dimensions.height,
      bytes: entry.bytes,
      hasAlpha: entry.hasAlpha,
      sha256: entry.sha256,
      provenance: entry.provenance,
    })),
  };
}

/** Index the catalog by asset id for O(1) lookups in validate/publish. */
export function indexById(catalog: Catalog): Map<string, CatalogEntry> {
  return new Map(catalog.entries.map((entry) => [entry.id, entry]));
}
