import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAndInstallApp, formatCommand, runXcuiTestAndExport } from '../src/steps.mjs';

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
      shImpl,
    });

    const xcodebuild = calls.find((c) => c.file === 'xcodebuild');
    expect(xcodebuild.args.some((a) => a.startsWith('DEVELOPMENT_TEAM='))).toBe(false);

    fs.rmSync(runnerDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});
