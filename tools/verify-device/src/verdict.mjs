// PASS/FAIL verdict over the built rows.
//
// TWO layers live here, deliberately separated:
//
//   1. computeVerdict(rows, threshold) — the phash pixel-diff signal. ADVISORY.
//      A state FAILS if the device never captured it (missing) or its pixel-diff
//      exceeds the threshold; a documented-gap reference is reported "no-reference"
//      (never a silent pass). This number is printed and the grid is the evidence,
//      but phash alone never gates a run — the vision panel is primary.
//
//   2. classifyRunVerdict(...) — the TYPED RUN VERDICT that owns run-level status
//      and the process exit code. It fails closed: a run is `verified-pass` ONLY
//      when at least one applicable state has fresh live-device provenance and a
//      complete primary (panel) fidelity pass, every required applicable state is
//      covered, and no strict evidence gate fails. Absence, inapplicability,
//      untrusted provenance, incomplete fidelity, and observed failure are each
//      distinct evidence kinds — no aggregate truthy default can blur them.
//
// The CLI, grid, and summary all CONSUME classifyRunVerdict's result; none of
// them recompute run status from independent booleans (card AUDIT #6, AC3).

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
    `${states.filter((s) => s.status === 'skipped').length} skipped`,
  ];
  const summary = `${pass ? 'PASS' : 'FAIL'} — ${parts.join(', ')} (threshold ${(threshold * 100).toFixed(0)}% changed)`;
  return { pass, states, summary };
}

export function isVerifiedDeviceLane(lane) {
  return lane === 'device';
}

/** The five evidence kinds the typed run verdict can carry (R1). `kind` is
 *  evidence-derived; it does NOT change because `--strict` is on or off. */
export const RUN_VERDICT_KINDS = Object.freeze([
  'verified-pass',
  'verified-fail',
  'skipped',
  'unverified',
  'no-applicable-evidence',
]);

/** Capture provenance labels the CLI stamps. Only `live-device` is trusted for a
 *  verified pass in this card; detached / off-device lanes are unverified until
 *  AUDIT #7 supplies a validated run/commit/device attestation (R18, KTD7). */
export const VERIFIED_PROVENANCE = 'live-device';

export function isProvenanceVerified(provenance) {
  return provenance === VERIFIED_PROVENANCE;
}

/**
 * Reference-first normalization of one compare row into typed state evidence.
 * Applicability is derived from the raw row STRUCTURE, never inferred from a
 * status name, so a row missing BOTH device and reference is `no-reference`
 * (not a false `missing`) and cannot inflate applicable coverage (R2, AE9).
 *
 * @param {object} row compare.buildRows row {state, device, reference, diff}
 * @returns {{state:string, applicability:'skipped'|'no-reference'|'missing'|'captured', reason:string}}
 */
export function normalizeStateEvidence(row) {
  const state = row.state;
  if (row.reference && row.reference.skipJudging) {
    return { state, applicability: 'skipped', reason: row.reference.gap || 'reference excluded from judging' };
  }
  const referenceTrusted = row.reference && !row.reference.gap;
  if (!referenceTrusted) {
    return {
      state,
      applicability: 'no-reference',
      reason: (row.reference && row.reference.gap) || 'no trusted reference to diff against',
    };
  }
  const deviceMissing = !row.device || row.device.gap || !row.diff;
  if (deviceMissing) {
    return {
      state,
      applicability: 'missing',
      reason: (row.device && row.device.gap) || 'trusted reference but no device capture/diff',
    };
  }
  return { state, applicability: 'captured', reason: 'trusted reference and device capture present' };
}

/**
 * The typed run verdict. Owns run-level status AND the process exit code so no
 * consumer re-decides success from independent booleans.
 *
 * @param {object} params
 * @param {boolean} [params.strict] enforcement mode (strict vs exploratory).
 * @param {string|null} [params.captureSkip] graceful-skip reason (device/toolchain
 *   absent, --skip-device); when set the whole run is `skipped`.
 * @param {string|null} [params.provenance] capture provenance label from the CLI
 *   ('live-device','detached-xcresult','provided-captures','browser').
 * @param {Array} [params.rows] compare.buildRows rows.
 * @param {object|null} [params.panel] runPanel result (has `.states` when it ran).
 * @param {object|null} [params.phashVerdict] computeVerdict result (advisory only).
 * @param {boolean} [params.viewportMetricsPass] manifest viewport assertions passed.
 * @param {string|null} [params.captureFailure] hard capture-runner failure.
 * @param {string[]} [params.ungatedCaptureStates] blind (marker-never-appeared) states.
 * @param {boolean} [params.allowUngated] operator override for blind captures.
 * @param {Array} [params.indistinguishableStatePairs] blocking indistinguishable pairs.
 * @returns {{kind:string, enforcement:'strict'|'exploratory', exitCode:0|1,
 *   summary:string, reason:string, applicableCount:number, fidelitySource:string|null,
 *   states:Array, ignoredPanelStates:Array, coverageGaps:Array,
 *   hardIntegrity:string[], blockingReasons:string[]}}
 */
export function classifyRunVerdict({
  strict = false,
  captureSkip = null,
  provenance = null,
  rows = [],
  panel = null,
  phashVerdict = null,
  viewportMetricsPass = true,
  captureFailure = null,
  ungatedCaptureStates = [],
  allowUngated = false,
  indistinguishableStatePairs = [],
} = {}) {
  const enforcement = strict ? 'strict' : 'exploratory';
  const ungated = Array.isArray(ungatedCaptureStates) ? ungatedCaptureStates : [];
  const indist = Array.isArray(indistinguishableStatePairs) ? indistinguishableStatePairs : [];

  // Hard integrity failures are NOT an evidence kind — they are a process gate
  // that fires in BOTH strict and exploratory modes (R11). They are surfaced as
  // blockingReasons and force a nonzero exit regardless of `kind`.
  const hardIntegrity = [];
  if (captureFailure) hardIntegrity.push(`capture runner failed: ${captureFailure}`);
  if (!allowUngated && ungated.length) hardIntegrity.push(`blind (ungated) captures: ${ungated.join(', ')}`);
  if (indist.length) hardIntegrity.push(`indistinguishable states: ${indist.length} pair(s)`);

  const finalize = (partial) => {
    const exitCode = hardIntegrity.length
      ? 1
      : strict
        ? (partial.kind === 'verified-pass' ? 0 : 1)
        : 0;
    const result = {
      enforcement,
      exitCode,
      applicableCount: 0,
      fidelitySource: null,
      states: [],
      ignoredPanelStates: [],
      coverageGaps: [],
      hardIntegrity,
      ...partial,
      blockingReasons: [...(partial.blockingReasons || []), ...hardIntegrity],
    };
    result.summary = formatRunSummary(result);
    return result;
  };

  // 1. Capture skipped entirely (device/toolchain absent, --skip-device). Strict
  //    treats absence as failure; exploratory keeps the advisory exit-0 degrade.
  if (captureSkip) {
    return finalize({ kind: 'skipped', reason: captureSkip });
  }

  // 2. Reference-first normalization → explicit applicability, no truthy defaults.
  const states = (rows || []).map(normalizeStateEvidence);
  const captured = states.filter((s) => s.applicability === 'captured');
  const missing = states.filter((s) => s.applicability === 'missing');
  const applicableCount = captured.length + missing.length;
  const panelRan = Array.isArray(panel?.states);
  const fidelitySource = panelRan ? 'panel' : (phashVerdict ? 'phash' : null);
  const base = { applicableCount, fidelitySource, states };

  // 3. No applicable evidence — zero trusted references (empty rows, skipped-only,
  //    no-reference-only, dual device+reference gaps). Precedes lane classification
  //    (R5): even a live device lane with nothing to diff cannot be a pass.
  if (applicableCount === 0) {
    return finalize({ ...base, kind: 'no-applicable-evidence', reason: describeNoApplicable(states) });
  }

  // 4. Provenance — only current-invocation live-device captures are trusted
  //    (R7, R18). Browser, provided-captures, and detached --xcresult are unverified.
  if (!isProvenanceVerified(provenance)) {
    return finalize({
      ...base,
      kind: 'unverified',
      reason: `unverified provenance (${provenance || 'non-device lane'}) — strict requires a live-device capture`,
    });
  }

  // 5. Primary fidelity absent — the vision panel is primary; phash cannot verify
  //    fidelity on its own (R7, KTD4, AE13). A skipped/unavailable panel is unverified.
  if (!panelRan) {
    return finalize({
      ...base,
      kind: 'unverified',
      reason: `primary vision panel did not score this run (${panel?.skipped || 'panel unavailable'}); phash is advisory only`,
    });
  }

  // 6. Canonical panel coverage for each CAPTURED applicable state. Inapplicable /
  //    extra panel rows are ignored-and-reported and can neither help nor hurt
  //    (R19, AE10). Missing/duplicate/unscored coverage for a captured applicable
  //    state makes the run `unverified` — never a fabricated pass or fail.
  const panelByState = new Map();
  for (const ps of panel.states) {
    if (!panelByState.has(ps.state)) panelByState.set(ps.state, []);
    panelByState.get(ps.state).push(ps);
  }
  const capturedNames = new Set(captured.map((s) => s.state));
  const ignoredPanelStates = panel.states
    .filter((ps) => !capturedNames.has(ps.state))
    .map((ps) => ({ state: ps.state, status: ps.status }));

  const coverageGaps = [];
  const panelFailures = [];
  for (const s of captured) {
    const entries = panelByState.get(s.state) || [];
    if (entries.length === 0) {
      coverageGaps.push({ state: s.state, reason: 'no panel result for captured applicable state' });
      continue;
    }
    if (entries.length > 1) {
      coverageGaps.push({ state: s.state, reason: `duplicate panel results (${entries.length})` });
      continue;
    }
    const status = entries[0].status;
    if (status === 'pass') continue;
    if (status === 'fail') { panelFailures.push(s.state); continue; }
    // 'unscored' / 'skipped' for a captured applicable state → fidelity absent.
    coverageGaps.push({ state: s.state, reason: `panel ${status} for captured applicable state` });
  }

  const rich = { ...base, ignoredPanelStates, coverageGaps };

  if (coverageGaps.length) {
    return finalize({
      ...rich,
      kind: 'unverified',
      reason: `incomplete primary fidelity for ${coverageGaps.map((g) => g.state).join(', ')}`,
    });
  }

  // 7. Verified failures — observed, not fabricated. A structurally missing
  //    applicable capture, an applicable panel fidelity fail, or a viewport
  //    assertion failure each make the run `verified-fail` (R4, R10, AE5, AE12).
  const failReasons = [];
  if (missing.length) failReasons.push(`missing capture: ${missing.map((s) => s.state).join(', ')}`);
  if (panelFailures.length) failReasons.push(`panel fidelity fail: ${panelFailures.join(', ')}`);
  if (viewportMetricsPass === false) failReasons.push('viewport metric assertion failed');
  if (failReasons.length) {
    return finalize({ ...rich, kind: 'verified-fail', reason: failReasons.join('; ') });
  }

  // 8. Verified pass — live provenance, ≥1 applicable state, complete panel passes,
  //    every required applicable state covered, no failed gate (R3).
  return finalize({
    ...rich,
    kind: 'verified-pass',
    reason: `${captured.length} applicable state(s) verified live with complete panel fidelity`,
  });
}

function describeNoApplicable(states) {
  const counts = { skipped: 0, 'no-reference': 0 };
  for (const s of states) {
    if (s.applicability in counts) counts[s.applicability] += 1;
  }
  if (states.length === 0) return 'no states to verify (empty run)';
  return `no applicable evidence — ${counts.skipped} skipped, ${counts['no-reference']} no-reference, 0 with a trusted reference`;
}

function formatRunSummary(v) {
  const mode = v.enforcement === 'strict' ? 'STRICT' : 'EXPLORATORY';
  const gate = v.exitCode === 0 ? 'exit 0' : 'exit nonzero';
  const blocked = v.hardIntegrity && v.hardIntegrity.length
    ? ` · hard integrity: ${v.hardIntegrity.join('; ')}`
    : '';
  return `${v.kind.toUpperCase()} [${mode}] — ${v.reason} `
    + `(applicable ${v.applicableCount}, fidelity ${v.fidelitySource || 'none'}, ${gate})${blocked}`;
}

function classify(row, threshold) {
  const cf = row.diff ? row.diff.changedFraction : null;
  if (row.reference && row.reference.skipJudging) {
    return {
      state: row.state,
      status: 'skipped',
      reason: row.reference.gap || 'reference excluded from judging',
      changedFraction: null,
    };
  }
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
