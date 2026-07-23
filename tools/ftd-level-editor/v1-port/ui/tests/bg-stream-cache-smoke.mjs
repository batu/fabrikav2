import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';
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

function stopVite(vite) {
  try {
    if (process.platform === 'win32') vite.kill();
    else process.kill(-vite.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

const seededSession = {
  id: 'bg_stream_cache_seed',
  orientation: 'portrait',
  style: 'demo-style',
  model: 'demo-model',
  bgModel: 'demo-model',
  inpaintModel: 'openai/gpt-image-2',
  scenePrompt: 'demo scene',
  dogPrompt: 'a tiny dog',
  nDogs: 1,
  backgrounds: [],
  selectedBgIndex: null,
  bgWidth: 0,
  bgHeight: 0,
  sections: [],
  hitboxes: [],
  dogs: [],
  setting: null,
  scene: null,
  entity: null,
  maskParams: { radial: 0, feather: 0 },
  exported: false,
  catalogUploaded: false,
  catalogListable: false,
  catalogTombstoned: false,
  bundledInApp: false,
};

async function run() {
  const vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(port)],
    { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore'] },
  );
  let browser;
  let releaseSession;
  let startJobCount = 0;
  let resumeJobPolls = 0;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });

    await page.route('**/api/sessions/bg_stream_cache_seed', async (route) => {
      await new Promise((resolve) => { releaseSession = resolve; });
      await route.fulfill({ json: seededSession });
    });
    await page.route('**/api/sessions/bg_stream_cache_seed/background-generation/jobs', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      startJobCount += 1;
      await route.fulfill({
        json: {
          jobId: 'bg-job-1',
          status: 'queued',
          succeeded: 0,
          failed: 0,
          backgrounds: [],
          error: null,
        },
      });
    });
    await page.route('**/api/sessions/bg_stream_cache_seed/background-generation/jobs/bg-job-resume', async (route) => {
      resumeJobPolls += 1;
      await route.fulfill({
        json: {
          jobId: 'bg-job-resume',
          status: 'succeeded',
          succeeded: 1,
          failed: 0,
          backgrounds: [{ index: 0, file: 'bg_00.png', generationTime: 1, width: 120, height: 180 }],
          error: null,
        },
      });
    });

    await page.goto(`${baseUrl}/tests/bg-stream-cache-harness.html`);
    await page.getByTestId('start').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="generation-status"]')?.textContent === 'generating:0');

    await page.waitForTimeout(250);
    const eventSourcesBeforeSeed = await page.evaluate(() => window.__bgEventSources.length);
    if (eventSourcesBeforeSeed !== 0) {
      throw new Error(`EventSource opened before session seed resolved: ${eventSourcesBeforeSeed}`);
    }

    releaseSession();
    await page.waitForFunction(() => window.__bgEventSources.length === 1);
    if (startJobCount !== 1) {
      throw new Error(`Expected one durable background job start, got ${startJobCount}`);
    }
    const jobStatus = await page.getByTestId('background-job').innerText();
    if (jobStatus !== 'bg-job-1:queued') {
      throw new Error(`Expected durable job status in hook, got ${jobStatus}`);
    }
    await page.evaluate(() => {
      window.__bgEventSources[0].emit('bg_ready', {
        index: 0,
        file: 'bg_00.png',
        generationTime: 1,
        width: 120,
        height: 180,
      });
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="background-count"]')?.textContent === '1');

    await page.evaluate(() => {
      window.__bgEventSources[0].emit('bg_ready', {
        index: 0,
        file: 'bg_00_retry.png',
        generationTime: 2,
        width: 120,
        height: 180,
      });
    });
    await page.waitForTimeout(100);
    const backgroundCount = await page.getByTestId('background-count').innerText();
    if (backgroundCount !== '1') {
      throw new Error(`Duplicate bg_ready should upsert by index, got ${backgroundCount} backgrounds`);
    }

    const resumePage = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await resumePage.route('**/api/sessions/bg_stream_cache_seed/background-generation/jobs/bg-job-resume', async (route) => {
      resumeJobPolls += 1;
      await route.fulfill({
        json: {
          jobId: 'bg-job-resume',
          status: 'succeeded',
          succeeded: 1,
          failed: 0,
          backgrounds: [{ index: 0, file: 'bg_00.png', generationTime: 1, width: 120, height: 180 }],
          error: null,
        },
      });
    });
    await resumePage.goto(`${baseUrl}/tests/bg-stream-cache-harness.html`);
    await resumePage.getByTestId('resume').click();
    await resumePage.waitForFunction(() => document.querySelector('[data-testid="background-job"]')?.textContent?.includes('bg-job-resume:succeeded'));
    const resumeEventSources = await resumePage.evaluate(() => window.__bgEventSources.length);
    if (resumeJobPolls === 0 || startJobCount !== 1 || resumeEventSources !== 0) {
      throw new Error(`Resume should poll existing job only, polls=${resumeJobPolls} starts=${startJobCount} eventSources=${resumeEventSources}`);
    }
    await resumePage.close();
  } finally {
    if (browser) await browser.close();
    stopVite(vite);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
