import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatCommand, runXcuiTestAndExport } from '../src/steps.mjs';

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
