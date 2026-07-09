// BROWSER-FALLBACK LANE (--lane browser): capture states via vite-dev +
// Playwright/Chromium driving window.__<GAME>_HARNESS__.driveTo, instead of the
// iOS device. Lets fidelity work + panel-score progress when the phone is down;
// a device pass later is what actually confirms the result (safe-area/notch
// insets are device-only and can't be faked in a desktop browser). Explicit
// only (--lane browser) — the default lane stays device (card comment 1).
//
// Capture-integrity gate mirrors the device lane's "never screenshot a state
// you didn't confirm": driveTo(state) resolves true only after ITS OWN
// snapshot() poll confirms arrival (@fabrikav2/testkit/testing) —
// a state where it resolves false is recorded as a gap, never guessed, exactly
// like a missing device shot (compare.mjs's "no <lane> capture" gap cell).

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const DEV_SERVER_TIMEOUT_MS = 30000;
export const HARNESS_READY_TIMEOUT_MS = 20000;
export const DEFAULT_VIEWPORT = { width: 390, height: 844 };
export const SETTLE_MS = 700;

/** The window key a game's harness is exposed under (games/<g>/src/main.ts). */
export function harnessWindowKey(game) {
  return `__${game.toUpperCase()}_HARNESS__`;
}

// eslint-disable-next-line no-control-regex -- stripping ANSI SGR sequences requires \x1b
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Strip ANSI color/style escape sequences (vite colorizes mid-URL — see below). */
export function stripAnsi(s) {
  return s.replace(ANSI_RE, '');
}

/**
 * Start `npx vite` in gameDir with the test harness enabled, and resolve once
 * its stdout prints the local dev URL. Rejects (never hangs) if no URL shows up
 * within timeoutMs or the process exits early — the CLI treats that as a
 * graceful browser-lane skip, same spirit as the device-absent skip.
 * @returns {Promise<{proc, baseUrl:string, stop:() => void}>}
 */
export function startDevServer(gameDir, { env = process.env, spawnImpl = spawn, timeoutMs = DEV_SERVER_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawnImpl('npx', ['vite'], {
      cwd: gameDir,
      env: { ...env, VITE_ENABLE_TEST_HARNESS: 'true' },
    });
    let buf = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error(`vite dev server did not report a URL within ${timeoutMs}ms`));
    }, timeoutMs);
    const onData = (chunk) => {
      if (settled) return;
      // Vite colorizes its "Local: http://localhost:PORT/" line with ANSI codes
      // wrapped around individual segments (bold the port, reset, etc.), so the
      // escape sequences land INSIDE the URL itself — strip them before matching.
      buf += stripAnsi(chunk.toString('utf8'));
      const m = buf.match(/https?:\/\/localhost:\d+\//);
      if (m) {
        settled = true;
        clearTimeout(timer);
        proc.stdout.off('data', onData);
        resolve({ proc, baseUrl: m[0], stop: () => proc.kill() });
      }
    };
    proc.stdout.on('data', onData);
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on('exit', (code) => {
      if (settled || code === null || code === 0) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`vite dev server exited early (code ${code})`));
    });
  });
}

/**
 * Drive every manifest state via window[windowKey].driveTo(state) and capture
 * a screenshot only once driveTo confirms arrival. Writes PNGs to outDir named
 * "<state>.png" (the same shape resolveDeviceCaptures produces) so the result
 * plugs straight into compare.buildRows.
 * @param {object} opts
 * @param {string[]} opts.states canonical state names to attempt, in order
 * @param {string} opts.baseUrl vite dev server URL
 * @param {string} opts.windowKey e.g. '__MARBLE_RUN_HARNESS__'
 * @param {string} opts.outDir
 * @param {Function} opts.launch e.g. `() => chromium.launch()` (injectable for tests)
 * @param {{width:number,height:number}} [opts.viewport]
 * @param {number} [opts.harnessReadyTimeoutMs]
 * @param {number} [opts.settleMs] dwell before the shot (let animations settle)
 * @returns {Promise<{captures:Record<string,string>, integrity:Array}>}
 */
export async function captureBrowserStates({
  states, baseUrl, windowKey, outDir, launch,
  viewport = DEFAULT_VIEWPORT,
  harnessReadyTimeoutMs = HARNESS_READY_TIMEOUT_MS,
  settleMs = SETTLE_MS,
}) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  const captures = {};
  const integrity = [];
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    for (const state of states) {
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.waitForFunction(
        (key) => typeof window[key]?.driveTo === 'function' && typeof window[key]?.snapshot === 'function',
        windowKey,
        { timeout: harnessReadyTimeoutMs },
      );
      const result = await page.evaluate(async ({ key, name }) => {
        const h = window[key];
        const ok = await h.driveTo(name);
        return { ok, snapshot: h.snapshot() };
      }, { key: windowKey, name: state });
      const integrityPass = result.ok === true;
      integrity.push({ state, driveToReturned: result.ok, snapshot: result.snapshot, integrityPass });
      if (!integrityPass) continue; // gap: compare.mjs reports this as a missing capture
      await page.waitForTimeout(settleMs);
      const png = await page.screenshot();
      const dest = path.join(outDir, `${state}.png`);
      fs.writeFileSync(dest, png);
      captures[state] = dest;
    }
  } finally {
    await browser.close();
  }
  return { captures, integrity };
}
