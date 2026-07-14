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
import { classifyRunVerdict, computeVerdict } from './src/verdict.mjs';
import { buildGridHtml } from './src/grid.mjs';
import { runPanel, withPanelMetadata } from './src/panel.mjs';
import { loadRegistry, resolveJudges } from './src/judges.mjs';
import { harnessWindowKey, startDevServer, captureBrowserStates } from './src/browserLane.mjs';
import { checkBudget } from './src/budget.mjs';
import { prepareJudgedCaptures, resolveJudgedContentInsets } from './src/contentInset.mjs';
import { captureAndroidStates } from './src/androidDriver.mjs';
import { resolveDevicePlatform } from './src/platform.mjs';
import {
  detectIndistinguishableStates,
  formatAllowedIndistinguishableStates,
  formatIndistinguishableStateWarnings,
} from './src/indistinguishableStates.mjs';
import {
  androidDeviceSerial,
  iosDeviceUdid,
  loadDeviceRegistry,
  resolveDeviceConfig,
} from './src/deviceRegistry.mjs';
import {
  buildSummary,
  compareSummaries,
  formatCompareTable,
  formatSummaryTable,
  formatUngatedCaptureWarnings,
  loadRunSummary,
  writeSummaryJson,
} from './src/summary.mjs';
import {
  evaluateViewportMetricAssertions,
  formatViewportMetricAssertions,
  viewportMetricAssertionsPass,
} from './src/viewportMetrics.mjs';
import * as steps from './src/steps.mjs';
import { deliverReport } from './src/portal.mjs';
import { tryWriteObservation } from './src/observation.mjs';

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
async function resolveDeviceCaptures(args, manifest, date, platform, deviceConfig) {
  const stateNames = manifestStateNames(manifest);
  if (args.captures) {
    const dir = path.resolve(args.captures);
    return {
      captures: loadCapturesDir(dir, stateNames),
      lane: 'provided-captures',
      provenance: 'provided-captures',
      deviceLabel: `captures dir ${path.relative(REPO_ROOT, dir)} — DEVICE-PROVENANCE-UNVERIFIED`,
    };
  }
  if (args.xcresult) {
    if (platform === 'android') {
      throw new Error('--xcresult is an iOS/XCUITest input; use --captures or --platform ios');
    }
    const exportDir = path.join(os.tmpdir(), `verify-device-${date}-export`);
    steps.exportAttachments(path.resolve(args.xcresult), exportDir);
    const { byState, captureByState, viewportMetrics } = extractFromExportDir(exportDir, stateNames);
    return {
      captures: byState,
      captureByState,
      viewportMetrics,
      // Detached artifact: we cannot prove it belongs to the current run/commit/device,
      // so provenance is UNVERIFIED until AUDIT #7 supplies a validated attestation.
      provenance: 'detached-xcresult',
      deviceLabel: `xcresult ${path.relative(REPO_ROOT, path.resolve(args.xcresult))} — DEVICE-PROVENANCE-UNVERIFIED (detached artifact)`,
    };
  }
  if (args.skipDevice) return { skip: 'forced by --skip-device' };
  return platform === 'android'
    ? await runAndroidDevicePath(args, manifest, date, deviceConfig)
    : runIosDevicePath(args, manifest, date, deviceConfig);
}

// The full on-device capture path. Gated: skips gracefully with a clear message
// when no device/toolchain is present so CI degrades instead of failing.
function runIosDevicePath(args, manifest, date, deviceConfig = {}) {
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
  const { device, reason } = pickDevice(parseDeviceList(devicesJson), iosDeviceUdid(deviceConfig));
  if (!device) return { skip: `${reason} — plug in a signed iOS device to run the on-device lane` };
  process.stderr.write(`verify-device: ${reason}\n`);

  const appBundleId = readAppBundleId(manifest.gameDir);
  if (!appBundleId) return { skip: `could not read appId from ${manifest.gameDir}/capacitor.config.ts` };

  steps.unlockKeychain(readEnvSecret('MAC_PASSWORD'));
  steps.buildHarnessBundle(manifest.gameDir);
  steps.buildAndInstallApp(manifest.gameDir, device.udid, appBundleId, {
    developmentTeam: process.env.DEVELOPMENT_TEAM,
  });
  const { exportDir, testError } = steps.runXcuiTestAndExport({
    runnerDir: RUNNER_DIR, deviceUdid: device.udid, appBundleId, outDir,
    developmentTeam: process.env.DEVELOPMENT_TEAM,
    // Gate exactly the ordered manifest vocabulary (seven states incl. Shop for
    // the seven-page shell); the runner never hardcodes its own list.
    states: manifestStateNames(manifest),
  });
  const { byState, captureByState, viewportMetrics } = extractFromExportDir(exportDir, manifestStateNames(manifest));
  return {
    captures: byState,
    captureByState,
    viewportMetrics,
    provenance: 'live-device',
    deviceLabel: `${deviceConfig.name ? `${deviceConfig.name}: ` : ''}${device.name} (${device.udid})`,
    captureFailure: testError ? `xcodebuild test failed: ${testError.message}` : null,
  };
}

async function runAndroidDevicePath(args, manifest, date, deviceConfig = {}) {
  const outDir = defaultOut(args, date);
  fs.mkdirSync(outDir, { recursive: true });
  const appId = readAppBundleId(manifest.gameDir);
  if (!appId) return { skip: `could not read appId from ${manifest.gameDir}/capacitor.config.ts` };

  const adbPrefix = deviceConfig.adbPrefix || 'adb';
  const buildPrefix = deviceConfig.buildPrefix;
  const serial = androidDeviceSerial(deviceConfig);
  const activity = args.androidActivity || `${appId}/.MainActivity`;

  steps.buildAndroidHarnessBundle(manifest.gameDir, { androidSdk: deviceConfig.androidSdk, buildPrefix });
  steps.assembleAndroidDebug(manifest.gameDir, { androidSdk: deviceConfig.androidSdk, buildPrefix });
  steps.installAndroidDebugApk({
    gameDir: manifest.gameDir,
    serial,
    adbPrefix,
    requireLocalApk: !buildPrefix,
  });
  const logcatSinceEpochMs = Date.now();
  steps.launchAndroidApp({ appId, activity, serial, adbPrefix });

  const { captures, failures } = await captureAndroidStates({
    states: manifestStateNames(manifest),
    outDir: path.join(outDir, 'android-captures'),
    adbPrefix,
    serial,
    logcatSinceEpochMs,
  });

  return {
    captures,
    captureByState: Object.fromEntries(Object.keys(captures).map((state) => [state, { gated: true }])),
    lane: 'device',
    provenance: 'live-device',
    deviceLabel: `${deviceConfig.name ? `${deviceConfig.name}: ` : ''}Android${serial ? ` ${serial}` : ''} via ${adbPrefix}`,
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
      states: manifestStateNames(manifest),
      baseUrl: dev.baseUrl,
      windowKey,
      outDir: path.join(os.tmpdir(), `verify-device-browser-${manifest.game}`),
      launch: () => chromium.launch(),
    });
    return {
      captures, lane: 'browser', provenance: 'browser',
      captureByState: Object.fromEntries(Object.keys(captures).map((state) => [state, { gated: true }])),
      deviceLabel: `browser (chromium @ ${dev.baseUrl}, harness ${windowKey}) — DEVICE-UNVERIFIED`,
    };
  } catch (err) {
    return { skip: `browser lane: capture failed — ${err.message}` };
  } finally {
    dev.stop();
  }
}

function manifestStateNames(manifest) {
  return (manifest.states || []).map((state) => state.name);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return 0; }

  const date = args.date || new Date().toISOString().slice(0, 10);
  const manifest = loadGameManifest(args.game, REPO_ROOT);
  const deviceRegistry = loadDeviceRegistry({ repoRoot: REPO_ROOT, env: process.env });
  const deviceConfig = resolveDeviceConfig({
    args,
    manifest,
    registry: deviceRegistry.devices,
    env: process.env,
  });
  const platform = resolveDevicePlatform({ args, manifest, device: deviceConfig });

  const resolved = args.lane === 'browser'
    ? await runBrowserLane(manifest)
    : await resolveDeviceCaptures(args, manifest, date, platform, deviceConfig);
  if (resolved.skip) {
    // Every graceful-skip reason routes through the ONE typed verdict so strict and
    // exploratory diverge in exactly one place (R12). Exploratory keeps the CI-safe
    // exit-0 degrade; strict fails closed — a skipped run is never "verified".
    const skipVerdict = classifyRunVerdict({ strict: args.strict, captureSkip: resolved.skip });
    process.stdout.write(
      `verify-device: SKIPPED on-device verification — ${resolved.skip}.\n` +
      `  This is the ${args.strict ? 'strict' : 'CI-safe'} degrade path; on-device rendering stays UNVERIFIED.\n` +
      `  Run on the configured device host with the device plugged in to produce the grid + verdict.\n` +
      `  run verdict: ${skipVerdict.summary}\n`
    );
    return skipVerdict.exitCode; // exploratory: 0 (absence is not a build failure); strict: nonzero
  }
  const lane = resolved.lane || 'device';

  const outDir = defaultOut(args, date);
  fs.mkdirSync(outDir, { recursive: true });
  const contentInsets = resolveJudgedContentInsets({
    args,
    manifest,
    lane,
    platform,
    device: deviceConfig,
    env: process.env,
  });
  const prepared = prepareJudgedCaptures({
    captures: resolved.captures,
    outDir,
    contentInsets,
  });
  const indistinguishableStates = detectIndistinguishableStates({
    captures: prepared.rawCaptures,
    manifest,
  });

  const { rows } = buildRows({
    manifest,
    deviceCaptures: prepared.judgedCaptures,
    lane,
    provenance: resolved.provenance,
  });
  const cropArtifacts = writeCropArtifacts({
    manifest,
    rows,
    outDir,
    repoRoot: REPO_ROOT,
    generatedAt: date,
  });
  const phashVerdict = computeVerdict(rows, args.threshold);
  const viewportMetricAssertions = evaluateViewportMetricAssertions({
    manifest,
    metricsByState: resolved.viewportMetrics || {},
  });

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

  // Blind (marker-never-appeared) captures are a hard integrity input. Derive them
  // straight from capture metadata — NOT from the summary we are about to build —
  // so the run verdict never depends on an artifact it also feeds (KTD5).
  const blindCaptureStates = Object.entries(resolved.captureByState || {})
    .filter(([, meta]) => meta && meta.gated === false)
    .map(([state]) => state);

  // ONE typed run verdict, computed after rows, panel, provenance, viewport
  // assertions, capture integrity, and indistinguishable-state checks are known
  // but BEFORE grid, summary, stdout, Portal delivery, or exit (R13). Every one
  // of those consumers reads THIS object — no divergent success booleans (AC3).
  const runVerdict = classifyRunVerdict({
    strict: args.strict,
    provenance: resolved.provenance,
    rows,
    panel,
    phashVerdict,
    viewportMetricsPass: viewportMetricAssertionsPass(viewportMetricAssertions),
    captureFailure: resolved.captureFailure,
    ungatedCaptureStates: blindCaptureStates,
    allowUngated: args.allowUngated,
    indistinguishableStatePairs: indistinguishableStates.blockingPairs,
  });

  const html = buildGridHtml({
    game: args.game, generatedAt: date, device: resolved.deviceLabel,
    rows, verdict: phashVerdict, panel, lane, runVerdict,
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

  const summary = buildSummary({
    panel,
    phashVerdict,
    captureByState: resolved.captureByState || {},
    indistinguishablePairs: indistinguishableStates.pairs,
    viewportMetrics: resolved.viewportMetrics || {},
    viewportMetricAssertions,
    runVerdict,
  });
  const summaryFile = writeSummaryJson(outDir, summary);

  // Vendor-neutral live-device OBSERVATION artifact (card qWCv9tUo). Written for
  // EVERY completed non-skip run beside summary.json, using the already-resolved
  // lane / provenance / platform / captures / run verdict / hard-integrity facts —
  // never a backfill of old evidence. The producer module owns the schema and the
  // canonical input hash; the merge/stop gate re-derives that hash from the
  // landing checkout to accept only a no-reference live-device observation whose
  // source still matches. runKind + hardIntegrity are COPIED from the one typed
  // run verdict, so no divergent verdict is computed here.
  const observationResult = tryWriteObservation(outDir, {
    repoRoot: REPO_ROOT,
    game: args.game,
    lane,
    provenance: resolved.provenance,
    platform,
    deviceLabel: resolved.deviceLabel,
    generatedAt: new Date().toISOString(),
    runKind: runVerdict.kind,
    hardIntegrity: runVerdict.hardIntegrity,
    captureFailure: resolved.captureFailure,
    requiredStates: manifestStateNames(manifest),
    captureByState: resolved.captureByState || {},
    captureFilesByState: prepared.rawCaptures,
  });
  const { observation, file: observationFile } = observationResult;
  if (observationResult.error) {
    process.stderr.write(
      `verify-device: observation skipped — ${observationResult.error.message}; `
      + 'the capture verdict is unchanged, and no observation can satisfy the landing gate\n',
    );
  }

  let compareTable = '';
  if (args.compare) {
    const previous = loadRunSummary(args.compare);
    const previousLabel = path.relative(REPO_ROOT, path.resolve(args.compare)) || '.';
    compareTable = formatCompareTable(compareSummaries(summary, previous), previousLabel);
  }

  // Panel/phash remain visible DIAGNOSTICS; the run verdict above owns status.
  const blindCaptureNote = blindCaptureStates.length === 0
    ? ''
    : args.allowUngated
      ? `  ungated captures allowed by --allow-ungated: ${blindCaptureStates.join(', ')}\n`
      : formatUngatedCaptureWarnings(blindCaptureStates);
  const indistinguishableNote = formatIndistinguishableStateWarnings(indistinguishableStates.blockingPairs)
    + formatAllowedIndistinguishableStates(indistinguishableStates.allowedPairs);
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
    blindCaptureNote +
    indistinguishableNote +
    `  phash (advisory): ${phashVerdict.summary}\n` +
    (panel.verdict ? `  panel (primary fidelity): ${panel.verdict.summary}\n`
      : `  panel: SKIPPED — ${panel.skipped} (on-device fidelity UNVERIFIED)\n`) +
    `  run verdict: ${runVerdict.summary}\n` +
    `  grid: ${path.relative(REPO_ROOT, outFile)}\n` +
    `  summary: ${path.relative(REPO_ROOT, summaryFile)}\n` +
    (observation && observationFile
      ? `  observation: ${path.relative(REPO_ROOT, observationFile)} (runKind ${observation.runKind}, inputs.sha256 ${observation.inputs.sha256.slice(0, 12)}…)\n`
      : `  observation: SKIPPED — ${observationResult.error?.message || 'artifact unavailable'}\n`) +
    formatViewportMetricAssertions(viewportMetricAssertions) +
    formatSummaryTable(summary) +
    compareTable
  );

  // OPTIONAL Portal delivery (portal-spec.md §10): push grid.html + summary.json
  // to a Portal stream as a `report`. Best-effort — deliverReport never throws
  // and never touches the exit code; a missing config or failed POST logs one
  // warning and the run continues exactly as it would have without --portal-stream.
  const portalStream = args.portalStream || process.env.PORTAL_STREAM;
  if (portalStream) {
    await deliverReport({
      slug: portalStream,
      game: args.game,
      date,
      files: [outFile, summaryFile, ...(observationFile ? [observationFile] : [])],
    });
  }

  return runVerdict.exitCode;
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`verify-device: ${err.message}\n`);
  process.exit(1);
});
