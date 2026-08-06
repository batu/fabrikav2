import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export const NATIVE_WEB_BUNDLE_MAX_BYTES = 100 * 1024 * 1024;

type ManifestValue = null | boolean | number | string | ManifestValue[] | { [key: string]: ManifestValue };
type ManifestObject = { [key: string]: ManifestValue };

interface NativePackageAsset extends ManifestObject {
  role: string;
  hash: string;
  size: number;
  path: string;
}

interface NativePackageMetadata {
  requiredAssets: NativePackageAsset[];
  optionalAssets: NativePackageAsset[];
  requiredBytes: number;
  packageDigest: string;
}

function manifestObject(value: ManifestValue, message: string): ManifestObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error(message);
  return value;
}

function assetPathWithinRoot(root: string, relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, '');
  const resolvedRoot = path.resolve(root);
  const assetPath = path.resolve(resolvedRoot, normalized);
  if (!assetPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Native public asset escapes public root: ${relativePath}`);
  }
  return assetPath;
}

function copyFileWithinRoot(publicRoot: string, outputRoot: string, relativePath: string): void {
  const normalized = relativePath.replace(/^\/+/, '');
  const source = assetPathWithinRoot(publicRoot, relativePath);
  if (!statSync(source, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Native public asset is missing: ${relativePath}`);
  }
  const destination = path.resolve(outputRoot, normalized);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination);
}

function collectManifestPaths(value: ManifestValue, paths: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectManifestPaths(item, paths);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'path' && typeof item === 'string') paths.add(item);
    else collectManifestPaths(item, paths);
  }
}

function directorySize(root: string): number {
  let bytes = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    bytes += entry.isDirectory() ? directorySize(entryPath) : statSync(entryPath).size;
  }
  return bytes;
}

function manifestLevels(value: ManifestValue, manifestPath: string): Array<{ [key: string]: ManifestValue }> {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || !Array.isArray(value.levels)) {
    throw new Error(`Native catalog manifest has no levels array: ${manifestPath}`);
  }
  return value.levels.map((level) => {
    if (level === null || Array.isArray(level) || typeof level !== 'object' || typeof level.id !== 'string') {
      throw new Error(`Native catalog manifest has a level without an id: ${manifestPath}`);
    }
    return level;
  });
}

function assetMetadata(outputRoot: string, relativePath: string): { hash: string; size: number } {
  const assetPath = assetPathWithinRoot(outputRoot, relativePath);
  const stat = statSync(assetPath, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new Error(`Native manifested asset is missing from output: ${relativePath}`);
  return {
    hash: createHash('sha256').update(readFileSync(assetPath)).digest('hex'),
    size: stat.size,
  };
}

function rewriteAssetMetadata(value: ManifestValue, outputRoot: string): ManifestValue {
  if (Array.isArray(value)) return value.map((item) => rewriteAssetMetadata(item, outputRoot));
  if (value === null || typeof value !== 'object') return value;

  const rewritten = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, rewriteAssetMetadata(item, outputRoot)]),
  ) as ManifestObject;
  if (typeof value.path !== 'string') return rewritten;
  const metadata = assetMetadata(outputRoot, value.path);
  return { ...rewritten, ...metadata };
}

function nativePackageAsset(value: ManifestValue, role: string, levelId: string): NativePackageAsset {
  const asset = manifestObject(value, `Native bundled level ${levelId} has invalid ${role} metadata`);
  if (
    typeof asset.path !== 'string'
    || typeof asset.hash !== 'string'
    || typeof asset.size !== 'number'
    || !Number.isSafeInteger(asset.size)
    || asset.size <= 0
  ) {
    throw new Error(`Native bundled level ${levelId} has incomplete ${role} metadata`);
  }
  return { role, hash: asset.hash, size: asset.size, path: asset.path };
}

function nativePackageAssets(
  assets: ManifestObject,
  key: string,
  rolePrefix: string,
  levelId: string,
): NativePackageAsset[] {
  const values = assets[key];
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new Error(`Native bundled level ${levelId} has invalid ${key} metadata`);
  return values.map((value, index) => nativePackageAsset(value, `${rolePrefix}:${index}`, levelId));
}

function nativeStyleVariantAssets(assets: ManifestObject, levelId: string): NativePackageAsset[] {
  const value = assets.styleVariants;
  if (value === undefined) return [];
  const variants = manifestObject(value, `Native bundled level ${levelId} has invalid styleVariants metadata`);
  return Object.entries(variants)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, asset]) => nativePackageAsset(asset, `styleVariant:${slug}`, levelId));
}

function packageMetadataForLevel(level: ManifestObject, manifestPath: string): NativePackageMetadata {
  const levelId = level.id as string;
  const assets = manifestObject(level.assets, `Native bundled level ${levelId} has no assets object: ${manifestPath}`);
  const requiredAssets = [
    nativePackageAsset(assets.levelJson, 'levelJson', levelId),
    nativePackageAsset(assets.colorImage, 'colorImage', levelId),
    ...nativePackageAssets(assets, 'bgImages', 'bgImage', levelId),
    ...nativePackageAssets(assets, 'dogSprites', 'dogSprite', levelId),
  ];
  const optionalAssets = [
    ...(assets.thumbnailImage === undefined
      ? []
      : [nativePackageAsset(assets.thumbnailImage, 'thumbnailImage', levelId)]),
    ...nativeStyleVariantAssets(assets, levelId),
  ];
  const digestInput = requiredAssets
    .map((asset) => `${asset.role}:${asset.hash}:${asset.size}:${asset.path}`)
    .sort()
    .join('\n');
  return {
    requiredAssets,
    optionalAssets,
    requiredBytes: requiredAssets.reduce((total, asset) => total + asset.size, 0),
    packageDigest: createHash('sha256').update(digestInput).digest('hex').slice(0, 16),
  };
}

function rewriteBundledManifest(manifestPath: string, outputRoot: string): Map<string, NativePackageMetadata> {
  const source = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestValue;
  const normalized = rewriteAssetMetadata(source, outputRoot);
  const levels = manifestLevels(normalized, manifestPath).map(
    (level): ManifestObject => ({ ...level, bundled: true }),
  );
  const normalizedManifest = { ...manifestObject(normalized, `Invalid native bundled manifest: ${manifestPath}`), levels };
  const packages = new Map<string, NativePackageMetadata>();
  for (const level of levels) {
    const levelId = level.id as string;
    if (packages.has(levelId)) throw new Error(`Native bundled manifest has duplicate level id: ${levelId}`);
    packages.set(levelId, packageMetadataForLevel(level, manifestPath));
  }
  writeFileSync(manifestPath, `${JSON.stringify(normalizedManifest, null, 2)}\n`);
  return packages;
}

function rewriteNativeCatalog(
  manifestPath: string,
  bundledPackages: ReadonlyMap<string, NativePackageMetadata>,
  requireAllBundledLevels: boolean,
): void {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestValue;
  const rewrittenLevelIds = new Set<string>();
  const levels = manifestLevels(manifest, manifestPath).map((level) => {
    const levelId = level.id as string;
    const nativePackage = bundledPackages.get(levelId);
    if (nativePackage === undefined) return { ...level, bundledInApp: false };
    rewrittenLevelIds.add(levelId);
    return {
      ...level,
      packageId: `${levelId}:${nativePackage.packageDigest}`,
      bundledInApp: true,
      package: {
        complete: true,
        requiredBytes: nativePackage.requiredBytes,
        requiredAssets: nativePackage.requiredAssets,
        optionalAssets: nativePackage.optionalAssets,
      },
    };
  });
  if (requireAllBundledLevels) {
    const missingLevelIds = [...bundledPackages.keys()].filter((levelId) => !rewrittenLevelIds.has(levelId));
    if (missingLevelIds.length > 0) {
      throw new Error(`Native catalog is missing bundled levels: ${missingLevelIds.join(', ')}`);
    }
  }
  const manifestRecord = manifestObject(manifest, `Invalid native catalog manifest: ${manifestPath}`);
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifestRecord, levels }, null, 2)}\n`);
}

export function copyNativePublicBundle(publicRoot: string, outputRoot: string): number {
  mkdirSync(outputRoot, { recursive: true });
  for (const entry of readdirSync(publicRoot, { withFileTypes: true })) {
    if (entry.name === 'levels' || entry.name.startsWith('levels_archive')) continue;
    cpSync(path.join(publicRoot, entry.name), path.join(outputRoot, entry.name), { recursive: true });
  }

  const levelsRoot = path.join(publicRoot, 'levels');
  const bundledManifestPath = path.join(levelsRoot, 'bundled-manifest.json');
  const bundledManifest = JSON.parse(readFileSync(bundledManifestPath, 'utf8')) as ManifestValue;
  manifestLevels(bundledManifest, bundledManifestPath);
  const requiredPaths = new Set<string>([
    'levels/bundled-manifest.json',
    'levels/catalog-manifest.json',
  ]);
  collectManifestPaths(bundledManifest, requiredPaths);
  for (const relativePath of requiredPaths) copyFileWithinRoot(publicRoot, outputRoot, relativePath);

  // Catalog snapshots accrete one file per approve (129 files / 50 MB by
  // 2026-08-06 — half the native cap). The runtime only consults a snapshot
  // when a remote sequence pins an old catalog revision, so shipping the
  // NEWEST one suffices for a fresh build; older revisions stream from the
  // webroot/CDN if ever requested.
  const snapshots = path.join(levelsRoot, 'catalog-snapshots');
  if (existsSync(snapshots)) {
    const newest = readdirSync(snapshots).filter((name) => name.endsWith('.json')).sort().at(-1);
    if (newest !== undefined) {
      copyFileWithinRoot(publicRoot, outputRoot, `levels/catalog-snapshots/${newest}`);
    }
  }

  rewriteNativeCatalog(path.join(outputRoot, 'levels', 'catalog-manifest.json'), bundledPackages, true);

  return directorySize(outputRoot);
}

export function nativePublicBundlePlugin(publicRoot: string): Plugin {
  return {
    name: 'ftd-native-public-bundle',
    writeBundle(options): void {
      if (typeof options.dir !== 'string') throw new Error('FTD native builds require a directory output');
      const bytes = copyNativePublicBundle(publicRoot, options.dir);
      if (bytes >= NATIVE_WEB_BUNDLE_MAX_BYTES) {
        throw new Error(
          `FTD native web bundle is ${(bytes / 1024 / 1024).toFixed(1)} MB; ` +
          `limit is ${NATIVE_WEB_BUNDLE_MAX_BYTES / 1024 / 1024} MB`,
        );
      }
    },
  };
}
