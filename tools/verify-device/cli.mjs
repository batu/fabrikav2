#!/usr/bin/env node
// verify-device — ONE-COMMAND on-device capture + diff. The forcing function for
// AGENTS.md #8: makes "capture the real device and diff it against the reference"
// the path of least resistance so it stops getting skipped for a proxy.
//
//   npm run verify-device -- --game marble_run
//
// Device path (Mac + plugged-in signed device + keychain, conductor-run):
//   1. build the harness bundle with the allstates tour + cap sync ios
//   2. xcodebuild + devicectl install the app on the device
//   3. run the committed XCUITest runner; export screenshots from the xcresult
//   4. diff device captures vs the committed reference set -> grid + PASS/FAIL
//   5. print the grid path + a one-line verdict
//
// Non-device path (worker/CI, unit-tested): --captures <dir> / --xcresult <path>
// feed pre-captured shots straight into steps 4-5; no device is required and the
// tool degrades gracefully (clear skip, exit 0) when no device is connected.
//
// Browser-fallback lane (--lane browser, explicit only — default stays device):
// vite-dev + Playwright/Chromium drive the game harness's driveTo(state) instead
// of a physical iOS device. Scored by the SAME panel, but every result is
// stamped lane=browser and the grid is marked DEVICE-UNVERIFIED (safe-area/notch
// fidelity is device-only). Lets fidelity work + panel-scoring progress when the
// phone is unavailable; a device pass later is what actually confirms it.
//
// Budget-guard: before the panel runs, remaining OpenRouter credit is checked
// (GET /credits); below --budget-floor (default $5) the panel HALTS — non-fatal,
// evidence marked UNVERIFIED-panel — instead of draining the shared budget to $0
// mid-overnight-run.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, HELP } from './src/args.mjs';
import { loadGameManifest } from '../refcap-compare/src/run.mjs';
import { parseDeviceList, pickDevice } from './src/devices.mjs';
import { extractFromExportDir, loadCapturesDir } from './src/attachments.mjs';
import { buildRows } from './src/compare.mjs';
import { computeVerdict } from './src/verdict.mjs';
import { buildGridHtml } from './src/grid.mjs';
import { runPanel } from './src/panel.mjs';
import { loadRegistry, resolveJudges } from './src/judges.mjs';
import { CANONICAL_STATES } from './src/states.mjs';
import { harnessWindowKey, startDevServer, captureBrowserStates } from './src/browserLane.mjs';
import { checkBudget } from './src/budget.mjs';
import * as steps from './src/steps.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNNER_DIR = path.join(__dirname, 'runner');

// Read the Capacitor appId (the installed bundle id the runner must launch).
function readAppBundleId(gameDir) {
  const cfg = path.join(gameDir, 'capacitor.config.ts');
  if (!fs.existsSync(cfg)) return null;
  const m = fs.readFileSync(cfg, 'utf8').match(/appId:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

// Read a secret from env first, then a sibling .env (the repo lives under a parent
// that holds .env — see the card). Never committed/echoed. Used for the keychain
// unlock (MAC_PASSWORD) and the vision panel (OPENROUTER_API_KEY).
function readEnvSecret(name) {
  if (process.env[name]) return process.env[name];
  for (const cand of [path.join(REPO_ROOT, '..', '.env'), path.join(REPO_ROOT, '.env')]) {
    if (fs.existsSync(cand)) {
      const m = fs.readFileSync(cand, 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)\\s*$`, 'm'));
      if (m) return m[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return null;
}

// Resolve the device captures (state -> abs PNG path), or a graceful skip.
// Returns { captures, deviceLabel } or { skip: '<reason>' }.
function resolveDeviceCaptures(args, manifest, date) {
  if (args.captures) {
    const dir = path.resolve(args.captures);
    return { captures: loadCapturesDir(dir), deviceLabel: `captures dir ${path.relative(REPO_ROOT, dir)}` };
  }
  if (args.xcresult) {
    const exportDir = path.join(os.tmpdir(), `verify-device-${date}-export`);
    steps.exportAttachments(path.resolve(args.xcresult), exportDir);
    const { byState } = extractFromExportDir(exportDir);
    return { captures: byState, deviceLabel: `xcresult ${path.relative(REPO_ROOT, path.resolve(args.xcresult))}` };
  }
  if (args.skipDevice) return { skip: 'forced by --skip-device' };
  return runDevicePath(args, manifest, date);
}

// The full on-device capture path. Gated: skips gracefully with a clear message
// when no device/toolchain is present so CI degrades instead of failing.
function runDevicePath(args, manifest, date) {
  const outDir = defaultOut(args, date);
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = path.join(os.tmpdir(), `verify-device-${date}`);
  fs.mkdirSync(tmp, { recursive: true });

  let devicesJson;
  try {
    devicesJson = steps.listDevicesJson(tmp);
  } catch (err) {
    return { skip: `devicectl unavailable (not a Mac / no Xcode?): ${err.message}` };
  }
  const { device, reason } = pickDevice(parseDeviceList(devicesJson), args.device);
  if (!device) return { skip: `${reason} — plug in a signed iOS device to run the on-device lane` };
  process.stderr.write(`verify-device: ${reason}\n`);

  const appBundleId = readAppBundleId(manifest.gameDir);
  if (!appBundleId) return { skip: `could not read appId from ${manifest.gameDir}/capacitor.config.ts` };

  steps.unlockKeychain(readEnvSecret('MAC_PASSWORD'));
  steps.buildHarnessBundle(manifest.gameDir);
  steps.buildAndInstallApp(manifest.gameDir, device.udid, appBundleId);
  const exportDir = steps.runXcuiTestAndExport({
    runnerDir: RUNNER_DIR, deviceUdid: device.udid, appBundleId, outDir,
    developmentTeam: process.env.DEVELOPMENT_TEAM,
  });
  const { byState } = extractFromExportDir(exportDir);
  return { captures: byState, deviceLabel: `${device.name} (${device.udid})` };
}

function defaultOut(args, date) {
  return args.out ? path.resolve(args.out) : path.join(REPO_ROOT, 'docs', 'evidence', `${date}-device-verify`);
}

// BROWSER-FALLBACK LANE (--lane browser, explicit only — default lane stays
// device). Drives a vite-dev server + Playwright/Chromium against the game
// harness's driveTo(state) instead of building/installing on a physical iOS
// device, so fidelity work + panel-scoring can progress when the phone is
// unavailable. Gracefully skips (never throws) if the dev server or Chromium
// can't come up — same degrade spirit as the device-absent skip.
async function runBrowserLane(manifest) {
  let dev;
  try {
    dev = await startDevServer(manifest.gameDir);
  } catch (err) {
    return { skip: `browser lane: could not start vite dev server — ${err.message}` };
  }
  try {
    const { chromium } = await import('@playwright/test');
    const windowKey = harnessWindowKey(manifest.game);
    const { captures } = await captureBrowserStates({
      states: CANONICAL_STATES,
      baseUrl: dev.baseUrl,
      windowKey,
      outDir: path.join(os.tmpdir(), `verify-device-browser-${manifest.game}`),
      launch: () => chromium.launch(),
    });
    return {
      captures, lane: 'browser',
      deviceLabel: `browser (chromium @ ${dev.baseUrl}, harness ${windowKey}) — DEVICE-UNVERIFIED`,
    };
  } catch (err) {
    return { skip: `browser lane: capture failed — ${err.message}` };
  } finally {
    dev.stop();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return 0; }

  const date = args.date || new Date().toISOString().slice(0, 10);
  const manifest = loadGameManifest(args.game, REPO_ROOT);

  const resolved = args.lane === 'browser'
    ? await runBrowserLane(manifest)
    : resolveDeviceCaptures(args, manifest, date);
  if (resolved.skip) {
    process.stdout.write(
      `verify-device: SKIPPED on-device verification — ${resolved.skip}.\n` +
      `  This is the CI-safe degrade path; on-device rendering stays UNVERIFIED.\n` +
      `  Run on the Mac with the device plugged in to produce the grid + verdict.\n`
    );
    return 0; // graceful skip: absence of a device is not a build failure
  }
  const lane = resolved.lane || 'device';

  const { rows } = buildRows({ manifest, deviceCaptures: resolved.captures, lane });
  const phashVerdict = computeVerdict(rows, args.threshold);

  // PRIMARY verdict: the multi-model vision panel (phash is now a secondary
  // advisory signal). Conductor-run — needs OPENROUTER_API_KEY + network; skips
  // gracefully (fidelity stays UNVERIFIED) in the worker/CI sandbox.
  const outDir = defaultOut(args, date);
  fs.mkdirSync(outDir, { recursive: true });
  let panel = { skipped: 'panel disabled by --skip-panel' };
  if (!args.skipPanel) {
    // Resolve the roster from the judge registry: --ensemble names a set,
    // --models overrides it. A keyless/credit-depleted judge is skipped-and-recorded
    // inside runPanel, not here (so the CLI never aborts over one broke judge).
    const judges = resolveJudges({ registry: loadRegistry(), ensemble: args.ensemble, models: args.models });
    process.stderr.write(`verify-device: panel roster (${args.models ? 'models override' : `ensemble ${args.ensemble}`}): `
      + `${judges.map((j) => j.id).join(', ')}\n`);
    const apiKey = readEnvSecret('OPENROUTER_API_KEY');

    // BUDGET-GUARD: never drain the shared OpenRouter credit to $0 mid-overnight
    // run. A confirmed remaining balance below --budget-floor HALTS the panel
    // (non-fatal, exit stays 0); a failed credit *check* (network blip, etc.)
    // does not halt — the panel's own per-judge credit-skip is the backstop.
    const budget = await checkBudget({ apiKey, floor: args.budgetFloor });
    if (budget.halted) {
      process.stderr.write(`verify-device: ${budget.reason}\n`);
      panel = { skipped: `${budget.reason} (panel not run — evidence UNVERIFIED-panel)`, halted: true, budget };
    } else {
      panel = await runPanel({
        rows, judges, apiKey, thresholdPct: args.panelThreshold,
      });
      if (panel.states) fs.writeFileSync(path.join(outDir, 'panel.json'), JSON.stringify(panel, null, 2));
    }
  }

  const html = buildGridHtml({
    game: args.game, generatedAt: date, device: resolved.deviceLabel,
    rows, verdict: phashVerdict, panel, lane,
  });
  const outFile = path.join(outDir, 'grid.html');
  fs.writeFileSync(outFile, html);

  // The overall PASS/FAIL is the panel's when it ran; otherwise phash (advisory).
  const primary = panel.verdict || phashVerdict;
  const primaryLabel = panel.verdict ? 'panel' : 'phash (panel skipped)';
  process.stdout.write(
    `verify-device: ${lane} captures from ${resolved.deviceLabel}\n` +
    (lane === 'browser' ? '  NOTE: browser lane — safe-area/notch fidelity is DEVICE-UNVERIFIED.\n' : '') +
    `  phash: ${phashVerdict.summary}\n` +
    (panel.verdict ? `  panel: ${panel.verdict.summary}\n`
      : `  panel: SKIPPED — ${panel.skipped} (on-device fidelity UNVERIFIED)\n`) +
    `  verdict (${primaryLabel}): ${primary.summary}\n` +
    `  grid: ${path.relative(REPO_ROOT, outFile)}\n`
  );
  return args.strict && !primary.pass ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`verify-device: ${err.message}\n`);
  process.exit(1);
});
