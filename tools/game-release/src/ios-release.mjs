import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { assertPhysicalIosDevice } from '../../verify-device/src/devices.mjs';
import { redactReleaseReceipt } from '../../verify-device/src/summary.mjs';

const FORBIDDEN = [/3940256099942544/, /applovin/i, /VITE_ENABLE_TEST_HARNESS/, /VITE_INSITU_TOUR/];
const SHA256 = /^[a-f0-9]{64}$/;

export function validateReleaseEnvironment(env = {}) {
  if (truthy(env.VITE_ENABLE_TEST_HARNESS)) throw new Error('release mode refuses the test harness');
  if (env.VITE_INSITU_TOUR && String(env.VITE_INSITU_TOUR).trim()) throw new Error('release mode refuses the insitu tour');
}

export function deriveReleaseBuildId(manifestDigest, sourceSha, artifactPayloadSha256 = '0'.repeat(64)) {
  if (!/^[a-f0-9]{64}$/.test(manifestDigest || '') || !/^[a-f0-9]{40}$/.test(sourceSha || '')) throw new Error('cannot derive build ID from invalid release identity');
  if (!/^[a-f0-9]{64}$/.test(artifactPayloadSha256)) throw new Error('cannot derive build ID from invalid artifact payload digest');
  let value = BigInt(`0x${crypto.createHash('sha256').update(`${manifestDigest}:${sourceSha}:${artifactPayloadSha256}`).digest('hex').slice(0, 16)}`);
  const major = Number(value % 9999n) + 1;
  value /= 9999n;
  const minor = Number(value % 100n);
  value /= 100n;
  const patch = Number(value % 100n);
  return `${major}.${minor}.${patch}`;
}

export function verifyExactInstall({ expected, installed, evidence }) {
  if (evidence?.lane !== 'release' || evidence?.physical !== true) throw new Error('exact verification requires physical harness-free release evidence');
  const expectedBuildId = deriveReleaseBuildId(expected.manifestDigest, expected.sourceSha, expected.artifactPayloadSha256);
  if (installed?.bundleId !== expected.bundleId || installed?.version !== expected.version || installed?.buildId !== expectedBuildId) {
    throw new Error('installed release identity does not match the approved artifact attestation');
  }
  return true;
}

export function executeIosRelease(request, deps) {
  deps ??= defaultDependencies();
  validateRequest(request);
  validateReleaseEnvironment(request.env);
  assertPhysicalIosDevice(request.device);
  deps.verifySource(request);
  deps.buildWeb(request);
  deps.syncNative(request);
  deps.applyNative(request);
  deps.validateNative(request);
  const provisional = deps.buildSignedApp(request);
  const payload = inspectBundle(provisional.appPath, request.maxBundleBytes, { payloadOnly: true });
  const buildId = deriveReleaseBuildId(request.attestation.manifestDigest, request.attestation.sourceSha, payload.sha256);
  deps.stampAttestation({ ...request.attestation, buildId }, request);
  const built = deps.buildSignedApp(request);
  const finalPayload = inspectBundle(built.appPath, request.maxBundleBytes, { payloadOnly: true });
  if (finalPayload.sha256 !== payload.sha256) throw new Error('final signed application payload changed after build ID binding');
  const artifact = inspectBundle(built.appPath, request.maxBundleBytes);
  deps.uninstallApp(request);
  deps.installApp({ ...request, appPath: built.appPath });
  const launch = deps.launchApp(request);
  const installedApp = deps.queryInstalledApp(request);
  const captured = deps.captureAttestation(request);
  verifyExactInstall({ expected: { ...request.attestation, artifactPayloadSha256: payload.sha256, bundleId: request.bundleId, version: request.version }, installed: captured.installedApplication, evidence: captured });
  if (!captured.path || !captured.gameplayState) throw new Error('physical release evidence path and gameplay state are required');
  const gameplay = verifyReviewedGameplayEvidence(request.gameplayEvidence, {
    deviceUdid: request.device.udid, bundleId: request.bundleId, version: request.version, buildId,
  }, deps.loadReviewAuthorityPublicKey());
  deps.verifySource(request);
  const receiptAttestation = {
    manifest_sha256: request.attestation.manifestDigest,
    source_revision: request.attestation.sourceSha,
    artifact_payload_sha256: payload.sha256,
    build_id: buildId,
  };
  return redactReleaseReceipt({
    kind: 'exact_release_candidate',
    manifest_sha256: request.attestation.manifestDigest,
    source_revision: request.attestation.sourceSha,
    bundle_id: request.bundleId,
    version: request.version,
    artifact: { sha256: artifact.sha256, size_bytes: artifact.sizeBytes, contaminated_entries: [] },
    build: { platform: 'ios', harness_enabled: false, insitu_tour: false, simulator: false, browser: false, signing_identity: built.signingIdentity },
    device: { udid: request.device.udid, physical: true },
    attestation: receiptAttestation,
    installed: { bundle_id: installedApp.bundleId, version: installedApp.version, build_id: installedApp.buildId },
    captured: { bundle_id: gameplay.bundleId, version: gameplay.version, build_id: gameplay.buildId, evidence_path: gameplay.path, evidence_sha256: gameplay.sha256, gameplay_state: gameplay.state, reviewed_by: gameplay.reviewReceipt.reviewed_by, review_receipt: gameplay.reviewReceipt },
    post_launch_capture: { evidence_path: captured.path, evidence_sha256: captured.sha256, state: captured.gameplayState },
    launch: { succeeded: launch?.launched === true },
    evidence: { lane: captured.lane, physical: captured.physical, paths: [captured.path] },
  });
}

export function captureIosReleaseCandidate(request, deps) {
  deps ??= defaultDependencies();
  validateRequest(request); validateReleaseEnvironment(request.env); assertPhysicalIosDevice(request.device);
  deps.verifySource(request); deps.buildWeb(request); deps.syncNative(request); deps.applyNative(request); deps.validateNative(request);
  const provisional = deps.buildSignedApp(request);
  const payload = inspectBundle(provisional.appPath, request.maxBundleBytes, { payloadOnly: true });
  const buildId = deriveReleaseBuildId(request.attestation.manifestDigest, request.attestation.sourceSha, payload.sha256);
  deps.stampAttestation({ ...request.attestation, buildId }, request);
  const built = deps.buildSignedApp(request);
  const finalPayload = inspectBundle(built.appPath, request.maxBundleBytes, { payloadOnly: true });
  if (finalPayload.sha256 !== payload.sha256) throw new Error('final signed application payload changed after build ID binding');
  const artifact = inspectBundle(built.appPath, request.maxBundleBytes);
  const stagedAppPath = deps.stageSignedApp(built.appPath, request);
  const stagedPayload = inspectBundle(stagedAppPath, request.maxBundleBytes, { payloadOnly: true });
  const stagedArtifact = inspectBundle(stagedAppPath, request.maxBundleBytes);
  if (stagedPayload.sha256 !== payload.sha256 || stagedArtifact.sha256 !== artifact.sha256 || stagedArtifact.sizeBytes !== artifact.sizeBytes) throw new Error('durable staged application does not match signed build');
  deps.uninstallApp(request); deps.installApp({ ...request, appPath: stagedAppPath });
  const launch = deps.launchApp(request); const installed = deps.queryInstalledApp(request); const captured = deps.captureAttestation(request);
  const expected = { ...request.attestation, artifactPayloadSha256: payload.sha256, bundleId: request.bundleId, version: request.version };
  verifyExactInstall({ expected, installed, evidence: captured });
  verifyExactInstall({ expected, installed: captured.installedApplication, evidence: captured });
  if (launch?.launched !== true || !captured.path || !captured.sha256) throw new Error('physical post-launch diagnostic capture is required');
  deps.verifySource(request);
  return redactReleaseReceipt({
    kind: 'staged_ios_release_candidate', boundary: 'staged_ios_release_candidate', status: 'passed',
    manifest_sha256: request.attestation.manifestDigest, source_revision: request.attestation.sourceSha,
    bundle_id: request.bundleId, version: request.version,
    artifact: { sha256: artifact.sha256, size_bytes: artifact.sizeBytes, contaminated_entries: [] },
    build: { platform: 'ios', harness_enabled: false, insitu_tour: false, simulator: false, browser: false, signing_identity: built.signingIdentity },
    device: { udid: request.device.udid, physical: true },
    attestation: { manifest_sha256: request.attestation.manifestDigest, source_revision: request.attestation.sourceSha, artifact_payload_sha256: payload.sha256, build_id: buildId },
    installed: { bundle_id: installed.bundleId, version: installed.version, build_id: installed.buildId },
    diagnostic_capture: { evidence_path: captured.path, evidence_sha256: captured.sha256, state: captured.gameplayState },
    launch: { succeeded: launch?.launched === true }, local_app_ref: `file-ref:${stagedAppPath}`,
  });
}

export function finalizeIosReleaseCandidate(request, staged, deps) {
  deps ??= defaultDependencies();
  validateRequest(request); validateReleaseEnvironment(request.env); assertPhysicalIosDevice(request.device);
  validateStaged(staged, request); deps.verifySource(request);
  const appPath = staged.local_app_ref.slice('file-ref:'.length);
  const payload = inspectBundle(appPath, request.maxBundleBytes, { payloadOnly: true });
  const artifact = inspectBundle(appPath, request.maxBundleBytes);
  if (payload.sha256 !== staged.attestation.artifact_payload_sha256 || artifact.sha256 !== staged.artifact.sha256 || artifact.sizeBytes !== staged.artifact.size_bytes) throw new Error('staged release artifact changed before finalization');
  const signingIdentity = deps.inspectStagedApp(appPath, request);
  if (signingIdentity !== staged.build.signing_identity) throw new Error('staged release signing identity changed');
  const installed = deps.queryInstalledApp(request);
  verifyExactInstall({ expected: { ...request.attestation, artifactPayloadSha256: payload.sha256, bundleId: request.bundleId, version: request.version }, installed, evidence: { lane: 'release', physical: true } });
  const gameplay = verifyReviewedGameplayEvidence(request.gameplayEvidence, { deviceUdid: request.device.udid, bundleId: request.bundleId, version: request.version, buildId: staged.attestation.build_id }, deps.loadReviewAuthorityPublicKey());
  deps.verifySource(request);
  return redactReleaseReceipt({
    kind: 'exact_release_candidate', manifest_sha256: request.attestation.manifestDigest, source_revision: request.attestation.sourceSha,
    bundle_id: request.bundleId, version: request.version, artifact: staged.artifact, build: staged.build, device: staged.device,
    attestation: staged.attestation, installed: { bundle_id: installed.bundleId, version: installed.version, build_id: installed.buildId },
    captured: { bundle_id: gameplay.bundleId, version: gameplay.version, build_id: gameplay.buildId, evidence_path: gameplay.path, evidence_sha256: gameplay.sha256, gameplay_state: gameplay.state, reviewed_by: gameplay.reviewReceipt.reviewed_by, review_receipt: gameplay.reviewReceipt },
    launch: { succeeded: staged.launch?.succeeded === true }, evidence: { lane: 'release', physical: true },
    local_app_ref: staged.local_app_ref,
  });
}

function validateStaged(staged, request) {
  const expectedBuildId = deriveReleaseBuildId(request.attestation.manifestDigest, request.attestation.sourceSha, staged?.attestation?.artifact_payload_sha256);
  const appPath = typeof staged?.local_app_ref === 'string' ? path.resolve(staged.local_app_ref.slice('file-ref:'.length)) : '';
  const candidateRoot = typeof staged?.diagnostic_capture?.evidence_path === 'string'
    ? path.join(path.dirname(path.resolve(staged.diagnostic_capture.evidence_path)), 'release-candidates') : '';
  const relativeApp = candidateRoot ? path.relative(candidateRoot, appPath) : '..';
  const safeLocalApp = relativeApp && relativeApp !== '..' && !relativeApp.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeApp)
    && appPath.endsWith('.app') && fs.existsSync(appPath) && fs.lstatSync(appPath).isDirectory() && !fs.lstatSync(appPath).isSymbolicLink();
  const identityMatches = staged?.kind === 'staged_ios_release_candidate'
    && staged.boundary === 'staged_ios_release_candidate' && staged.status === 'passed'
    && staged.manifest_sha256 === request.attestation.manifestDigest && staged.source_revision === request.attestation.sourceSha
    && staged.bundle_id === request.bundleId && staged.version === request.version
    && staged.device?.udid === request.device.udid && staged.device?.physical === true
    && staged.attestation?.manifest_sha256 === request.attestation.manifestDigest
    && staged.attestation?.source_revision === request.attestation.sourceSha
    && staged.attestation?.build_id === expectedBuildId
    && staged.installed?.bundle_id === request.bundleId && staged.installed?.version === request.version
    && staged.installed?.build_id === expectedBuildId
    && staged.launch?.succeeded === true
    && typeof staged.diagnostic_capture?.evidence_path === 'string' && staged.diagnostic_capture.evidence_path.length > 0
    && SHA256.test(staged.diagnostic_capture?.evidence_sha256 || '')
    && staged.diagnostic_capture?.state === 'post_launch_device_capture'
    && SHA256.test(staged.artifact?.sha256 || '') && Number.isInteger(staged.artifact?.size_bytes) && staged.artifact.size_bytes > 0
    && Array.isArray(staged.artifact?.contaminated_entries) && staged.artifact.contaminated_entries.length === 0
    && typeof staged.build?.signing_identity === 'string' && staged.build.signing_identity.length > 0
    && staged.build?.platform === 'ios' && staged.build.harness_enabled === false && staged.build.insitu_tour === false
    && staged.build.simulator === false && staged.build.browser === false
    && staged.local_app_ref?.startsWith('file-ref:/') && safeLocalApp;
  if (!identityMatches) throw new Error('staged release candidate does not match approved release');
}

function validateRequest(request) {
  if (!request?.gameDir || !request.bundleId || !request.version) throw new Error('gameDir, bundleId, and version are required');
  for (const [key, pattern] of [['manifestDigest', /^[a-f0-9]{64}$/], ['sourceSha', /^[a-f0-9]{40}$/]]) {
    if (!pattern.test(request.attestation?.[key] || '')) throw new Error(`invalid release attestation ${key}`);
  }
}

export function inspectBundle(appPath, maxBytes = 250 * 1024 * 1024, { payloadOnly = false, execImpl = execFileSync } = {}) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  for (const entry of walk(appPath)) {
    const { file, type } = entry;
    const relative = path.relative(appPath, file);
    if (payloadOnly && (relative.startsWith('_CodeSignature/') || relative === 'embedded.mobileprovision')) continue;
    const rawContent = type === 'symlink' ? Buffer.from(fs.readlinkSync(file)) : fs.readFileSync(file);
    const hashContent = payloadOnly && relative === 'Info.plist' ? canonicalInfoPlist(file, execImpl) : rawContent;
    size += rawContent.length;
    hash.update(type); hash.update('\0'); hash.update(relative); hash.update('\0'); hash.update(hashContent);
    if (FORBIDDEN.some((pattern) => pattern.test(relative) || pattern.test(rawContent.toString('utf8')))) throw new Error(`release bundle is catalog-contaminated: ${relative}`);
  }
  if (size > maxBytes) throw new Error(`release bundle is oversized (${size} > ${maxBytes})`);
  return { path: appPath, sha256: hash.digest('hex'), sizeBytes: size };
}

function canonicalInfoPlist(file, execImpl) {
  let parsed;
  try {
    const json = execImpl('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    parsed = JSON.parse(json);
  } catch {
    throw new Error('release Info.plist could not be canonicalized');
  }
  delete parsed.CFBundleVersion;
  return Buffer.from(canonicalJson(parsed));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function reviewReceiptPayload(evidence) {
  const receipt = evidence?.reviewReceipt || {};
  return canonicalJson({
    boundary: receipt.boundary,
    receipt_id: receipt.receipt_id,
    reviewed_by: receipt.reviewed_by,
    reviewed_at: receipt.reviewed_at,
    verdict: receipt.verdict,
    evidence_sha256: receipt.evidence_sha256,
    device_udid: evidence?.deviceUdid,
    bundle_id: evidence?.bundleId,
    version: evidence?.version,
    build_id: evidence?.buildId,
    gameplay_state: evidence?.state,
  });
}

export function verifyReviewedGameplayEvidence(evidence, expected, authorityPublicKey) {
  const receipt = evidence?.reviewReceipt;
  if (!receipt || receipt.boundary !== 'authenticated_gameplay_review' || !receipt.receipt_id || !receipt.reviewed_by) throw new Error('authenticated gameplay review receipt is required');
  if (receipt.verdict !== 'passed' || !/^\d{4}-\d{2}-\d{2}T/.test(receipt.reviewed_at || '') || !Number.isFinite(Date.parse(receipt.reviewed_at))) throw new Error('gameplay review verdict or timestamp is invalid');
  if (evidence.deviceUdid !== expected.deviceUdid || evidence.bundleId !== expected.bundleId || evidence.version !== expected.version || evidence.buildId !== expected.buildId) throw new Error('reviewed gameplay evidence identity does not match the installed candidate');
  if (!evidence.path || !fs.existsSync(evidence.path) || fs.statSync(evidence.path).size <= 0) throw new Error('reviewed gameplay evidence artifact is missing');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(evidence.path)).digest('hex');
  if (sha256 !== evidence.sha256 || sha256 !== receipt.evidence_sha256 || !evidence.state) throw new Error('reviewed gameplay evidence digest or state is invalid');
  let valid = false;
  try {
    const key = authorityPublicKey?.type === 'public' ? authorityPublicKey : crypto.createPublicKey(authorityPublicKey);
    const signature = /^[A-Za-z0-9+/]{86}==$/.test(receipt.server_signature || '') ? Buffer.from(receipt.server_signature, 'base64') : Buffer.alloc(0);
    valid = key.asymmetricKeyType === 'ed25519' && signature.length === 64 && crypto.verify(null, Buffer.from(reviewReceiptPayload(evidence)), key, signature);
  } catch {}
  if (!valid) throw new Error('gameplay review receipt signature is invalid');
  return { ...evidence, sha256, reviewReceipt: { ...receipt } };
}

function walk(root) {
  if (!fs.existsSync(root)) throw new Error(`signed app bundle is missing: ${root}`);
  return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? walk(file) : entry.isFile() ? [{ file, type: 'file' }] : entry.isSymbolicLink() ? [{ file, type: 'symlink' }] : [];
  });
}

function truthy(value) { return /^(1|true|yes|on)$/i.test(String(value || '').trim()); }

export function defaultDependencies({ execImpl = execFileSync, spawnImpl = spawnSync } = {}) {
  const run = (file, args, options = {}) => execImpl(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...options });
  const repoRoot = (request) => path.resolve(request.gameDir, '..', '..');
  const query = (request, { required = true } = {}) => {
    const temporary = fs.mkdtempSync(path.join(request.temporaryDirectory || '/tmp', 'ftd-release-device-'));
    fs.chmodSync(temporary, 0o700);
    const output = path.join(temporary, 'apps.json');
    let json;
    try {
      run('xcrun', ['devicectl', 'device', 'info', 'apps', '--device', request.device.udid, '--columns', '*', '--json-output', output]);
      json = JSON.parse(fs.readFileSync(output, 'utf8'));
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
    const candidates = collectObjects(json);
    const app = candidates.find((value) => [value.bundleIdentifier, value.bundleId].includes(request.bundleId));
    if (!app) {
      if (required) throw new Error('installed application was not returned by devicectl');
      return null;
    }
    return {
      bundleId: app.bundleIdentifier || app.bundleId,
      version: app.version || app.marketingVersion || app.CFBundleShortVersionString,
      buildId: String(app.bundleVersion || app.buildVersion || app.CFBundleVersion || ''),
    };
  };
  const childEnv = (request) => Object.fromEntries(Object.entries({
    ...request.env,
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    DEVELOPER_DIR: process.env.DEVELOPER_DIR,
    LANG: 'C', LC_ALL: 'C',
  }).filter(([, value]) => value !== undefined));
  return {
    stageSignedApp(appPath, request) {
      if (!request.evidencePath) throw new Error('release evidence path is required for durable candidate storage');
      const candidateRoot = path.join(path.dirname(path.resolve(request.evidencePath)), 'release-candidates', crypto.randomUUID());
      fs.mkdirSync(candidateRoot, { recursive: true, mode: 0o700 });
      const stagedAppPath = path.join(candidateRoot, path.basename(appPath));
      fs.cpSync(appPath, stagedAppPath, { recursive: true, dereference: false, errorOnExist: true, force: false, preserveTimestamps: true });
      return stagedAppPath;
    },
    inspectStagedApp(appPath, request) { return inspectSignedIosApp(appPath, { expectedTeam: request.developmentTeam, spawnImpl }); },
    loadReviewAuthorityPublicKey() {
      const file = process.env.BASEGAMELAB_REVIEW_AUTHORITY_PUBLIC_KEY_PATH;
      if (!file || !path.isAbsolute(file)) throw new Error('review authority public key path is not configured');
      const stat = fs.statSync(file);
      if (!stat.isFile() || (stat.mode & 0o022) !== 0) throw new Error('review authority public key must be a non-writable regular file');
      return fs.readFileSync(file, 'utf8');
    },
    verifySource(request) {
      const root = repoRoot(request);
      if (run('git', ['rev-parse', 'HEAD'], { cwd: root, env: childEnv(request) }).trim() !== request.attestation.sourceSha) throw new Error('release source revision changed after approval');
      if (run('git', ['status', '--porcelain'], { cwd: root, env: childEnv(request) }).trim()) throw new Error('release source worktree is dirty');
    },
    buildWeb(request) {
      const root = repoRoot(request);
      run('node', ['tools/patch-gameanalytics-persistence.mjs', '--verify'], { cwd: root, env: childEnv(request) });
      run('npm', ['run', 'build:ios'], { cwd: request.gameDir, env: childEnv(request) });
    },
    syncNative(request) {
      if (!fs.existsSync(path.join(request.gameDir, 'ios'))) run('npx', ['cap', 'add', 'ios'], { cwd: request.gameDir, env: childEnv(request) });
      run('npx', ['cap', 'sync', 'ios'], { cwd: request.gameDir, env: childEnv(request) });
    },
    applyNative(request) { run('node', ['tools/native-shell/apply.mjs', '--game', path.basename(request.gameDir)], { cwd: repoRoot(request), env: { ...request.env, PATH: process.env.PATH } }); },
    validateNative(request) { run('node', ['tools/native-shell/validate.mjs', '--game', path.basename(request.gameDir)], { cwd: repoRoot(request), env: { ...request.env, PATH: process.env.PATH } }); },
    stampAttestation(attestation, request) {
      const plist = path.join(request.gameDir, 'ios', 'App', 'App', 'Info.plist');
      for (const [key, value] of Object.entries({ CFBundleVersion: attestation.buildId })) {
        try { run('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist]); } catch {}
        run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist]);
      }
    },
    buildSignedApp(request) {
      const derived = path.join(request.gameDir, 'ios', 'App', 'release-build');
      const project = path.join(request.gameDir, 'ios', 'App', 'App.xcodeproj');
      const settings = [`MARKETING_VERSION=${request.version}`];
      if (request.developmentTeam) settings.push('-allowProvisioningUpdates', `DEVELOPMENT_TEAM=${request.developmentTeam}`);
      run('xcodebuild', ['-project', project, '-scheme', 'App', '-configuration', 'Release', '-destination', `id=${request.device.udid}`, '-derivedDataPath', derived, 'build', ...settings]);
      const appPath = path.join(derived, 'Build', 'Products', 'Release-iphoneos', 'App.app');
      return { appPath, signingIdentity: inspectSignedIosApp(appPath, { expectedTeam: request.developmentTeam, spawnImpl }) };
    },
    uninstallApp(request) {
      if (query(request, { required: false })) run('xcrun', ['devicectl', 'device', 'uninstall', 'app', '--device', request.device.udid, request.bundleId]);
    },
    installApp(request) { run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', request.device.udid, request.appPath]); },
    launchApp(request) { run('xcrun', ['devicectl', 'device', 'process', 'launch', '--terminate-existing', '--device', request.device.udid, request.bundleId]); return { launched: true }; },
    queryInstalledApp: query,
    captureAttestation(request) {
      if (!request.evidencePath) throw new Error('release evidence path is required');
      fs.mkdirSync(path.dirname(request.evidencePath), { recursive: true, mode: 0o700 });
      run('idevicescreenshot', ['-u', request.device.udid, request.evidencePath]);
      if (!fs.existsSync(request.evidencePath) || fs.statSync(request.evidencePath).size <= 0) throw new Error('physical release screenshot was not captured');
      const app = query(request);
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(request.evidencePath)).digest('hex');
      return { installedApplication: app, lane: 'release', physical: true, path: request.evidencePath, sha256, gameplayState: 'post_launch_device_capture' };
    },
  };
}

export function inspectSignedIosApp(appPath, { expectedTeam, spawnImpl = spawnSync } = {}) {
  const verify = spawnImpl('codesign', ['--verify', '--deep', '--strict', appPath], { encoding: 'utf8' });
  if (verify.status !== 0) throw new Error('signed application failed codesign verification');
  const details = spawnImpl('codesign', ['-d', '--verbose=4', appPath], { encoding: 'utf8' });
  if (details.status !== 0) throw new Error('signed application identity could not be read');
  const text = `${details.stdout || ''}\n${details.stderr || ''}`;
  const authority = /^Authority=(.+)$/m.exec(text)?.[1]?.trim();
  const team = /^TeamIdentifier=(.+)$/m.exec(text)?.[1]?.trim();
  if (!authority || !team) throw new Error('signed application has no authority or team identifier');
  if (expectedTeam && team !== expectedTeam) throw new Error('signed application team does not match the approved team');
  return `${authority} [${team}]`;
}

function collectObjects(value) {
  if (Array.isArray(value)) return value.flatMap(collectObjects);
  if (!value || typeof value !== 'object') return [];
  return [value, ...Object.values(value).flatMap(collectObjects)];
}
