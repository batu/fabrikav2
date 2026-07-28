#!/usr/bin/env node
// Aggregate smoke runner (ledger 054 #21): the 9 UI smoke harnesses had no
// single entry point, so "the whole B2 regression net only fires when someone
// remembers to run each script by hand." Runs ALL smokes sequentially (each
// spins its own vite) and exits 1 if ANY failed (full run, not fail-fast).
//
//   npm run test:smoke-all
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));
const smokes = readdirSync(testsDir).filter((f) => f.endsWith('-smoke.mjs')).sort();

let failed = 0;
for (const smoke of smokes) {
  const started = Date.now();
  process.stdout.write(`── ${smoke} … `);
  const r = spawnSync(process.execPath, [join(testsDir, smoke)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 240_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (r.status === 0) {
    console.log(`PASS (${secs}s)`);
  } else {
    failed += 1;
    // Distinguish a hang from a crash (re-review TEST-4): on spawnSync
    // timeout r.error is ETIMEDOUT and r.status is null.
    console.log(r.error?.code === 'ETIMEDOUT' ? `TIMEOUT after 240s (${secs}s)` : `FAIL (${secs}s)`);
    process.stdout.write(String(r.stdout || ''));
    process.stderr.write(String(r.stderr || ''));
  }
}
console.log(`\n${smokes.length - failed}/${smokes.length} smokes passed`);
process.exit(failed === 0 ? 0 : 1);
