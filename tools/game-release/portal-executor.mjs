#!/opt/homebrew/Cellar/node/26.7.0/bin/node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This is deliberately explicit. Adding a runtime import or invoked release
// tool requires updating this graph and its mutation tests before approval.
const RUNTIME_SHA256 = Object.freeze({
  'package.json': 'c72c7a6f3ce175c92f12055873f33b68cf0ac26bde9a3d8706888af1f0bb2da6',
  'package-lock.json': '973f4c891a804a38fbbc7d6ba812d1341aeaae85bef6a7e058fdac231a6fd9d7',
  'games/find_the_dog/package.json': '3719ebf5cec411dfca16717214b53a6f99f21a01615ec7482a73522195843761',
  'games/find_the_dog/capacitor.config.ts': '749bdf8675c3bdd1af5d0c42f9411c40d75390a665badf05ea73af27f0f11b0c',
  'games/find_the_dog/config/admob.public.json': '36941dce093ec0e3363d05f58513fd34854e27a5ee26a0d158a083d42cdc13f5',
  'games/find_the_bird/config/admob.public.json': 'a663f22f3b7b37110c928b14fb7b11105158b680f51168681de1b3a1683f1653',
  'games/find_the_dog/vite.config.ts': 'e34bc1803de65d8c3f43b37abeefe97af446a612692dcdf7ca8cf899f8313afe',
  'games/find_the_dog/src/build/nativePublicBundle.ts': '001912bc5165d5d03bdeb376e018f1a7d74ba92afce2c4b059b9276ad706f26a',
  'games/find_the_dog/src/sdk/includePlugins.ts': '1a9286b394918f166e30fd718eb57ec73d47a2961f6d02720ad039121ea8bd53',
  'games/find_the_dog/src/ads/AdMobConfig.ts': 'bfedebdfdbd99272c596df80294c16b5bf4bf3f23490e40a051154f245526b4f',
  'configs/vite.base.ts': '0bc2142b5becd7c1cd0d5f6c78a6d83c8a02677ddaed20972646499309406e58',
  'tools/game-release/src/portal-executor.mjs': '233f55ca6443f33a37ba782ac681bf23a178272ae4fd0ef8a26ccd6f2dd9e0e0',
  'tools/game-release/src/ios-release.mjs': 'a704df1fff4cffc92cb43a637c0d20274405bf85326075ddd03651fd3e23406f',
  'tools/game-release/src/manifest.mjs': '618ca664a49df83170580920a0268a4a9ecc22bf1a1e01491bb23d0c94d9d782',
  'tools/patch-gameanalytics-persistence.mjs': 'e73c6bbe8b1a63948a30ddcf7eac4e2782941a70e0860be63b28c8ee8a61e1bf',
  'tools/patch-admob-ios-revenue.mjs': '38bad61707f2a4f4bd1ec1362137448f01a68a8689eb61aea545edcfe1c943e1',
  'tools/game-env/src/env.mjs': '4b4324cc2f368c7a7a0ab369778d63a9b75e6ba963a306a59fbbe402ae77e9fc',
  'tools/game-env/src/admob-identities.mjs': '0c719c8cc8adb8739e1525677718f3944a17035549a4eba19be8ff7ee3567e6c',
  'tools/game-env/src/policies.mjs': 'a9b7ec554f5d5d43421e18d69a5c48f33c3dbe475853e9f872100fad20ab256c',
  'tools/game-env/src/policies/find-the-bird.mjs': '3ddb9738dbd36141e17207ce9993c5f1c8971cba976a971965ac89886945917d',
  'tools/game-env/src/policies/find-the-dog.mjs': 'fcd6bbacc049b81bfd3fa7f86b619dafb744b0d0d817dd63675e2acf8c4c77bf',
  'tools/game-env/src/validate.mjs': '6abb2dde4c8c781049792d7443058a58c8eea11d864a5a2d8ee2381ec7aa7586',
  'tools/game-env/validate.mjs': '94988f1ee28af9657a4a6593edb19f4bc5df8604a37f3fda69c69beb2d74b8eb',
  'tools/native-shell/apply.mjs': 'eb4968e593303695eab1cd2359dc730a057951679019b62fb5f4c29a793b69c2',
  'tools/native-shell/validate.mjs': '25608ad518199e391cf4af429cdc79d30d1b0073317c5ceff1506c8bbc592084',
  'tools/native-shell/src/native-shell.mjs': '26e15409221d941de37741548954e41368d119d5b1b56f4c825cacbe4ed27358',
  'tools/native-shell/src/cli.mjs': 'a98a5d19ef4634dd1d99a88d267cbd60ee43a4d3a2cca6c4bb285dfb165e10df',
  'tools/verify-device/src/devices.mjs': '2c518251f616aa5d15331ed9e599924ae3a0ecc5f1b3126c2862360976010be9',
  'tools/verify-device/src/summary.mjs': 'a27e8eb2f378b25352b570157c5ea66977ded05fa0184e2edb5352b0d9de38cc',
});
const NODE_IDENTITY = Object.freeze({
  executable: '/opt/homebrew/Cellar/node/26.7.0/bin/node',
  sha256: '1ef99ea25fe70c9b67e7efe768ef8ee22148d3cabc703db6131b57aeb617d040',
});

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifyRuntimeGraph() {
  const wrapper = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(wrapper), '..', '..');
  if (fs.realpathSync(process.execPath) !== NODE_IDENTITY.executable || sha256(process.execPath) !== NODE_IDENTITY.sha256) {
    throw new Error('Node runtime identity changed');
  }
  for (const [relative, expected] of Object.entries(RUNTIME_SHA256)) {
    const file = path.join(repoRoot, relative);
    if (!fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || sha256(file) !== expected) {
      throw new Error(`release runtime graph changed: ${relative}`);
    }
  }
  return repoRoot;
}

let response;
try {
  if (process.argv.length !== 2) throw new Error('arguments are not accepted');
  const repoRoot = verifyRuntimeGraph();
  const { executePortalPayload } = await import(pathToFileURL(path.join(repoRoot, 'tools/game-release/src/portal-executor.mjs')));
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  response = executePortalPayload(payload);
} catch (error) {
  response = { outcome: 'blocked', receipt: { reason: /runtime (?:graph|identity)/i.test(String(error?.message)) ? 'executor_integrity_failed' : 'invalid_executor_payload' } };
}
process.stdout.write(`${JSON.stringify(response)}\n`);
