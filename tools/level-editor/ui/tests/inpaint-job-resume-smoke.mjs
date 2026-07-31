import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';
import { URL } from 'node:url';
import { chromium } from 'playwright';

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const sessionId = 'inpaint_job_demo';

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
        const response = await fetch(`${baseUrl}/tests/inpaint-job-resume-harness.html`);
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
  if (process.platform === 'win32') {
    vite.kill();
    return;
  }
  try {
    process.kill(-vite.pid);
  } catch {
    vite.kill();
  }
}

function job(jobId, status, result = {}) {
  return {
    jobId,
    status,
    succeeded: result.succeeded ?? (status === 'succeeded' ? 2 : 0),
    failed: result.failed ?? 0,
    colorFile: status === 'succeeded' ? 'color.png' : null,
    evalFile: status === 'succeeded' ? 'eval.png' : null,
    error: null,
  };
}

function session(statuses) {
  return {
    id: sessionId,
    orientation: 'portrait',
    style: 'demo-style',
    model: 'openai/gpt-image-2',
    bgModel: 'openai/gpt-image-2',
    inpaintModel: 'openai/gpt-image-2',
    scenePrompt: 'demo scene',
    dogPrompt: 'a tiny dog',
    nDogs: 2,
    backgrounds: [{ index: 0, file: 'bg_00.png', generationTime: 1, width: 120, height: 120 }],
    selectedBgIndex: 0,
    bgWidth: 120,
    bgHeight: 120,
    sections: [],
    hitboxes: [{ x: 25, y: 30, r: 8, id: 'dog-0' }, { x: 80, y: 90, r: 8, id: 'dog-1' }],
    dogs: statuses.map((status, index) => ({
      index,
      id: `dog-${index}`,
      status,
      activeVariant: status === 'done' ? 0 : null,
      promptOverride: null,
      variants: status === 'done' ? [`dogs/dog_0${index}/variant_000.png`] : [],
      ...(status === 'error' ? { error: 'failed' } : {}),
    })),
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
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    let startPosts = 0;
    let legacyStreamRequests = 0;
    let jobPolls = 0;
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === `/api/sessions/${sessionId}/inpaint/jobs` && route.request().method() === 'POST') {
        startPosts += 1;
        await route.fulfill({ json: job('crop-started', 'queued', { succeeded: 0 }) });
        return;
      }
      if (url.pathname === `/api/sessions/${sessionId}/inpaint/jobs/crop-started`) {
        jobPolls += 1;
        await route.fulfill({ json: job('crop-started', jobPolls < 2 ? 'running' : 'succeeded') });
        return;
      }
      if (url.pathname === `/api/sessions/${sessionId}`) {
        await route.fulfill({ json: session(jobPolls < 2 ? ['generating', 'pending'] : ['done', 'done']) });
        return;
      }
      if (url.pathname === `/api/sessions/${sessionId}/inpaint`) {
        legacyStreamRequests += 1;
        await route.fulfill({ status: 500, body: 'legacy stream should not be used' });
        return;
      }
      await route.continue();
    });

    await page.goto(`${baseUrl}/tests/inpaint-job-resume-harness.html`);
    await page.getByRole('button', { name: 'Start crop job' }).click();
    await page.waitForSelector('text=idle 2/2');
    await page.waitForSelector('text=done,done');
    const storedJobId = await page.evaluate((key) => localStorage.getItem(key), `ftd:cropInpaintJob:${sessionId}`);
    if (storedJobId !== null) {
      throw new Error(`Completed crop inpaint job should clear persisted id, got ${storedJobId}`);
    }
    if (startPosts !== 1 || legacyStreamRequests !== 0) {
      throw new Error(`Expected one durable start and no legacy EventSource, starts=${startPosts} legacy=${legacyStreamRequests}`);
    }

    const resumePage = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await resumePage.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [`ftd:cropInpaintJob:${sessionId}`, 'crop-resume']);
    let resumePosts = 0;
    let resumeJobPolls = 0;
    await resumePage.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === `/api/sessions/${sessionId}/inpaint/jobs` && route.request().method() === 'POST') {
        resumePosts += 1;
        await route.fulfill({ status: 500, body: 'resume should not post a new job' });
        return;
      }
      if (url.pathname === `/api/sessions/${sessionId}/inpaint/jobs/crop-resume`) {
        resumeJobPolls += 1;
        await route.fulfill({ json: job('crop-resume', resumeJobPolls < 2 ? 'running' : 'succeeded') });
        return;
      }
      if (url.pathname === `/api/sessions/${sessionId}`) {
        await route.fulfill({ json: session(resumeJobPolls < 2 ? ['generating', 'done'] : ['done', 'done']) });
        return;
      }
      if (url.pathname === `/api/sessions/${sessionId}/inpaint`) {
        legacyStreamRequests += 1;
        await route.fulfill({ status: 500, body: 'legacy stream should not be used' });
        return;
      }
      await route.continue();
    });
    await resumePage.goto(`${baseUrl}/tests/inpaint-job-resume-harness.html?resume=1`);
    await resumePage.waitForSelector('text=idle 2/2');
    await resumePage.waitForSelector('text=done,done');
    if (resumePosts !== 0 || resumeJobPolls === 0 || legacyStreamRequests !== 0) {
      throw new Error(`Expected resume to poll existing job only, posts=${resumePosts} polls=${resumeJobPolls} legacy=${legacyStreamRequests}`);
    }
    await resumePage.close();
  } finally {
    await browser?.close();
    stopVite(vite);
  }
}

await run();
