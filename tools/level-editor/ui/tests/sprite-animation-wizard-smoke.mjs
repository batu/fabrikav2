import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const sessionId = 'wizard_demo';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('Could not allocate a free port'));
        }
      });
    });
  });
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
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    let requestBody = null;
    let postCount = 0;

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === `/api/sessions/${sessionId}/animation-jobs`) {
        postCount += 1;
        requestBody = route.request().postDataJSON();
        if (postCount === 2) {
          await route.fulfill({
            status: 502,
            json: {
              detail: {
                error: 'Layer provider HTTP 403 from storage.googleapis.com',
                job: {
                  id: 'job_failed',
                  status: 'failed',
                  sourceCandidateId: requestBody.sourceCandidateId,
                  sourceImage: 'dogs/dog_00/sprite_000.png',
                  prompt: requestBody.prompt,
                  motionPreset: requestBody.motionPreset,
                  customPrompt: requestBody.customPrompt,
                  durationSeconds: requestBody.durationSeconds,
                  fps: requestBody.fps,
                  provider: 'layer',
                  model: 'layer/sprite-animation',
                  providerJobId: null,
                  contentType: null,
                  previewPath: null,
                  createdAt: '2026-05-11T12:01:00Z',
                  completedAt: '2026-05-11T12:01:02Z',
                  error: 'Layer provider HTTP 403 from storage.googleapis.com',
                  metadata: {},
                },
              },
            },
          });
          return;
        }
        await route.fulfill({
          json: {
            id: 'job_001',
            status: 'completed',
            sourceCandidateId: requestBody.sourceCandidateId,
            sourceImage: 'dogs/dog_00/sprite_000.png',
            prompt: requestBody.prompt,
            motionPreset: requestBody.motionPreset,
            customPrompt: requestBody.customPrompt,
            durationSeconds: requestBody.durationSeconds,
            fps: requestBody.fps,
            provider: 'layer',
            model: 'layer/sprite-animation',
            providerJobId: 'inference_001',
            contentType: 'video/mp4',
            previewPath: 'animations/jobs/job_001/preview.mp4',
            createdAt: '2026-05-11T12:00:00Z',
            completedAt: '2026-05-11T12:00:03Z',
            error: null,
            metadata: {},
          },
        });
        return;
      }
      if (url.pathname === `/levels/${sessionId}/animations/jobs/job_001/preview.mp4`) {
        await route.fulfill({
          contentType: 'video/mp4',
          body: Buffer.from(''),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`${baseUrl}/tests/sprite-animation-wizard-harness.html`);
    await page.getByRole('button', { name: 'Sniff' }).click();
    await page.getByLabel('Custom direction').fill('Keep the paws planted and only move the head.');
    await page.getByRole('button', { name: 'Animate sprite' }).click();
    await page.waitForSelector('video');

    if (requestBody === null) {
      throw new Error('Expected animation job POST request');
    }
    if (requestBody.sourceCandidateId !== 'dog_00:sprite_000') {
      throw new Error(`Expected selected sprite id in request, got ${requestBody.sourceCandidateId}`);
    }
    if (requestBody.motionPreset !== 'sniff') {
      throw new Error(`Expected sniff preset in request, got ${requestBody.motionPreset}`);
    }
    if (requestBody.customPrompt !== 'Keep the paws planted and only move the head.') {
      throw new Error(`Expected custom prompt in request, got ${requestBody.customPrompt}`);
    }
    if (requestBody.durationSeconds !== 3 || requestBody.fps !== 24) {
      throw new Error(`Expected default timing in request, got ${requestBody.durationSeconds}s @ ${requestBody.fps}fps`);
    }

    const status = await page.locator('.animation-job-meta').innerText();
    if (!status.includes('Preview ready')) {
      throw new Error(`Expected completed preview status, got: ${status}`);
    }
    const videoSrc = await page.locator('video').getAttribute('src');
    if (!videoSrc || !videoSrc.endsWith(`/levels/${sessionId}/animations/jobs/job_001/preview.mp4`)) {
      throw new Error(`Expected preview video src, got: ${videoSrc}`);
    }

    await page.getByLabel('Custom direction').fill('Keep the paws planted and wag only once.');
    await page.waitForSelector('video', { state: 'detached' });
    const promptLabel = await page.locator('.animation-prompt-summary span').innerText();
    if (promptLabel.toLowerCase() !== 'prompt to send') {
      throw new Error(`Expected prompt summary to return to draft after edits, got: ${promptLabel}`);
    }
    const draftStatus = await page.locator('.animation-job-status').innerText();
    if (!draftStatus.includes('settings changed')) {
      throw new Error(`Expected settings-changed status after editing a completed preview, got: ${draftStatus}`);
    }

    await page.getByRole('button', { name: 'Animate sprite' }).click();
    await page.waitForSelector('.animation-job-error');
    const failedStatus = await page.getByTestId('created-job-state').innerText();
    if (failedStatus !== 'job_failed:failed') {
      throw new Error(`Expected failed saved job to notify parent callback, got: ${failedStatus}`);
    }
    const failedError = await page.locator('.animation-job-error').first().innerText();
    if (!failedError.includes('Layer provider HTTP 403 from storage.googleapis.com')) {
      throw new Error(`Expected failed provider error, got: ${failedError}`);
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
