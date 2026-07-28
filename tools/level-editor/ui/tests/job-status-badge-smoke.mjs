import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
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
        const response = await fetch(`${baseUrl}/tests/job-status-badge-harness.html`);
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

async function sectionText(page, testId) {
  return page.getByTestId(testId).innerText();
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
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`${baseUrl}/tests/job-status-badge-harness.html`);

    const active = await sectionText(page, 'generating-active');
    if (!active.includes('backend: background stream active')) throw new Error(active);

    const inactive = await sectionText(page, 'generating-inactive');
    if (!inactive.includes('backend: no active background stream')) throw new Error(inactive);

    const upscaling = await sectionText(page, 'upscaling');
    if (!upscaling.includes('durable upscale job: polling (job-123)')) throw new Error(upscaling);
    if (!upscaling.includes('safe to close this tab during upscale')) throw new Error(upscaling);
    const upscalingBadge = page.getByTestId('upscaling').getByTestId('job-status-badge');
    if (await upscalingBadge.getAttribute('data-upscale-job-id') !== 'job-123') throw new Error('missing job id contract');
    if (await upscalingBadge.getAttribute('data-upscale-job-status') !== 'polling') throw new Error('missing job status contract');

    const failed = await sectionText(page, 'failed');
    if (!failed.includes('durable upscale job: orphaned_unknown (manual review)')) throw new Error(failed);
    if (!failed.includes('error code: orphaned_unknown')) throw new Error(failed);
    if (!failed.includes('backend: stopped')) throw new Error(failed);
    if (!failed.includes('checked:')) throw new Error(failed);

    const nullRender = await sectionText(page, 'null-render');
    if (nullRender.trim() !== '') throw new Error(`Expected null render, got ${nullRender}`);
  } finally {
    if (browser) await browser.close();
    if (process.platform === 'win32') vite.kill();
    else process.kill(-vite.pid, 'SIGTERM');
  }
}

await run();
