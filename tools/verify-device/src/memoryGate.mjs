// MEMORY GATE: sample the game's WebContent process footprint on the iPhone
// while the XCUITest tour runs, and fail the run when it exceeds the limit.
//
// Why this exists (2026-09-10): Find the Dog 1.0.8 / Find the Bird shipped with
// the game web process at 1.3 GB before a level loaded; WebKit killed it on the
// first level and the apps bounced to the home map. No unit test can see that
// number — only the device can — so the device lane owns the check.
//
// Sampling uses `pymobiledevice3 developer dvt sysmon process single`, which
// returns every process with `physFootprint` (the number iOS jetsam uses). The
// game's WebContent is the largest `com.apple.WebKit.WebContent`; ad WebViews
// sit around 50 MB. The sampler is a child process because the runner step
// blocks the event loop on a synchronous `xcodebuild test`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 1280 MB: above the fixed build's worst transient (1143 MB at the win card on
// an iPhone 12, live lane run 2026-09-10) and ~16% under the lowest footprint at
// which WebKit killed the shipped build (1520 MB). A returning Pre FX ladder
// (+625 MB at boot) trips it immediately.
export const DEFAULT_MEMORY_LIMIT_MB = 1280;
export const DEFAULT_SAMPLE_INTERVAL_MS = 3000;
export const WEBCONTENT_PROCESS_NAME = 'com.apple.WebKit.WebContent';
export const SYSMON_ARGS = ['developer', 'dvt', 'sysmon', 'process', 'single'];

/** @returns {Array<{pid:number,name:string,execName:string,physFootprint:number}>} */
export function parseSysmonProcesses(json) {
  const list = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      pid: Number(p.pid),
      name: String(p.name ?? ''),
      execName: String(p.execName ?? ''),
      physFootprint: Number(p.physFootprint ?? 0),
    }))
    .filter((p) => Number.isFinite(p.pid) && Number.isFinite(p.physFootprint));
}

/** The game page's WebContent: the largest one; AdMob WebViews are ~50 MB. */
export function selectGameWebContent(processes) {
  const web = processes.filter((p) => p.name === WEBCONTENT_PROCESS_NAME);
  if (!web.length) return null;
  return web.reduce((best, p) => (p.physFootprint > best.physFootprint ? p : best));
}

/** Parse the JSONL file the sampler worker writes. Malformed lines are dropped. */
export function parseSampleLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((s) => s && typeof s === 'object');
}

/**
 * Evaluate sampled footprints against the limit.
 * @returns {{status:'pass'|'fail'|'unavailable', peakMb:number|null, peakAt:string|null,
 *   sampleCount:number, errorCount:number, limitMb:number, reason:string}}
 */
export function evaluateMemoryGate({ samples = [], limitMb = DEFAULT_MEMORY_LIMIT_MB, minSamples = 2 } = {}) {
  const good = samples.filter((s) => Number.isFinite(Number(s.footprintMb)));
  const errors = samples.length - good.length;
  if (good.length < minSamples) {
    const why = samples.length === 0
      ? 'no samples (is `sudo pymobiledevice3 remote tunneld` running?)'
      : `${good.length} usable sample(s), ${errors} error(s): ${String((samples.find((s) => s.error) || {}).error || '').slice(0, 120)}`;
    return { status: 'unavailable', peakMb: null, peakAt: null, sampleCount: good.length, errorCount: errors, limitMb, reason: `memory gate unavailable — ${why}` };
  }
  const peak = good.reduce((best, s) => (Number(s.footprintMb) > Number(best.footprintMb) ? s : best));
  const peakMb = Math.round(Number(peak.footprintMb));
  const status = peakMb > limitMb ? 'fail' : 'pass';
  return {
    status,
    peakMb,
    peakAt: peak.at || null,
    sampleCount: good.length,
    errorCount: errors,
    limitMb,
    reason: status === 'pass'
      ? `peak WebContent footprint ${peakMb} MB ≤ ${limitMb} MB over ${good.length} samples`
      : `peak WebContent footprint ${peakMb} MB > ${limitMb} MB (at ${peak.at || 'unknown'}, pid ${peak.pid ?? '?'})`,
  };
}

export function formatMemoryGate(gate) {
  if (!gate) return '  memory gate: SKIPPED (--skip-memory-gate)\n';
  const label = gate.status === 'pass' ? 'PASS' : gate.status === 'fail' ? 'FAIL' : 'UNAVAILABLE';
  return `  memory gate: ${label} — ${gate.reason}\n`;
}

const WORKER = fileURLToPath(new URL('./memorySamplerWorker.mjs', import.meta.url));

/**
 * Start the sampler as a detached child so it keeps sampling while the caller
 * blocks on a synchronous xcodebuild. `stop()` kills it and returns the parsed
 * samples. `pymobiledevice3` must be on PATH and the privileged tunnel running.
 */
export function startMemorySampler({
  outFile,
  intervalMs = DEFAULT_SAMPLE_INTERVAL_MS,
  spawnImpl = spawn,
  pymobiledevice3 = 'pymobiledevice3',
} = {}) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, '');
  const child = spawnImpl(process.execPath, [WORKER, outFile, String(intervalMs), pymobiledevice3], {
    stdio: 'ignore',
    detached: false,
  });
  let stopped = false;
  return {
    child,
    outFile,
    stop() {
      if (!stopped) {
        stopped = true;
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
      }
      return parseSampleLines(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '');
    },
  };
}
