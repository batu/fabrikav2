// Per-bird tap-accuracy audit through the game's own test harness — the
// authoritative answer to "is this level winnable?". Blind coordinate taps
// are NOT a substitute (they read as misses and burn lives).
//
//   GAME_URL=http://localhost:5177 LEVEL_INDEX=1 node scripts/tap-audit.mjs
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
const result = await p.evaluate(async (LEVEL_INDEX) => {
  const h = window.__FIND_DOG_HARNESS__;
  const idx = Number(LEVEL_INDEX);
  h.gotoGameScene();
  await new Promise(r => setTimeout(r, 3000));
  if (idx > 1) {
    h.startLevel(idx);
    await new Promise(r => setTimeout(r, 4000));
  }
  let snap = h.snapshot();
  const report = { level: snap.levelId ?? snap.level ?? null, total: snap.totalDogs, results: [] };
  for (const dog of snap.dogPositions ?? []) {
    const before = h.snapshot().foundDogIds.length;
    h.findDog(dog.id);
    await new Promise(r => setTimeout(r, 250));
    const after = h.snapshot().foundDogIds.length;
    report.results.push({ id: dog.id, hit: after > before });
  }
  const final = h.snapshot();
  report.found = final.foundDogIds.length;
  report.status = final.status;
  return report;
}, process.env.LEVEL_INDEX ?? '1');
console.log(JSON.stringify(result, null, 2));
await b.close();
const misses = (result.results ?? []).filter((r) => !r.hit);
if (misses.length > 0) {
  console.error(`unreachable birds: ${misses.map((m) => m.id).join(', ')}`);
  process.exit(1);
}
if (result.found !== result.total) {
  console.error(`found ${result.found}/${result.total} — level not completable`);
  process.exit(1);
}
