import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;

const config = {
  views: { isometric: 'Isometric hidden-object view.' },
  styles: { clean_old_cartoon: 'Clean old cartoon style.' },
  settings: {
    japan: {
      label: 'Japan',
      scenes: { japan_market: 'A compact market with stalls and crates.' },
      shortDescriptions: { japan_market: 'Market with stalls.' },
    },
  },
  entities: { dog: 'dog' },
  entityPromptTemplate: 'Add exactly one {entity}.',
  models: [{ id: 'openai/gpt-image-2', label: 'GPT Image' }],
  inpaintModels: [{ id: 'openai/gpt-image-2', label: 'GPT Image' }],
  upscaleModels: [],
};

const geometryConfig = {
  hudFraction: 0.139,
  bannerFraction: 0.071,
  sectionBoundaryBuffer: 60,
  landscapeEdgeSafeArea: 60,
  viewportSafeFraction: 0.12,
  nSections: 3,
  portraitReference: { width: 768, height: 1376, deadzones: [] },
};

const session = {
  id: 'generate_error_visible',
  orientation: 'portrait',
  style: 'clean_old_cartoon',
  model: 'openai/gpt-image-2',
  bgModel: 'openai/gpt-image-2',
  inpaintModel: 'openai/gpt-image-2',
  scenePrompt: 'demo scene',
  dogPrompt: 'demo dog',
  nDogs: 1,
  backgrounds: [],
  selectedBgIndex: null,
  bgWidth: 0,
  bgHeight: 0,
  sections: [],
  hitboxes: [],
  dogs: [],
  setting: 'japan',
  scene: 'japan_market',
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
    const page = await browser.newPage({ viewport: { width: 900, height: 760 } });

    await page.addInitScript(() => {
      window.__generateErrorSources = [];
      class FakeEventSource {
        constructor(url) {
          this.url = url;
          this.listeners = new Map();
          window.__generateErrorSources.push(this);
          queueMicrotask(() => {
            this.emit('bg_error', {
              index: 0,
              error: 'RuntimeError: OPENAI_API_KEY not set in environment',
            });
            this.emit('generate_complete', { failed: 1, succeeded: 0 });
          });
        }
        addEventListener(type, listener) {
          const listeners = this.listeners.get(type) ?? [];
          listeners.push(listener);
          this.listeners.set(type, listeners);
        }
        close() {}
        emit(type, data) {
          for (const listener of this.listeners.get(type) ?? []) {
            listener(new MessageEvent(type, { data: JSON.stringify(data) }));
          }
        }
      }
      window.EventSource = FakeEventSource;
    });

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/config') {
        await route.fulfill({ json: config });
        return;
      }
      if (url.pathname === '/api/config/geometry') {
        await route.fulfill({ json: geometryConfig });
        return;
      }
      if (url.pathname.startsWith('/api/prompts/')) {
        await route.fulfill({ json: { default_version: 0, versions: [] } });
        return;
      }
      if (url.pathname === '/api/sessions' && method === 'POST') {
        await route.fulfill({ json: { sessionId: session.id, dogPrompt: session.dogPrompt } });
        return;
      }
      if (url.pathname === `/api/sessions/${session.id}` && method === 'GET') {
        await route.fulfill({ json: session });
        return;
      }
      if (url.pathname === `/api/sessions/${session.id}/background-generation/jobs` && method === 'POST') {
        await route.fulfill({
          json: {
            jobId: 'bg-job-generate-error',
            status: 'queued',
            succeeded: 0,
            failed: 0,
            backgrounds: [],
            error: null,
          },
        });
        return;
      }
      await route.continue();
    });

    await page.goto(baseUrl);
    await page.getByRole('button', { name: 'Generate Level' }).click();
    await page.waitForFunction(() => window.__generateErrorSources.length === 1);
    const alert = page.getByRole('alert');
    await alert.waitFor({ timeout: 5_000 });
    const alertText = await alert.innerText();
    if (!alertText.includes('OPENAI_API_KEY not set in environment')) {
      throw new Error(`Expected missing-key error to be visible, got:\n${alertText}`);
    }
  } finally {
    if (browser) await browser.close();
    stopVite(vite);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
