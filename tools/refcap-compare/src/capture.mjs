// Live capture lanes. These run device/harness commands and are CODED but NOT
// exercised in the worker sandbox (no phone; the sibling harness driveTo card is
// not yet landed). The offline path (cli.mjs --offline) is what the AC exercises.
// The guards these lanes enforce (foreground-verify, capture-integrity) are unit-
// tested independently of a device (foreground.mjs / test/foreground.test.js).

import { execFileSync } from 'node:child_process';
import readline from 'node:readline';
import { assertForeground } from './foreground.mjs';

/**
 * Build the argv for running adb over ssh to the ubuntu-server bridge.
 * @param {object} ref manifest.reference
 * @param {string[]} adbArgs
 * @returns {{cmd:string, args:string[]}}
 */
export function adbCommand(ref, adbArgs) {
  const serialArgs = ref.serial ? ['-s', ref.serial] : [];
  const remote = [ref.adb, ...serialArgs, ...adbArgs].join(' ');
  return { cmd: 'ssh', args: [ref.host, remote] };
}

function runAdb(ref, adbArgs, opts = {}) {
  const { cmd, args } = adbCommand(ref, adbArgs);
  return execFileSync(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts });
}

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(`${prompt}\n> press ENTER when ready `, () => {
    rl.close();
    resolve();
  }));
}

/**
 * REFERENCE lane: for one state, foreground-verify the expected package, then
 * screencap. Manual states prompt the operator and WAIT — never blind-tap.
 * Returns the captured PNG buffer + stamped metadata. Live only.
 * @returns {Promise<{png:Buffer, meta:object}>}
 */
export async function captureReference(ref, stateDef, stateName) {
  if (stateDef.manual) {
    await waitForEnter(stateDef.prompt || `Drive the phone to the "${stateName}" state.`);
  }
  // Foreground-verify EVERY capture (hard error on mismatch).
  const dumpsys = runAdb(ref, ['shell', 'dumpsys', 'activity', 'activities'], { encoding: 'utf8' });
  const actual = assertForeground(dumpsys, ref.package, stateName);
  // Stamp version from the device package info.
  let version = ref.version || 'unknown';
  try {
    const dump = runAdb(ref, ['shell', 'dumpsys', 'package', ref.package], { encoding: 'utf8' });
    const m = dump.match(/versionName=(\S+)/);
    if (m) version = m[1];
  } catch { /* keep manifest version */ }
  const png = runAdb(ref, ['exec-out', 'screencap', '-p']);
  return {
    png,
    meta: {
      lane: 'reference',
      package: actual.package,
      activity: actual.activity,
      version,
      device: ref.device,
    },
  };
}

/**
 * V2 lane: drive the harness to a state and capture. Gated on the sibling harness
 * card exposing driveTo(state) + capture(); until that lands this throws with a
 * clear message rather than pretending. The capture-integrity gate (snapshot
 * scene === requested state) is enforced by the harness per the card — this lane
 * MUST assert it before saving.
 */
export async function captureV2() {
  throw new Error(
    'v2 live lane requires the game harness driveTo(state) + capture() ' +
    '(sibling card, not yet landed). Use --offline to consume committed v2 evidence PNGs. ' +
    'When wired, this lane MUST assert snapshot().scene === requested state before saving ' +
    '(capture-integrity gate, ledger B5).'
  );
}
