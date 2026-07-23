import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';
import { URL } from 'node:url';
import { chromium } from 'playwright';

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

const session = {
  id: 'step_place_dogs_prompt_contract',
  orientation: 'portrait',
  style: 'flatvector',
  model: 'openai/gpt-image-2',
  bgModel: 'openai/gpt-image-2',
  inpaintModel: 'openai/gpt-image-2',
  scenePrompt: 'near a bench',
  dogPrompt: 'a small hidden dog matching the selected recipe',
  nDogs: 1,
  backgrounds: [{ index: 0, file: 'bg_00.png', generationTime: 1, width: 120, height: 120 }],
  selectedBgIndex: 0,
  bgWidth: 120,
  bgHeight: 120,
  sections: [],
  hitboxes: [{ x: 30, y: 40, r: 10, id: 'dog-0' }],
  dogs: [{ index: 0, id: 'dog-0', status: 'done', activeVariant: 0, promptOverride: null, variants: ['dogs/dog_00/variant_000.png'] }],
  setting: 'park',
  scene: 'bench',
  entity: 'dog',
  maskParams: { radial: 0, feather: 0 },
  exported: false,
  catalogUploaded: false,
  catalogListable: false,
  catalogTombstoned: false,
  bundledInApp: false,
};

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
        const response = await fetch(`${baseUrl}/tests/step-place-dogs-harness.html`);
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

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/sessions/step_place_dogs_prompt_contract') {
        await route.fulfill({ json: session });
        return;
      }
      if (url.pathname === '/api/sessions/step_place_dogs_prompt_contract/visibility-check') {
        await route.fulfill({ json: { ok: true, issues: [], viewports: [] } });
        return;
      }
      if (url.pathname.startsWith('/api/sessions/step_place_dogs_prompt_contract/gallery-preview/')) {
        await route.fulfill({ contentType: 'image/png', body: png });
        return;
      }
      if (url.pathname.startsWith('/levels/')) {
        await route.fulfill({ contentType: 'image/png', body: png });
        return;
      }
      await route.continue();
    });

    await page.goto(`${baseUrl}/tests/step-place-dogs-harness.html`);
    await page.getByTestId('dogs-canvas').waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Inpaint All dogs (1)' }).waitFor({ timeout: 10_000 });
    await page.getByTestId('inpaint-mode-crop_reference').click();
    await page.getByRole('button', { name: 'Inpaint All dogs (1)' }).click();
    await page.waitForFunction(() => window.__lastInpaintStart !== undefined, null, { timeout: 5_000 });
    const mode = await page.evaluate(() => window.__lastInpaintStart?.[3]);
    if (mode !== 'crop_reference') {
      throw new Error(`Expected crop_reference mode, got ${mode}`);
    }

    const body = await page.locator('body').innerText();
    for (const retired of [
      'Entity Inpainting Prompt',
      'Magenta prompt override',
      'Shared prompt',
      'Describe how the dog should be inpainted',
      'local preview',
      'catalog upload',
    ]) {
      if (body.includes(retired)) {
        throw new Error(`Retired Dogs copy still visible: ${retired}`);
      }
    }

    console.log('step-place-dogs-smoke: PASS (Dogs consumes recipe prompt without inline prompt editors)');
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
