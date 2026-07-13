import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  androidBuildEnv,
  buildAndroidBuildCommandParts,
  androidDebugApkPath,
  applyNativeRecipe,
  assembleAndroidDebug,
  buildAndInstallApp,
  buildHarnessBundle,
  buildAndroidHarnessBundle,
  formatCommand,
  installAndroidDebugApk,
  launchAndroidApp,
  runXcuiTestAndExport,
} from '../src/steps.mjs';

describe('steps command logging', () => {
  it('redacts configured argv values without changing the real argv contract', () => {
    const line = formatCommand('security', [
      'unlock-keychain',
      '-p',
      'super-secret',
      '/Users/base/Library/Keychains/login.keychain-db',
    ], { redact: ['super-secret'] });
    expect(line).toContain('-p ***');
    expect(line).not.toContain('super-secret');
  });
});

describe('buildAndInstallApp', () => {
  function makeGameDir() {
    const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-game-'));
    fs.mkdirSync(path.join(gameDir, 'ios', 'App', 'App.xcodeproj'), { recursive: true });
    return gameDir;
  }

  function restoreDevelopmentTeam(value) {
    if (value === undefined) {
      delete process.env.DEVELOPMENT_TEAM;
    } else {
      process.env.DEVELOPMENT_TEAM = value;
    }
  }

  it('adds provisioning updates and DEVELOPMENT_TEAM to the app build when DEVELOPMENT_TEAM is set', () => {
    const originalDevelopmentTeam = process.env.DEVELOPMENT_TEAM;
    process.env.DEVELOPMENT_TEAM = 'TEAM123';
    const gameDir = makeGameDir();
    const calls = [];
    const shImpl = (file, args, opts = {}) => {
      calls.push({ file, args, opts });
      return '';
    };

    try {
      const appBundleId = buildAndInstallApp(gameDir, 'DEVICE', 'com.example.game', { shImpl });

      expect(appBundleId).toBe('com.example.game');
      const xcodebuild = calls.find((c) => c.file === 'xcodebuild');
      expect(xcodebuild.args).toContain('-allowProvisioningUpdates');
      expect(xcodebuild.args).toContain('DEVELOPMENT_TEAM=TEAM123');
    } finally {
      fs.rmSync(gameDir, { recursive: true, force: true });
      restoreDevelopmentTeam(originalDevelopmentTeam);
    }
  });

  it('omits provisioning updates and DEVELOPMENT_TEAM from the app build when DEVELOPMENT_TEAM is unset', () => {
    const originalDevelopmentTeam = process.env.DEVELOPMENT_TEAM;
    delete process.env.DEVELOPMENT_TEAM;
    const gameDir = makeGameDir();
    const calls = [];
    const shImpl = (file, args, opts = {}) => {
      calls.push({ file, args, opts });
      return '';
    };

    try {
      buildAndInstallApp(gameDir, 'DEVICE', 'com.example.game', { shImpl });

      const xcodebuild = calls.find((c) => c.file === 'xcodebuild');
      expect(xcodebuild.args).not.toContain('-allowProvisioningUpdates');
      expect(xcodebuild.args.some((a) => a.startsWith('DEVELOPMENT_TEAM='))).toBe(false);
    } finally {
      fs.rmSync(gameDir, { recursive: true, force: true });
      restoreDevelopmentTeam(originalDevelopmentTeam);
    }
  });
});

describe('native resource recipe application', () => {
  it('copies iOS recipe inputs into the generated Capacitor App target', () => {
    const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-recipe-game-'));
    const source = path.join(gameDir, 'native-resources', 'ios', 'App');
    fs.mkdirSync(path.join(source, 'Config'), { recursive: true });
    fs.writeFileSync(path.join(source, 'Info.plist'), '<plist />');
    fs.writeFileSync(path.join(source, 'Config', 'Signing.xcconfig'), 'CODE_SIGN_STYLE = Automatic\n');

    try {
      const applied = applyNativeRecipe(gameDir, 'ios');

      expect(applied).toEqual(['Config/Signing.xcconfig', 'Info.plist']);
      expect(fs.readFileSync(path.join(gameDir, 'ios', 'App', 'App', 'Info.plist'), 'utf8')).toBe('<plist />');
      expect(
        fs.readFileSync(path.join(gameDir, 'ios', 'App', 'App', 'Config', 'Signing.xcconfig'), 'utf8'),
      ).toContain('CODE_SIGN_STYLE');
    } finally {
      fs.rmSync(gameDir, { recursive: true, force: true });
    }
  });

  it('applies the iOS recipe after cap sync during the harness build', () => {
    const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-ios-game-'));
    fs.mkdirSync(path.join(gameDir, 'native-resources', 'ios', 'App'), { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'native-resources', 'ios', 'App', 'Info.plist'), '<plist />');
    const calls = [];

    try {
      buildHarnessBundle(gameDir, {
        shImpl: (file, args, opts = {}) => {
          calls.push({ file, args, opts });
          return '';
        },
      });

      expect(calls.map((c) => `${c.file} ${c.args.join(' ')}`)).toEqual([
        'npx vite build',
        'npx cap sync ios',
      ]);
      expect(fs.readFileSync(path.join(gameDir, 'ios', 'App', 'App', 'Info.plist'), 'utf8')).toBe('<plist />');
      expect(calls[0].opts.env.VITE_ENABLE_TEST_HARNESS).toBe('true');
      expect(calls[0].opts.env.VITE_INSITU_TOUR).toBe('allstates');
    } finally {
      fs.rmSync(gameDir, { recursive: true, force: true });
    }
  });
});

describe('runXcuiTestAndExport', () => {
  it('always regenerates the project, forwards test bundle id via env, exports attachments after XCTest failure', () => {
    const runnerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-runner-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-out-'));
    fs.mkdirSync(path.join(runnerDir, 'VerifyDeviceRunner.xcodeproj'));
    const calls = [];
    const shImpl = (file, args, opts = {}) => {
      calls.push({ file, args, opts });
      if (file === 'xcodebuild') {
        const resultIndex = args.indexOf('-resultBundlePath') + 1;
        fs.mkdirSync(args[resultIndex], { recursive: true });
        throw new Error('XCTest failed');
      }
      if (file === 'xcrun') {
        const outIndex = args.indexOf('--output-path') + 1;
        fs.mkdirSync(args[outIndex], { recursive: true });
        fs.writeFileSync(path.join(args[outIndex], 'manifest.json'), '[]');
      }
      return '';
    };

    const result = runXcuiTestAndExport({
      runnerDir,
      deviceUdid: 'DEVICE',
      appBundleId: 'com.example.game',
      outDir,
      developmentTeam: 'TEAM123',
      states: ['menu', 'level', 'shop', 'settings', 'pause', 'win', 'fail'],
      shImpl,
    });

    expect(result.exportDir).toBe(path.join(outDir, 'device-attachments'));
    expect(result.testError.message).toMatch(/XCTest failed/);
    expect(fs.existsSync(path.join(result.exportDir, 'manifest.json'))).toBe(true);

    const [xcodegen, xcodebuild, exportCall] = calls;
    expect(xcodegen).toMatchObject({ file: 'xcodegen', args: ['generate'] });
    expect(xcodebuild.file).toBe('xcodebuild');
    expect(xcodebuild.args).toContain('-allowProvisioningUpdates');
    expect(xcodebuild.args).toContain('DEVELOPMENT_TEAM=TEAM123');
    expect(xcodebuild.args.some((a) => a.startsWith('TEST_RUNNER_TARGET_BUNDLE_ID='))).toBe(false);
    expect(xcodebuild.opts.env.TEST_RUNNER_TARGET_BUNDLE_ID).toBe('com.example.game');
    // The runner gates the ORDERED manifest vocabulary (Shop included), passed as
    // a comma-separated env var — never a hardcoded six-state list (card qWCv9tUo).
    expect(xcodebuild.args.some((a) => a.startsWith('TEST_RUNNER_TARGET_STATES='))).toBe(false);
    expect(xcodebuild.opts.env.TEST_RUNNER_TARGET_STATES).toBe('menu,level,shop,settings,pause,win,fail');
    expect(exportCall.args.slice(0, 3)).toEqual(['xcresulttool', 'export', 'attachments']);

    fs.rmSync(runnerDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('omits the DEVELOPMENT_TEAM build setting when no override is provided', () => {
    const runnerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-runner-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-out-'));
    const calls = [];
    const shImpl = (file, args, opts = {}) => {
      calls.push({ file, args, opts });
      if (file === 'xcodebuild') {
        const resultIndex = args.indexOf('-resultBundlePath') + 1;
        fs.mkdirSync(args[resultIndex], { recursive: true });
      }
      if (file === 'xcrun') {
        const outIndex = args.indexOf('--output-path') + 1;
        fs.mkdirSync(args[outIndex], { recursive: true });
        fs.writeFileSync(path.join(args[outIndex], 'manifest.json'), '[]');
      }
      return '';
    };

    runXcuiTestAndExport({
      runnerDir,
      deviceUdid: 'DEVICE',
      appBundleId: 'com.example.game',
      outDir,
      states: ['menu', 'level', 'shop', 'settings', 'pause', 'win', 'fail'],
      shImpl,
    });

    const xcodebuild = calls.find((c) => c.file === 'xcodebuild');
    expect(xcodebuild.args.some((a) => a.startsWith('DEVELOPMENT_TEAM='))).toBe(false);

    fs.rmSync(runnerDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('fails closed (never spawns xcodebuild) when the ordered state vocabulary is missing, empty, or comma-poisoned', () => {
    const runnerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-runner-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-out-'));
    const calls = [];
    const shImpl = (file, args, opts = {}) => { calls.push({ file, args, opts }); return ''; };
    const base = { runnerDir, deviceUdid: 'DEVICE', appBundleId: 'com.example.game', outDir, shImpl };

    for (const states of [undefined, [], 'menu,level', ['menu', ''], ['menu', 'a,b']]) {
      expect(() => runXcuiTestAndExport({ ...base, states })).toThrow(
        /non-empty ordered `states`|TEST_RUNNER_TARGET_STATES wire/,
      );
    }
    // A fail-closed vocabulary error must NOT burn a device run.
    expect(calls.some((c) => c.file === 'xcodebuild')).toBe(false);

    fs.rmSync(runnerDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});

describe('Android build/install steps', () => {
  it('assembles remote Android build commands with cwd and harness env through a build prefix', () => {
    const parts = buildAndroidBuildCommandParts({
      buildPrefix: 'ssh ubuntu-server',
      cwd: '/home/batu/Desktop/utolye/fabrikav2/games/block_blast',
      env: androidBuildEnv('/home/batu/android-sdk'),
      command: 'npx',
      args: ['vite', 'build'],
    });

    expect(parts.slice(0, 6)).toEqual([
      'ssh',
      'ubuntu-server',
      'cd',
      '/home/batu/Desktop/utolye/fabrikav2/games/block_blast',
      '&&',
      'env',
    ]);
    expect(parts).toContain('ANDROID_HOME=/home/batu/android-sdk');
    expect(parts).toContain('ANDROID_SDK_ROOT=/home/batu/android-sdk');
    expect(parts).toContain('VITE_ENABLE_TEST_HARNESS=true');
    expect(parts).toContain('VITE_INSITU_TOUR=allstates');
    expect(parts.slice(-3)).toEqual(['npx', 'vite', 'build']);
  });

  it('builds the Android harness bundle and runs cap add only when android/ is absent', () => {
    const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-android-game-'));
    const recipeValues = path.join(gameDir, 'native-resources', 'android', 'app', 'src', 'main', 'res', 'values');
    fs.mkdirSync(recipeValues, { recursive: true });
    fs.writeFileSync(path.join(recipeValues, 'strings.xml'), '<resources />');
    const calls = [];
    const shImpl = (file, args, opts = {}) => {
      calls.push({ file, args, opts });
      if (file === 'npx' && args.join(' ') === 'cap add android') {
        fs.mkdirSync(path.join(gameDir, 'android'), { recursive: true });
      }
      return '';
    };

    buildAndroidHarnessBundle(gameDir, { androidSdk: '/home/batu/android-sdk', shImpl });
    buildAndroidHarnessBundle(gameDir, { androidSdk: '/home/batu/android-sdk', shImpl });

    expect(calls.map((c) => `${c.file} ${c.args.join(' ')}`)).toEqual([
      'npx vite build',
      'npx cap add android',
      'npx cap sync android',
      'npx vite build',
      'npx cap sync android',
    ]);
    expect(calls[0].opts.env.VITE_ENABLE_TEST_HARNESS).toBe('true');
    expect(calls[0].opts.env.VITE_INSITU_TOUR).toBe('allstates');
    expect(calls[0].opts.env.ANDROID_HOME).toBe('/home/batu/android-sdk');
    expect(calls[0].opts.env.PATH).toContain('/home/batu/android-sdk/platform-tools');
    expect(
      fs.readFileSync(path.join(gameDir, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'), 'utf8'),
    ).toBe('<resources />');

    fs.rmSync(gameDir, { recursive: true, force: true });
  });

  it('runs Android harness build commands through VERIFY_DEVICE_BUILD_PREFIX style wrappers', () => {
    const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-android-game-'));
    const calls = [];

    buildAndroidHarnessBundle(gameDir, {
      androidSdk: '/home/batu/android-sdk',
      buildPrefix: 'ssh ubuntu-server',
      partsImpl: (parts) => {
        calls.push(parts);
        return '';
      },
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].slice(0, 3)).toEqual(['ssh', 'ubuntu-server', 'cd']);
    expect(calls[0]).toContain(gameDir);
    expect(calls[0].slice(-3)).toEqual(['npx', 'vite', 'build']);
    expect(calls[1].slice(-4)).toEqual(['npx', 'cap', 'add', 'android']);
    expect(calls[2].slice(-4)).toEqual(['npx', 'cap', 'sync', 'android']);

    fs.rmSync(gameDir, { recursive: true, force: true });
  });

  it('assembles the generated Android debug APK with Gradle', () => {
    const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-android-game-'));
    fs.mkdirSync(path.join(gameDir, 'android'), { recursive: true });
    const calls = [];

    const apk = assembleAndroidDebug(gameDir, {
      androidSdk: '/home/batu/android-sdk',
      shImpl: (file, args, opts = {}) => {
        calls.push({ file, args, opts });
        return '';
      },
    });

    expect(apk).toBe(androidDebugApkPath(gameDir));
    expect(calls[0].file).toBe('./gradlew');
    expect(calls[0].args).toEqual(['--no-daemon', 'assembleDebug']);
    expect(calls[0].opts.cwd).toBe(path.join(gameDir, 'android'));

    fs.rmSync(gameDir, { recursive: true, force: true });
  });

  it('assembles Android debug APK through a build prefix without requiring local android/', () => {
    const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-android-game-'));
    const calls = [];

    const apk = assembleAndroidDebug(gameDir, {
      androidSdk: '/home/batu/android-sdk',
      buildPrefix: 'ssh ubuntu-server',
      partsImpl: (parts) => {
        calls.push(parts);
        return '';
      },
    });

    expect(apk).toBe(androidDebugApkPath(gameDir));
    expect(calls[0].slice(0, 3)).toEqual(['ssh', 'ubuntu-server', 'cd']);
    expect(calls[0]).toContain(path.join(gameDir, 'android'));
    expect(calls[0].slice(-3)).toEqual(['./gradlew', '--no-daemon', 'assembleDebug']);

    fs.rmSync(gameDir, { recursive: true, force: true });
  });

  it('installs the debug APK through a configurable adb prefix', () => {
    const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-android-game-'));
    const apk = androidDebugApkPath(gameDir);
    fs.mkdirSync(path.dirname(apk), { recursive: true });
    fs.writeFileSync(apk, 'apk');
    const calls = [];

    installAndroidDebugApk({
      gameDir,
      serial: '27091JEGR22183',
      adbPrefix: 'ssh ubuntu-server adb',
      shImpl: (parts) => calls.push(parts),
    });

    expect(calls[0]).toEqual([
      'ssh', 'ubuntu-server', 'adb', '-s', '27091JEGR22183', 'install', '-r', apk,
    ]);

    fs.rmSync(gameDir, { recursive: true, force: true });
  });

  it('can assemble a remote install command without a local APK artifact', () => {
    const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-android-game-'));
    const calls = [];

    installAndroidDebugApk({
      gameDir,
      serial: '27091JEGR22183',
      adbPrefix: 'ssh ubuntu-server adb',
      requireLocalApk: false,
      shImpl: (parts) => calls.push(parts),
    });

    expect(calls[0]).toEqual([
      'ssh',
      'ubuntu-server',
      'adb',
      '-s',
      '27091JEGR22183',
      'install',
      '-r',
      androidDebugApkPath(gameDir),
    ]);

    fs.rmSync(gameDir, { recursive: true, force: true });
  });

  it('launches the Android app after a best-effort force stop', () => {
    const calls = [];
    launchAndroidApp({
      appId: 'com.example.game',
      serial: '27091JEGR22183',
      adbPrefix: 'ssh ubuntu-server adb',
      shImpl: (parts) => {
        calls.push(parts);
        return '';
      },
    });

    expect(calls).toEqual([
      ['ssh', 'ubuntu-server', 'adb', '-s', '27091JEGR22183', 'shell', 'am', 'force-stop', 'com.example.game'],
      [
        'ssh', 'ubuntu-server', 'adb', '-s', '27091JEGR22183',
        'shell', 'am', 'start', '-W', '-n', 'com.example.game/.MainActivity',
      ],
    ]);
  });

  it('defaults Android SDK env to the ubuntu build-host path when unset', () => {
    const env = androidBuildEnv('/home/batu/android-sdk');
    expect(env.ANDROID_HOME).toBe('/home/batu/android-sdk');
    expect(env.ANDROID_SDK_ROOT).toBe('/home/batu/android-sdk');
  });
});
