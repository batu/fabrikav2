#!/usr/bin/env node
// One-shot device install with hard gates — born from the 2026-07-20 stale-install
// incident (a piped xcodebuild masked a failure and devicectl happily installed
// the previous App.app). Every step here fails loudly, and the built bundle's
// build-info.json SHA must match HEAD before anything touches the phone.
//
//   node tools/native-shell/install.mjs --game find_the_dog \
//     [--device <udid>] [--team <id>] [--env-file <path>] [--bundle-id <id>]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const game = arg('game');
if (!game) { console.error('install: --game is required'); process.exit(2); }
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const gameDir = path.join(repoRoot, 'games', game);
const device = arg('device', '00008101-000410EC3EF9001E');
const team = arg('team', process.env.DEVELOPMENT_TEAM ?? '42L77JAX72');
const envFile = arg('env-file', path.join(process.env.HOME ?? '', 'fabrika-keys', `ftd-v2.env.ios.local`));
const bundleId = arg('bundle-id', 'com.baseardahan.hiddenobj');

function run(label, file, args, opts = {}) {
  process.stderr.write(`install: ${label}\n`);
  try {
    return execFileSync(file, args, { cwd: gameDir, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  } catch (err) {
    console.error(`install: FAILED at ${label}${err.stdout ? `\n${String(err.stdout).slice(-2000)}` : ''}`);
    process.exit(1);
  }
}

// 1. web build with the real env (env file injected for vite's mode loading)
const env = { ...process.env };
if (fs.existsSync(envFile)) {
  const local = path.join(gameDir, '.env.ios.local');
  fs.copyFileSync(envFile, local);
  process.on('exit', () => fs.rmSync(local, { force: true }));
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
}
run('vite build --mode ios', 'npx', ['vite', 'build', '--mode', 'ios'], { env });

// 2. HEAD vs bundle provenance — the gate that makes stale installs impossible
const head = run('git rev-parse', 'git', ['rev-parse', '--short=10', 'HEAD']).trim();
const distInfo = JSON.parse(fs.readFileSync(path.join(gameDir, 'dist', 'build-info.json'), 'utf8'));
if (distInfo.sha !== head) {
  console.error(`install: FAILED — dist build-info sha ${distInfo.sha} != HEAD ${head}`);
  process.exit(1);
}

// 3. native sync + shell apply + validate
run('cap sync ios', 'npx', ['cap', 'sync', 'ios'], { env });
run('native-shell apply', 'node', [path.join(repoRoot, 'tools', 'native-shell', 'apply.mjs'), '--game', game], { cwd: repoRoot });
run('native-shell validate', 'node', [path.join(repoRoot, 'tools', 'native-shell', 'validate.mjs'), '--game', game], { cwd: repoRoot });

// 4. xcodebuild — output captured whole, success asserted on the marker
const derived = path.join(gameDir, 'ios', 'App', 'build');
const xcOut = run('xcodebuild (Debug, device)', 'xcodebuild', [
  '-project', path.join(gameDir, 'ios', 'App', 'App.xcodeproj'), '-scheme', 'App',
  '-configuration', 'Debug', '-destination', `id=${device}`, '-derivedDataPath', derived,
  '-allowProvisioningUpdates', `DEVELOPMENT_TEAM=${team}`, 'build',
]);
if (!xcOut.includes('** BUILD SUCCEEDED **')) {
  console.error('install: FAILED — xcodebuild did not report BUILD SUCCEEDED');
  process.exit(1);
}

// 5. the BUILT APP's bundled build-info must also match HEAD (kills stale App.app)
const appPath = path.join(derived, 'Build', 'Products', 'Debug-iphoneos', 'App.app');
const appInfo = JSON.parse(fs.readFileSync(path.join(appPath, 'public', 'build-info.json'), 'utf8'));
if (appInfo.sha !== head) {
  console.error(`install: FAILED — App.app carries sha ${appInfo.sha}, HEAD is ${head} (stale product)`);
  process.exit(1);
}

// 6. install + launch
run('devicectl install', 'xcrun', ['devicectl', 'device', 'install', 'app', '--device', device, appPath]);
run('devicectl launch', 'xcrun', ['devicectl', 'device', 'process', 'launch', '--terminate-existing', '--device', device, bundleId]);
process.stderr.write(`install: OK — ${game} ${head}${appInfo.dirty ? ' (dirty tree)' : ''} on device ${device}\n`);
