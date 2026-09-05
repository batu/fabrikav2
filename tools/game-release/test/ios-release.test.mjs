import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { captureIosReleaseCandidate, defaultDependencies, deriveReleaseBuildId, executeIosRelease, finalizeIosReleaseCandidate, inspectBundle, inspectSignedIosApp, reviewReceiptPayload, validateReleaseEnvironment, verifyExactInstall, verifyReviewedGameplayEvidence } from '../src/ios-release.mjs';
import { patchGameAnalyticsSource, verifyPatchedGameAnalyticsSource } from '../../patch-gameanalytics-persistence.mjs';

const attestation = { manifestDigest: 'a'.repeat(64), sourceSha: 'b'.repeat(40) };
const buildId = deriveReleaseBuildId(attestation.manifestDigest, attestation.sourceSha);

function signedGameplayEvidence(overrides = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const evidence = {
    deviceUdid: 'PHONE', bundleId: 'com.example.dog', version: '1.2.3', buildId: overrides.buildId || buildId,
    path: overrides.path, sha256: overrides.sha256, state: 'level',
    reviewReceipt: { boundary: 'authenticated_gameplay_review', receipt_id: 'review-123', reviewed_by: 'operator', reviewed_at: '2026-08-18T12:00:00.000Z', verdict: 'passed', evidence_sha256: overrides.sha256 },
    ...overrides,
  };
  evidence.reviewReceipt.server_signature = crypto.sign(null, Buffer.from(reviewReceiptPayload(evidence)), privateKey).toString('base64');
  return { evidence, publicKey: publicKey.export({ type: 'spki', format: 'pem' }) };
}

function attachReviewReceipt(evidence, privateKey) {
  evidence.reviewReceipt = { boundary: 'authenticated_gameplay_review', receipt_id: 'review-123', reviewed_by: 'operator', reviewed_at: '2026-08-18T12:00:00.000Z', verdict: 'passed', evidence_sha256: evidence.sha256 };
  evidence.reviewReceipt.server_signature = crypto.sign(null, Buffer.from(reviewReceiptPayload(evidence)), privateKey).toString('base64');
}

describe('iOS exact release lane', () => {
  it('accepts exactly one persistence patch and rejects ambiguous or tampered SDK source', () => {
    const before = 'delete-events; log-sent';
    const after = 'delete-events; save-store; log-sent';
    const markers = {
      before,
      after,
      unpatchedSha256: crypto.createHash('sha256').update(before).digest('hex'),
      patchedSha256: crypto.createHash('sha256').update(after).digest('hex'),
    };

    expect(patchGameAnalyticsSource(before, markers)).toBe(after);
    expect(patchGameAnalyticsSource(after, markers)).toBe(after);
    expect(() => patchGameAnalyticsSource(`${before}\n${before}`, markers)).toThrow(/digest|exactly one/i);
    expect(() => patchGameAnalyticsSource(`${after}\n${after}`, markers)).toThrow(/digest|exactly one/i);
    expect(() => patchGameAnalyticsSource(`${after} tampered`, markers)).toThrow(/digest/i);
    expect(() => verifyPatchedGameAnalyticsSource(before, markers)).toThrow(/not applied/i);
    expect(verifyPatchedGameAnalyticsSource(after, markers)).toBeUndefined();
  });

  it('stages an installed candidate without gameplay review, then finalizes it without rebuilding', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-release-staged-'));
    const app = path.join(root, 'App.app'); fs.mkdirSync(app); fs.writeFileSync(path.join(app, 'payload.bin'), 'release');
    const diagnostic = path.join(root, 'post-launch.png'); fs.writeFileSync(diagnostic, 'diagnostic');
    const durableApp = path.join(root, 'release-candidates', 'candidate-1', 'App.app'); fs.mkdirSync(path.dirname(durableApp), { recursive: true }); fs.cpSync(app, durableApp, { recursive: true });
    const proof = path.join(root, 'gameplay.png'); fs.writeFileSync(proof, 'reviewed-gameplay');
    const proofSha = crypto.createHash('sha256').update('reviewed-gameplay').digest('hex');
    let candidateBuildId = ''; const captureCalls = [];
    const request = { gameDir: root, bundleId: 'com.example.dog', version: '1.2.3', device: { udid: 'PHONE', platform: 'iOS' }, attestation, env: {}, maxBundleBytes: 1024 };
    const staged = captureIosReleaseCandidate(request, {
      verifySource: () => captureCalls.push('verify-source'), buildWeb: () => captureCalls.push('build'), syncNative: () => captureCalls.push('sync'),
      applyNative: () => captureCalls.push('apply'), validateNative: () => captureCalls.push('validate'),
      buildSignedApp: () => (captureCalls.push('signed-build'), { appPath: app, signingIdentity: 'Apple Development: Example [TEAM]' }),
      stageSignedApp: () => (captureCalls.push('stage-app'), durableApp),
      stampAttestation(value) { candidateBuildId = value.buildId; captureCalls.push('stamp'); }, uninstallApp: () => captureCalls.push('uninstall'),
      installApp: () => captureCalls.push('install'), launchApp: () => (captureCalls.push('launch'), { launched: true }),
      queryInstalledApp: () => ({ bundleId: request.bundleId, version: request.version, buildId: candidateBuildId }),
      captureAttestation: () => ({ installedApplication: { bundleId: request.bundleId, version: request.version, buildId: candidateBuildId }, lane: 'release', physical: true, path: diagnostic, sha256: crypto.createHash('sha256').update('diagnostic').digest('hex'), gameplayState: 'post_launch_device_capture' }),
    });
    expect(staged.kind).toBe('staged_ios_release_candidate');
    expect(staged).not.toHaveProperty('captured');
    expect(staged.diagnostic_capture.state).toBe('post_launch_device_capture');
    expect(captureCalls).toEqual(['verify-source', 'build', 'sync', 'apply', 'validate', 'signed-build', 'stamp', 'signed-build', 'stage-app', 'uninstall', 'install', 'launch', 'verify-source']);

    const reviewKeys = crypto.generateKeyPairSync('ed25519');
    request.gameplayEvidence = { deviceUdid: 'PHONE', bundleId: request.bundleId, version: request.version, buildId: candidateBuildId, path: proof, sha256: proofSha, state: 'level' };
    attachReviewReceipt(request.gameplayEvidence, reviewKeys.privateKey);
    const finalizeCalls = [];
    const exact = finalizeIosReleaseCandidate(request, staged, {
      verifySource: () => finalizeCalls.push('verify-source'), inspectStagedApp: () => (finalizeCalls.push('codesign'), staged.build.signing_identity),
      queryInstalledApp: () => (finalizeCalls.push('query-installed'), { bundleId: request.bundleId, version: request.version, buildId: candidateBuildId }),
      loadReviewAuthorityPublicKey: () => reviewKeys.publicKey,
    });
    expect(finalizeCalls).toEqual(['verify-source', 'codesign', 'query-installed', 'verify-source']);
    expect(exact.kind).toBe('exact_release_candidate');
    expect(exact.attestation).toEqual(staged.attestation);
    expect(exact.local_app_ref).toBe(staged.local_app_ref);
    expect(exact.captured.review_receipt.boundary).toBe('authenticated_gameplay_review');
  });

  it('rejects a staged receipt whose payload binding was changed', () => {
    const request = { gameDir: '/tmp/game', bundleId: 'com.example.dog', version: '1.2.3', device: { udid: 'PHONE', platform: 'iOS' }, attestation, env: {} };
    const staged = { kind: 'staged_ios_release_candidate', boundary: 'staged_ios_release_candidate', status: 'passed', manifest_sha256: attestation.manifestDigest, source_revision: attestation.sourceSha, bundle_id: request.bundleId, version: request.version, device: { udid: 'PHONE', physical: true }, attestation: { manifest_sha256: attestation.manifestDigest, source_revision: attestation.sourceSha, artifact_payload_sha256: 'c'.repeat(64), build_id: '1.2.3' }, installed: { bundle_id: request.bundleId, version: request.version, build_id: '1.2.3' }, artifact: { sha256: 'd'.repeat(64), size_bytes: 1, contaminated_entries: [] }, build: { platform: 'ios', harness_enabled: false, insitu_tour: false, simulator: false, browser: false, signing_identity: 'A [T]' }, launch: { succeeded: true }, diagnostic_capture: { evidence_path: '/tmp/evidence.png', evidence_sha256: 'e'.repeat(64), state: 'post_launch_device_capture' }, local_app_ref: 'file-ref:/tmp/App.app' };
    expect(() => finalizeIosReleaseCandidate(request, staged, {})).toThrow(/staged release candidate/i);
  });

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

  it('verifies both dependency patches before the iOS web build', () => {
    const calls = [];
    const deps = defaultDependencies({
      execImpl: (file, args, options) => {
        calls.push({ file, args, cwd: options.cwd });
        return '';
      },
    });

    deps.buildWeb({ gameDir: '/repo/games/find_the_dog', env: {} });

    expect(calls).toEqual([
      {
        file: 'node',
        args: ['tools/patch-gameanalytics-persistence.mjs', '--verify'],
        cwd: '/repo',
      },
      {
        file: 'node',
        args: ['tools/patch-admob-ios-revenue.mjs', '--verify'],
        cwd: '/repo',
      },
      {
        file: 'npm',
        args: ['run', 'build:ios'],
        cwd: '/repo/games/find_the_dog',
      },
    ]);
  });

  it.each(['tools/patch-gameanalytics-persistence.mjs', 'tools/patch-admob-ios-revenue.mjs'])(
    'blocks the iOS web build when dependency verification fails: %s',
    (failedPatch) => {
      const calls = [];
      const deps = defaultDependencies({
        execImpl: (file, args) => {
          calls.push({ file, args });
          if (args[0] === failedPatch) throw new Error('dependency correction missing');
          return '';
        },
      });

      expect(() => deps.buildWeb({ gameDir: '/repo/games/find_the_dog', env: {} })).toThrow('dependency correction missing');
      expect(calls.at(-1)).toEqual({ file: 'node', args: [failedPatch, '--verify'] });
      expect(calls.some(({ file }) => file === 'npm')).toBe(false);
    },
  );

  it('passes the requested marketing version to Xcode', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-release-build-'));
    const app = path.join(root, 'owned-output', 'DerivedData', 'Build', 'Products', 'Release-iphoneos', 'App.app');
    fs.mkdirSync(app, { recursive: true });
    const calls = [];
    const deps = defaultDependencies({
      execImpl: (file, args) => {
        calls.push([file, args]);
        if (file === 'agency') fs.writeFileSync(args[args.indexOf('--result-file') + 1], JSON.stringify({ output_dir: path.join(root, 'owned-output') }));
        return '';
      },
      spawnImpl: (_file, args) => args[0] === '--verify'
        ? { status: 0, stdout: '', stderr: '' }
        : { status: 0, stdout: '', stderr: 'Authority=Apple Development: Example\nTeamIdentifier=TEAM123\n' },
    });

    deps.buildSignedApp({ gameDir: root, version: '1.2.3', device: { udid: 'PHONE' }, developmentTeam: 'TEAM123' });

    expect(calls[0][0]).toBe('agency');
    expect(calls[0][1]).toContain('durable');
    expect(calls[0][1]).toContain('MARKETING_VERSION=1.2.3');
  });

  it('treats uninstalling from a clean device as a no-op', () => {
    const calls = [];
    const deps = defaultDependencies({ execImpl: (file, args) => {
      calls.push([file, args]);
      if (args.includes('--json-output')) fs.writeFileSync(args.at(-1), JSON.stringify({ result: { apps: [] } }));
      return '';
    } });

    deps.uninstallApp({ bundleId: 'com.example.dog', device: { udid: 'PHONE' } });

    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toContain('info');
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

  it('binds every Info.plist field except CFBundleVersion into the payload digest', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-release-plist-'));
    const app = path.join(root, 'App.app'); fs.mkdirSync(app);
    const plist = path.join(app, 'Info.plist');
    const write = (build, admob) => fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>${build}</string><key>GADApplicationIdentifier</key><string>${admob}</string></dict></plist>`);
    write('1.2.3', 'ca-app-pub-1');
    const first = inspectBundle(app, 1024, { payloadOnly: true }).sha256;
    write('9.9.9', 'ca-app-pub-1');
    expect(inspectBundle(app, 1024, { payloadOnly: true }).sha256).toBe(first);
    write('9.9.9', 'ca-app-pub-2');
    expect(inspectBundle(app, 1024, { payloadOnly: true }).sha256).not.toBe(first);
  });

  it('requires an authenticated gameplay review bound to candidate and evidence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-release-review-'));
    const proof = path.join(root, 'proof.png'); fs.writeFileSync(proof, 'proof');
    const sha256 = crypto.createHash('sha256').update('proof').digest('hex');
    const { evidence, publicKey } = signedGameplayEvidence({ path: proof, sha256 });
    expect(verifyReviewedGameplayEvidence(evidence, { deviceUdid: 'PHONE', bundleId: 'com.example.dog', version: '1.2.3', buildId }, publicKey).reviewReceipt.verdict).toBe('passed');
    expect(() => verifyReviewedGameplayEvidence({ ...evidence, state: 'menu' }, { deviceUdid: 'PHONE', bundleId: 'com.example.dog', version: '1.2.3', buildId }, publicKey)).toThrow(/signature/i);
    expect(() => verifyReviewedGameplayEvidence({ ...evidence, reviewReceipt: { ...evidence.reviewReceipt, server_signature: 'Zm9yZ2Vk' } }, { deviceUdid: 'PHONE', bundleId: 'com.example.dog', version: '1.2.3', buildId }, publicKey)).toThrow(/signature/i);
  });

  it('fails closed when source becomes dirty before receipt emission', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-release-source-'));
    const app = path.join(root, 'App.app'); fs.mkdirSync(app); fs.writeFileSync(path.join(app, 'x'), 'x');
    const proof = path.join(root, 'proof.png'); fs.writeFileSync(proof, 'proof');
    const proofSha = crypto.createHash('sha256').update('proof').digest('hex');
    let checks = 0;
    let candidateBuildId = '';
    const request = { gameDir: root, bundleId: 'com.example.dog', version: '1', device: { udid: 'P', platform: 'iOS' }, attestation, env: {} };
    const reviewKeys = crypto.generateKeyPairSync('ed25519');
    request.gameplayEvidence = { deviceUdid: 'P', bundleId: 'com.example.dog', version: '1', get buildId() { return candidateBuildId; }, path: proof, sha256: proofSha, state: 'level' };
    expect(() => executeIosRelease(request, {
      verifySource() { checks += 1; if (checks === 2) throw new Error('release source worktree is dirty'); },
      buildWeb() {}, syncNative() {}, applyNative() {}, validateNative() {}, stampAttestation(value) { candidateBuildId = value.buildId; },
      buildSignedApp: () => ({ appPath: app, signingIdentity: 'A [T]' }), uninstallApp() {}, installApp() {}, launchApp: () => ({ launched: true }),
      queryInstalledApp: () => ({ bundleId: 'com.example.dog', version: '1', buildId: candidateBuildId }),
      captureAttestation: () => ({ installedApplication: { bundleId: 'com.example.dog', version: '1', buildId: candidateBuildId }, lane: 'release', physical: true, path: '/evidence/device.png', sha256: 'c'.repeat(64), gameplayState: 'post_launch_device_capture' }),
      loadReviewAuthorityPublicKey: () => { attachReviewReceipt(request.gameplayEvidence, reviewKeys.privateKey); return reviewKeys.publicKey; },
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
    const reviewKeys = crypto.generateKeyPairSync('ed25519');
    const request = {
      gameDir: root, bundleId: 'com.example.dog', version: '1.2.3', device: { udid: 'PHONE', name: 'iPhone', platform: 'iOS' },
      attestation, env: {}, maxBundleBytes: 1024,
      gameplayEvidence: { deviceUdid: 'PHONE', bundleId: 'com.example.dog', version: '1.2.3', get buildId() { return actualBuildId; }, path: gameplayPath, sha256: gameplaySha, state: 'level' },
    };
    const result = executeIosRelease(request, {
      verifySource: () => calls.push('verify-source'), buildWeb: () => calls.push('build-web'), syncNative: () => calls.push('sync'), applyNative: () => calls.push('apply'),
      validateNative: () => calls.push('validate'), stampAttestation: (value) => { actualBuildId = value.buildId; calls.push('stamp'); },
      buildSignedApp: () => (calls.push('signed-build'), { appPath: app, signingIdentity: 'Apple Development: REDACTED' }),
      uninstallApp: () => calls.push('uninstall'), installApp: () => calls.push('install'), launchApp: () => (calls.push('launch'), { launched: true }),
      queryInstalledApp: () => ({ bundleId: 'com.example.dog', version: '1.2.3', buildId: actualBuildId }),
      captureAttestation: () => ({ installedApplication: { bundleId: 'com.example.dog', version: '1.2.3', buildId: actualBuildId }, lane: 'release', physical: true, path: '/evidence/device.png', sha256: 'c'.repeat(64), gameplayState: 'post_launch_device_capture' }),
      loadReviewAuthorityPublicKey: () => { attachReviewReceipt(request.gameplayEvidence, reviewKeys.privateKey); return reviewKeys.publicKey; },
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
    expect(result.captured).toEqual({ bundle_id: 'com.example.dog', version: '1.2.3', build_id: actualBuildId, evidence_path: gameplayPath, evidence_sha256: gameplaySha, gameplay_state: 'level', reviewed_by: 'operator', review_receipt: request.gameplayEvidence.reviewReceipt });
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
