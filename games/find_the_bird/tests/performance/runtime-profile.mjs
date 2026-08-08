#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';

const gameRoot = resolve(import.meta.dirname, '../..');
const distRoot = join(gameRoot, 'dist');
const rawCycleCount = process.env.FTB_PROFILE_CYCLES ?? '3';
const cycleCount = Number(rawCycleCount);
if (!Number.isSafeInteger(cycleCount) || cycleCount < 1) {
  throw new Error(`FTB_PROFILE_CYCLES must be a positive integer; received '${rawCycleCount}'`);
}

if (!existsSync(join(distRoot, 'index.html'))) {
  throw new Error('Missing dist/index.html. Run the production build with VITE_ENABLE_TEST_HARNESS=true first.');
}

const MIME_BY_EXTENSION = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function filesBelow(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function fixtureHash() {
  const paths = [
    join(gameRoot, 'public/levels/bundled-manifest.json'),
    join(gameRoot, 'public/levels/catalog-manifest.json'),
    join(gameRoot, 'src/core/GameConfig.ts'),
  ];
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(relative(gameRoot, path));
    hash.update(readFileSync(path));
  }
  return hash.digest('hex');
}

function bundleSnapshot() {
  const assets = filesBelow(join(distRoot, 'assets'));
  const js = assets.filter((path) => extname(path) === '.js');
  const css = assets.filter((path) => extname(path) === '.css');
  const bytes = (paths) => paths.reduce((total, path) => total + statSync(path).size, 0);
  return {
    js_bytes: bytes(js),
    css_bytes: bytes(css),
    largest_js_bytes: Math.max(0, ...js.map((path) => statSync(path).size)),
    js_chunks: js.length,
  };
}

function staticServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const candidate = normalize(join(distRoot, pathname));
    const safeCandidate = candidate === distRoot || candidate.startsWith(`${distRoot}${sep}`)
      ? candidate
      : join(distRoot, 'index.html');
    const isFile = existsSync(safeCandidate) && statSync(safeCandidate).isFile();
    const acceptsDocument = request.headers.accept?.includes('text/html') === true;
    let filePath = isFile ? safeCandidate : null;
    if (filePath === null && acceptsDocument) filePath = join(distRoot, 'index.html');
    if (filePath === null) {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('Not found');
      return;
    }
    response.statusCode = 200;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', MIME_BY_EXTENSION[extname(filePath)] ?? 'application/octet-stream');
    createReadStream(filePath).pipe(response);
  });
}

async function listen(server) {
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Static server did not expose a TCP port');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  await new Promise((resolveClose) => server.close(resolveClose));
}

const server = staticServer();
const origin = await listen(server);
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-precise-memory-info'],
});

let result;
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const pageErrors = [];
  const localRequestFailures = [];
  let blockedExternalRequests = 0;

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(origin)) localRequestFailures.push(request.url());
  });
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) localRequestFailures.push(response.url());
  });
  await page.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.startsWith(origin) || requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) {
      await route.continue();
      return;
    }
    blockedExternalRequests += 1;
    await route.abort('blockedbyclient');
  });

  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('ftd_tutorial_shown', '1');
    localStorage.setItem('ftd_settings', JSON.stringify({
      adsEnabled: false,
      gameMode: 'restoration',
      hapticsOn: false,
      musicOn: false,
      notificationsOn: false,
      ratePromptEnabled: false,
      soundEffectsOn: false,
      soundOn: false,
      tutorialEnabled: false,
    }));
    const perf = {
      frames: [],
      longTasks: [],
      startedAt: performance.now(),
    };
    window.__FTB_RUNTIME_PROFILE__ = perf;
    const frame = (timestamp) => {
      perf.frames.push(timestamp);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    if (typeof globalThis.PerformanceObserver === 'function') {
      try {
        const observer = new globalThis.PerformanceObserver((list) => {
          for (const entry of list.getEntries()) perf.longTasks.push({ start: entry.startTime, duration: entry.duration });
        });
        observer.observe({ type: 'longtask', buffered: true });
      } catch {
        // Long-task observation is diagnostic only; unsupported engines still run the profile.
      }
    }
  });

  const navigationStartedAt = performance.now();
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('#home-shell', { state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => {
    const harness = window.__FIND_DOG_HARNESS__;
    return harness?.snapshot?.().homeShellVisible === true;
  }, null, { timeout: 30_000 });
  const homeReadyMs = performance.now() - navigationStartedAt;

  const firstPlayStartedAt = performance.now();
  await page.evaluate(() => {
    window.__FTB_RUNTIME_PROFILE__.firstPlayPromise = window.__FIND_DOG_HARNESS__.verbs.startLevel.run();
  });
  await page.waitForFunction(() => {
    const harness = window.__FIND_DOG_HARNESS__;
    const snapshot = harness?.snapshot?.();
    return snapshot?.activeScene === 'GameScene'
      && snapshot.levelDataReady === true
      && snapshot.dogPositions.length > 0;
  }, null, { timeout: 30_000 });
  const firstLevelEngineReadyMs = performance.now() - firstPlayStartedAt;
  await page.waitForFunction(() => document.getElementById('scene-transition-cover') === null, null, { timeout: 30_000 });
  const firstLevelReadyMs = performance.now() - firstPlayStartedAt;
  const firstPlayStarted = await page.evaluate(() => window.__FTB_RUNTIME_PROFILE__.firstPlayPromise);
  if (!firstPlayStarted) throw new Error('Runtime profile could not start the first level through the real home action');

  const firstSnapshot = await page.evaluate(() => window.__FIND_DOG_HARNESS__.snapshot());
  const textureCountBeforeCycles = await page.evaluate(() => Object.keys(window.__FIND_DOG_GAME__.textures.list).length);
  const heapBeforeCycles = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);

  const pickupAttempt = await page.evaluate(() => {
    const harness = window.__FIND_DOG_HARNESS__;
    const before = harness.snapshot();
    const target = before.dogPositions.find((dog) => !dog.found);
    if (target === undefined) throw new Error('No unfound bird available for pickup profile');
    const startedAt = performance.now();
    const result = harness.findDog(target.id);
    return { startedAt, targetId: target.id, foundBefore: before.foundDogIds.length, result };
  });
  if (!pickupAttempt.result.found || pickupAttempt.result.totalFound !== pickupAttempt.foundBefore + 1) {
    throw new Error(`Runtime profile pickup did not find ${pickupAttempt.targetId}`);
  }
  await page.waitForTimeout(1_000);
  const pickupEndedAt = await page.evaluate(() => performance.now());
  const pickupStateConsistent = await page.evaluate(({ targetId, foundBefore }) => {
    const snapshot = window.__FIND_DOG_HARNESS__.snapshot();
    return snapshot.dogPositions.some((dog) => dog.id === targetId && dog.found)
      && snapshot.foundDogIds.length === foundBefore + 1;
  }, pickupAttempt);

  const cycleReadyTimings = [];
  for (let index = 0; index < cycleCount; index += 1) {
    const cycleTiming = await page.evaluate(async () => {
      const harness = window.__FIND_DOG_HARNESS__;
      harness.gotoHomeForTest();
      const waitFor = async (predicate, timeoutMs) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          if (predicate()) return;
          await new Promise((resolveWait) => setTimeout(resolveWait, 16));
        }
        throw new Error('Runtime profile scene-cycle timed out');
      };
      await waitFor(() => harness.snapshot().homeShellVisible === true, 10_000);
      const startedAt = performance.now();
      const startPromise = harness.verbs.startLevel.run();
      await waitFor(() => {
        const snapshot = harness.snapshot();
        return snapshot.activeScene === 'GameScene'
          && snapshot.levelDataReady === true
          && snapshot.dogPositions.length > 0;
      }, 30_000);
      const engineReadyMs = performance.now() - startedAt;
      await waitFor(() => document.getElementById('scene-transition-cover') === null, 30_000);
      if (!await startPromise) throw new Error('Runtime profile could not restart the level');
      return { engineReadyMs, visibleReadyMs: performance.now() - startedAt };
    });
    cycleReadyTimings.push(cycleTiming);
  }

  await page.waitForTimeout(250);
  const textureCountAfterCycles = await page.evaluate(() => Object.keys(window.__FIND_DOG_GAME__.textures.list).length);
  const heapAfterCycles = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  const browserMetrics = await page.evaluate(({ pickupStartedAt, pickupEndedAt }) => {
    const perf = window.__FTB_RUNTIME_PROFILE__;
    const frameGaps = [];
    const pickupFrameGaps = [];
    for (let index = 1; index < perf.frames.length; index += 1) {
      const gap = perf.frames[index] - perf.frames[index - 1];
      frameGaps.push(gap);
      if (perf.frames[index] >= pickupStartedAt && perf.frames[index - 1] <= pickupEndedAt) pickupFrameGaps.push(gap);
    }
    const resources = performance.getEntriesByType('resource');
    const bytesFor = (type) => resources
      .filter((entry) => entry.name.includes(type))
      .reduce((total, entry) => total + entry.encodedBodySize, 0);
    return {
      frameGaps,
      pickupFrameGaps,
      longTasks: perf.longTasks,
      requestCount: resources.length,
      transferBytes: resources.reduce((total, entry) => total + entry.encodedBodySize, 0),
      jsTransferBytes: bytesFor('.js'),
      imageTransferBytes: resources
        .filter((entry) => /\.(?:png|webp|jpe?g)(?:\?|$)/.test(entry.name))
        .reduce((total, entry) => total + entry.encodedBodySize, 0),
    };
  }, { pickupStartedAt: pickupAttempt.startedAt, pickupEndedAt });

  // Prove the HTTP-error gate itself before trusting a green result. Run the
  // probe after timing/resource snapshots, then remove only its known URL so
  // unrelated late failures remain visible in the final gate.
  const missingAssetProbeUrl = `${origin}/__ftb_runtime_profile_missing__.png`;
  const missingAssetProbeStatus = await page.evaluate(async (url) => (await fetch(url)).status, missingAssetProbeUrl);
  if (missingAssetProbeStatus !== 404 || !localRequestFailures.includes(missingAssetProbeUrl)) {
    throw new Error('Runtime profile HTTP failure gate did not observe its missing-asset probe');
  }
  for (let index = localRequestFailures.length - 1; index >= 0; index -= 1) {
    if (localRequestFailures[index] === missingAssetProbeUrl) localRequestFailures.splice(index, 1);
  }

  const cycleEngineReadyMs = cycleReadyTimings.map((timing) => timing.engineReadyMs);
  const cycleVisibleReadyMs = cycleReadyTimings.map((timing) => timing.visibleReadyMs);
  const medianCycleReadyMs = percentile(cycleVisibleReadyMs, 0.5);
  const worstCycleReadyMs = Math.max(...cycleVisibleReadyMs);
  result = {
    runtime_ready_sum_ms: round(homeReadyMs + firstLevelReadyMs + medianCycleReadyMs),
    home_ready_success: 1,
    first_level_ready_success: 1,
    gameplay_state_consistent: firstSnapshot.levelId.length > 0 && firstSnapshot.totalDogs > 0 && pickupStateConsistent ? 1 : 0,
    local_request_failures: localRequestFailures.length,
    page_error_count: pageErrors.length,
    texture_growth_count: Math.max(0, textureCountAfterCycles - textureCountBeforeCycles),
    home_ready_ms: round(homeReadyMs),
    first_level_engine_ready_ms: round(firstLevelEngineReadyMs),
    first_level_ready_ms: round(firstLevelReadyMs),
    cached_cycle_engine_median_ms: round(percentile(cycleEngineReadyMs, 0.5)),
    cached_cycle_engine_worst_ms: round(Math.max(...cycleEngineReadyMs)),
    cached_cycle_median_ms: round(medianCycleReadyMs),
    cached_cycle_worst_ms: round(worstCycleReadyMs),
    frame_gap_p95_ms: round(percentile(browserMetrics.frameGaps, 0.95)),
    frame_gap_max_ms: round(Math.max(0, ...browserMetrics.frameGaps)),
    pickup_frame_gap_p95_ms: round(percentile(browserMetrics.pickupFrameGaps, 0.95)),
    pickup_frame_gap_max_ms: round(Math.max(0, ...browserMetrics.pickupFrameGaps)),
    long_task_total_ms: round(browserMetrics.longTasks.reduce((total, task) => total + task.duration, 0)),
    long_task_max_ms: round(Math.max(0, ...browserMetrics.longTasks.map((task) => task.duration))),
    request_count: browserMetrics.requestCount,
    transfer_bytes: browserMetrics.transferBytes,
    js_transfer_bytes: browserMetrics.jsTransferBytes,
    image_transfer_bytes: browserMetrics.imageTransferBytes,
    heap_growth_bytes: Math.max(0, heapAfterCycles - heapBeforeCycles),
    texture_count_before_cycles: textureCountBeforeCycles,
    texture_count_after_cycles: textureCountAfterCycles,
    blocked_external_requests: blockedExternalRequests,
    level_id: firstSnapshot.levelId,
    total_dogs: firstSnapshot.totalDogs,
    fixture_sha256: fixtureHash(),
    cycle_count: cycleCount,
    bundle: bundleSnapshot(),
  };
  await context.close();
} finally {
  await browser.close();
  await closeServer(server);
}

process.stdout.write(`${JSON.stringify(result)}\n`);
