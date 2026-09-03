import { readFile, writeFile } from 'node:fs/promises';

const expectedVersion = '4.4.7';
const packageUrl = new URL('../node_modules/gameanalytics/package.json', import.meta.url);
const sdkUrl = new URL('../node_modules/gameanalytics/dist/GameAnalytics.node.js', import.meta.url);
const before = `GAStore["delete"](EGAStore.Events, requestIdWhereArgs);
                    GALogger.i("Event queue: " + eventCount + " events sent.");`;
const after = `GAStore["delete"](EGAStore.Events, requestIdWhereArgs);
                    GAStore.save(GAState.getGameKey());
                    GALogger.i("Event queue: " + eventCount + " events sent.");`;

const manifest = JSON.parse(await readFile(packageUrl, 'utf8'));
if (manifest.version !== expectedVersion) {
  throw new Error(`Refusing to patch gameanalytics ${manifest.version}; expected ${expectedVersion}`);
}

const source = await readFile(sdkUrl, 'utf8');
if (source.includes(after)) {
  console.log(`gameanalytics@${expectedVersion} persistence patch already applied`);
  process.exit(0);
}

const occurrences = source.split(before).length - 1;
if (occurrences !== 1) {
  throw new Error(`Expected one GameAnalytics success branch, found ${occurrences}`);
}

await writeFile(sdkUrl, source.replace(before, after));
console.log(`Patched gameanalytics@${expectedVersion} queue deletion persistence`);
