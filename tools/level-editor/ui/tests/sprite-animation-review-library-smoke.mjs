import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const sessionId = 'review_library_demo';

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
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === `/api/sessions/${sessionId}/animation-jobs`) {
        await route.fulfill({
          json: {
            jobs: [
              {
                id: 'job_other_sprite',
                status: 'completed',
                reviewStatus: 'generated',
                previewExists: true,
                sourceCandidateId: 'dog_01:sprite_000',
                sourceImage: 'dogs/dog_01/sprite_000.png',
                prompt: 'Animate a different dog sprite.',
                motionPreset: 'jump',
                customPrompt: null,
                durationSeconds: 3,
                fps: 24,
                provider: 'layer',
                model: 'layer/sprite-animation',
                providerJobId: 'inference-other',
                contentType: 'video/mp4',
                previewPath: 'animations/jobs/job_other_sprite/preview.mp4',
                createdAt: '2026-05-11T12:03:00Z',
                completedAt: '2026-05-11T12:03:03Z',
                error: null,
                metadata: {},
              },
              {
                id: 'job_generated',
                status: 'completed',
                reviewStatus: 'generated',
                previewExists: true,
                sourceCandidateId: 'dog_00:sprite_000',
                sourceImage: 'dogs/dog_00/sprite_000.png',
                prompt: 'Animate this dog sprite with a gentle tail wag.',
                motionPreset: 'tail_wag',
                customPrompt: 'Keep the paws planted.',
                durationSeconds: 3,
                fps: 24,
                provider: 'layer',
                model: 'layer/sprite-animation',
                providerJobId: 'inference-generated',
                contentType: 'video/mp4',
                previewPath: 'animations/jobs/job_generated/preview.mp4',
                createdAt: '2026-05-11T12:00:00Z',
                completedAt: '2026-05-11T12:00:03Z',
                error: null,
                metadata: {},
              },
              {
                id: 'job_failed',
                status: 'failed',
                reviewStatus: 'failed',
                previewExists: false,
                sourceCandidateId: 'dog_00:sprite_000',
                sourceImage: 'dogs/dog_00/sprite_000.png',
                prompt: 'Animate this dog sprite with a blink.',
                motionPreset: 'blink',
                customPrompt: null,
                durationSeconds: 3,
                fps: 24,
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
              {
                id: 'job_missing',
                status: 'completed',
                reviewStatus: 'missing_file',
                previewExists: false,
                sourceCandidateId: 'dog_00:sprite_000',
                sourceImage: 'dogs/dog_00/sprite_000.png',
                prompt: 'Animate this dog sprite with idle breathing.',
                motionPreset: 'idle_breathing',
                customPrompt: null,
                durationSeconds: 2,
                fps: 12,
                provider: 'layer',
                model: 'layer/sprite-animation',
                providerJobId: 'inference-missing',
                contentType: 'video/mp4',
                previewPath: 'animations/jobs/job_missing/preview.mp4',
                createdAt: '2026-05-11T12:02:00Z',
                completedAt: '2026-05-11T12:02:03Z',
                error: null,
                metadata: {},
              },
            ],
          },
        });
        return;
      }
      if (url.pathname === `/levels/${sessionId}/animations/jobs/job_generated/preview.mp4`) {
        await route.fulfill({ contentType: 'video/mp4', body: Buffer.from('') });
        return;
      }
      await route.continue();
    });

    await page.goto(`${baseUrl}/tests/sprite-animation-review-library-harness.html`);
    await page.waitForSelector('.animation-library-item');
    const statusText = await page.locator('.animation-library-list').innerText();
    for (const expected of ['Generated', 'Failed', 'Missing file']) {
      if (!statusText.includes(expected)) {
        throw new Error(`Expected library list to include ${expected}, got: ${statusText}`);
      }
    }
    if (statusText.includes('inference-other') || statusText.includes('different dog sprite')) {
      throw new Error(`Expected other sprite jobs to be filtered out, got: ${statusText}`);
    }
    const headerText = await page.locator('.sprite-animation-library-header').innerText();
    if (!headerText.includes('3 saved attempts for selected sprite')) {
      throw new Error(`Expected selected-sprite candidate count, got: ${headerText}`);
    }
    await page.getByRole('button', { name: /Generated/i }).click();
    await page.waitForSelector('video');
    const videoSrc = await page.locator('video').getAttribute('src');
    if (!videoSrc || !videoSrc.endsWith(`/levels/${sessionId}/animations/jobs/job_generated/preview.mp4`)) {
      throw new Error(`Expected generated preview video src, got: ${videoSrc}`);
    }
    const generatedDetail = await page.locator('.animation-library-detail').innerText();
    if (!generatedDetail.includes('inference-generated') || !generatedDetail.includes('Keep the paws planted')) {
      throw new Error(`Expected generated metadata and custom prompt, got: ${generatedDetail}`);
    }

    await page.getByRole('button', { name: /Failed/i }).click();
    const failedDetail = await page.locator('.animation-library-detail').innerText();
    if (!failedDetail.includes('Layer provider HTTP 403 from storage.googleapis.com')) {
      throw new Error(`Expected failed sanitized error, got: ${failedDetail}`);
    }
    if (await page.locator('.animation-library-detail video').count() !== 0) {
      throw new Error('Expected failed candidate to render no video');
    }

    await page.getByRole('button', { name: /Missing file/i }).click();
    const missingDetail = await page.locator('.animation-library-detail').innerText();
    if (!missingDetail.includes('Preview file missing')) {
      throw new Error(`Expected missing-file state, got: ${missingDetail}`);
    }
    if (await page.locator('.animation-library-detail video').count() !== 0) {
      throw new Error('Expected missing-file candidate to render no video');
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
