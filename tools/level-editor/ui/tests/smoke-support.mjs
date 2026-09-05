import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const uiRoot = fileURLToPath(new URL('../', import.meta.url));

export function startSmokeVite(port) {
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  return spawn(process.execPath, [vite, '--config', fileURLToPath(new URL('./vite-smoke.config.mjs', import.meta.url)), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: uiRoot,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

export async function launchSmokeBrowser(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const unexpected = new Set();
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext({ ...options, serviceWorkers: 'block' });
    context.on('page', (page) => page.on('pageerror', (error) => unexpected.add(`Browser exception: ${error.message}`)));
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseUrl).origin || /^\/(api|levels|public-levels)(\/|$)/.test(url.pathname)) {
        unexpected.add(`${route.request().method()} ${url.origin}${url.pathname}`);
        await route.fulfill({ status: 501, json: { error: 'Unmocked request blocked by editor smoke gate' } });
      } else {
        await route.continue();
      }
    });
    return context;
  };
  browser.newPage = async (options) => (await browser.newContext(options)).newPage();
  const close = browser.close.bind(browser);
  browser.close = async () => {
    await close();
    if (unexpected.size) {
      // Preserve the original assertion error and let each fixture stop Vite.
      console.error(`Unexpected editor activity:\n${[...unexpected].join('\n')}`);
      process.exitCode = 1;
    }
  };
  return browser;
}
