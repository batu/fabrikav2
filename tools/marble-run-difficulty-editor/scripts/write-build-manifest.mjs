import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

export const BUILD_MANIFEST_VERSION = 1;
export const BUILD_MANIFEST_NAME = 'build-manifest.json';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function assetPaths(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await assetPaths(root, absolute));
    else if (entry.isFile() && entry.name !== BUILD_MANIFEST_NAME) paths.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
  return paths.sort();
}

export async function buildManifest({ distDir, packageFile, basePath = './' }) {
  const packageJson = JSON.parse(await readFile(packageFile, 'utf8'));
  const assets = [];
  for (const relativePath of await assetPaths(distDir)) {
    const bytes = await readFile(path.join(distDir, relativePath));
    assets.push({ path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const contentHash = sha256(Buffer.from(JSON.stringify({ basePath, assets }), 'utf8'));
  return { manifestVersion: BUILD_MANIFEST_VERSION, version: packageJson.version, basePath, contentHash, assets };
}

export async function writeBuildManifest(options) {
  const manifest = await buildManifest(options);
  const output = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(options.distDir, BUILD_MANIFEST_NAME), output);
  return manifest;
}

const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await writeBuildManifest({ distDir: path.join(projectDir, 'dist'), packageFile: path.join(projectDir, 'package.json'), basePath: './' });
}
