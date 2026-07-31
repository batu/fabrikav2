import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const ids = [
  'square_hawaii_waterfall_flash_4k',
  'square_pirate_cove_flash_4k',
  'square_yucatan_cenote_flash_4k',
  'square_sami_aurora_flash_4k',
  'square_grand_bazaar_flash_4k',
];
const out = new URL('./browser/', import.meta.url);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

async function snapshot() {
  return page.evaluate(() => window.__FIND_DOG_HARNESS__.snapshot());
}

async function touchDrag(from, to, id = 1) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id }] });
  for (let step = 1; step <= 6; step += 1) {
    const t = step / 6;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(80);
}

async function pinch(fromA, fromB, toA, toB) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...fromA, id: 2 }, { ...fromB, id: 3 }] });
  for (let step = 1; step <= 6; step += 1) {
    const t = step / 6;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
      { x: fromA.x + (toA.x - fromA.x) * t, y: fromA.y + (toA.y - fromA.y) * t, id: 2 },
      { x: fromB.x + (toB.x - fromB.x) * t, y: fromB.y + (toB.y - fromB.y) * t, id: 3 },
    ] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
}

async function cameraState() {
  return page.evaluate(() => {
    const scene = window.__FIND_DOG_GAME__.scene.getScene('GameScene');
    const camera = scene.cameras.main;
    const bounds = camera.getBounds();
    return { scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
  });
}

await page.goto('http://127.0.0.1:5199/');
await page.waitForFunction(() => window.__FIND_DOG_HARNESS__?.enabled === true, null, { timeout: 30_000 });
await page.evaluate(() => {
  const harness = window.__FIND_DOG_HARNESS__;
  harness.resetSave();
  harness.seedSave({ unlockedLevel: 1, tutorialShown: true, noAds: true });
  harness.setSettings({ showDebugOverlay: false, tutorialEnabled: false });
});
await page.evaluate(() => window.__FIND_DOG_HARNESS__.driveTo('level'));

const results = [];
for (let levelIndex = 0; levelIndex < ids.length; levelIndex += 1) {
  const id = ids[levelIndex];
  await page.waitForFunction((expected) => {
    const state = window.__FIND_DOG_HARNESS__.snapshot();
    const scene = window.__FIND_DOG_GAME__.scene.getScene('GameScene');
    return state.levelDataReady && state.levelId === expected && state.status === 'playing'
      && scene?.sys?.isActive() && scene.getLevel()?.id === expected
      && document.getElementById('scene-transition-cover') === null;
  }, id, { timeout: 30_000 });

  const initial = await snapshot();
  if (initial.totalDogs !== 15) throw new Error(`${id}: expected 15 targets, got ${initial.totalDogs}`);
  await page.screenshot({ path: new URL(`${id}-min-center.png`, out).pathname });

  const panStates = [];
  for (const [label, from, to] of [
    ['left', { x: 70, y: 430 }, { x: 330, y: 430 }],
    ['right', { x: 330, y: 430 }, { x: 70, y: 430 }],
    ['top', { x: 195, y: 240 }, { x: 195, y: 720 }],
    ['bottom', { x: 195, y: 720 }, { x: 195, y: 240 }],
  ]) {
    await touchDrag(from, to);
    panStates.push({ label, ...(await cameraState()) });
    await page.screenshot({ path: new URL(`${id}-edge-${label}.png`, out).pathname });
  }

  await page.evaluate(({ scrollX, scrollY }) => {
    const camera = window.__FIND_DOG_GAME__.scene.getScene('GameScene').cameras.main;
    camera.setZoom(1);
    camera.setScroll(scrollX, scrollY);
  }, { scrollX: initial.cameraScrollX, scrollY: initial.cameraScrollY });
  const focalPoint = {
    x: 120 * (initial.gameSize.width / 390),
    y: 500 * (initial.gameSize.height / 844),
  };
  const focalBefore = await page.evaluate(({ x, y }) => {
    const c = window.__FIND_DOG_GAME__.scene.getScene('GameScene').cameras.main;
    return { x: c.scrollX + c.width / 2 + (x - c.width / 2) / c.zoom, y: c.scrollY + c.height / 2 + (y - c.height / 2) / c.zoom };
  }, focalPoint);
  await pinch({ x: 90, y: 500 }, { x: 150, y: 500 }, { x: 20, y: 500 }, { x: 220, y: 500 });
  const zoomed = await cameraState();
  const focalAfter = await page.evaluate(({ x, y }) => {
    const c = window.__FIND_DOG_GAME__.scene.getScene('GameScene').cameras.main;
    return { x: c.scrollX + c.width / 2 + (x - c.width / 2) / c.zoom, y: c.scrollY + c.height / 2 + (y - c.height / 2) / c.zoom };
  }, focalPoint);
  await page.screenshot({ path: new URL(`${id}-gameplay-zoom.png`, out).pathname });

  const exercised = [];
  for (const target of initial.dogPositions) {
    const found = await page.evaluate((dogId) => {
      const scene = window.__FIND_DOG_GAME__.scene.getScene('GameScene');
      const dog = scene.getLevel().dogs.find((candidate) => candidate.id === dogId);
      scene.handleTap({
        worldX: scene.imgOffsetX + dog.x * scene.imgScale,
        worldY: scene.imgOffsetY + dog.y * scene.imgScale,
        screenX: 195,
        screenY: 422,
      });
      const state = window.__FIND_DOG_HARNESS__.snapshot();
      return { found: state.foundDogIds.includes(dogId), totalFound: state.foundDogIds.length };
    }, target.id);
    exercised.push({ id: target.id, ...found });
    if (!found.found) throw new Error(`${id}/${target.id}: center tap was not accepted`);
  }
  await page.waitForFunction(() => window.__FIND_DOG_HARNESS__.snapshot().levelComplete === true, null, { timeout: 30_000 });
  await page.screenshot({ path: new URL(`${id}-complete.png`, out).pathname });

  results.push({
    id,
    initial: { levelSize: initial.levelSize, totalDogs: initial.totalDogs, runtimeSequence: initial.runtimeSequence },
    exercised,
    panStates,
    zoom: { before: initial.cameraZoom, after: zoomed.zoom, focalPoint, focalBefore, focalAfter, error: Math.hypot(focalAfter.x - focalBefore.x, focalAfter.y - focalBefore.y) },
    complete: await snapshot(),
  });

  if (levelIndex < ids.length - 1) {
    await page.waitForFunction(() => {
      const button = document.querySelector('.fab-complete-claim-btn');
      return button instanceof HTMLButtonElement && !button.disabled
        && document.querySelector('#level-complete-overlay')?.dataset.rewardReveal === 'complete';
    }, null, { timeout: 30_000 });
    await page.evaluate(() => document.querySelector('.fab-complete-claim-btn').click());
    await page.waitForFunction(() => {
      const button = document.querySelector('.fab-complete-next-btn');
      return button instanceof HTMLButtonElement && !button.disabled;
    }, null, { timeout: 30_000 });
    await page.evaluate(() => document.querySelector('.fab-complete-next-btn').click());
  }
}

await writeFile(new URL('results.json', out), `${JSON.stringify({ ids, results, errors }, null, 2)}\n`);
await browser.close();
