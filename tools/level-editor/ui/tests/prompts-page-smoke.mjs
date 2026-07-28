// PromptsPage smoke (D1, plan 2026-06-10-002): boots vite on a free port,
// mocks /api/prompts*, opens #prompts, and exercises list → edit → save →
// set-default against a STATEFUL mock (a save must appear in the list).
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
        const response = await fetch(`${baseUrl}/`);
        if (response.ok) { resolve(); return; }
      } catch { /* starting */ }
      if (Date.now() > deadline) { reject(new Error('Timed out waiting for Vite')); return; }
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
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE:', m.text().slice(0, 300)); });
    page.on('pageerror', (e) => console.error('PAGEERROR:', String(e).slice(0, 400)));

    // Stateful library mock.
    const library = {
      'view:isometric': {
        default_version: 1,
        versions: [{ version: 1, text: 'iso v1 text', created_at: '2026-06-01T00:00:00Z' }],
      },
      'inpaint:default': {
        default_version: 2,
        versions: [
          { version: 1, text: 'inpaint v1', created_at: '2026-06-01T00:00:00Z' },
          { version: 2, text: 'inpaint v2', created_at: '2026-06-02T00:00:00Z' },
        ],
      },
    };
    await page.route('**/api/prompts', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(library) }));
    await page.route('**/api/prompts/*', async (route) => {
      const url = new URL(route.request().url());
      const kind = decodeURIComponent(url.pathname.split('/').pop());
      if (route.request().method() === 'POST') {
        const { text } = JSON.parse(route.request().postData() || '{}');
        const k = library[kind] ?? { default_version: 0, versions: [] };
        const v = (k.versions.at(-1)?.version ?? 0) + 1;
        k.versions.push({ version: v, text, created_at: new Date(0).toISOString() });
        k.default_version = v;
        library[kind] = k;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(k) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(library[kind]) });
    });
    await page.route('**/api/sessions', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/config', (route) =>
      route.fulfill({ json: {
        views: { isometric: 'Isometric' },
        styles: { cartoon: 'Cartoon' },
        settings: { harbor: { label: 'Harbor', scenes: { market: 'Market scene' } } },
        entities: { dog: 'dog' },
        entityPromptTemplate: 'Add a {entity}.',
        models: [{ id: 'model-a', label: 'Model A' }],
        inpaintModels: [{ id: 'model-b', label: 'Model B' }],
        upscaleModels: [],
      } }));

    await page.goto(`${baseUrl}/#prompts`);
    try {
      await page.getByTestId('prompts-page').waitFor({ timeout: 10_000 });
    } catch (e) {
      console.error('BODY:', (await page.innerText('body')).slice(0, 600));
      throw e;
    }

    // 1. kinds listed, grouped
    await page.getByTestId('prompt-kind-view:isometric').waitFor();
    await page.getByTestId('prompt-kind-inpaint:default').waitFor();

    // 2. open a kind → editor shows the default version text
    await page.getByTestId('prompt-kind-inpaint:default').click();
    const editor = page.getByTestId('prompt-editor');
    if ((await editor.inputValue()) !== 'inpaint v2') throw new Error('editor did not load default version');

    // 3. edit + save → v3 appears and becomes default
    await editor.fill('inpaint v3 — edited in smoke');
    await page.getByTestId('prompt-save').click();
    await page.getByText('✓ Saved as v3 (now default)').waitFor({ timeout: 5_000 });
    if (library['inpaint:default'].default_version !== 3) throw new Error('mock library not updated to v3');

    console.log('prompts-page-smoke: PASS (list + load-default + edit + save-version)');
  } finally {
    if (browser) await browser.close();
    if (process.platform !== 'win32' && vite.pid) {
      try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* already gone */ }
    } else {
      vite.kill('SIGTERM');
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
