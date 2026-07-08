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
// Budget-guard: before every billable panel model call, remaining OpenRouter
// credit is checked (GET /credits); below --budget-floor (default $5) that
// judge/state is recorded as budget-halted without making the model call.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, HELP } from './src/args.mjs';
import { loadGameManifest } from '../refcap-compare/src/run.mjs';
import { parseDeviceList, pickDevice } from './src/devices.mjs';
import { extractFromExportDir, loadCapturesDir } from './src/attachments.mjs';
import { buildRows } from './src/compare.mjs';
import { writeCropArtifacts } from './src/crops.mjs';
import { computeStrictExitCode, computeVerdict } from './src/verdict.mjs';
import { buildGridHtml } from './src/grid.mjs';
import { runPanel, withPanelMetadata } from './src/panel.mjs';
import { loadRegistry, resolveJudges } from './src/judges.mjs';
import { CANONICAL_STATES } from './src/states.mjs';
import { harnessWindowKey, startDevServer, captureBrowserStates } from './src/browserLane.mjs';
import { checkBudget } from './src/budget.mjs';
import { prepareJudgedCaptures, resolveJudgedContentInsets } from './src/contentInset.mjs';
import { captureAndroidStates } from './src/androidDriver.mjs';
import { resolveDevicePlatform } from './src/platform.mjs';
import {
  buildSummary,
  compareSummaries,
  formatCompareTable,
  formatSummaryTable,
  loadRunSummary,
  writeSummaryJson,
} from './src/summary.mjs';
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
async function resolveDeviceCaptures(args, manifest, date, platform) {
  if (args.captures) {
    const dir = path.resolve(args.captures);
    return {
      captures: loadCapturesDir(dir),
      lane: 'provided-captures',
      deviceLabel: `captures dir ${path.relative(REPO_ROOT, dir)} — DEVICE-PROVENANCE-UNVERIFIED`,
    };
  }
  if (args.xcresult) {
    if (platform === 'android') {
      throw new Error('--xcresult is an iOS/XCUITest input; use --captures or --platform ios');
    }
    const exportDir = path.join(os.tmpdir(), `verify-device-${date}-export`);
    steps.exportAttachments(path.resolve(args.xcresult), exportDir);
    const { byState } = extractFromExportDir(exportDir);
    return { captures: byState, deviceLabel: `xcresult ${path.relative(REPO_ROOT, path.resolve(args.xcresult))}` };
  }
  if (args.skipDevice) return { skip: 'forced by --skip-device' };
  return platform === 'android'
    ? await runAndroidDevicePath(args, manifest, date)
    : runIosDevicePath(args, manifest, date);
}

// The full on-device capture path. Gated: skips gracefully with a clear message
// when no device/toolchain is present so CI degrades instead of failing.
function runIosDevicePath(args, manifest, date) {
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
  const { exportDir, testError } = steps.runXcuiTestAndExport({
    runnerDir: RUNNER_DIR, deviceUdid: device.udid, appBundleId, outDir,
    developmentTeam: process.env.DEVELOPMENT_TEAM,
  });
  const { byState } = extractFromExportDir(exportDir);
  return {
    captures: byState,
    deviceLabel: `${device.name} (${device.udid})`,
    captureFailure: testError ? `xcodebuild test failed: ${testError.message}` : null,
  };
}

async function runAndroidDevicePath(args, manifest, date) {
  const outDir = defaultOut(args, date);
  fs.mkdirSync(outDir, { recursive: true });
  const appId = readAppBundleId(manifest.gameDir);
  if (!appId) return { skip: `could not read appId from ${manifest.gameDir}/capacitor.config.ts` };

  const adbPrefix = args.adbPrefix || process.env.VERIFY_DEVICE_ADB_PREFIX || 'adb';
  const serial = args.device;
  const activity = args.androidActivity || `${appId}/.MainActivity`;

  steps.buildAndroidHarnessBundle(manifest.gameDir, { androidSdk: args.androidSdk });
  steps.assembleAndroidDebug(manifest.gameDir, { androidSdk: args.androidSdk });
  steps.installAndroidDebugApk({ gameDir: manifest.gameDir, serial, adbPrefix });
  steps.launchAndroidApp({ appId, activity, serial, adbPrefix });

  const { captures, failures } = await captureAndroidStates({
    states: CANONICAL_STATES,
    outDir: path.join(outDir, 'android-captures'),
    adbPrefix,
    serial,
  });

  return {
    captures,
    lane: 'device',
    deviceLabel: `Android${serial ? ` ${serial}` : ''} via ${adbPrefix}`,
    captureFailure: failures.length ? `android capture failures: ${failures.join('; ')}` : null,
  };
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
  const platform = resolveDevicePlatform({ args, manifest });

  const resolved = args.lane === 'browser'
    ? await runBrowserLane(manifest)
    : await resolveDeviceCaptures(args, manifest, date, platform);
  if (resolved.skip) {
    process.stdout.write(
      `verify-device: SKIPPED on-device verification — ${resolved.skip}.\n` +
      `  This is the CI-safe degrade path; on-device rendering stays UNVERIFIED.\n` +
      `  Run on the configured device host with the device plugged in to produce the grid + verdict.\n`
    );
    return 0; // graceful skip: absence of a device is not a build failure
  }
  const lane = resolved.lane || 'device';

  const outDir = defaultOut(args, date);
  fs.mkdirSync(outDir, { recursive: true });
  const contentInsets = resolveJudgedContentInsets({ args, manifest, lane, platform });
  const prepared = prepareJudgedCaptures({
    captures: resolved.captures,
    outDir,
    contentInsets,
  });

  const { rows } = buildRows({ manifest, deviceCaptures: prepared.judgedCaptures, lane });
  const cropArtifacts = writeCropArtifacts({
    manifest,
    rows,
    outDir,
    repoRoot: REPO_ROOT,
    generatedAt: date,
  });
  const phashVerdict = computeVerdict(rows, args.threshold);

  // PRIMARY verdict: the multi-model vision panel (phash is now a secondary
  // advisory signal). Conductor-run — needs OPENROUTER_API_KEY + network; skips
  // gracefully (fidelity stays UNVERIFIED) in the worker/CI sandbox.
  let panel = { skipped: 'panel disabled by --skip-panel' };
  if (!args.skipPanel) {
    // Resolve the roster from the judge registry: --ensemble names a set,
    // --models overrides it. A keyless/credit-depleted judge is skipped-and-recorded
    // inside runPanel, not here (so the CLI never aborts over one broke judge).
    const judges = resolveJudges({ registry: loadRegistry(), ensemble: args.ensemble, models: args.models });
    process.stderr.write(`verify-device: panel roster (${args.models ? 'models override' : `ensemble ${args.ensemble}`}): `
      + `${judges.map((j) => j.id).join(', ')}\n`);
    const apiKey = readEnvSecret('OPENROUTER_API_KEY');

    // BUDGET-GUARD: check remaining OpenRouter credit immediately before every
    // billable model call. A confirmed balance below --budget-floor records that
    // judge/state as skipped without making the call; failed checks do not halt.
    panel = await runPanel({
      rows, judges, apiKey, thresholdPct: args.panelThreshold,
      budgetCheck: () => checkBudget({ apiKey, floor: args.budgetFloor }),
    });
    if (panel.budgetHalted) {
      process.stderr.write('verify-device: budget halted one or more panel calls; see panel.json/grid for skipped judges\n');
    }
    if (panel.states) {
      panel = withPanelMetadata(panel, {
        game: args.game,
        lane,
        generatedAt: new Date().toISOString(),
      });
      fs.writeFileSync(path.join(outDir, 'panel.json'), JSON.stringify(panel, null, 2));
    }
  }

  const html = buildGridHtml({
    game: args.game, generatedAt: date, device: resolved.deviceLabel,
    rows, verdict: phashVerdict, panel, lane,
    captureArtifacts: {
      contentInsetTop: prepared.artifacts.contentInsetTop,
      contentInsetBottom: prepared.artifacts.contentInsetBottom,
      rawDir: path.relative(REPO_ROOT, prepared.artifacts.rawDir),
      judgedDir: path.relative(REPO_ROOT, prepared.artifacts.judgedDir),
      crops: cropArtifacts.cropDir ? {
        dir: path.relative(REPO_ROOT, cropArtifacts.cropDir),
        inventory: path.relative(REPO_ROOT, cropArtifacts.inventoryPath),
        count: cropArtifacts.count,
        skipped: cropArtifacts.skipped,
      } : null,
    },
  });
  const outFile = path.join(outDir, 'grid.html');
  fs.writeFileSync(outFile, html);

  const summary = buildSummary({ panel, phashVerdict });
  const summaryFile = writeSummaryJson(outDir, summary);
  let compareTable = '';
  if (args.compare) {
    const previous = loadRunSummary(args.compare);
    const previousLabel = path.relative(REPO_ROOT, path.resolve(args.compare)) || '.';
    compareTable = formatCompareTable(compareSummaries(summary, previous), previousLabel);
  }

  // The overall PASS/FAIL is the panel's when it ran; otherwise phash (advisory).
  const primary = panel.verdict || phashVerdict;
  const primaryLabel = panel.verdict ? 'panel' : 'phash (panel skipped)';
  const laneNote = lane === 'browser'
    ? '  NOTE: browser lane — safe-area/notch fidelity is DEVICE-UNVERIFIED.\n'
    : lane === 'provided-captures'
      ? '  NOTE: provided-captures lane — DEVICE-PROVENANCE-UNVERIFIED; strict requires a verified device lane.\n'
      : '';
  process.stdout.write(
    `verify-device: ${lane} captures from ${resolved.deviceLabel}\n` +
    laneNote +
    `  platform: ${platform}\n` +
    `  content-inset: top ${contentInsets.top}px, bottom ${contentInsets.bottom}px cropped before phash/panel; ` +
    `raw ${path.relative(REPO_ROOT, prepared.artifacts.rawDir)}; ` +
    `judged ${path.relative(REPO_ROOT, prepared.artifacts.judgedDir)}\n` +
    (cropArtifacts.cropDir
      ? `  crops: ${path.relative(REPO_ROOT, cropArtifacts.cropDir)} ` +
        `(${cropArtifacts.count} files, ${cropArtifacts.skipped} skipped inventory rows); ` +
        `inventory ${path.relative(REPO_ROOT, cropArtifacts.inventoryPath)}\n`
      : '') +
    (resolved.captureFailure ? `  capture: FAILED — ${resolved.captureFailure}\n` : '') +
    `  phash: ${phashVerdict.summary}\n` +
    (panel.verdict ? `  panel: ${panel.verdict.summary}\n`
      : `  panel: SKIPPED — ${panel.skipped} (on-device fidelity UNVERIFIED)\n`) +
    `  verdict (${primaryLabel}): ${primary.summary}\n` +
    `  grid: ${path.relative(REPO_ROOT, outFile)}\n` +
    `  summary: ${path.relative(REPO_ROOT, summaryFile)}\n` +
    formatSummaryTable(summary) +
    compareTable
  );
  return computeStrictExitCode({
    strict: args.strict,
    lane,
    primary,
    captureFailure: resolved.captureFailure,
  });
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`verify-device: ${err.message}\n`);
  process.exit(1);
});
