import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const sessionId = 'sprite_refresh_demo';

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
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
    let candidateRequests = 0;
    let refreshedCandidate = false;

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === `/api/sessions/${sessionId}/sprite-candidates`) {
        candidateRequests += 1;
        await route.fulfill({
          json: {
            candidates: [{
              id: 'dog_00:sprite_000',
              dogIndex: 0,
              spriteIndex: 0,
              status: 'ready',
              reason: null,
              image: refreshedCandidate ? 'dogs/dog_00/sprite_001.png' : 'dogs/dog_00/sprite_000.png',
              metadataPath: refreshedCandidate ? 'dogs/dog_00/sprite_001.json' : 'dogs/dog_00/sprite_000.json',
              width: 64,
              height: 72,
              technique: 'test-cutout',
              quality: { pickupUsable: true },
            }],
          },
        });
        return;
      }
      if (url.pathname === `/levels/${sessionId}/dogs/dog_00/sprite_000.png`) {
        await route.fulfill({
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
        });
        return;
      }
      if (url.pathname === `/levels/${sessionId}/dogs/dog_00/sprite_001.png`) {
        await route.fulfill({
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`${baseUrl}/tests/sprite-browser-refresh-harness.html`);
    await page.waitForSelector('.sprite-browser-empty');
    const waitingText = await page.locator('.sprite-browser-empty').last().innerText();
    if (!waitingText.includes('Finish generating dog sprites')) {
      throw new Error(`Expected waiting state before sprite candidates are ready, got: ${waitingText}`);
    }
    if (candidateRequests !== 0) {
      throw new Error(`Expected no candidate fetch while dog sprites are still generating, got ${candidateRequests}`);
    }
    const beforeReadyCandidateRequests = candidateRequests;

    await page.locator('#settle').click();
    await page.waitForSelector('.sprite-candidate-card');
    if (candidateRequests <= beforeReadyCandidateRequests) {
      throw new Error(`Expected a candidate fetch after sprites settle, got ${candidateRequests}`);
    }
    const summary = await page.locator('.sprite-browser-summary').innerText();
    if (!summary.includes('1 of 1')) {
      throw new Error(`Expected ready candidate summary after sprites settle, got: ${summary}`);
    }
    await page.locator('.sprite-candidate-card').click();
    await page.waitForSelector('.sprite-animation-wizard');
    await page.getByLabel('Custom direction').fill('This draft should clear after source refresh.');
    const beforeCandidateRefresh = candidateRequests;
    refreshedCandidate = true;
    await page.locator('#refresh-candidates').click();
    await page.waitForTimeout(500);
    if (candidateRequests <= beforeCandidateRefresh) {
      throw new Error(`Expected candidate refresh after dog variant change, got ${candidateRequests}`);
    }
    const selectionText = await page.locator('.sprite-browser-selection').innerText();
    if (!selectionText.includes('dog #0')) {
      throw new Error(`Expected selection to survive candidate refresh, got: ${selectionText}`);
    }
    const customPrompt = await page.getByLabel('Custom direction').inputValue();
    if (customPrompt !== '') {
      throw new Error(`Expected wizard to remount when selected source changes, got stale prompt: ${customPrompt}`);
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
