import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeBuildManifest } from '../scripts/write-build-manifest.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'marble-editor-manifest-'));
  const distDir = path.join(root, 'dist');
  const packageFile = path.join(root, 'package.json');
  await mkdir(path.join(distDir, 'assets'), { recursive: true });
  await writeFile(packageFile, '{"version":"0.1.0"}\n');
  await writeFile(path.join(distDir, 'index.html'), '<script src="./assets/app.js"></script>\n');
  await writeFile(path.join(distDir, 'assets/app.js'), 'export const answer=42;\n');
  return { distDir, packageFile };
}

test('identical artifacts produce identical aggregate and per-asset digests', async () => {
  const files = await fixture();
  const first = await writeBuildManifest({ ...files, basePath: './' });
  const firstBytes = await readFile(path.join(files.distDir, 'build-manifest.json'), 'utf8');
  const second = await writeBuildManifest({ ...files, basePath: './' });
  const secondBytes = await readFile(path.join(files.distDir, 'build-manifest.json'), 'utf8');
  assert.deepEqual(second, first);
  assert.equal(secondBytes, firstBytes);
  assert.equal(first.version, '0.1.0');
  assert.equal(first.basePath, './');
  assert.equal(first.assets.length, 2);
});

test('changing one emitted asset changes its digest and aggregate hash', async () => {
  const files = await fixture();
  const before = await writeBuildManifest({ ...files, basePath: './' });
  await writeFile(path.join(files.distDir, 'assets/app.js'), 'export const answer=43;\n');
  const after = await writeBuildManifest({ ...files, basePath: './' });
  assert.notEqual(after.contentHash, before.contentHash);
  assert.notEqual(after.assets.find(({ path: name }) => name === 'assets/app.js').sha256, before.assets.find(({ path: name }) => name === 'assets/app.js').sha256);
  assert.equal(after.assets.find(({ path: name }) => name === 'index.html').sha256, before.assets.find(({ path: name }) => name === 'index.html').sha256);
});
