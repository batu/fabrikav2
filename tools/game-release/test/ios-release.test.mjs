import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { defaultDependencies, deriveReleaseBuildId, executeIosRelease, validateReleaseEnvironment, verifyExactInstall } from '../src/ios-release.mjs';

const attestation = { manifestDigest: 'a'.repeat(64), sourceSha: 'b'.repeat(40) };
const buildId = deriveReleaseBuildId(attestation.manifestDigest, attestation.sourceSha);

describe('iOS exact release lane', () => {
  it('refuses harness and insitu flags', () => {
    expect(() => validateReleaseEnvironment({ VITE_ENABLE_TEST_HARNESS: 'true' })).toThrow(/harness/i);
    expect(() => validateReleaseEnvironment({ VITE_INSITU_TOUR: 'allstates' })).toThrow(/insitu/i);
  });

  it('rejects stale, simulator, browser, and harness evidence', () => {
    const expected = { ...attestation, bundleId: 'com.example.dog', version: '1.2.3' };
    const installed = { bundleId: 'com.example.dog', version: '1.2.3', buildId };
    expect(() => verifyExactInstall({ expected, installed: { ...installed, buildId: '1.0.0' }, evidence: { lane: 'release', physical: true } })).toThrow(/attestation/i);
    for (const evidence of [{ lane: 'browser', physical: true }, { lane: 'harness', physical: true }, { lane: 'release', physical: false }]) {
      expect(() => verifyExactInstall({ expected, installed, evidence })).toThrow(/physical harness-free/i);
    }
  });

  it('derives a stable CFBundleVersion and parses the real devicectl app shape', () => {
    expect(buildId).toMatch(/^\d{1,4}\.\d{1,2}\.\d{1,2}$/);
    expect(deriveReleaseBuildId(attestation.manifestDigest, attestation.sourceSha)).toBe(buildId);
    expect(deriveReleaseBuildId('c'.repeat(64), attestation.sourceSha)).not.toBe(buildId);
    const deps = defaultDependencies({ execImpl: () => JSON.stringify({ result: { apps: [{ bundleIdentifier: 'com.example.dog', version: '1.2.3', bundleVersion: buildId, path: '/private/app' }] } }) });
    expect(deps.queryInstalledApp({ bundleId: 'com.example.dog', device: { udid: 'PHONE' } })).toEqual({ bundleId: 'com.example.dog', version: '1.2.3', buildId });
  });

  it('builds before sync, replaces install, and emits a redacted bound receipt', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-release-'));
    const app = path.join(root, 'App.app');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'payload.bin'), 'release');
    const calls = [];
    const result = executeIosRelease({
      gameDir: root, bundleId: 'com.example.dog', version: '1.2.3', device: { udid: 'PHONE', name: 'iPhone', platform: 'iOS' },
      attestation, env: {}, maxBundleBytes: 1024,
    }, {
      buildWeb: () => calls.push('build-web'), syncNative: () => calls.push('sync'), applyNative: () => calls.push('apply'),
      validateNative: () => calls.push('validate'), stampAttestation: () => calls.push('stamp'),
      buildSignedApp: () => (calls.push('signed-build'), { appPath: app, signingIdentity: 'Apple Development: REDACTED' }),
      uninstallApp: () => calls.push('uninstall'), installApp: () => calls.push('install'), launchApp: () => (calls.push('launch'), { launched: true }),
      queryInstalledApp: () => ({ bundleId: 'com.example.dog', version: '1.2.3', buildId }),
      captureAttestation: () => ({ installedApplication: { bundleId: 'com.example.dog', version: '1.2.3', buildId }, lane: 'release', physical: true, path: '/evidence/device.mp4', gameplayState: 'level' }),
    });
    expect(calls).toEqual(['build-web', 'sync', 'apply', 'validate', 'stamp', 'signed-build', 'uninstall', 'install', 'launch']);
    expect(Object.keys(result).sort()).toEqual(['artifact', 'attestation', 'build', 'bundle_id', 'captured', 'device', 'evidence', 'installed', 'kind', 'launch', 'manifest_sha256', 'source_revision', 'version']);
    expect(result.kind).toBe('exact_release_candidate');
    expect(result.manifest_sha256).toBe(attestation.manifestDigest);
    expect(result.source_revision).toBe(attestation.sourceSha);
    expect(result.bundle_id).toBe('com.example.dog');
    expect(result.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.artifact).toEqual({ sha256: result.artifact.sha256, size_bytes: 7, contaminated_entries: [] });
    expect(result.build).toEqual({ platform: 'ios', harness_enabled: false, insitu_tour: false, simulator: false, browser: false, signing_identity: 'Apple Development: REDACTED' });
    expect(result.device.udid).toBe('PHONE');
    expect(result.device.physical).toBe(true);
    expect(result.attestation).toEqual({ manifest_sha256: attestation.manifestDigest, source_revision: attestation.sourceSha, build_id: buildId });
    expect(result.installed).toEqual({ bundle_id: 'com.example.dog', version: '1.2.3', build_id: buildId });
    expect(result.captured).toEqual({ bundle_id: 'com.example.dog', version: '1.2.3', build_id: buildId, evidence_path: '/evidence/device.mp4', gameplay_state: 'level' });
    expect(result.launch).toEqual({ succeeded: true });
    expect(JSON.stringify(result)).not.toContain('payload.bin');
  });

  it('rejects oversized and catalog-contaminated bundles before install', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-release-bad-'));
    const app = path.join(root, 'App.app');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'asset.json'), 'SKAdNetworkIdentifier applovin.com');
    const base = { gameDir: root, bundleId: 'com.example.dog', version: '1', device: { udid: 'P', platform: 'iOS' }, attestation, env: {}, maxBundleBytes: 1 };
    const deps = { buildWeb() {}, syncNative() {}, applyNative() {}, validateNative() {}, stampAttestation() {}, buildSignedApp: () => ({ appPath: app, signingIdentity: 'id' }), uninstallApp: () => { throw new Error('must not install'); } };
    expect(() => executeIosRelease(base, deps)).toThrow(/oversized|contaminated/i);
  });
});
