import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { defaultDependencies, deriveReleaseBuildId, executeIosRelease, inspectSignedIosApp, validateReleaseEnvironment, verifyExactInstall } from '../src/ios-release.mjs';

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
    const deps = defaultDependencies({ execImpl: (_file, args) => {
      const output = args.at(-1);
      fs.writeFileSync(output, JSON.stringify({ result: { apps: [{ bundleIdentifier: 'com.example.dog', version: '1.2.3', bundleVersion: buildId, path: '/private/app' }] } }));
      return '';
    } });
    expect(deps.queryInstalledApp({ bundleId: 'com.example.dog', device: { udid: 'PHONE' } })).toEqual({ bundleId: 'com.example.dog', version: '1.2.3', buildId });
  });

  it('verifies and reads signing authority from the actual app', () => {
    const calls = [];
    const identity = inspectSignedIosApp('/tmp/App.app', { expectedTeam: 'TEAM123', spawnImpl: (_file, args) => {
      calls.push(args);
      return args[0] === '--verify' ? { status: 0, stdout: '', stderr: '' } : { status: 0, stdout: '', stderr: 'Authority=Apple Development: Example\nTeamIdentifier=TEAM123\n' };
    } });
    expect(identity).toBe('Apple Development: Example [TEAM123]');
    expect(calls[0]).toEqual(['--verify', '--deep', '--strict', '/tmp/App.app']);
    expect(() => inspectSignedIosApp('/tmp/App.app', { expectedTeam: 'WRONG', spawnImpl: (_file, args) => args[0] === '--verify' ? { status: 0 } : { status: 0, stderr: 'Authority=A\nTeamIdentifier=TEAM123\n' } })).toThrow(/team/i);
  });

  it('fails closed when source becomes dirty before receipt emission', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-release-source-'));
    const app = path.join(root, 'App.app'); fs.mkdirSync(app); fs.writeFileSync(path.join(app, 'x'), 'x');
    const proof = path.join(root, 'proof.png'); fs.writeFileSync(proof, 'proof');
    const proofSha = crypto.createHash('sha256').update('proof').digest('hex');
    let checks = 0;
    let candidateBuildId = '';
    const request = { gameDir: root, bundleId: 'com.example.dog', version: '1', device: { udid: 'P', platform: 'iOS' }, attestation, env: {} };
    request.gameplayEvidence = { reviewed: true, reviewer: 'operator', deviceUdid: 'P', bundleId: 'com.example.dog', version: '1', get buildId() { return candidateBuildId; }, path: proof, sha256: proofSha, state: 'level' };
    expect(() => executeIosRelease(request, {
      verifySource() { checks += 1; if (checks === 2) throw new Error('release source worktree is dirty'); },
      buildWeb() {}, syncNative() {}, applyNative() {}, validateNative() {}, stampAttestation(value) { candidateBuildId = value.buildId; },
      buildSignedApp: () => ({ appPath: app, signingIdentity: 'A [T]' }), uninstallApp() {}, installApp() {}, launchApp: () => ({ launched: true }),
      queryInstalledApp: () => ({ bundleId: 'com.example.dog', version: '1', buildId: candidateBuildId }),
      captureAttestation: () => ({ installedApplication: { bundleId: 'com.example.dog', version: '1', buildId: candidateBuildId }, lane: 'release', physical: true, path: '/evidence/device.png', sha256: 'c'.repeat(64), gameplayState: 'post_launch_device_capture' }),
    })).toThrow(/dirty/);
    expect(checks).toBe(2);
  });

  it('builds before sync, replaces install, and emits a redacted bound receipt', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-release-'));
    const app = path.join(root, 'App.app');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'payload.bin'), 'release');
    const gameplayPath = path.join(root, 'gameplay.png'); fs.writeFileSync(gameplayPath, 'reviewed-gameplay');
    const gameplaySha = crypto.createHash('sha256').update('reviewed-gameplay').digest('hex');
    const calls = [];
    let actualBuildId = '';
    const result = executeIosRelease({
      gameDir: root, bundleId: 'com.example.dog', version: '1.2.3', device: { udid: 'PHONE', name: 'iPhone', platform: 'iOS' },
      attestation, env: {}, maxBundleBytes: 1024,
      gameplayEvidence: { reviewed: true, reviewer: 'operator', deviceUdid: 'PHONE', bundleId: 'com.example.dog', version: '1.2.3', get buildId() { return actualBuildId; }, path: gameplayPath, sha256: gameplaySha, state: 'level' },
    }, {
      verifySource: () => calls.push('verify-source'), buildWeb: () => calls.push('build-web'), syncNative: () => calls.push('sync'), applyNative: () => calls.push('apply'),
      validateNative: () => calls.push('validate'), stampAttestation: (value) => { actualBuildId = value.buildId; calls.push('stamp'); },
      buildSignedApp: () => (calls.push('signed-build'), { appPath: app, signingIdentity: 'Apple Development: REDACTED' }),
      uninstallApp: () => calls.push('uninstall'), installApp: () => calls.push('install'), launchApp: () => (calls.push('launch'), { launched: true }),
      queryInstalledApp: () => ({ bundleId: 'com.example.dog', version: '1.2.3', buildId: actualBuildId }),
      captureAttestation: () => ({ installedApplication: { bundleId: 'com.example.dog', version: '1.2.3', buildId: actualBuildId }, lane: 'release', physical: true, path: '/evidence/device.png', sha256: 'c'.repeat(64), gameplayState: 'post_launch_device_capture' }),
    });
    expect(calls).toEqual(['verify-source', 'build-web', 'sync', 'apply', 'validate', 'signed-build', 'stamp', 'signed-build', 'uninstall', 'install', 'launch', 'verify-source']);
    expect(Object.keys(result).sort()).toEqual(['artifact', 'attestation', 'build', 'bundle_id', 'captured', 'device', 'evidence', 'installed', 'kind', 'launch', 'manifest_sha256', 'post_launch_capture', 'source_revision', 'version']);
    expect(result.kind).toBe('exact_release_candidate');
    expect(result.manifest_sha256).toBe(attestation.manifestDigest);
    expect(result.source_revision).toBe(attestation.sourceSha);
    expect(result.bundle_id).toBe('com.example.dog');
    expect(result.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.artifact).toEqual({ sha256: result.artifact.sha256, size_bytes: 7, contaminated_entries: [] });
    expect(result.build).toEqual({ platform: 'ios', harness_enabled: false, insitu_tour: false, simulator: false, browser: false, signing_identity: 'Apple Development: REDACTED' });
    expect(result.device.udid).toBe('PHONE');
    expect(result.device.physical).toBe(true);
    expect(result.attestation).toEqual({ manifest_sha256: attestation.manifestDigest, source_revision: attestation.sourceSha, artifact_payload_sha256: expect.stringMatching(/^[a-f0-9]{64}$/), build_id: actualBuildId });
    expect(result.installed).toEqual({ bundle_id: 'com.example.dog', version: '1.2.3', build_id: actualBuildId });
    expect(result.post_launch_capture).toEqual({ evidence_path: '/evidence/device.png', evidence_sha256: 'c'.repeat(64), state: 'post_launch_device_capture' });
    expect(result.captured).toEqual({ bundle_id: 'com.example.dog', version: '1.2.3', build_id: actualBuildId, evidence_path: gameplayPath, evidence_sha256: gameplaySha, gameplay_state: 'level', reviewed_by: 'operator' });
    expect(result.launch).toEqual({ succeeded: true });
    expect(JSON.stringify(result)).not.toContain('payload.bin');
  });

  it('rejects oversized and catalog-contaminated bundles before install', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-release-bad-'));
    const app = path.join(root, 'App.app');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'asset.json'), 'SKAdNetworkIdentifier applovin.com');
    const base = { gameDir: root, bundleId: 'com.example.dog', version: '1', device: { udid: 'P', platform: 'iOS' }, attestation, env: {}, maxBundleBytes: 1 };
    const deps = { verifySource() {}, buildWeb() {}, syncNative() {}, applyNative() {}, validateNative() {}, stampAttestation() {}, buildSignedApp: () => ({ appPath: app, signingIdentity: 'id' }), uninstallApp: () => { throw new Error('must not install'); } };
    expect(() => executeIosRelease(base, deps)).toThrow(/oversized|contaminated/i);
  });
});
