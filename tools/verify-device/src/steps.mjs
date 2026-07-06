// Device-only orchestration steps (build harness bundle, cap sync, xcodebuild,
// devicectl install, run the XCUITest runner, export the xcresult). These shell
// out and REQUIRE a Mac + a plugged-in signed device + a keychain unlock — none
// available in the worker sandbox or CI. They are authored to the proven
// insitu-runner playbook (docs/retros/insitu-testing-capability-notes.md) and run
// by the conductor. The non-device glue they feed (attachment extraction, compare,
// verdict) is what's unit-tested. Every step logs its command so a device run is
// inspectable, never silent.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Run a command, streaming output; returns stdout. Throws on non-zero. */
function sh(file, args, opts = {}) {
  process.stderr.write(`  $ ${file} ${args.join(' ')}\n`);
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

/** Export attachments from an existing .xcresult into exportDir (manifest.json + PNGs). */
export function exportAttachments(xcresultPath, exportDir) {
  fs.rmSync(exportDir, { recursive: true, force: true });
  sh('xcrun', ['xcresulttool', 'export', 'attachments', '--path', xcresultPath, '--output-path', exportDir]);
  return exportDir;
}

/** List connected devices as parsed devicectl JSON (via a temp --json-output file). */
export function listDevicesJson(tmpDir) {
  const out = path.join(tmpDir, 'devices.json');
  sh('xcrun', ['devicectl', 'list', 'devices', '--json-output', out]);
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

/** Best-effort keychain unlock so xcodebuild can code-sign non-interactively. */
export function unlockKeychain(password) {
  if (!password) {
    process.stderr.write('  (no MAC_PASSWORD — skipping keychain unlock; relying on an already-unlocked login keychain)\n');
    return;
  }
  try {
    sh('security', ['unlock-keychain', '-p', password, `${process.env.HOME}/Library/Keychains/login.keychain-db`]);
  } catch (err) {
    process.stderr.write(`  keychain unlock failed (continuing, may already be unlocked): ${err.message}\n`);
  }
}

/**
 * Step 1: build the harness-enabled bundle with the allstates tour + cap sync ios.
 * @param {string} gameDir absolute games/<game> dir
 */
export function buildHarnessBundle(gameDir) {
  const env = { ...process.env, VITE_ENABLE_TEST_HARNESS: 'true', VITE_INSITU_TOUR: 'allstates' };
  sh('npx', ['vite', 'build'], { cwd: gameDir, env });
  sh('npx', ['cap', 'sync', 'ios'], { cwd: gameDir, env });
}

/**
 * Step 2: build + install the Capacitor app on the device.
 * @returns {string} the installed app bundle id (from capacitor config)
 */
export function buildAndInstallApp(gameDir, deviceUdid, appBundleId) {
  const proj = path.join(gameDir, 'ios', 'App', 'App.xcodeproj');
  if (!fs.existsSync(proj)) {
    throw new Error(`no Capacitor iOS project at ${proj} — run 'npx cap add ios' in ${gameDir} first`);
  }
  const derived = path.join(gameDir, 'ios', 'App', 'build');
  sh('xcodebuild', [
    '-project', proj, '-scheme', 'App', '-configuration', 'Debug',
    '-destination', `id=${deviceUdid}`, '-derivedDataPath', derived, 'build',
  ]);
  const appPath = path.join(derived, 'Build', 'Products', 'Debug-iphoneos', 'App.app');
  sh('xcrun', ['devicectl', 'device', 'install', 'app', '--device', deviceUdid, appPath]);
  return appBundleId;
}

/**
 * Step 3: generate + run the XCUITest runner against the device, export xcresult.
 * @returns {string} the export dir containing manifest.json + attachment PNGs
 */
export function runXcuiTestAndExport({ runnerDir, deviceUdid, appBundleId, outDir, developmentTeam }) {
  const xcodeproj = path.join(runnerDir, 'VerifyDeviceRunner.xcodeproj');
  if (!fs.existsSync(xcodeproj)) {
    // The template ships project.yml; materialise the .xcodeproj with xcodegen.
    sh('xcodegen', ['generate'], { cwd: runnerDir, env: { ...process.env, DEVELOPMENT_TEAM: developmentTeam || '' } });
  }
  const xcresult = path.join(outDir, 'device.xcresult');
  fs.rmSync(xcresult, { recursive: true, force: true });
  sh('xcodebuild', [
    'test', '-project', xcodeproj, '-scheme', 'VerifyDeviceRunner',
    '-destination', `id=${deviceUdid}`, '-resultBundlePath', xcresult,
    `TEST_RUNNER_TARGET_BUNDLE_ID=${appBundleId}`,
  ]);
  const exportDir = path.join(outDir, 'device-attachments');
  fs.rmSync(exportDir, { recursive: true, force: true });
  sh('xcrun', ['xcresulttool', 'export', 'attachments', '--path', xcresult, '--output-path', exportDir]);
  return exportDir;
}
