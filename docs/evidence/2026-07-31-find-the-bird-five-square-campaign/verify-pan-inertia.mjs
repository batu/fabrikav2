import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const out = new URL('./browser/pan-inertia/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

async function state() {
  return page.evaluate(() => {
    const camera = window.__FIND_DOG_GAME__.scene.getScene('GameScene').cameras.main;
    const bounds = camera.getBounds();
    const viewWidth = camera.width / camera.zoom;
    const originOffsetX = (camera.width - viewWidth) * camera.originX;
    const minX = bounds.x - originOffsetX;
    const maxX = Math.max(minX, bounds.right - viewWidth - originOffsetX);
    return { scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom, minX, maxX };
  });
}

await page.goto('http://127.0.0.1:5199/');
await page.waitForFunction(() => window.__FIND_DOG_HARNESS__?.enabled === true, null, { timeout: 30_000 });
await page.evaluate(async () => {
  window.__FIND_DOG_HARNESS__.resetSave();
  window.__FIND_DOG_HARNESS__.seedSave({ unlockedLevel: 1, tutorialShown: true, noAds: true });
  window.__FIND_DOG_HARNESS__.setSettings({ showDebugOverlay: false, tutorialEnabled: false });
  await window.__FIND_DOG_HARNESS__.driveTo('level');
});
await page.waitForFunction(() => {
  const snapshot = window.__FIND_DOG_HARNESS__.snapshot();
  const scene = window.__FIND_DOG_GAME__.scene.getScene('GameScene');
  return snapshot.levelDataReady
    && snapshot.levelId === 'square_hawaii_waterfall_flash_4k'
    && snapshot.status === 'playing'
    && scene?.sys?.isActive()
    && document.getElementById('scene-transition-cover') === null;
}, null, { timeout: 30_000 });
await page.evaluate(() => {
  const camera = window.__FIND_DOG_GAME__.scene.getScene('GameScene').cameras.main;
  camera.setZoom(2);
});
const range = await state();
await page.evaluate(({ minX, maxX }) => {
  const camera = window.__FIND_DOG_GAME__.scene.getScene('GameScene').cameras.main;
  camera.setScroll((minX + maxX) / 2, camera.scrollY);
}, range);

await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 270, y: 430, id: 1 }] });
for (let step = 1; step <= 4; step += 1) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 270 - step * 10, y: 430, id: 1 }],
  });
  await page.waitForTimeout(16);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

const samples = [];
let elapsed = 0;
let previous = await state();
for (const waitMs of [0, 32, 32, 48, 64, 96, 128, 192]) {
  await page.waitForTimeout(waitMs);
  elapsed += waitMs;
  const current = await state();
  samples.push({ elapsedMs: elapsed, ...current, deltaX: current.scrollX - previous.scrollX });
  await page.screenshot({ path: new URL(`frame-${String(elapsed).padStart(3, '0')}ms.png`, out).pathname });
  previous = current;
}

const postRelease = samples.slice(1).map((sample) => Math.abs(sample.deltaX));
const movedAfterRelease = postRelease.some((delta) => delta > 0.5);
const settled = postRelease.at(-1) < 0.5;
const stayedInBounds = samples.every((sample) => sample.scrollX >= sample.minX - 0.01 && sample.scrollX <= sample.maxX + 0.01);
const result = { levelId: 'square_hawaii_waterfall_flash_4k', samples, assertions: { movedAfterRelease, settled, stayedInBounds } };
await writeFile(new URL('results.json', out), `${JSON.stringify(result, null, 2)}\n`);
await browser.close();

if (!Object.values(result.assertions).every(Boolean)) {
  throw new Error(`Pan inertia verification failed: ${JSON.stringify(result.assertions)}`);
}
