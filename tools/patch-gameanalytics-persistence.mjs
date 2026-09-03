import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const expectedVersion = '4.4.7';
const packageUrl = new URL('../node_modules/gameanalytics/package.json', import.meta.url);
const sdkUrl = new URL('../node_modules/gameanalytics/dist/GameAnalytics.node.js', import.meta.url);
const before = `GAStore["delete"](EGAStore.Events, requestIdWhereArgs);
                    GALogger.i("Event queue: " + eventCount + " events sent.");`;
const after = `GAStore["delete"](EGAStore.Events, requestIdWhereArgs);
                    GAStore.save(GAState.getGameKey());
                    GALogger.i("Event queue: " + eventCount + " events sent.");`;
const expectedSource = {
  before,
  after,
  unpatchedSha256: 'dd057674b958e787b360105aeaf38d8e3e87c6b1f162eb4c693d7d78f10ae7ab',
  patchedSha256: 'e0d46cc4173a5988ecbfcaacb754acedcfc4bad8c801a46094b8e590f5e8ae89',
};

export function patchGameAnalyticsSource(source, markers = expectedSource) {
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== markers.unpatchedSha256 && digest !== markers.patchedSha256) {
    throw new Error(`GameAnalytics SDK source digest is not approved: ${digest}`);
  }
  const beforeCount = source.split(markers.before).length - 1;
  const afterCount = source.split(markers.after).length - 1;
  if (beforeCount === 0 && afterCount === 1) return source;
  if (beforeCount === 1 && afterCount === 0) return source.replace(markers.before, markers.after);
  throw new Error(`Expected exactly one GameAnalytics success branch (unpatched=${beforeCount}, patched=${afterCount})`);
}

export function verifyPatchedGameAnalyticsSource(source, markers = expectedSource) {
  const digest = createHash('sha256').update(source).digest('hex');
  const patchedCount = source.split(markers.after).length - 1;
  if (digest !== markers.patchedSha256 || patchedCount !== 1) {
    throw new Error(`GameAnalytics persistence patch is not applied exactly once (digest=${digest}, patched=${patchedCount})`);
  }
}

async function main() {
  if (process.argv.length > 3 || (process.argv[2] !== undefined && process.argv[2] !== '--verify')) {
    throw new Error('Usage: node tools/patch-gameanalytics-persistence.mjs [--verify]');
  }
  const manifest = JSON.parse(await readFile(packageUrl, 'utf8'));
  if (manifest.version !== expectedVersion) {
    throw new Error(`Refusing to patch gameanalytics ${manifest.version}; expected ${expectedVersion}`);
  }

  const source = await readFile(sdkUrl, 'utf8');
  const patched = patchGameAnalyticsSource(source);
  if (patched !== source) {
    await writeFile(sdkUrl, patched);
    console.log(`Patched gameanalytics@${expectedVersion} queue deletion persistence`);
  } else {
    console.log(`gameanalytics@${expectedVersion} persistence patch already applied`);
  }

  verifyPatchedGameAnalyticsSource(await readFile(sdkUrl, 'utf8'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
