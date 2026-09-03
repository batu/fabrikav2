#!/opt/homebrew/Cellar/node/26.7.0/bin/node
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE = Object.freeze({
  path: '/opt/homebrew/Cellar/node/26.7.0/bin/node',
  sha256: '1ef99ea25fe70c9b67e7efe768ef8ee22148d3cabc703db6131b57aeb617d040',
});
const IDENTITY_GRAPH = Object.freeze({
  'tools/game-release/cli.mjs': '5a5d1e8b4d21636a1112b57d64ab6e61df3c301aae1be5367390a7a4cd21ad18',
  'tools/game-release/src/manifest.mjs': '618ca664a49df83170580920a0268a4a9ecc22bf1a1e01491bb23d0c94d9d782',
  'games/find_the_dog/config/admob.public.json': '36941dce093ec0e3363d05f58513fd34854e27a5ee26a0d158a083d42cdc13f5',
  'games/find_the_bird/config/admob.public.json': 'a663f22f3b7b37110c928b14fb7b11105158b680f51168681de1b3a1683f1653',
  'tools/game-env/src/env.mjs': '4b4324cc2f368c7a7a0ab369778d63a9b75e6ba963a306a59fbbe402ae77e9fc',
  'tools/game-env/src/admob-identities.mjs': '0c719c8cc8adb8739e1525677718f3944a17035549a4eba19be8ff7ee3567e6c',
  'tools/game-env/src/policies.mjs': 'a9b7ec554f5d5d43421e18d69a5c48f33c3dbe475853e9f872100fad20ab256c',
  'tools/game-env/src/policies/find-the-bird.mjs': '3ddb9738dbd36141e17207ce9993c5f1c8971cba976a971965ac89886945917d',
  'tools/game-env/src/policies/find-the-dog.mjs': 'fcd6bbacc049b81bfd3fa7f86b619dafb744b0d0d817dd63675e2acf8c4c77bf',
  'tools/game-env/src/validate.mjs': '6abb2dde4c8c781049792d7443058a58c8eea11d864a5a2d8ee2381ec7aa7586',
  'tools/native-shell/src/native-shell.mjs': '26e15409221d941de37741548954e41368d119d5b1b56f4c825cacbe4ed27358',
  'games/find_the_dog/native-resources/ios/shell-manifest.json': 'bfeb2a1f6f7b75f5074f5ff6b81a4bf08b59b69bb2d3db7f50efc294c021b298',
  'games/find_the_bird/native-resources/ios/shell-manifest.json': 'e71284f2f1efcccfa4ee8199d19ebe3b0fb3e269216ce00929bcc92a5d68ba49',
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
