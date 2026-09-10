// Child-process loop for memoryGate.mjs: every `intervalMs`, run
// `pymobiledevice3 developer dvt sysmon process single`, pick the game's
// WebContent process, and append one JSON line to `outFile`. Errors are
// recorded as samples too so the gate can distinguish "tunnel down" from
// "healthy". Killed with SIGTERM by the parent.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { parseSysmonProcesses, selectGameWebContent, SYSMON_ARGS } from './memoryGate.mjs';

const [outFile, intervalArg, binary = 'pymobiledevice3'] = process.argv.slice(2);
const intervalMs = Math.max(500, Number(intervalArg) || 3000);
const MB = 1024 * 1024;

function sampleOnce() {
  return new Promise((resolve) => {
    execFile(binary, SYSMON_ARGS, { encoding: 'utf8', maxBuffer: 64 * MB, timeout: 20_000 }, (err, stdout) => {
      const at = new Date().toISOString();
      if (err) return resolve({ at, error: String(err.message || err).slice(0, 200) });
      try {
        const web = selectGameWebContent(parseSysmonProcesses(stdout));
        if (!web) return resolve({ at, error: 'no WebContent process found' });
        resolve({ at, pid: web.pid, footprintMb: web.physFootprint / MB });
      } catch (e) {
        resolve({ at, error: String(e.message || e).slice(0, 200) });
      }
    });
  });
}

let running = true;
process.on('SIGTERM', () => { running = false; });
process.on('SIGINT', () => { running = false; });

while (running) {
  const started = Date.now();
  const sample = await sampleOnce();
  fs.appendFileSync(outFile, `${JSON.stringify(sample)}\n`);
  const wait = intervalMs - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
