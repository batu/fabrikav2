import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export const NATIVE_WEB_BUNDLE_MAX_BYTES = 100 * 1024 * 1024;

type ManifestValue = null | boolean | number | string | ManifestValue[] | { [key: string]: ManifestValue };

function copyFileWithinRoot(publicRoot: string, outputRoot: string, relativePath: string): void {
  const normalized = relativePath.replace(/^\/+/, '');
  const source = path.resolve(publicRoot, normalized);
  const publicPrefix = `${path.resolve(publicRoot)}${path.sep}`;
  if (!source.startsWith(publicPrefix)) {
    throw new Error(`Native public asset escapes public root: ${relativePath}`);
  }
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

export function copyNativePublicBundle(publicRoot: string, outputRoot: string): number {
  mkdirSync(outputRoot, { recursive: true });
  for (const entry of readdirSync(publicRoot, { withFileTypes: true })) {
    if (entry.name === 'levels' || entry.name.startsWith('levels_archive')) continue;
    cpSync(path.join(publicRoot, entry.name), path.join(outputRoot, entry.name), { recursive: true });
  }

  const levelsRoot = path.join(publicRoot, 'levels');
  const bundledManifestPath = path.join(levelsRoot, 'bundled-manifest.json');
  const bundledManifest = JSON.parse(readFileSync(bundledManifestPath, 'utf8')) as ManifestValue;
  const requiredPaths = new Set<string>([
    'levels/bundled-manifest.json',
    'levels/catalog-manifest.json',
  ]);
  collectManifestPaths(bundledManifest, requiredPaths);
  for (const relativePath of requiredPaths) copyFileWithinRoot(publicRoot, outputRoot, relativePath);

  const snapshots = path.join(levelsRoot, 'catalog-snapshots');
  if (existsSync(snapshots)) {
    cpSync(snapshots, path.join(outputRoot, 'levels', 'catalog-snapshots'), { recursive: true });
  }

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
