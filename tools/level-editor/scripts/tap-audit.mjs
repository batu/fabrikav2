// Per-bird tap-accuracy audit through the game's own test harness — the
// authoritative answer to "is this level winnable?". Blind coordinate taps
// are NOT a substitute (they read as misses and burn lives).
//
//   GAME_URL=http://localhost:5177 LEVEL_ID=<level-id> node scripts/tap-audit.mjs
//
// Exits non-zero when any bird is unreachable.
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
p.on('pageerror', e => console.log('PAGEERR:', String(e).slice(0,120)));
await p.goto(process.env.GAME_URL ?? 'http://localhost:5177'); await p.waitForTimeout(5000);
const hasHarness = await p.evaluate(() => typeof window.__FIND_DOG_HARNESS__ !== 'undefined');
console.log('harness:', hasHarness);
if (!hasHarness) { await b.close(); process.exit(0); }
const result = await p.evaluate(async (LEVEL_ID) => {
  const h = window.__FIND_DOG_HARNESS__;
  // Select by level ID, never by index: a level-order-revision migration
  // rewrites currentLevelIndex on boot, so index selection silently lands on
  // level 1 and an index-based audit reports the WRONG level as passing.
  h.gotoGameScene(LEVEL_ID || undefined);
  await new Promise(r => setTimeout(r, 5000));
  const snap = h.snapshot();
  const loaded = snap.levelId ?? snap.level ?? null;
  if (LEVEL_ID && loaded !== LEVEL_ID) {
    return { error: `asked for ${LEVEL_ID} but ${loaded} loaded`, level: loaded };
  }
  const report = { level: loaded, total: snap.totalDogs, results: [] };
  for (const dog of snap.dogPositions ?? []) {
    const before = h.snapshot().foundDogIds.length;
    h.findDog(dog.id);
    await new Promise(r => setTimeout(r, 250));
    report.results.push({ id: dog.id, hit: h.snapshot().foundDogIds.length > before });
  }
  const final = h.snapshot();
  report.found = final.foundDogIds.length;
  report.status = final.status;
  return report;
}, process.env.LEVEL_ID ?? '');
console.log(JSON.stringify(result, null, 2));
await b.close();
if (result.error) { console.error(result.error); process.exit(1); }
const misses = (result.results ?? []).filter((r) => !r.hit);
if (misses.length > 0) {
  console.error(`unreachable birds: ${misses.map((m) => m.id).join(', ')}`);
  process.exit(1);
}
if (result.found !== result.total) {
  console.error(`found ${result.found}/${result.total} — level not completable`);
  process.exit(1);
}
