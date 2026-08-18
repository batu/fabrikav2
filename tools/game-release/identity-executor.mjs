#!/opt/homebrew/Cellar/node/26.3.0/bin/node
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE = Object.freeze({
  path: '/opt/homebrew/Cellar/node/26.3.0/bin/node',
  sha256: '56694c81b093cc8da273fa017cf91765b3653e5f64f16727976ffaa87b2b6b31',
});
const IDENTITY_GRAPH = Object.freeze({
  'tools/game-release/cli.mjs': '5a5d1e8b4d21636a1112b57d64ab6e61df3c301aae1be5367390a7a4cd21ad18',
  'tools/game-release/src/manifest.mjs': '618ca664a49df83170580920a0268a4a9ecc22bf1a1e01491bb23d0c94d9d782',
  'tools/game-env/src/env.mjs': '4b4324cc2f368c7a7a0ab369778d63a9b75e6ba963a306a59fbbe402ae77e9fc',
  'tools/game-env/src/policies.mjs': 'c57ae66c34f4013c8bf1830ae6e436749fc806000ce7ee134b37fc3b1f6131ef',
  'tools/game-env/src/policies/find-the-dog.mjs': 'ba081672d7456449c1d9afb323e9a81804ae51437a590b4b54b57a0dabb88319',
  'tools/game-env/src/validate.mjs': 'e1d9733c038b353cd85915bc8c95e2f633123773b40be686ea1e24f03046b31c',
  'tools/native-shell/src/native-shell.mjs': '09247c88a76b8a17ae52e9280979d39b1465d35126270d96833e6ffe5ec9980d',
  'games/find_the_dog/native-resources/ios/shell-manifest.json': '2dd1d07848b0c7ee2a856bd2ec40eb84a0dcfc9693332bb4c976d9655830b6a6',
});
const SUCCESS_KEYS = ['bundleId', 'game', 'name', 'nativeRecipe', 'ok', 'platform', 'sourceRevision'];

function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function verifyIntegrity(repoRoot) {
  if (process.execPath !== NODE.path || digest(NODE.path) !== NODE.sha256) throw new Error('identity Node changed');
  for (const [relative, expected] of Object.entries(IDENTITY_GRAPH)) {
    const file = path.join(repoRoot, relative);
    if (!fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || digest(file) !== expected) throw new Error('identity graph changed');
  }
}

let response = { ok: false, error: 'release identity validation failed' };
let exitCode = 1;
try {
  if (process.argv.length !== 2) throw new Error('arguments are not accepted');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  verifyIntegrity(repoRoot);
  const input = fs.readFileSync(0, 'utf8');
  const request = JSON.parse(input);
  if (request?.command !== 'identity') throw new Error('identity command is required');
  const result = spawnSync(NODE.path, [path.join(repoRoot, 'tools/game-release/cli.mjs')], {
    cwd: repoRoot, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    env: Object.fromEntries(Object.entries({ HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }).filter(([, value]) => value)),
  });
  if (result.status !== 0 || result.stderr || !result.stdout) throw new Error('identity CLI failed');
  const parsed = JSON.parse(result.stdout);
  if (Object.keys(parsed).sort().join('\0') !== SUCCESS_KEYS.join('\0') || parsed.ok !== true) throw new Error('identity response is not closed');
  response = parsed; exitCode = 0;
} catch (error) {
  if (/identity (?:Node|graph) changed/.test(String(error?.message))) response = { ok: false, error: 'release identity integrity failed' };
}
process.stdout.write(`${JSON.stringify(response)}\n`);
process.exitCode = exitCode;
