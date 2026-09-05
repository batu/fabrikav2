import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Google iOS AdValue.value is decimal currency units (0.005 means $0.005).
// AdMob 8.1.0 truncates it while labeling it valueMicros. Convert before the
// integer serialization; Android already emits micros and is left untouched.
// https://developers.google.com/admob/ios/impression-level-ad-revenue
export const admobIosRevenuePatch = {
  version: '8.1.0',
  before: 'adValue.value.int64Value',
  after: 'adValue.value.multiplying(by: NSDecimalNumber(value: 1_000_000)).int64Value',
  files: [
    {
      path: 'ios/Sources/AdMobPlugin/Banner/BannerExecutor.swift',
      unpatchedSha256: '78bc17e8bca6364e1e5e6f37cae97b558c28c9cf655c5907d0d2ae4dd2afc35d',
      patchedSha256: 'bd743fcc12aa672d53779778263e5d483570371bcc57234f33bebe9c0bc704e5',
    },
    {
      path: 'ios/Sources/AdMobPlugin/Interstitial/AdInterstitialExecutor.swift',
      unpatchedSha256: '96de00c5818779161788aaf73c6419974f2a948b815ca1ab70ff3c9233cb6ae5',
      patchedSha256: '6f95a2835af73d3f7741194ddf0440df37eb80be5cb5b3501c968a066cd18eb9',
    },
    {
      path: 'ios/Sources/AdMobPlugin/Rewarded/AdRewardExecutor.swift',
      unpatchedSha256: '7fee3fa526531c9fea9b1ebed43861346e76fcf52347e6eda67b9a8f3dafb1a9',
      patchedSha256: '46698aa657a8913ef058c4e07339f8907d2e4ba7dd64636322b4acbd47b0e634',
    },
    {
      path: 'ios/Sources/AdMobPlugin/RewardedInterstitial/AdRewardInterstitialExecutor.swift',
      unpatchedSha256: '8ae96fbd754f9e52e1864561aa581fe4f8ccc98e2b500872142b62625027aad5',
      patchedSha256: '6d12fcb3fb7b9c263ff9825f0c98de62f9fef6570aecfd73db9eb8b384a97caf',
    },
    {
      path: 'ios/Sources/AdMobPlugin/AppOpen/AppOpenAdManager.swift',
      unpatchedSha256: 'de087730bc61ccf528117959940676a6fb532dc6aa5a92b9e6bcf5c8342bc057',
      patchedSha256: '82ee44730147c99a4eafb4b3d3d80ac8e13b2c8ab68f28d67fa6c5225c6dbae5',
    },
  ],
};

const digest = (source) => createHash('sha256').update(source).digest('hex');

export function verifyAdmobIosRevenueSource(source, file) {
  if (digest(source) !== file.patchedSha256 || source.split(admobIosRevenuePatch.after).length !== 2) {
    throw new Error(`AdMob iOS revenue patch is not applied exactly once: ${file.path}`);
  }
}

export function patchAdmobIosRevenueSource(source, file) {
  const hash = digest(source);
  if (hash !== file.unpatchedSha256 && hash !== file.patchedSha256) {
    throw new Error(`AdMob SDK source digest is not approved: ${file.path} (${hash})`);
  }
  const patched = hash === file.patchedSha256
    ? source
    : source.replace(admobIosRevenuePatch.before, admobIosRevenuePatch.after);
  verifyAdmobIosRevenueSource(patched, file);
  return patched;
}

export async function patchAdmobIosRevenue({
  packageRoot = fileURLToPath(new URL('../node_modules/@capacitor-community/admob/', import.meta.url)),
  verifyOnly = false,
} = {}) {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.version !== admobIosRevenuePatch.version) {
    throw new Error(`Refusing to patch AdMob ${manifest.version}; expected ${admobIosRevenuePatch.version}`);
  }
  // Validate every complete source before any mutation. A partially applied
  // correction can be retried, but unreviewed upstream drift fails closed.
  const changes = await Promise.all(admobIosRevenuePatch.files.map(async (file) => {
    const target = path.join(packageRoot, file.path);
    const source = await readFile(target, 'utf8');
    if (verifyOnly) verifyAdmobIosRevenueSource(source, file);
    return { file, target, source, patched: patchAdmobIosRevenueSource(source, file) };
  }));
  let patchedFiles = 0;
  for (const change of changes) {
    if (change.source !== change.patched) {
      await writeFile(change.target, change.patched);
      patchedFiles += 1;
    }
    verifyAdmobIosRevenueSource(await readFile(change.target, 'utf8'), change.file);
  }
  return { version: manifest.version, patchedFiles };
}

async function main() {
  if (process.argv.length > 3 || (process.argv[2] !== undefined && process.argv[2] !== '--verify')) {
    throw new Error('Usage: node tools/patch-admob-ios-revenue.mjs [--verify]');
  }
  const result = await patchAdmobIosRevenue({ verifyOnly: process.argv[2] === '--verify' });
  console.log(`AdMob@${result.version} iOS revenue correction verified (${result.patchedFiles} files patched)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
