#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hardwareUdid = process.env.MARBLE_RUN_HARDWARE_UDID ?? '00008101-000410EC3EF9001E';
const coreDeviceId = process.env.MARBLE_RUN_CORE_DEVICE_ID ?? '2D894791-A5A3-58BE-9C88-AE0AF08B8C09';
const bundleId = 'com.basegamelab.marblerun';
const derivedData = process.env.MARBLE_RUN_DERIVED_DATA ?? '/private/tmp/marble-run-optimize-dd';
const levels = process.env.MARBLE_RUN_PROFILE_LEVELS ?? '1,13,20';
const timeoutMs = Number(process.env.MARBLE_RUN_PROFILE_TIMEOUT_MS ?? 180_000);

const env = {
  ...process.env,
  VITE_ENABLE_TEST_HARNESS: 'true',
  VITE_PERF_PROBE_LEVELS: levels,
  VITE_PLAYTHROUGH_LEVELS: '',
  VITE_PROBE_TAP_LEVELS: '',
  VITE_SDK_VERIFIER_AUTOMOUNT: '',
  VITE_SDK_VERIFIER_AUTOPRELOAD: '',
  VITE_SDK_VERIFIER_AUTOCRASH: '',
};

function run(label, file, args, options = {}) {
  process.stderr.write(`[profile] ${label}\n`);
  return execFileSync(file, args, {
    cwd: gameDir,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  });
}

run('web build', 'npm', ['run', 'build']);
run('native sync', 'npm', ['run', 'ios:sync']);
const buildOutput = run('signed iPhone build', 'xcodebuild', [
  '-project', 'ios/App/App.xcodeproj',
  '-scheme', 'App',
  '-configuration', 'Debug',
  '-destination', `id=${hardwareUdid}`,
  '-derivedDataPath', derivedData,
  '-allowProvisioningUpdates',
  'build',
]);
if (!buildOutput.includes('** BUILD SUCCEEDED **')) throw new Error('xcodebuild omitted BUILD SUCCEEDED');

const appPath = path.join(derivedData, 'Build', 'Products', 'Debug-iphoneos', 'App.app');
if (!fs.existsSync(appPath)) throw new Error(`built app missing: ${appPath}`);
run('install probe app', 'xcrun', ['devicectl', 'device', 'install', 'app', '--device', coreDeviceId, appPath]);

process.stderr.write('[profile] launch and collect device console\n');
const launch = spawn('xcrun', [
  'devicectl', 'device', 'process', 'launch',
  '--device', coreDeviceId,
  '--terminate-existing',
  '--console',
  bundleId,
], { cwd: gameDir, env, stdio: ['ignore', 'pipe', 'pipe'] });

let output = '';
const marker = '[perf] results:';
const samples = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    launch.kill('SIGTERM');
    reject(new Error(`timed out after ${timeoutMs}ms waiting for ${marker}`));
  }, timeoutMs);
  const consume = (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stderr.write(text);
    const markerIndex = output.indexOf(marker);
    if (markerIndex < 0) return;
    const line = output.slice(markerIndex + marker.length).split(/\r?\n/, 1)[0].trim();
    try {
      const parsed = JSON.parse(line);
      clearTimeout(timer);
      launch.kill('SIGTERM');
      resolve(parsed);
    } catch {
      // The JSON may be split across console chunks; wait for the next one.
    }
  };
  launch.stdout.on('data', consume);
  launch.stderr.on('data', consume);
  launch.on('error', (error) => { clearTimeout(timer); reject(error); });
  launch.on('exit', (code) => {
    if (!output.includes(marker)) {
      clearTimeout(timer);
      reject(new Error(`devicectl exited ${code} before performance results`));
    }
  });
});

if (!Array.isArray(samples) || samples.some((sample) => sample === null)) {
  throw new Error(`invalid profile samples: ${JSON.stringify(samples)}`);
}
const values = (key) => samples.map((sample) => Number(sample[key]));
const max = (key) => Math.max(...values(key));
const min = (key) => Math.min(...values(key));
const result = {
  levels_profiled: samples.length,
  p95_ms: max('p95Ms'),
  worst_ms: max('worstMs'),
  p50_ms: max('p50Ms'),
  draw_calls: max('drawCalls'),
  triangles: max('triangles'),
  frames_min: min('frames'),
};
for (const sample of samples) {
  result[`level_${sample.level}_p95_ms`] = Number(sample.p95Ms);
  result[`level_${sample.level}_draw_calls`] = Number(sample.drawCalls);
  result[`level_${sample.level}_triangles`] = Number(sample.triangles);
}
process.stdout.write(`${JSON.stringify(result)}\n`);
