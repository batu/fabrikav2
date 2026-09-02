import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { parseEnvText } from '../../game-env/src/env.mjs';
import { getGamePolicy } from '../../game-env/src/policies.mjs';
import { validateEnvironment } from '../../game-env/src/validate.mjs';
import { captureIosReleaseCandidate, defaultDependencies, finalizeIosReleaseCandidate } from './ios-release.mjs';
import { buildReleaseManifest } from './manifest.mjs';

const CAPTURE_DEVICE_STEPS = new Set(['device.capture', 'device.release']);
const FINALIZE_DEVICE_STEPS = new Set(['device.finalize', 'device.exact_release']);
const BUILD_STEPS = new Set(['build.release', 'build.diagnostic']);
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;

export function executePortalPayload(payload, dependencies = {}) {
  try {
    const mapped = validatePayload(payload);
    if (BUILD_STEPS.has(mapped.stepKey)) return executeBuild(mapped, dependencies);
    if (CAPTURE_DEVICE_STEPS.has(mapped.stepKey)) return executeDeviceCapture(mapped, dependencies);
    if (FINALIZE_DEVICE_STEPS.has(mapped.stepKey)) return executeExactDevice(mapped, dependencies);
    return blocked('unsupported_release_step');
  } catch (error) {
    return blocked(error?.code || 'invalid_executor_payload');
  }
}

function executeBuild(mapped, dependencies) {
  const env = readEnvironment(mapped.settings.environment_ref);
  const build = dependencies.buildReleaseManifest || buildReleaseManifest;
  const result = build({
    repoRoot: mapped.repoRoot, game: 'find_the_dog', expectedSourceRevision: mapped.sourceRevision, platform: 'ios',
  }, {
    validateEnvironment: ({ gameRoot, mode }) => validateEnvironment({ gameRoot, mode, policy: getGamePolicy('find_the_dog'), environment: env }),
  });
  if (result?.ok !== true || result.bundleId !== mapped.bundleId || result.sourceRevision !== mapped.sourceRevision) throw coded('build_diagnostic_failed');
  return { outcome: 'passed', receipt: {
    boundary: 'build_diagnostic', status: 'passed', manifest_sha256: mapped.manifestSha,
    source_revision: mapped.sourceRevision, bundle_id: mapped.bundleId, platform: 'ios',
  } };
}

function executeDeviceCapture(mapped, dependencies) {
  const env = readEnvironment(mapped.settings.environment_ref, true);
  const evidencePath = resolveFileRef(mapped.settings.evidence_ref, { mustExist: false });
  const execute = dependencies.captureIosReleaseCandidate || captureIosReleaseCandidate;
  const receipt = execute(baseReleaseRequest(mapped, env, { evidencePath }), dependencies.releaseDependencies || defaultDependencies());
  if (!plainObject(receipt) || receipt.kind !== 'staged_ios_release_candidate' || receipt.status !== 'passed') throw coded('device_capture_failed');
  return { outcome: 'passed', receipt };
}

function executeExactDevice(mapped, dependencies) {
  const env = readEnvironment(mapped.settings.environment_ref, true);
  const gameplayPath = resolveFileRef(mapped.settings.gameplay_evidence_ref, { sensitive: true });
  const publicKeyPath = resolveFileRef(mapped.settings.review_public_key_ref, { sensitive: true });
  const staged = latestStaged(mapped.run);
  const review = latestReview(mapped.run);
  const signed = review.signed_payload;
  const digest = (dependencies.sha256File || sha256File)(gameplayPath);
  if (digest !== signed.evidence_sha256 || review.receipt.evidence_sha256 !== digest) throw coded('review_evidence_mismatch');
  const request = baseReleaseRequest(mapped, env, {
    gameplayEvidence: {
      deviceUdid: signed.device_udid, bundleId: signed.bundle_id, version: signed.version,
      buildId: signed.build_id, state: signed.gameplay_state, path: gameplayPath,
      sha256: signed.evidence_sha256, reviewReceipt: review.receipt,
    },
  });
  const execute = dependencies.finalizeIosReleaseCandidate || finalizeIosReleaseCandidate;
  const releaseDependencies = dependencies.releaseDependencies || {
    ...defaultDependencies(),
    loadReviewAuthorityPublicKey: () => fs.readFileSync(publicKeyPath, 'utf8'),
  };
  return { outcome: 'passed', receipt: closePortalExactReceipt(execute(request, staged, releaseDependencies)) };
}

function baseReleaseRequest(mapped, env, extra = {}) {
  return {
    command: 'ios-release', platform: 'ios', gameDir: path.join(mapped.repoRoot, 'games', 'find_the_dog'),
    bundleId: mapped.bundleId, version: mapped.version,
    device: { udid: mapped.device.udid, name: mapped.device.name, platform: 'iOS' },
    attestation: { manifestDigest: mapped.manifestSha, sourceSha: mapped.sourceRevision }, env,
    developmentTeam: optionalString(mapped.settings.development_team),
    maxBundleBytes: positiveInteger(mapped.settings.max_artifact_bytes, 500_000_000),
    ...extra,
  };
}

function closePortalExactReceipt(receipt) {
  if (!plainObject(receipt) || receipt.kind !== 'exact_release_candidate') throw coded('exact_release_failed');
  const { post_launch_capture: _postLaunchCapture, ...closed } = receipt;
  if (plainObject(closed.evidence)) {
    const { paths: _paths, ...evidence } = closed.evidence;
    closed.evidence = evidence;
  }
  return closed;
}

function validatePayload(payload) {
  if (!plainObject(payload) || !plainObject(payload.run) || !plainObject(payload.step) || !plainObject(payload.settings)) throw coded('invalid_executor_payload');
  const run = payload.run; const manifest = run.manifest; const game = manifest?.game; const device = manifest?.device;
  if (!plainObject(manifest) || !plainObject(game) || !plainObject(device)) throw coded('invalid_executor_payload');
  if (!SHA64.test(run.manifest_sha256 || '') || !SHA40.test(game.source_revision || '')) throw coded('invalid_release_identity');
  if (game.slug !== 'find-the-dog' || game.platform !== 'ios' || game.build_target !== 'release') throw coded('unsupported_release_identity');
  if (!game.bundle_id || !game.version || !device.udid) throw coded('invalid_release_identity');
  const repoRoot = payload.settings.repo_root;
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) throw coded('invalid_stable_reference');
  return { run, stepKey: String(payload.step.step_key || ''), settings: payload.settings, repoRoot: path.resolve(repoRoot), manifestSha: run.manifest_sha256, sourceRevision: game.source_revision, bundleId: game.bundle_id, version: game.version, device };
}

function latestReview(run) {
  const reviews = Array.isArray(run.review_audit_receipts) ? run.review_audit_receipts : [];
  const review = reviews.at(-1);
  if (!plainObject(review?.receipt) || !plainObject(review?.signed_payload)) throw coded('authenticated_review_unavailable');
  const signed = review.signed_payload;
  const expected = run.manifest;
  if (signed.device_udid !== expected.device.udid || signed.bundle_id !== expected.game.bundle_id || signed.version !== expected.game.version || !signed.build_id || !signed.gameplay_state || !SHA64.test(signed.evidence_sha256 || '')) throw coded('review_identity_mismatch');
  return review;
}

function latestStaged(run) {
  const receipts = Array.isArray(run.receipts) ? run.receipts : [];
  const staged = receipts.map((entry) => entry?.receipt).findLast((receipt) => receipt?.kind === 'staged_ios_release_candidate' && receipt?.status === 'passed');
  if (!plainObject(staged)) throw coded('staged_release_candidate_unavailable');
  return staged;
}

function readEnvironment(reference, required = false) {
  if (!reference && !required) return {};
  const file = resolveFileRef(reference, { sensitive: true });
  return Object.fromEntries(parseEnvText(fs.readFileSync(file, 'utf8'), { fileName: 'release environment' }).values);
}

function resolveFileRef(reference, { mustExist = true, sensitive = false } = {}) {
  if (typeof reference !== 'string' || !reference.startsWith('file-ref:')) throw coded('invalid_stable_reference');
  const file = reference.slice('file-ref:'.length);
  if (!path.isAbsolute(file)) throw coded('invalid_stable_reference');
  if (!mustExist) return path.resolve(file);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (sensitive && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))) throw coded('unsafe_external_file');
  return path.resolve(file);
}

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function positiveInteger(value, fallback) { return Number.isInteger(value) && value > 0 ? value : fallback; }
function optionalString(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function plainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function blocked(reason) { return { outcome: 'blocked', receipt: { reason } }; }
function coded(code) { return Object.assign(new Error(code), { code }); }
