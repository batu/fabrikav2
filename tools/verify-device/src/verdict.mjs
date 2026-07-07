// PASS/FAIL verdict over the built rows. A state FAILS if the device never
// captured it (missing state) or its pixel-diff exceeds the threshold. States
// whose reference is a documented gap can't be diffed — they're reported as
// "advisory" (device captured, nothing trusted to diff against), never a silent
// pass. The overall verdict starts ADVISORY (see cli --strict): the number is
// printed and the grid is the evidence, but the gate doesn't fail the build
// until the thresholds are tuned against real device captures.

/**
 * @param {Array} rows from compare.buildRows
 * @param {number} threshold changed-fraction FAIL cutoff (0..1)
 * @returns {{pass:boolean, states:Array<{state:string,status:string,reason:string,
 *   changedFraction:number|null}>, summary:string}}
 */
export function computeVerdict(rows, threshold) {
  const states = rows.map((row) => classify(row, threshold));
  const fails = states.filter((s) => s.status === 'fail');
  const missing = states.filter((s) => s.status === 'missing');
  const pass = fails.length === 0 && missing.length === 0;
  const parts = [
    `${states.filter((s) => s.status === 'pass').length} pass`,
    `${fails.length} over-threshold`,
    `${missing.length} missing`,
    `${states.filter((s) => s.status === 'no-reference').length} no-reference`,
  ];
  const summary = `${pass ? 'PASS' : 'FAIL'} — ${parts.join(', ')} (threshold ${(threshold * 100).toFixed(0)}% changed)`;
  return { pass, states, summary };
}

export function isVerifiedDeviceLane(lane) {
  return lane === 'device';
}

export function computeStrictExitCode({ strict, lane, primary, captureFailure }) {
  if (captureFailure) return 1;
  if (!strict) return 0;
  if (!isVerifiedDeviceLane(lane)) return 1;
  return primary?.pass ? 0 : 1;
}

function classify(row, threshold) {
  const cf = row.diff ? row.diff.changedFraction : null;
  if (row.device && row.device.gap) {
    return { state: row.state, status: 'missing', reason: row.device.gap, changedFraction: null };
  }
  if (!row.diff) {
    // Device captured, but the reference lane is a documented gap → can't diff.
    return {
      state: row.state,
      status: 'no-reference',
      reason: (row.reference && row.reference.gap) || 'no reference to diff against',
      changedFraction: null,
    };
  }
  if (cf > threshold) {
    return {
      state: row.state,
      status: 'fail',
      reason: `diff ${(cf * 100).toFixed(1)}% > threshold ${(threshold * 100).toFixed(0)}%`,
      changedFraction: cf,
    };
  }
  return {
    state: row.state,
    status: 'pass',
    reason: `diff ${(cf * 100).toFixed(1)}% ≤ threshold`,
    changedFraction: cf,
  };
}
