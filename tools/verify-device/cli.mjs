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

// MAC_PASSWORD for the keychain unlock: env first, then a sibling .env (the repo
// lives under a parent that holds .env — see the card). Never committed/echoed.
function readMacPassword() {
  if (process.env.MAC_PASSWORD) return process.env.MAC_PASSWORD;
  for (const cand of [path.join(REPO_ROOT, '..', '.env'), path.join(REPO_ROOT, '.env')]) {
    if (fs.existsSync(cand)) {
      const m = fs.readFileSync(cand, 'utf8').match(/^\s*MAC_PASSWORD\s*=\s*(.+)\s*$/m);
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

  steps.unlockKeychain(readMacPassword());
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return 0; }

  const date = args.date || new Date().toISOString().slice(0, 10);
  const manifest = loadGameManifest(args.game, REPO_ROOT);

  const resolved = resolveDeviceCaptures(args, manifest, date);
  if (resolved.skip) {
    process.stdout.write(
      `verify-device: SKIPPED on-device verification — ${resolved.skip}.\n` +
      `  This is the CI-safe degrade path; on-device rendering stays UNVERIFIED.\n` +
      `  Run on the Mac with the device plugged in to produce the grid + verdict.\n`
    );
    return 0; // graceful skip: absence of a device is not a build failure
  }

  const { rows } = buildRows({ manifest, deviceCaptures: resolved.captures });
  const verdict = computeVerdict(rows, args.threshold);
  const html = buildGridHtml({ game: args.game, generatedAt: date, device: resolved.deviceLabel, rows, verdict });

  const outDir = defaultOut(args, date);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'grid.html');
  fs.writeFileSync(outFile, html);

  process.stdout.write(
    `verify-device: device captures from ${resolved.deviceLabel}\n` +
    verdict.states.map((s) => `  ${s.status.padEnd(12)} ${s.state.padEnd(9)} ${s.reason}`).join('\n') + '\n' +
    `  verdict: ${verdict.summary}\n` +
    `  grid: ${path.relative(REPO_ROOT, outFile)}\n`
  );
  return args.strict && !verdict.pass ? 1 : 0;
}

try {
  process.exit(main());
} catch (err) {
  process.stderr.write(`verify-device: ${err.message}\n`);
  process.exit(1);
}
