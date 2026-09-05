import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const wrapper = fs.readFileSync(path.join(repoRoot, 'tools/game-release/portal-executor.mjs'), 'utf8');
const graph = Object.fromEntries([...wrapper.matchAll(/^ {2}'([^']+)': '([a-f0-9]{64})',/gm)].map(([, file, hash]) => [file, hash]));
const changedLayers = ['package.json', 'tools/game-release/src/ios-release.mjs', 'tools/patch-admob-ios-revenue.mjs'];
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Exercise only the wrapper's actual integrity function. The release entrypoint
// and payload executor never run. Fixture digests isolate each mutation from
// unrelated historical pins that may already disagree with the checkout.
function integrityFixture() {
  const root = '/fixture/repo';
  const nodePath = wrapper.match(/ {2}executable: '([^']+)',/)[1];
  const contents = new Map([[nodePath, 'fixture-node']]);
  for (const relative of Object.keys(graph)) contents.set(path.join(root, relative), `fixture:${relative}`);
  const read = (file) => {
    if (!contents.has(file)) throw new Error(`missing fixture file: ${file}`);
    return contents.get(file);
  };
  const source = wrapper.slice(wrapper.indexOf('const RUNTIME_SHA256'), wrapper.indexOf('\nlet response;'))
    .replace(/^ {2}'([^']+)': '[a-f0-9]{64}',/gm, (_, relative) => `  '${relative}': '${digest(read(path.join(root, relative)))}',`)
    .replace(/ {2}sha256: '[a-f0-9]{64}',/, `  sha256: '${digest(read(nodePath))}',`)
    .replace('import.meta.url', JSON.stringify(pathToFileURL(path.join(root, 'tools/game-release/portal-executor.mjs')).href));
  const verify = vm.runInNewContext(`${source}\nverifyRuntimeGraph;`, {
    crypto, path, fileURLToPath,
    process: { execPath: nodePath },
    fs: {
      readFileSync: read,
      realpathSync: (file) => file,
      statSync: (file) => ({ isFile: () => contents.has(file) }),
      lstatSync: () => ({ isSymbolicLink: () => false }),
    },
  });
  return { root, contents, verify };
}

describe('release dependency integrity', () => {
  it.each(changedLayers)('pins the current source for the changed release layer %s', (relative) => {
    expect(graph[relative]).toBe(digest(fs.readFileSync(path.join(repoRoot, relative))));
  });

  it.each([...new Set([...Object.keys(graph), ...changedLayers])])('identifies the exact drifted runtime layer %s', (relative) => {
    expect(graph).toHaveProperty([relative]);
    const { root, contents, verify } = integrityFixture();
    expect(verify()).toBe(root);
    const file = path.join(root, relative);
    contents.set(file, `${contents.get(file)}\nmutation`);
    expect(() => verify()).toThrow(`release runtime graph changed: ${relative}`);
  });
});
