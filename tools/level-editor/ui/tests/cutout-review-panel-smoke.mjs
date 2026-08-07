import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const sessionId = 'cutout_review_demo';
const secondSessionId = 'cutout_review_demo_2';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Could not allocate a free port'));
      });
    });
  });
}

function png(color) {
  const pixels = {
    red: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    green: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAwUBAcgnV3EAAAAASUVORK5CYII=',
    blue: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPgPAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  };
  return Buffer.from(pixels[color] ?? pixels.red, 'base64');
}

function waitForServer() {
  const deadline = Date.now() + 20_000;
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const response = await fetch(baseUrl);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // Vite is still starting.
      }
      if (Date.now() > deadline) {
        reject(new Error('Timed out waiting for Vite dev server'));
        return;
      }
      setTimeout(check, 250);
    };
    check();
  });
}

async function run() {
  const vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(port)],
    { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore'] },
  );
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    let completedRegens = 0;
    let batchSubmissions = 0;
    let submittedDogIndices = [];
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const isCandidateRequest =
        url.pathname === `/api/sessions/${sessionId}/sprite-candidates` ||
        url.pathname === `/api/sessions/${secondSessionId}/sprite-candidates`;
      if (isCandidateRequest) {
        await route.fulfill({
          json: {
            candidates: [
              {
                id: 'dog_00:sprite_000',
                dogIndex: 0,
                spriteIndex: 0,
                status: 'ready',
                reason: null,
                image: 'dogs/dog_00/sprite_000.png',
                mask: 'dogs/dog_00/sprite_mask_000.png',
                metadataPath: 'dogs/dog_00/sprite_000.json',
                width: 42,
                height: 50,
                technique: 'sam2-box075-component-cutout-v1',
                quality: { pickupUsable: true, bboxCoverage: 0.18, visibleCoverage: 0.09, edgeTouches: 0 },
              },
              {
                id: 'dog_00:sprite_001',
                dogIndex: 0,
                spriteIndex: 1,
                status: 'ready',
                reason: null,
                image: 'dogs/dog_00/sprite_001.png',
                mask: 'dogs/dog_00/sprite_mask_001.png',
                metadataPath: 'dogs/dog_00/sprite_001.json',
                width: 110,
                height: 120,
                technique: 'semantic-rembg-isnet-cutout-v1',
                quality: { pickupUsable: true, bboxCoverage: 0.72, visibleCoverage: 0.51, edgeTouches: 3 },
              },
              {
                id: 'dog_01:sprite_000',
                dogIndex: 1,
                spriteIndex: 0,
                status: 'ready',
                reason: null,
                image: 'dogs/dog_01/sprite_000.png',
                mask: 'dogs/dog_01/sprite_mask_000.png',
                metadataPath: 'dogs/dog_01/sprite_000.json',
                width: 94,
                height: 88,
                technique: 'semantic-rembg-isnet-cutout-v1',
                quality: { pickupUsable: true, bboxCoverage: 0.64, visibleCoverage: 0.42, edgeTouches: 2 },
              },
              ...(completedRegens > 0
                ? [{
                    id: 'dog_01:sprite_001',
                    dogIndex: 1,
                    spriteIndex: 1,
                    status: 'ready',
                    reason: null,
                    image: 'dogs/dog_01/sprite_001.png',
                    mask: 'dogs/dog_01/sprite_mask_001.png',
                    metadataPath: 'dogs/dog_01/sprite_001.json',
                    width: 44,
                    height: 48,
                    technique: 'sam2-box075-component-cutout-v1',
                    quality: { pickupUsable: true, bboxCoverage: 0.16, visibleCoverage: 0.08, edgeTouches: 0 },
                  }]
                : []),
              {
                id: 'dog_02:sprite_000',
                dogIndex: 2,
                spriteIndex: 0,
                status: 'not_pickup_usable',
                reason: 'sprite metadata marks this pickup as unusable',
                image: 'dogs/dog_02/sprite_000.png',
                mask: null,
                metadataPath: 'dogs/dog_02/sprite_000.json',
                width: 18,
                height: 18,
                technique: 'diff-mask-connected-components-v1',
                quality: { pickupUsable: false },
              },
            ],
          },
        });
        return;
      }
      if (url.pathname.match(/^\/api\/sessions\/[^/]+\/sprite-candidates\/[^/]+\/overlay$/)) {
        await route.fulfill({ contentType: 'image/png', body: png('blue') });
        return;
      }
      if (url.pathname === `/api/sessions/${sessionId}/dogs/retry-inpaint/jobs` && route.request().method() === 'POST') {
        batchSubmissions += 1;
        const body = route.request().postDataJSON();
        submittedDogIndices = body.dogIndices;
        await route.fulfill({ json: {
          jobId: 'retry_job_1', status: 'queued', succeeded: 0, failed: 0, units: [], error: null,
        } });
        return;
      }
      if (url.pathname === `/api/sessions/${sessionId}/dogs/retry-inpaint/jobs/retry_job_1`) {
        completedRegens = 1;
        await route.fulfill({ json: {
          jobId: 'retry_job_1', status: 'failed_retryable', succeeded: 1, failed: 1, error: 'one failed',
          units: [
            { dogIndex: 1, status: 'succeeded', retryable: false, error: null, file: 'dogs/dog_01/variant_001.png', variantIndex: 1 },
            { dogIndex: 2, status: 'failed_retryable', retryable: true, error: 'dog 2 failed', file: null, variantIndex: null },
          ],
        } });
        return;
      }
      if (url.pathname.startsWith(`/levels/${sessionId}/`) || url.pathname.startsWith(`/levels/${secondSessionId}/`)) {
        await route.fulfill({ contentType: 'image/png', body: png(url.pathname.includes('dog_01') ? 'green' : url.pathname.includes('dog_02') ? 'blue' : 'red') });
        return;
      }
      await route.continue();
    });

    await page.goto(baseUrl);
    await page.evaluate((key) => {
      window.localStorage.setItem(key, 'null');
    }, `ftd-cutout-review:${sessionId}`);
    await page.goto(`${baseUrl}/tests/cutout-review-panel-harness.html`);
    await page.waitForSelector('.cutout-review-card');
    const firstLabel = await page.locator('.cutout-review-card').first().locator('strong').innerText();
    if (!firstLabel.includes('sprite 000')) {
      throw new Error(`Expected active dog variant to use sprite 000, saw: ${firstLabel}`);
    }
    const summary = await page.locator('.cutout-review-summary').innerText();
    if (!summary.includes('2 need redo')) {
      throw new Error(`Unexpected initial summary: ${summary}`);
    }
    const firstOverlay = page.getByRole('button', { name: 'Select dog #0 · sprite 000 for regeneration' });
    if (await firstOverlay.getAttribute('aria-pressed') !== 'false') {
      throw new Error('Clean overlay unexpectedly started selected.');
    }
    await firstOverlay.click();
    await page.getByRole('button', { name: 'Redo selected (3)' }).waitFor();
    const selectedOverlays = await page.locator('.cutout-review-overlay[aria-pressed="true"]').count();
    if (selectedOverlays !== 3) throw new Error(`Expected three independently selected overlays, saw ${selectedOverlays}`);
    await page.getByRole('button', { name: 'Remove dog #0 · sprite 000 from regeneration' }).click();
    await page.getByRole('button', { name: 'Redo selected (2)' }).waitFor();
    await page.locator('.cutout-review-card').first().getByText('Keep').click();
    await page.waitForFunction(
      (key) => window.localStorage.getItem(key)?.includes('approved') === true,
      `ftd-cutout-review:${sessionId}`,
    );
    await page.reload();
    await page.waitForSelector('.cutout-review-card.approved');
    const persistedSummary = await page.locator('.cutout-review-summary').innerText();
    if (!persistedSummary.includes('1/3 kept')) {
      throw new Error(`Review status did not persist across reload: ${persistedSummary}`);
    }
    await page.getByText('Redo selected (2)').click();
    await page.waitForSelector('#last-action:text("dog 1 regenerated as variant 1")');
    if (batchSubmissions !== 1) throw new Error(`Expected one durable batch submission, saw ${batchSubmissions}`);
    if (JSON.stringify(submittedDogIndices) !== JSON.stringify([1, 2])) {
      throw new Error(`Batch did not target the selected dog indices: ${JSON.stringify(submittedDogIndices)}`);
    }
    await page.getByText('1 redo failed').waitFor();
    const replacedLabel = await page.locator('.cutout-review-card').nth(1).locator('strong').innerText();
    if (!replacedLabel.includes('sprite 001')) {
      throw new Error(`Regenerated dog did not refresh to replacement candidate: ${replacedLabel}`);
    }
    await page.screenshot({ path: '/tmp/pcdNQRrf-cutout-review-panel.png', fullPage: true });
    await page.locator('#switch-session').click();
    await page.waitForFunction(() => !document.querySelector('.cutout-review-summary')?.textContent?.includes('1/3 kept'));
    const switchedSummary = await page.locator('.cutout-review-summary').innerText();
    if (switchedSummary.includes('1/3 kept')) {
      throw new Error(`Review state leaked into second session: ${switchedSummary}`);
    }
  } finally {
    if (browser) await browser.close();
    if (process.platform === 'win32') {
      vite.kill('SIGTERM');
    } else if (vite.pid) {
      try {
        process.kill(-vite.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
