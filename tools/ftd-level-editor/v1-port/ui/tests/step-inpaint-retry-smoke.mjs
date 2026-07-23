import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';
import { URL } from 'node:url';
import { chromium } from 'playwright';

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;

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

function png() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  );
}

const geometryConfig = {
  hudFraction: 0.139,
  bannerFraction: 0.071,
  sectionBoundaryBuffer: 60,
  landscapeEdgeSafeArea: 128,
  viewportSafeFraction: 0.8,
  nSections: 3,
  portraitReference: {
    width: 768,
    height: 1376,
    deadzones: [
      { label: 'HUD', x: 0, y: 0, w: 768, h: 191 },
      { label: 'AD', x: 0, y: 1278, w: 768, h: 98 },
      { label: 'HINT', x: 566, y: 1068, w: 182, h: 182 },
      { label: 'CROP L', x: 0, y: 0, w: 77, h: 1376 },
      { label: 'CROP R', x: 691, y: 0, w: 77, h: 1376 },
    ],
  },
};

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

function restoredSession(sessionId, dog1) {
  return {
    id: sessionId,
    orientation: 'portrait',
    style: 'flatvector',
    model: 'openai/gpt-image-2',
    inpaintModel: 'openai/gpt-image-2',
    scenePrompt: 'market',
    dogPrompt: 'a tiny dog',
    nDogs: 3,
    backgrounds: [{ index: 0, file: 'bg_00.png', generationTime: 1, width: 120, height: 120 }],
    selectedBgIndex: 0,
    bgWidth: 120,
    bgHeight: 120,
    sections: [],
    hitboxes: [{ x: 30, y: 40, r: 10 }, { x: 80, y: 70, r: 10 }, { x: 100, y: 95, r: 10 }],
    dogs: [
      { index: 0, status: 'done', activeVariant: 0, promptOverride: null, variants: ['dogs/dog_00/variant_000.png'] },
      dog1,
      { index: 2, status: 'done', activeVariant: 0, promptOverride: null, variants: ['dogs/dog_02/variant_000.png'] },
    ],
    exported: false,
  };
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
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const posts = [];
    let successRetried = false;
    let fullColorRequests = 0;
    let geometryRequests = 0;
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/config/geometry') {
        geometryRequests += 1;
        await route.fulfill({ json: geometryConfig });
        return;
      }
      if (url.pathname.endsWith('/dogs/retry-inpaint/jobs') && route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() ?? '{}');
        posts.push({ sessionId: url.pathname.split('/')[3], body });
        await route.fulfill({
          json: {
            jobId: body.dogIndices?.[0] === 1 && url.pathname.includes('retry_failure') ? 'retry-failure' : 'retry-success',
            status: 'queued',
            succeeded: 0,
            failed: 0,
            units: [],
            error: null,
          },
        });
        return;
      }
      if (url.pathname === '/api/sessions/step_inpaint_retry_success/dogs/retry-inpaint/jobs/retry-success') {
        successRetried = true;
        await route.fulfill({
          json: {
            jobId: 'retry-success',
            status: 'succeeded',
            succeeded: 1,
            failed: 0,
            units: [{
              dogIndex: 1,
              status: 'succeeded',
              retryable: false,
              error: null,
              file: 'dogs/dog_01/variant_001.png',
              variantIndex: 1,
            }],
            error: null,
          },
        });
        return;
      }
      if (url.pathname === '/api/sessions/step_inpaint_retry_failure/dogs/retry-inpaint/jobs/retry-failure') {
        await route.fulfill({
          json: {
            jobId: 'retry-failure',
            status: 'failed_retryable',
            succeeded: 0,
            failed: 1,
            units: [{
              dogIndex: 1,
              status: 'failed_retryable',
              retryable: true,
              error: 'retry still failed',
              file: null,
              variantIndex: null,
            }],
            error: '1 failed dog retry attempt did not complete',
          },
        });
        return;
      }
      if (url.pathname === '/api/sessions/step_inpaint_retry_success') {
        await route.fulfill({
          json: successRetried
            ? restoredSession('step_inpaint_retry_success', {
                index: 1,
                status: 'done',
                activeVariant: 1,
                promptOverride: null,
                variants: ['dogs/dog_01/variant_001.png'],
              })
            : restoredSession('step_inpaint_retry_success', {
                index: 1,
                status: 'error',
                activeVariant: null,
                promptOverride: null,
                variants: [],
              }),
        });
        return;
      }
      if (url.pathname === '/api/sessions/step_inpaint_retry_failure') {
        await route.fulfill({
          json: restoredSession('step_inpaint_retry_failure', {
            index: 1,
            status: 'error',
            activeVariant: null,
            promptOverride: null,
            variants: [],
          }),
        });
        return;
      }
      if (url.pathname.endsWith('/recomposite-preview')) {
        await route.fulfill({ contentType: 'image/jpeg', body: png() });
        return;
      }
      if (url.pathname.startsWith('/levels/')) {
        if (url.pathname.endsWith('/color.png')) {
          fullColorRequests += 1;
        }
        await route.fulfill({ contentType: 'image/png', body: png() });
        return;
      }
      await route.continue();
    });

    await page.goto(`${baseUrl}/tests/step-inpaint-retry-harness.html?session=step_inpaint_retry_success`);
    await page.waitForSelector('text=Retry failed dogs (1)');
    await page.waitForSelector('text=Dog is still marked failed; retry or inspect backend logs.');
    if (geometryRequests === 0) {
      throw new Error('StepInpaint LevelCanvas did not request server geometry config.');
    }
    const body = await page.locator('body').innerText();
    for (const retired of [
      'Shared prompt',
      'Describe how the dog should be inpainted',
      'local preview',
      'catalog upload',
    ]) {
      if (body.includes(retired)) {
        throw new Error(`Retired Dogs review copy still visible: ${retired}`);
      }
    }
    await page.locator('button[title^="#0"]').first().click();
    await page.waitForSelector('text=Exclude');
    const variantCopy = await page.locator('body').innerText();
    if (variantCopy.includes('No variant')) {
      throw new Error(`Dog review should expose Exclude instead of No variant: ${variantCopy}`);
    }
    await page.getByRole('button', { name: 'Retry failed dogs (1)' }).click();
    await page.waitForSelector('text=All 3 dogs inpainted');
    if (posts[0]?.body?.dogIndices?.join(',') !== '1') {
      throw new Error(`Retry posted wrong dog indices: ${JSON.stringify(posts[0])}`);
    }

    await page.goto(`${baseUrl}/tests/step-inpaint-retry-harness.html?session=step_inpaint_retry_failure`);
    await page.waitForSelector('text=Retry failed dogs (1)');
    await page.getByRole('button', { name: 'Retry failed dogs (1)' }).click();
    await page.waitForSelector('text=retry still failed');
    await page.waitForSelector('text=Retry failed dogs (1)');
    if (fullColorRequests !== 0) {
      throw new Error(`StepInpaint should use recomposite-preview instead of full color.png; requests=${fullColorRequests}`);
    }
  } finally {
    if (browser) await browser.close();
    if (process.platform === 'win32') {
      vite.kill();
    } else {
      try {
        process.kill(-vite.pid);
      } catch {
        vite.kill();
      }
    }
  }
}

await run();
