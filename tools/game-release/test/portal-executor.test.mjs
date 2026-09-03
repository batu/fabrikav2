import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { executePortalPayload } from '../src/portal-executor.mjs';

const sourceRevision = 'a'.repeat(40);
const manifestSha = 'b'.repeat(64);
const runtimeGraph = [
  'package.json', 'package-lock.json', 'games/find_the_dog/package.json', 'games/find_the_dog/capacitor.config.ts',
  'games/find_the_dog/config/admob.public.json', 'games/find_the_bird/config/admob.public.json',
  'games/find_the_dog/vite.config.ts', 'games/find_the_dog/src/build/nativePublicBundle.ts', 'configs/vite.base.ts',
  'games/find_the_dog/src/sdk/includePlugins.ts', 'games/find_the_dog/src/ads/AdMobConfig.ts',
  'tools/game-release/src/portal-executor.mjs', 'tools/game-release/src/ios-release.mjs', 'tools/game-release/src/manifest.mjs',
  'tools/patch-gameanalytics-persistence.mjs',
  'tools/game-env/src/env.mjs', 'tools/game-env/src/admob-identities.mjs', 'tools/game-env/src/policies.mjs', 'tools/game-env/src/policies/find-the-bird.mjs', 'tools/game-env/src/policies/find-the-dog.mjs', 'tools/game-env/src/validate.mjs',
  'tools/game-env/validate.mjs', 'tools/native-shell/apply.mjs', 'tools/native-shell/validate.mjs', 'tools/native-shell/src/native-shell.mjs', 'tools/native-shell/src/cli.mjs',
  'tools/verify-device/src/devices.mjs', 'tools/verify-device/src/summary.mjs',
];

function portalPayload(stepKey, settings = {}) {
  return {
    run: {
      id: 'rr_1', manifest_sha256: manifestSha,
      manifest: {
        game: { slug: 'find-the-dog', platform: 'ios', bundle_id: 'com.baseardahan.hiddenobj', version: '1.0.0', source_revision: sourceRevision, build_target: 'release' },
        device: { udid: 'PHONE', name: 'iPhone' }, providers: [],
      },
      review_audit_receipts: [],
    },
    step: { step_key: stepKey, attempt: 1 },
    settings: { executor: stepKey.split('.')[0], repo_root: '/repo', ...settings },
  };
}

describe('Portal release executable adapter', () => {
  it('maps an approved build step into the existing manifest function', () => {
    let request;
    const result = executePortalPayload(portalPayload('build.release'), {
      buildReleaseManifest(value) { request = value; return { ok: true, platform: 'ios', bundleId: 'com.baseardahan.hiddenobj', sourceRevision }; },
    });
    expect(request).toEqual({ repoRoot: '/repo', game: 'find_the_dog', expectedSourceRevision: sourceRevision, platform: 'ios' });
    expect(result).toEqual({ outcome: 'passed', receipt: { boundary: 'build_diagnostic', status: 'passed', manifest_sha256: manifestSha, source_revision: sourceRevision, bundle_id: 'com.baseardahan.hiddenobj', platform: 'ios' } });
  });

  it('captures a staged device candidate without requiring gameplay review', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-game-release-'));
    const envFile = path.join(root, 'release.env');
    const evidenceFile = path.join(root, 'post-launch.png');
    fs.writeFileSync(envFile, 'VITE_ADMOB_IOS_ENABLED=true\n'); fs.chmodSync(envFile, 0o600);
    const payload = portalPayload('device.capture', {
      environment_ref: `file-ref:${envFile}`, evidence_ref: `file-ref:${evidenceFile}`,
      development_team: 'TEAM123', max_artifact_bytes: 1234,
    });
    let request;
    const staged = { kind: 'staged_ios_release_candidate', boundary: 'staged_ios_release_candidate', status: 'passed' };
    const result = executePortalPayload(payload, { captureIosReleaseCandidate(value) { request = value; return staged; }, releaseDependencies: {} });
    expect(request).toMatchObject({ gameDir: '/repo/games/find_the_dog', bundleId: 'com.baseardahan.hiddenobj', env: { VITE_ADMOB_IOS_ENABLED: 'true' }, evidencePath: evidenceFile, developmentTeam: 'TEAM123', maxBundleBytes: 1234 });
    expect(request).not.toHaveProperty('gameplayEvidence');
    expect(result).toEqual({ outcome: 'passed', receipt: staged });
  });

  it('finalizes the stored staged candidate with Portal review without rebuilding', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-game-finalize-'));
    const envFile = path.join(root, 'release.env'); const gameplayFile = path.join(root, 'gameplay.png'); const publicKey = path.join(root, 'review-public.pem');
    fs.writeFileSync(envFile, 'VITE_ADMOB_IOS_ENABLED=true\n'); fs.chmodSync(envFile, 0o600);
    fs.writeFileSync(gameplayFile, 'proof'); fs.chmodSync(gameplayFile, 0o600); fs.writeFileSync(publicKey, 'PUBLIC'); fs.chmodSync(publicKey, 0o600);
    const sha256 = 'f'.repeat(64); const payload = portalPayload('device.finalize', {
      environment_ref: `file-ref:${envFile}`, gameplay_evidence_ref: `file-ref:${gameplayFile}`, review_public_key_ref: `file-ref:${publicKey}`,
    });
    const staged = { kind: 'staged_ios_release_candidate', boundary: 'staged_ios_release_candidate', status: 'passed', marker: 'staged' };
    payload.run.receipts = [{ step_key: 'device.capture', outcome: 'passed', receipt: staged }];
    payload.run.review_audit_receipts = [{
      receipt: { boundary: 'authenticated_gameplay_review', receipt_id: 'grr_1', reviewed_by: 'Batu', reviewed_at: '2026-08-18T12:00:00+00:00', verdict: 'passed', evidence_sha256: sha256, server_signature: 'signature' },
      signed_payload: { device_udid: 'PHONE', bundle_id: 'com.baseardahan.hiddenobj', version: '1.0.0', build_id: '1.2.3', gameplay_state: 'level', evidence_sha256: sha256 },
    }];
    let request; let receivedStaged; let key;
    const exact = { kind: 'exact_release_candidate', local_app_ref: 'file-ref:/evidence/release-candidates/id/App.app', evidence: { lane: 'release', physical: true } };
    const result = executePortalPayload(payload, {
      sha256File: () => sha256,
      finalizeIosReleaseCandidate(value, candidate, releaseDeps) { request = value; receivedStaged = candidate; key = releaseDeps.loadReviewAuthorityPublicKey(); return exact; },
    });
    expect(request).toMatchObject({
      gameDir: '/repo/games/find_the_dog', bundleId: 'com.baseardahan.hiddenobj', version: '1.0.0',
      device: { udid: 'PHONE', name: 'iPhone', platform: 'iOS' },
      attestation: { manifestDigest: manifestSha, sourceSha: sourceRevision },
      env: { VITE_ADMOB_IOS_ENABLED: 'true' },
      gameplayEvidence: { deviceUdid: 'PHONE', bundleId: 'com.baseardahan.hiddenobj', version: '1.0.0', buildId: '1.2.3', state: 'level', path: gameplayFile, sha256, reviewReceipt: payload.run.review_audit_receipts[0].receipt },
    });
    expect(receivedStaged).toBe(staged);
    expect(key).toBe('PUBLIC');
    expect(result).toEqual({ outcome: 'passed', receipt: exact });
  });

  it('blocks unsupported steps and raw or permissive secret files without echoing values', () => {
    expect(executePortalPayload(portalPayload('provider.admob'))).toEqual({ outcome: 'blocked', receipt: { reason: 'unsupported_release_step' } });
    expect(executePortalPayload(portalPayload('device.release', { environment_ref: 'raw-secret' }))).toEqual({ outcome: 'blocked', receipt: { reason: 'invalid_stable_reference' } });
  });

  it('is directly executable and returns a closed blocked receipt', () => {
    const executable = path.resolve('tools/game-release/portal-executor.mjs');
    const result = spawnSync(executable, [], { input: JSON.stringify(portalPayload('provider.admob')), encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ outcome: 'blocked', receipt: { reason: 'unsupported_release_step' } });
    expect(result.stderr).toBe('');
  });

  it.each(runtimeGraph)('fails before payload parsing when runtime layer %s drifts', (relative) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-runtime-graph-'));
    for (const file of ['tools/game-release/portal-executor.mjs', ...runtimeGraph]) {
      const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.resolve(file), target);
    }
    const executable = path.join(root, 'tools/game-release/portal-executor.mjs'); fs.chmodSync(executable, 0o755);
    fs.appendFileSync(path.join(root, relative), '\n// integrity mutation\n');
    const result = spawnSync(executable, [], { input: '{malformed-json', encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ outcome: 'blocked', receipt: { reason: 'executor_integrity_failed' } });
    expect(result.stderr).toBe('');
  });

  it('declares every transitive relative import in the integrity graph', () => {
    const declared = new Set(runtimeGraph);
    for (const relative of runtimeGraph.filter((file) => /\.(?:mjs|js|ts)$/.test(file))) {
      const source = fs.readFileSync(path.resolve(relative), 'utf8').split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n');
      for (const match of source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) {
        const unresolved = path.resolve(path.dirname(relative), match[1]);
        const resolved = [unresolved, `${unresolved}.mjs`, `${unresolved}.js`, `${unresolved}.ts`].find((candidate) => fs.existsSync(candidate));
        const imported = path.relative(process.cwd(), resolved || unresolved);
        expect(declared, `${relative} imports undeclared runtime file ${imported}`).toContain(imported);
      }
    }
  });

  it('rejects an otherwise identical Node executable from an unapproved path before parsing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-node-identity-'));
    const wrapper = fs.readFileSync(path.resolve('tools/game-release/portal-executor.mjs'), 'utf8').replace("executable: '/opt/homebrew/Cellar/node/26.7.0/bin/node'", "executable: '/unapproved/node'");
    const copiedWrapper = path.join(root, 'portal-executor.mjs'); fs.writeFileSync(copiedWrapper, wrapper);
    const result = spawnSync(process.execPath, [copiedWrapper], { input: '{malformed-json', encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ outcome: 'blocked', receipt: { reason: 'executor_integrity_failed' } });
  });
});
