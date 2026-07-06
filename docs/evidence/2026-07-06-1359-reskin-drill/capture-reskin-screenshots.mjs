#!/usr/bin/env node
/**
 * Reskin-drill before/after screenshot capture (card MQPvX0qi).
 *
 * Drives a running marble_run dev/preview server via the shell test harness
 * (window.__MARBLE_RUN_HARNESS__) to three deterministic screens and writes a
 * PNG per screen. Same harness pattern as games/marble_run/tests/e2e/play.spec.ts,
 * but standalone (plain `node`, not the Playwright test runner) so it can run
 * against either the reskinned or the stashed-baseline build.
 *
 * Usage:
 *   BASE_URL=http://localhost:5210 node capture-reskin-screenshots.mjs <outDir>
 *
 * Requires the game to be served first, e.g. from games/marble_run:
 *   npm run dev            # vite dev on :5210 (reads design/ live)
 * Each screen capture is independent — one failing screen does not abort the rest.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5210';
const WINDOW_KEY = '__MARBLE_RUN_HARNESS__';
const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node capture-reskin-screenshots.mjs <outDir>');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const VIEWPORT = { width: 390, height: 844 };

async function newMenuPage(browser) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  // Wait for the shell harness to be installed and the menu CTA to be ready.
  await page.waitForFunction(
    (key) => {
      const h = window[key];
      return h && typeof h.startLevel === 'function';
    },
    WINDOW_KEY,
    { timeout: 15000 },
  );
  await page.locator('[data-fab-action="play"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(400); // let the decorative saga/board settle
  return page;
}

async function capture(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.log(`  ✗ ${name}: ${String(err.message).split('\n')[0]}`);
  }
}

const browser = await chromium.launch({ headless: true });
try {
  // 01 — MENU: banner title (app.title), LEVEL CTA (menu.levelButton), accent + bg palette.
  await capture('01-menu', async () => {
    const page = await newMenuPage(browser);
    await page.screenshot({ path: path.join(outDir, '01-menu.png') });
    await page.close();
  });

  // 02 — SETTINGS modal: settings.title.
  await capture('02-settings', async () => {
    const page = await newMenuPage(browser);
    await page.locator('[data-fab-action="settings"]').click();
    await page.locator('.mr-settings-card').waitFor({ state: 'visible', timeout: 6000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(outDir, '02-settings.png') });
    await page.close();
  });

  // 03 — RESULT modal: result.win.title (best-effort — drives the greedy solver
  // to a terminal state; deterministic per level/seed so before/after match).
  await capture('03-result', async () => {
    const page = await newMenuPage(browser);
    await page.evaluate((key) => window[key].startLevel(1), WINDOW_KEY);
    await page.waitForFunction(
      (key) => {
        const s = window[key].snapshot();
        return s.scene === 'playing' && s.inputReady === true;
      },
      WINDOW_KEY,
      { timeout: 12000 },
    );
    for (let i = 0; i < 200; i += 1) {
      const status = await page.evaluate((key) => window[key].snapshot().status, WINDOW_KEY);
      if (status === 'won' || status === 'failed') break;
      await page.evaluate((key) => window[key].solveStep(), WINDOW_KEY);
      await page.waitForTimeout(100);
    }
    await page.waitForFunction(
      (key) => {
        const s = window[key].snapshot().scene;
        return s === 'complete' || s === 'failed';
      },
      WINDOW_KEY,
      { timeout: 12000 },
    );
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, '03-result.png') });
    await page.close();
  });
} finally {
  await browser.close();
}
console.log(`Done → ${outDir}`);
