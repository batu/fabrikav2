#!/opt/homebrew/Cellar/node/26.7.0/bin/node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This is deliberately explicit. Adding a runtime import or invoked release
// tool requires updating this graph and its mutation tests before approval.
const RUNTIME_SHA256 = Object.freeze({
  'package.json': '715fa51c8326e562b2daa1a8fa742d3857ec19035a5e58bcee6a1de5edf3865c',
  'package-lock.json': '8d5474908988d4bdcda218e69767d4a29a48a2ee80946ef27e09d9c2e512db02',
  'games/find_the_dog/package.json': '5db7e032354cee02ec34723e27e8bce0e17b76d1dc14c39991246cbca8c5a4f5',
  'games/find_the_dog/capacitor.config.ts': '3d1dd574b8a532f27cdc4a8a0f41f52dfa8293a53f328171dbdf64a03aaf9aed',
  'games/find_the_dog/vite.config.ts': '5c751c242d3b57882758ff5dea461203f0bbacc71819b13d756d92fa84ccecd0',
  'games/find_the_dog/src/build/nativePublicBundle.ts': '001912bc5165d5d03bdeb376e018f1a7d74ba92afce2c4b059b9276ad706f26a',
  'games/find_the_dog/src/sdk/includePlugins.ts': '118b03507344115f7aed36ac6cc248d9530c3e79cb549d8005f5f93a6a353107',
  'games/find_the_dog/src/ads/AdMobConfig.ts': '124c69bfafc292e028b37d3092941ce3b39b3a7a5d386d3032731f6fa15bfdc4',
  'configs/vite.base.ts': '0bc2142b5becd7c1cd0d5f6c78a6d83c8a02677ddaed20972646499309406e58',
  'tools/game-release/src/portal-executor.mjs': '233f55ca6443f33a37ba782ac681bf23a178272ae4fd0ef8a26ccd6f2dd9e0e0',
  'tools/game-release/src/ios-release.mjs': 'f35bb4c65096e5921f484314b0682e71026113057e711601d66e0455bea94c3c',
  'tools/game-release/src/manifest.mjs': '618ca664a49df83170580920a0268a4a9ecc22bf1a1e01491bb23d0c94d9d782',
  'tools/game-env/src/env.mjs': '4b4324cc2f368c7a7a0ab369778d63a9b75e6ba963a306a59fbbe402ae77e9fc',
  'tools/game-env/src/policies.mjs': 'c57ae66c34f4013c8bf1830ae6e436749fc806000ce7ee134b37fc3b1f6131ef',
  'tools/game-env/src/policies/find-the-dog.mjs': 'ba081672d7456449c1d9afb323e9a81804ae51437a590b4b54b57a0dabb88319',
  'tools/game-env/src/validate.mjs': 'e1d9733c038b353cd85915bc8c95e2f633123773b40be686ea1e24f03046b31c',
  'tools/game-env/validate.mjs': '43395e6ccd2cf3bbe39c9a12b5ed8a80fa04216ae288023040d13c539a69b812',
  'tools/native-shell/apply.mjs': 'eb4968e593303695eab1cd2359dc730a057951679019b62fb5f4c29a793b69c2',
  'tools/native-shell/validate.mjs': '25608ad518199e391cf4af429cdc79d30d1b0073317c5ceff1506c8bbc592084',
  'tools/native-shell/src/native-shell.mjs': '09247c88a76b8a17ae52e9280979d39b1465d35126270d96833e6ffe5ec9980d',
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
