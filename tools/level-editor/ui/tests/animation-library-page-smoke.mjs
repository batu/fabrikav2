import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';
import { URL } from 'node:url';
import { chromium } from 'playwright';

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);
const requestedAssetPaths = new Set();

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

function stopVite(vite) {
  if (process.platform === 'win32') {
    vite.kill('SIGTERM');
    return;
  }
  if (!vite.pid) return;
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/config') {
        await route.fulfill({
          json: {
            views: { isometric: 'Isometric' },
            styles: { cartoon: 'Cartoon' },
            settings: { harbor: { label: 'Harbor', scenes: { market: 'Market scene' } } },
            entities: { dog: 'dog' },
            entityPromptTemplate: 'Add a {entity}.',
            models: [{ id: 'model-a', label: 'Model A' }],
            inpaintModels: [{ id: 'model-b', label: 'Model B' }],
            upscaleModels: [],
          },
        });
        return;
      }
      if (url.pathname === '/api/sessions') {
        await route.fulfill({
          json: [
            {
              id: 'session_alpha',
              name: 'Alpha Harbor',
              nDogs: 1,
              hasImage: true,
              hasThumbnail: true,
              setting: 'harbor',
              exported: false,
              model: 'model-a',
              variants: ['gemini'],
              scene: 'market',
              entity: 'dog',
              createdAt: '2026-05-11T12:00:00Z',
              orientation: 'portrait',
            },
            {
              id: 'session_beta',
              name: 'Beta Plaza',
              nDogs: 1,
              hasImage: true,
              hasThumbnail: true,
              setting: 'harbor',
              exported: true,
              assetBase: 'public-levels',
              model: 'model-a',
              variants: ['gemini'],
              scene: 'plaza',
              entity: 'dog',
              createdAt: '2026-05-11T12:01:00Z',
              orientation: 'portrait',
            },
          ],
        });
        return;
      }
      if (url.pathname === '/api/sessions/session_alpha/sprite-candidates') {
        await route.fulfill({
          json: {
            candidates: [{
              id: 'dog_00:sprite_000',
              dogIndex: 0,
              spriteIndex: 0,
              status: 'ready',
              reason: null,
              image: 'dogs/dog_00/sprite_000.png',
              metadataPath: 'dogs/dog_00/sprite_000.json',
              width: 64,
              height: 72,
              technique: 'cutout',
              quality: { pickupUsable: true },
            }],
          },
        });
        return;
      }
      if (url.pathname === '/api/sessions/session_beta/sprite-candidates') {
        await route.fulfill({
          json: {
            candidates: [{
              id: 'dog_00:sprite_001',
              dogIndex: 0,
              spriteIndex: 1,
              status: 'ready',
              reason: null,
              image: 'dogs/dog_00/sprite_001.png',
              metadataPath: 'dogs/dog_00/sprite_001.json',
              width: 66,
              height: 74,
              technique: 'cutout',
              quality: { pickupUsable: true },
            }],
          },
        });
        return;
      }
      if (url.pathname === '/api/sessions/session_alpha/animation-jobs') {
        await route.fulfill({
          json: {
            jobs: [{
              id: 'job_alpha',
              status: 'completed',
              reviewStatus: 'generated',
              previewExists: true,
              sourceCandidateId: 'dog_00:sprite_000',
              sourceImage: 'dogs/dog_00/sprite_000.png',
              prompt: 'Animate alpha dog with a tail wag.',
              motionPreset: 'tail_wag',
              customPrompt: 'Keep paws planted.',
              durationSeconds: 3,
              fps: 24,
              provider: 'layer',
              model: 'layer/sprite-animation',
              providerJobId: 'inference-alpha',
              contentType: 'video/mp4',
              previewPath: 'animations/jobs/job_alpha/preview.mp4',
              createdAt: '2026-05-11T12:02:00Z',
              completedAt: '2026-05-11T12:02:03Z',
              error: null,
              metadata: {},
            }],
          },
        });
        return;
      }
      if (url.pathname === '/api/sessions/session_beta/animation-jobs') {
        await route.fulfill({ json: { jobs: [] } });
        return;
      }
      if (url.pathname.startsWith('/levels/') && url.pathname.endsWith('.png')) {
        requestedAssetPaths.add(url.pathname);
        if (url.pathname.includes('/session_beta/')) {
          throw new Error(`Exported beta sprite requested from active levels path: ${url.pathname}`);
        }
        await route.fulfill({ contentType: 'image/png', body: transparentPng });
        return;
      }
      if (url.pathname.startsWith('/public-levels/') && url.pathname.endsWith('.png')) {
        requestedAssetPaths.add(url.pathname);
        await route.fulfill({ contentType: 'image/png', body: transparentPng });
        return;
      }
      if (url.pathname === '/levels/session_alpha/animations/jobs/job_alpha/preview.mp4') {
        await route.fulfill({ contentType: 'video/mp4', body: Buffer.from('') });
        return;
      }
      await route.continue();
    });

    await page.goto(`${baseUrl}/#animations`);
    await page.waitForSelector('.animation-page');
    await page.getByRole('heading', { name: 'Sprite Animations' }).waitFor();
    const header = await page.locator('.animation-page-header').innerText();
    if (!header.includes('2 ready sprites across 2 level sessions')) {
      throw new Error(`Expected top-level animation summary, got: ${header}`);
    }
    const listText = await page.locator('.animation-page-sprite-list').innerText();
    if (!listText.includes('Alpha Harbor') || !listText.includes('Beta Plaza')) {
      throw new Error(`Expected generated dogs from both sessions, got: ${listText}`);
    }
    if (!listText.includes('1 animation attempt') || !listText.includes('0 animation attempts')) {
      throw new Error(`Expected per-sprite attempt counts, got: ${listText}`);
    }
    if (!requestedAssetPaths.has('/levels/session_alpha/dogs/dog_00/sprite_000.png')) {
      throw new Error(`Expected active session sprite to load from /levels, got: ${[...requestedAssetPaths].join(', ')}`);
    }
    if (!requestedAssetPaths.has('/public-levels/session_beta/dogs/dog_00/sprite_001.png')) {
      throw new Error(`Expected exported session sprite to load from /public-levels, got: ${[...requestedAssetPaths].join(', ')}`);
    }
    await page.getByRole('button', { name: /Alpha Harbor/i }).click();
    await page.waitForSelector('.sprite-animation-wizard');
    await page.waitForFunction(() => document.body.innerText.includes('inference-alpha'));
    const detail = await page.locator('.animation-page-detail').innerText();
    if (!detail.includes('Animation Candidates') || !detail.includes('inference-alpha')) {
      throw new Error(`Expected selected sprite wizard and review metadata, got: ${detail}`);
    }
    await page.getByLabel('Search animation sprites').fill('beta');
    const filteredText = await page.locator('.animation-page-sprite-list').innerText();
    if (filteredText.includes('Alpha Harbor') || !filteredText.includes('Beta Plaza')) {
      throw new Error(`Expected search to filter to beta session, got: ${filteredText}`);
    }
  } finally {
    await browser?.close();
    stopVite(vite);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
