import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { assertPhysicalIosDevice } from '../../verify-device/src/devices.mjs';
import { redactReleaseReceipt } from '../../verify-device/src/summary.mjs';

const FORBIDDEN = [/3940256099942544/, /applovin/i, /VITE_ENABLE_TEST_HARNESS/, /VITE_INSITU_TOUR/];

export function validateReleaseEnvironment(env = {}) {
  if (truthy(env.VITE_ENABLE_TEST_HARNESS)) throw new Error('release mode refuses the test harness');
  if (env.VITE_INSITU_TOUR && String(env.VITE_INSITU_TOUR).trim()) throw new Error('release mode refuses the insitu tour');
}

export function deriveReleaseBuildId(manifestDigest, sourceSha) {
  if (!/^[a-f0-9]{64}$/.test(manifestDigest || '') || !/^[a-f0-9]{40}$/.test(sourceSha || '')) throw new Error('cannot derive build ID from invalid release identity');
  let value = BigInt(`0x${crypto.createHash('sha256').update(`${manifestDigest}:${sourceSha}`).digest('hex').slice(0, 16)}`);
  const major = Number(value % 9999n) + 1;
  value /= 9999n;
  const minor = Number(value % 100n);
  value /= 100n;
  const patch = Number(value % 100n);
  return `${major}.${minor}.${patch}`;
}

export function verifyExactInstall({ expected, installed, evidence }) {
  if (evidence?.lane !== 'release' || evidence?.physical !== true) throw new Error('exact verification requires physical harness-free release evidence');
  const expectedBuildId = deriveReleaseBuildId(expected.manifestDigest, expected.sourceSha);
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
  const buildId = deriveReleaseBuildId(request.attestation.manifestDigest, request.attestation.sourceSha);
  deps.verifySource(request);
  deps.buildWeb(request);
  deps.syncNative(request);
  deps.applyNative(request);
  deps.validateNative(request);
  deps.stampAttestation({ ...request.attestation, buildId }, request);
  const built = deps.buildSignedApp(request);
  const artifact = inspectBundle(built.appPath, request.maxBundleBytes);
  deps.uninstallApp(request);
  deps.installApp({ ...request, appPath: built.appPath });
  const launch = deps.launchApp(request);
  const installedApp = deps.queryInstalledApp(request);
  const captured = deps.captureAttestation(request);
  verifyExactInstall({ expected: { ...request.attestation, bundleId: request.bundleId, version: request.version }, installed: captured.installedApplication, evidence: captured });
  if (!captured.path || !captured.gameplayState) throw new Error('physical release evidence path and gameplay state are required');
  deps.verifySource(request);
  const receiptAttestation = {
    manifest_sha256: request.attestation.manifestDigest,
    source_revision: request.attestation.sourceSha,
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
    captured: { bundle_id: captured.installedApplication.bundleId, version: captured.installedApplication.version, build_id: captured.installedApplication.buildId, evidence_path: captured.path, evidence_sha256: captured.sha256, gameplay_state: captured.gameplayState },
    launch: { succeeded: launch?.launched === true },
    evidence: { lane: captured.lane, physical: captured.physical, paths: [captured.path] },
  });
}

function validateRequest(request) {
  if (!request?.gameDir || !request.bundleId || !request.version) throw new Error('gameDir, bundleId, and version are required');
  for (const [key, pattern] of [['manifestDigest', /^[a-f0-9]{64}$/], ['sourceSha', /^[a-f0-9]{40}$/]]) {
    if (!pattern.test(request.attestation?.[key] || '')) throw new Error(`invalid release attestation ${key}`);
  }
}

function inspectBundle(appPath, maxBytes = 250 * 1024 * 1024) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  for (const file of walk(appPath)) {
    const relative = path.relative(appPath, file);
    const content = fs.readFileSync(file);
    size += content.length;
    hash.update(relative); hash.update('\0'); hash.update(content);
    if (FORBIDDEN.some((pattern) => pattern.test(relative) || pattern.test(content.toString('utf8')))) throw new Error(`release bundle is catalog-contaminated: ${relative}`);
  }
  if (size > maxBytes) throw new Error(`release bundle is oversized (${size} > ${maxBytes})`);
  return { path: appPath, sha256: hash.digest('hex'), sizeBytes: size };
}

function walk(root) {
  if (!fs.existsSync(root)) throw new Error(`signed app bundle is missing: ${root}`);
  return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? walk(file) : entry.isFile() ? [file] : [];
  });
}

function truthy(value) { return /^(1|true|yes|on)$/i.test(String(value || '').trim()); }

export function defaultDependencies({ execImpl = execFileSync, spawnImpl = spawnSync } = {}) {
  const run = (file, args, options = {}) => execImpl(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...options });
  const repoRoot = (request) => path.resolve(request.gameDir, '..', '..');
  const query = (request) => {
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
    if (!app) throw new Error('installed application was not returned by devicectl');
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
    verifySource(request) {
      const root = repoRoot(request);
      if (run('git', ['rev-parse', 'HEAD'], { cwd: root, env: childEnv(request) }).trim() !== request.attestation.sourceSha) throw new Error('release source revision changed after approval');
      if (run('git', ['status', '--porcelain'], { cwd: root, env: childEnv(request) }).trim()) throw new Error('release source worktree is dirty');
    },
    buildWeb(request) { run('npm', ['run', 'build:ios'], { cwd: request.gameDir, env: childEnv(request) }); },
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
      const settings = request.developmentTeam ? ['-allowProvisioningUpdates', `DEVELOPMENT_TEAM=${request.developmentTeam}`] : [];
      run('xcodebuild', ['-project', project, '-scheme', 'App', '-configuration', 'Release', '-destination', `id=${request.device.udid}`, '-derivedDataPath', derived, 'build', ...settings]);
      const appPath = path.join(derived, 'Build', 'Products', 'Release-iphoneos', 'App.app');
      return { appPath, signingIdentity: inspectSignedIosApp(appPath, { expectedTeam: request.developmentTeam, spawnImpl }) };
    },
    uninstallApp(request) { run('xcrun', ['devicectl', 'device', 'uninstall', 'app', '--device', request.device.udid, request.bundleId]); },
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
