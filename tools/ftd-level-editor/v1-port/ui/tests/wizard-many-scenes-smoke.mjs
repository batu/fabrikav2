/* global MessageEvent, URL, process */
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

const config = {
  views: { isometric: 'Isometric hidden-object view.' },
  styles: { clean_old_cartoon: 'Clean old cartoon style.' },
  settings: {
    japan: {
      label: 'Japan',
      scenes: {
        japan_garden: 'A garden with bridges and stone lanterns.',
        japan_market: 'A compact market with stalls and crates.',
      },
      shortDescriptions: {
        japan_garden: 'Garden with bridges.',
        japan_market: 'Market with stalls.',
      },
    },
    france: {
      label: 'France',
      scenes: {
        france_cafe: 'A quiet cafe terrace with tables and awnings.',
      },
      shortDescriptions: {
        france_cafe: 'Cafe terrace.',
      },
    },
  },
  entities: { dog: 'dog' },
  entityPromptTemplate: 'Add exactly one {entity}.',
  models: [{ id: 'openai/gpt-image-2', label: 'GPT Image' }],
  inpaintModels: [{ id: 'openai/gpt-image-2', label: 'GPT Image' }],
  upscaleModels: [],
};

function sessionResponse(id, scene) {
  return {
    id,
    orientation: 'portrait',
    style: 'clean_old_cartoon',
    model: 'openai/gpt-image-2',
    bgModel: 'openai/gpt-image-2',
    inpaintModel: 'openai/gpt-image-2',
    scenePrompt: `scene prompt for ${scene}`,
    dogPrompt: 'dog prompt',
    nDogs: 30,
    backgrounds: [],
    selectedBgIndex: null,
    bgWidth: 0,
    bgHeight: 0,
    sections: [],
    hitboxes: [],
    dogs: [],
    setting: 'japan',
    scene,
    entity: 'dog',
    maskParams: { radial: 0, feather: 0 },
    exported: false,
    catalogUploaded: false,
    catalogListable: false,
    catalogTombstoned: false,
    bundledInApp: false,
  };
}

async function run() {
  const vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(port)],
    { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore'] },
  );
  let browser;
  const created = [];
  let backgroundJobStarts = 0;
  let backgroundJobGets = 0;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.addInitScript(() => {
      window.__wizardEventSources = [];
      class FakeEventSource {
        constructor(url) {
          this.url = url;
          this.listeners = new Map();
          window.__wizardEventSources.push(this);
        }
        addEventListener(type, listener) {
          this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
        }
        close() {
          this.closed = true;
        }
        emit(type, data = {}) {
          for (const listener of this.listeners.get(type) || []) {
            listener(new MessageEvent(type, { data: JSON.stringify(data) }));
          }
        }
      }
      window.EventSource = FakeEventSource;
    });

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/config') {
        await route.fulfill({ json: config });
        return;
      }
      if (url.pathname.startsWith('/api/prompts/')) {
        await route.fulfill({ json: { default_version: 0, versions: [] } });
        return;
      }
      if (url.pathname === '/api/actions/assemble-recipe-prompts') {
        const body = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({
          json: {
            scenePrompt: `assembled scene ${body.scene}`,
            dogPrompt: 'assembled dog prompt',
            promptContext: { source: 'server-recipe-prompt-v1' },
          },
        });
        return;
      }
      if (url.pathname === '/api/sessions' && route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() ?? '{}');
        if ('scenePrompt' in body || 'dogPrompt' in body) {
          await route.fulfill({ status: 400, json: { detail: { error: 'client prompt fields should not be sent' } } });
          return;
        }
        const sessionId = `${body.scene}_session`;
        created.push(body);
        await route.fulfill({
          json: {
            sessionId,
            scenePrompt: `scene prompt for ${body.scene}`,
            dogPrompt: 'dog prompt',
            promptContext: { source: 'server-recipe-prompt-v1' },
          },
        });
        return;
      }
      const bgJobMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/background-generation\/jobs$/);
      if (bgJobMatch && route.request().method() === 'POST') {
        backgroundJobStarts += 1;
        await route.fulfill({
          json: {
            jobId: `bg-job-${bgJobMatch[1]}`,
            status: 'queued',
            succeeded: 0,
            failed: 0,
            backgrounds: [],
            error: null,
          },
        });
        return;
      }
      const bgJobStatusMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/background-generation\/jobs\/([^/]+)$/);
      if (bgJobStatusMatch && route.request().method() === 'GET') {
        backgroundJobGets += 1;
        const sessionId = bgJobStatusMatch[1];
        const scene = sessionId.replace(/_session$/, '');
        await route.fulfill({
          json: {
            jobId: bgJobStatusMatch[2],
            status: 'succeeded',
            succeeded: 1,
            failed: 0,
            backgrounds: [{
              index: 0,
              file: `bg_${scene}.png`,
              generationTime: 1,
              width: 1024,
              height: 1536,
            }],
            error: null,
          },
        });
        return;
      }
      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch) {
        const id = sessionMatch[1];
        const scene = id.replace(/_session$/, '');
        await route.fulfill({ json: sessionResponse(id, scene) });
        return;
      }
      await route.continue();
    });

    await page.goto(baseUrl);
    const configureText = await page.locator('.step').first().innerText();
    for (const retiredText of [
      'Show server-assembled prompts',
      'edit in Prompts',
      'Scene prompt to background generation',
      'Entity prompt to per-hitbox inpaint',
    ]) {
      if (configureText.includes(retiredText)) {
        throw new Error(`Configure still exposes prompt/debug clutter: ${retiredText}`);
      }
    }
    await page.getByTestId('mode-many-scenes').click();
    await page.getByTestId('scene-check-japan_market').check();
    await page.getByTestId('scene-check-france_cafe').check();
    await page.getByTestId('generate-many-scenes').click();
    await page.waitForFunction(() => window.__wizardEventSources.length === 3);
    if (backgroundJobStarts !== 3) {
      throw new Error(`Expected one durable background job per scene, got ${backgroundJobStarts}`);
    }

    await page.waitForFunction(() => {
      const raw = window.localStorage.getItem('ftd-builder-many-scene-jobs-v1');
      if (!raw) return false;
      const jobs = JSON.parse(raw);
      return Array.isArray(jobs) && jobs.length === 3 && jobs.every((job) => job.sessionId && job.jobId);
    });
    await page.reload();
    await page.waitForSelector('[data-testid="many-scene-job-france_cafe"] >> text=ready');
    await page.waitForSelector('[data-testid="many-scene-job-japan_garden"] >> text=ready');
    await page.waitForSelector('[data-testid="many-scene-job-japan_market"] >> text=ready');
    if (backgroundJobStarts !== 3) {
      throw new Error(`Reload recovery should not start duplicate background jobs, got ${backgroundJobStarts}`);
    }
    if (backgroundJobGets < 3) {
      throw new Error(`Expected reload recovery to poll existing background jobs, got ${backgroundJobGets} GETs`);
    }

    const persistedJobs = await page.evaluate(() => {
      const raw = window.localStorage.getItem('ftd-builder-many-scene-jobs-v1');
      return raw ? JSON.parse(raw) : [];
    });
    for (const scene of ['france_cafe', 'japan_garden', 'japan_market']) {
      const job = persistedJobs.find((candidate) => candidate.sceneKey === scene);
      if (!job || job.status !== 'ready' || job.backgroundFile !== `bg_${scene}.png`) {
        throw new Error(`Expected persisted ready job for ${scene}, got ${JSON.stringify(job)}`);
      }
    }
    await page.waitForSelector('[data-testid="many-scene-job-france_cafe"] >> text=bg-job-france_cafe_session');
    await page.waitForSelector('[data-testid="many-scene-job-japan_garden"] >> text=bg-job-japan_garden_session');
    await page.waitForSelector('[data-testid="many-scene-job-japan_market"] >> text=bg-job-japan_market_session');

    const scenes = created.map((body) => `${body.setting}/${body.scene}`).sort();
    if (JSON.stringify(scenes) !== JSON.stringify(['france/france_cafe', 'japan/japan_garden', 'japan/japan_market'])) {
      throw new Error(`Expected three recipe create-session calls across settings, got ${JSON.stringify(created)}`);
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
