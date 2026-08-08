#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const apiUrl = process.env.PERF_API_URL ?? 'http://127.0.0.1:5206';
const requestedPort = Number(process.env.PERF_UI_PORT ?? 0);
const navigationSamples = 5;
const preferredSessionId = 'ad_campaigns_ad_treehouse_village_bird_24d4';
const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const ordered = values.slice().sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function freePort() {
  if (requestedPort > 0) return Promise.resolve(requestedPort);
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolvePort(address.port);
        else reject(new Error('Could not allocate a free profiling port'));
      });
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for profiling UI at ${url}`);
}

function stopProcess(child) {
  try {
    if (process.platform === 'win32') child.kill();
    else process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function createdAtMs(session) {
  const parsed = Date.parse(session.createdAt ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

function activeCards(sessions) {
  const cards = [];
  for (const session of sessions) {
    if (session.archived) continue;
    for (const variant of session.variants ?? []) {
      if ((session.archivedVariants ?? []).includes(variant)) continue;
      cards.push({ id: `${session.id}::${variant}`, session, variant });
    }
  }
  return cards.sort((a, b) => {
    const createdDelta = createdAtMs(b.session) - createdAtMs(a.session);
    if (createdDelta !== 0) return createdDelta;
    if (a.session.id !== b.session.id) return a.session.id.localeCompare(b.session.id);
    return a.variant.localeCompare(b.variant);
  });
}

async function findFixture() {
  const response = await fetch(`${apiUrl}/api/sessions?include_public=true`);
  if (!response.ok) throw new Error(`Session fixture request failed: ${response.status}`);
  const sessions = await response.json();
  const cards = activeCards(sessions);
  const preferredCardId = `${preferredSessionId}::gemini`;
  let targetIndex = cards.findIndex((card) => card.id === preferredCardId);
  if (targetIndex < 0) {
    targetIndex = cards.findIndex((card, index) => (
      card.variant === 'gemini' && card.session.nDogs > 0 &&
      (index >= navigationSamples || index + navigationSamples < cards.length)
    ));
  }
  if (targetIndex < 0) throw new Error('No stable performance fixture card is available');
  const direction = targetIndex + navigationSamples < cards.length ? 1 : -1;
  const navigationCards = Array.from({ length: navigationSamples + 1 }, (_, offset) => (
    cards[targetIndex + offset * direction]
  ));
  if (navigationCards.some((card) => card === undefined)) {
    throw new Error('Performance fixture does not have enough adjacent cards');
  }
  const target = cards[targetIndex];
  const manifest = navigationCards.map((card) => ({
    id: card.id,
    assetVersion: card.session.assetVersion ?? 0,
    nDogs: card.session.nDogs,
  }));
  return {
    cards,
    target,
    direction,
    manifest,
    hash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
  };
}

async function firstBackgroundDraw(page, { after, differentFrom = null, includes = null }) {
  await page.waitForFunction(
    ({ drawAfter, previous, required }) => window.__editorPerf.draws.some((draw) => (
      draw.t >= drawAfter && draw.src && draw.src !== previous && (!required || draw.src.includes(required))
    )),
    { drawAfter: after, previous: differentFrom, required: includes },
    { timeout: 20_000 },
  );
  return page.evaluate(
    ({ drawAfter, previous, required }) => window.__editorPerf.draws.find((draw) => (
      draw.t >= drawAfter && draw.src && draw.src !== previous && (!required || draw.src.includes(required))
    )),
    { drawAfter: after, previous: differentFrom, required: includes },
  );
}

async function dragAndMeasure(page, overlay, deltaX, deltaY) {
  const bounds = await overlay.boundingBox();
  if (!bounds) throw new Error('Cutout overlay has no measurable bounds');
  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height / 2;
  await page.evaluate(() => window.__editorPerf.startFrameCapture());
  const startedAt = await page.evaluate(() => performance.now());
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 120 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const capture = await page.evaluate(() => window.__editorPerf.stopFrameCapture());
  const endedAt = await page.evaluate(() => performance.now());
  const longTasks = await page.evaluate(
    ({ start, end }) => window.__editorPerf.longTasks.filter((task) => task.t >= start && task.t <= end),
    { start: startedAt, end: endedAt },
  );
  return {
    gaps: capture.gaps,
    longTaskMs: longTasks.reduce((total, task) => total + task.duration, 0),
  };
}

async function run() {
  const fixture = await findFixture();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: uiRoot,
      detached: process.platform !== 'win32',
      env: { ...process.env, LEVEL_EDITOR_API: apiUrl },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  let browser;
  try {
    await waitForServer(baseUrl);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const requests = [];
    page.on('request', (request) => {
      requests.push({ method: request.method(), url: request.url(), t: Date.now() });
    });
    await page.route('**/api/sessions/*/sprite-candidates/*/placement', async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true, spriteBox: body.spriteBox } });
    });
    await page.addInitScript(() => {
      const perf = {
        draws: [],
        longTasks: [],
        frameHandle: 0,
        frameTimes: [],
        startFrameCapture() {
          this.frameTimes = [];
          const tick = (time) => {
            this.frameTimes.push(time);
            this.frameHandle = requestAnimationFrame(tick);
          };
          this.frameHandle = requestAnimationFrame(tick);
        },
        stopFrameCapture() {
          cancelAnimationFrame(this.frameHandle);
          const gaps = this.frameTimes.slice(1).map((time, index) => time - this.frameTimes[index]);
          return { gaps };
        },
      };
      window.__editorPerf = perf;
      const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function instrumentedDrawImage(...args) {
        const result = originalDrawImage.apply(this, args);
        if (this.canvas?.classList?.contains('bg-canvas')) {
          const image = args[0];
          perf.draws.push({
            t: performance.now(),
            src: image?.currentSrc || image?.src || '',
          });
        }
        return result;
      };
      if (typeof PerformanceObserver !== 'undefined') {
        try {
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              perf.longTasks.push({ t: entry.startTime, duration: entry.duration });
            }
          });
          observer.observe({ type: 'longtask', buffered: true });
        } catch {
          // Long-task observation is diagnostic; missing drag samples still fail hard below.
        }
      }
    });

    await page.goto(`${baseUrl}/#gallery`, { waitUntil: 'domcontentloaded' });
    const targetCard = page.locator(`[data-gallery-card-id="${fixture.target.id}"]`);
    await targetCard.waitFor({ timeout: 30_000 });
    const galleryReadyMs = await page.evaluate(() => performance.now());

    const modalStartedAt = await page.evaluate(() => performance.now());
    await targetCard.locator('button').first().click();
    await page.getByRole('dialog').waitFor({ timeout: 20_000 });
    const initialDraw = await firstBackgroundDraw(page, {
      after: modalStartedAt,
      includes: fixture.target.session.id,
    });
    const modalBackgroundReadyMs = initialDraw.t - modalStartedAt;

    const navigationLatencies = [];
    let previousSrc = initialDraw.src;
    const navButtonName = fixture.direction > 0 ? 'Next →' : '← Prev';
    for (let sample = 0; sample < navigationSamples; sample += 1) {
      const startedAt = await page.evaluate(() => performance.now());
      await page.getByRole('button', { name: navButtonName, exact: true }).click();
      const draw = await firstBackgroundDraw(page, { after: startedAt, differentFrom: previousSrc });
      navigationLatencies.push(draw.t - startedAt);
      previousSrc = draw.src;
    }

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10_000 });
    await targetCard.locator('button').first().click();
    await page.getByRole('dialog').waitFor({ timeout: 20_000 });
    await page.getByRole('tab', { name: 'Cutouts & redo' }).click();
    const firstCard = page.locator('.cutout-review-card').first();
    await firstCard.waitFor({ timeout: 30_000 });
    const overlay = firstCard.locator('.cutout-review-overlay');
    await overlay.waitFor({ timeout: 10_000 });

    const requestStartIndex = requests.length;
    const spriteDrag = await dragAndMeasure(page, overlay, 150, 32);
    await page.waitForTimeout(1_150);

    await firstCard.getByRole('tab', { name: 'Padding', exact: true }).click();
    const left = firstCard.getByLabel(/padding left$/);
    const top = firstCard.getByLabel(/padding top$/);
    const right = firstCard.getByLabel(/padding right$/);
    const bottom = firstCard.getByLabel(/padding bottom$/);
    const before = [left, top, right, bottom];
    const beforeValues = await Promise.all(before.map((input) => input.inputValue().then(Number)));
    const paddingDrag = await dragAndMeasure(page, overlay, 210, 60);
    const afterValues = await Promise.all(before.map((input) => input.inputValue().then(Number)));

    const dragRequests = requests.slice(requestStartIndex);
    const candidateRefreshes = dragRequests.filter((request) => (
      request.method === 'GET' && new URL(request.url).pathname.endsWith('/sprite-candidates')
    )).length;
    const placementPuts = dragRequests.filter((request) => (
      request.method === 'PUT' && new URL(request.url).pathname.endsWith('/placement')
    )).length;
    const paddingSizePreserved = (
      beforeValues[2] - beforeValues[0] === afterValues[2] - afterValues[0] &&
      beforeValues[3] - beforeValues[1] === afterValues[3] - afterValues[1]
    );
    const allDragGaps = [...spriteDrag.gaps, ...paddingDrag.gaps];
    const samplesComplete = (
      navigationLatencies.length === navigationSamples &&
      spriteDrag.gaps.length >= 3 && paddingDrag.gaps.length >= 3
    );
    const navigationP95 = percentile(navigationLatencies, 0.95);
    const spriteP95 = percentile(spriteDrag.gaps, 0.95);
    const paddingP95 = percentile(paddingDrag.gaps, 0.95);
    const result = {
      interaction_latency_score_ms: round(modalBackgroundReadyMs + navigationP95 + Math.max(spriteP95, paddingP95)),
      profile_samples_complete: samplesComplete ? 1 : 0,
      navigation_success_rate: round(navigationLatencies.length / navigationSamples),
      padding_box_size_preserved: paddingSizePreserved ? 1 : 0,
      drag_candidate_refresh_requests: candidateRefreshes,
      gallery_ready_ms: round(galleryReadyMs),
      modal_background_ready_ms: round(modalBackgroundReadyMs),
      navigation_background_p50_ms: round(percentile(navigationLatencies, 0.5)),
      navigation_background_p95_ms: round(navigationP95),
      navigation_background_max_ms: round(Math.max(...navigationLatencies)),
      sprite_drag_frame_p95_ms: round(spriteP95),
      padding_drag_frame_p95_ms: round(paddingP95),
      drag_frame_max_ms: round(Math.max(...allDragGaps)),
      drag_long_task_ms: round(spriteDrag.longTaskMs + paddingDrag.longTaskMs),
      drag_placement_put_requests: placementPuts,
      fixture_card_count: fixture.cards.length,
      fixture_hash: fixture.hash,
      fixture_session_id: fixture.target.session.id,
      navigation_samples_ms: navigationLatencies.map(round),
      sprite_drag_frame_samples: spriteDrag.gaps.length,
      padding_drag_frame_samples: paddingDrag.gaps.length,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    if (browser) await browser.close();
    stopProcess(vite);
  }
}

run().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
