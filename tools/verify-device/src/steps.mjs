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
import { buildAdbCommandParts } from './androidDriver.mjs';
import { execCommandParts } from './command.mjs';

export function formatCommand(file, args, { redact = [] } = {}) {
  const secrets = redact.filter((v) => typeof v === 'string' && v.length > 0);
  const rendered = args.map((arg) => {
    let s = String(arg);
    for (const secret of secrets) {
      s = s.split(secret).join('***');
    }
    return s;
  });
  return `$ ${file} ${rendered.join(' ')}`;
}

/** Run a command, streaming output; returns stdout. Throws on non-zero. */
function sh(file, args, opts = {}) {
  const { redact = [], ...execOpts } = opts;
  process.stderr.write(`  ${formatCommand(file, args, { redact })}\n`);
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...execOpts });
}

/** Export attachments from an existing .xcresult into exportDir (manifest.json + PNGs). */
export function exportAttachments(xcresultPath, exportDir, { shImpl = sh } = {}) {
  fs.rmSync(exportDir, { recursive: true, force: true });
  shImpl('xcrun', ['xcresulttool', 'export', 'attachments', '--path', xcresultPath, '--output-path', exportDir]);
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
    sh('security', ['unlock-keychain', '-p', password, `${process.env.HOME}/Library/Keychains/login.keychain-db`], {
      redact: [password],
    });
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

export function resolveAndroidSdkRoot(androidSdk) {
  return androidSdk || process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '/home/batu/android-sdk';
}

export function androidBuildEnv(androidSdk) {
  const sdk = resolveAndroidSdkRoot(androidSdk);
  const bins = [
    path.join(sdk, 'cmdline-tools', 'latest', 'bin'),
    path.join(sdk, 'platform-tools'),
  ];
  return {
    ...process.env,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    PATH: `${bins.join(path.delimiter)}${path.delimiter}${process.env.PATH || ''}`,
    VITE_ENABLE_TEST_HARNESS: 'true',
    VITE_INSITU_TOUR: 'allstates',
  };
}

/**
 * Android step 1: build the harness-enabled bundle, create android/ once, then
 * sync web/native assets. The generated Capacitor project stays ignored.
 */
export function buildAndroidHarnessBundle(gameDir, { androidSdk, shImpl = sh } = {}) {
  const env = androidBuildEnv(androidSdk);
  shImpl('npx', ['vite', 'build'], { cwd: gameDir, env });
  if (!fs.existsSync(path.join(gameDir, 'android'))) {
    shImpl('npx', ['cap', 'add', 'android'], { cwd: gameDir, env });
  }
  shImpl('npx', ['cap', 'sync', 'android'], { cwd: gameDir, env });
}

export function androidDebugApkPath(gameDir) {
  return path.join(gameDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
}

/** Android step 2: assemble a debug APK via the generated Gradle wrapper. */
export function assembleAndroidDebug(gameDir, { androidSdk, shImpl = sh } = {}) {
  const androidDir = path.join(gameDir, 'android');
  if (!fs.existsSync(androidDir)) {
    throw new Error(`no Capacitor Android project at ${androidDir} — run 'npx cap add android' first`);
  }
  shImpl('./gradlew', ['--no-daemon', 'assembleDebug'], {
    cwd: androidDir,
    env: androidBuildEnv(androidSdk),
  });
  return androidDebugApkPath(gameDir);
}

/** Android step 3: install the debug APK with a configurable adb command prefix. */
export function installAndroidDebugApk({
  gameDir,
  serial,
  adbPrefix = process.env.VERIFY_DEVICE_ADB_PREFIX || 'adb',
  shImpl = execCommandParts,
} = {}) {
  const apk = androidDebugApkPath(gameDir);
  if (!fs.existsSync(apk)) {
    throw new Error(`debug APK not found: ${apk}`);
  }
  shImpl(buildAdbCommandParts({
    adbPrefix,
    serial,
    adbArgs: ['install', '-r', apk],
  }));
  return apk;
}

export function launchAndroidApp({
  appId,
  activity = `${appId}/.MainActivity`,
  serial,
  adbPrefix = process.env.VERIFY_DEVICE_ADB_PREFIX || 'adb',
  shImpl = execCommandParts,
} = {}) {
  try {
    shImpl(buildAdbCommandParts({
      adbPrefix,
      serial,
      adbArgs: ['shell', 'am', 'force-stop', appId],
    }));
  } catch (err) {
    process.stderr.write(`  adb force-stop failed (continuing): ${err.message}\n`);
  }
  shImpl(buildAdbCommandParts({
    adbPrefix,
    serial,
    adbArgs: ['shell', 'am', 'start', '-W', '-n', activity],
  }));
  return activity;
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
 * @returns {{exportDir:string, testError:Error|null}} exported attachments plus
 *   the xcodebuild test failure, if XCTest failed after writing device.xcresult
 */
export function runXcuiTestAndExport({
  runnerDir, deviceUdid, appBundleId, outDir, developmentTeam, shImpl = sh,
}) {
  const xcodeproj = path.join(runnerDir, 'VerifyDeviceRunner.xcodeproj');
  // The template ships project.yml; materialise the .xcodeproj every run so a
  // stale generated project cannot poison signing or runner settings.
  shImpl('xcodegen', ['generate'], { cwd: runnerDir });
  const xcresult = path.join(outDir, 'device.xcresult');
  fs.rmSync(xcresult, { recursive: true, force: true });
  const buildSettings = developmentTeam ? [`DEVELOPMENT_TEAM=${developmentTeam}`] : [];
  let testError = null;
  try {
    shImpl('xcodebuild', [
      'test', '-project', xcodeproj, '-scheme', 'VerifyDeviceRunner',
      '-destination', `id=${deviceUdid}`, '-allowProvisioningUpdates',
      '-resultBundlePath', xcresult,
      ...buildSettings,
    ], {
      env: { ...process.env, TEST_RUNNER_TARGET_BUNDLE_ID: appBundleId },
    });
  } catch (err) {
    testError = err;
    process.stderr.write(`  xcodebuild test failed; exporting xcresult attachments before failing: ${err.message}\n`);
  }
  const exportDir = path.join(outDir, 'device-attachments');
  if (!fs.existsSync(xcresult)) {
    if (testError) {
      throw new Error(`xcodebuild test failed and did not produce ${xcresult}: ${testError.message}`);
    }
    throw new Error(`xcodebuild test did not produce ${xcresult}`);
  }
  exportAttachments(xcresult, exportDir, { shImpl });
  return { exportDir, testError };
}
