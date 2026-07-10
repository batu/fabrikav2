import { describe, it, expect } from 'vitest';
import {
  classifyRunVerdict,
  computeVerdict,
  isProvenanceVerified,
  isVerifiedDeviceLane,
  normalizeStateEvidence,
  RUN_VERDICT_KINDS,
} from '../src/verdict.mjs';

// Row shapes as produced by compare.buildRows (only the fields verdict reads).
const capturedRow = (state, cf = 0.01) => ({ state, device: { base64: 'x' }, reference: { base64: 'y' }, diff: { changedFraction: cf } });
const missingRow = (state) => ({ state, device: { gap: `no device capture for "${state}"` }, reference: { base64: 'y' }, diff: null });
const noRefRow = (state) => ({ state, device: { base64: 'x' }, reference: { gap: 'documented reference gap' }, diff: null });
const dualGapRow = (state) => ({ state, device: { gap: 'no device capture' }, reference: { gap: 'documented reference gap' }, diff: null });
const skippedRow = (state) => ({
  state,
  device: { base64: 'x' },
  reference: { gap: 'reference skipped by refs manifest at-rest:false', skipJudging: true },
  diff: null,
});

// A vision-panel result keyed by per-state status (classifyRunVerdict reads only
// {state, status}). `null` panel means the panel never ran (skipped/no key).
const panelWith = (entries) => ({ states: entries.map(([state, status]) => ({ state, status })) });
const LIVE = 'live-device';

describe('computeVerdict (phash advisory signal)', () => {
  it('passes when every diffed state is under threshold', () => {
    const v = computeVerdict([capturedRow('menu', 0.01), capturedRow('level', 0.1)], 0.2);
    expect(v.pass).toBe(true);
    expect(v.summary).toMatch(/^PASS/);
  });

  it('fails a state whose diff exceeds the threshold', () => {
    const v = computeVerdict([capturedRow('menu', 0.01), capturedRow('level', 0.5)], 0.2);
    expect(v.pass).toBe(false);
    expect(v.states.find((s) => s.state === 'level').status).toBe('fail');
    expect(v.summary).toMatch(/^FAIL/);
  });

  it('fails when a device capture is missing entirely', () => {
    const v = computeVerdict([capturedRow('menu', 0.01), missingRow('win')], 0.2);
    expect(v.pass).toBe(false);
    expect(v.states.find((s) => s.state === 'win').status).toBe('missing');
  });

  it('marks a state with no reference as no-reference (advisory phash still passes)', () => {
    const v = computeVerdict([noRefRow('pause')], 0.2);
    expect(v.pass).toBe(true); // phash advisory number is not the run gate...
    expect(v.states[0].status).toBe('no-reference'); // ...the run gate is classifyRunVerdict
  });

  it('marks refs manifest exclusions as skipped without failing the phash verdict', () => {
    const v = computeVerdict([capturedRow('menu', 0.01), skippedRow('fail')], 0.2);
    expect(v.pass).toBe(true);
    expect(v.states.find((s) => s.state === 'fail')).toMatchObject({ status: 'skipped' });
    expect(v.summary).toContain('1 skipped');
  });

  it('threshold boundary: equal to threshold passes', () => {
    const v = computeVerdict([capturedRow('menu', 0.2)], 0.2);
    expect(v.states[0].status).toBe('pass');
  });
});

describe('normalizeStateEvidence (reference-first applicability)', () => {
  it('classifies a skipJudging reference as skipped (inapplicable)', () => {
    expect(normalizeStateEvidence(skippedRow('fail')).applicability).toBe('skipped');
  });
  it('classifies an absent/gapped reference as no-reference even when device is present', () => {
    expect(normalizeStateEvidence(noRefRow('pause')).applicability).toBe('no-reference');
  });
  it('classifies a DUAL device+reference gap as no-reference, never missing (AE9)', () => {
    expect(normalizeStateEvidence(dualGapRow('win')).applicability).toBe('no-reference');
  });
  it('classifies a trusted reference without a device capture as missing (applicable)', () => {
    expect(normalizeStateEvidence(missingRow('win')).applicability).toBe('missing');
  });
  it('classifies a trusted reference with a device capture/diff as captured (applicable)', () => {
    expect(normalizeStateEvidence(capturedRow('menu')).applicability).toBe('captured');
  });
});

describe('provenance helpers', () => {
  it('trusts only the live-device lane / provenance', () => {
    expect(isVerifiedDeviceLane('device')).toBe(true);
    expect(isVerifiedDeviceLane('browser')).toBe(false);
    expect(isProvenanceVerified('live-device')).toBe(true);
    expect(isProvenanceVerified('detached-xcresult')).toBe(false);
    expect(isProvenanceVerified('provided-captures')).toBe(false);
    expect(isProvenanceVerified('browser')).toBe(false);
    expect(isProvenanceVerified(undefined)).toBe(false);
  });
});

// Every case names the evidence composition, the expected evidence kind, and the
// exit code in BOTH enforcement modes. No zero-applicable or incomplete-primary
// case may become verified-pass; no exit is inferred from a truthy aggregate.
describe('classifyRunVerdict — evidence composition × enforcement', () => {
  const cases = [
    {
      name: 'AE1 empty rows → no-applicable-evidence',
      input: { provenance: LIVE, rows: [], panel: panelWith([]) },
      kind: 'no-applicable-evidence', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'AE1 skipped-only rows → no-applicable-evidence',
      input: { provenance: LIVE, rows: [skippedRow('fail'), skippedRow('win')], panel: panelWith([]) },
      kind: 'no-applicable-evidence', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'no-reference-only rows → no-applicable-evidence',
      input: { provenance: LIVE, rows: [noRefRow('pause')], panel: panelWith([]) },
      kind: 'no-applicable-evidence', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'AE9 dual device+reference gap → no-applicable-evidence (not missing)',
      input: { provenance: LIVE, rows: [dualGapRow('win')], panel: panelWith([]) },
      kind: 'no-applicable-evidence', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'AE2 --skip-device → skipped',
      input: { captureSkip: 'forced by --skip-device' },
      kind: 'skipped', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'AE7 browser provenance + passing panel → unverified',
      input: { provenance: 'browser', rows: [capturedRow('menu')], panel: panelWith([['menu', 'pass']]) },
      kind: 'unverified', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'provided-captures provenance → unverified',
      input: { provenance: 'provided-captures', rows: [capturedRow('menu')], panel: panelWith([['menu', 'pass']]) },
      kind: 'unverified', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'AE14 detached xcresult + passing panel → unverified',
      input: { provenance: 'detached-xcresult', rows: [capturedRow('menu')], panel: panelWith([['menu', 'pass']]) },
      kind: 'unverified', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'AE13 live run but panel skipped → unverified (phash cannot verify)',
      input: { provenance: LIVE, rows: [capturedRow('menu')], panel: { skipped: 'no OPENROUTER_API_KEY' }, phashVerdict: { pass: true } },
      kind: 'unverified', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'AE4 live run, all applicable panel-pass → verified-pass',
      input: { provenance: LIVE, rows: [capturedRow('menu'), capturedRow('level')], panel: panelWith([['menu', 'pass'], ['level', 'pass']]) },
      kind: 'verified-pass', strictExit: 0, exploratoryExit: 0,
    },
    {
      name: 'AE6 live run, applicable pass + manifest-skipped state → verified-pass',
      input: { provenance: LIVE, rows: [capturedRow('menu'), skippedRow('fail')], panel: panelWith([['menu', 'pass'], ['fail', 'skipped']]) },
      kind: 'verified-pass', strictExit: 0, exploratoryExit: 0,
    },
    {
      name: 'AE10 applicable pass + inapplicable no-reference (unscored) → verified-pass',
      input: { provenance: LIVE, rows: [capturedRow('menu'), noRefRow('pause')], panel: panelWith([['menu', 'pass'], ['pause', 'unscored']]) },
      kind: 'verified-pass', strictExit: 0, exploratoryExit: 0,
    },
    {
      name: 'AE11 panel pass + phash fail → verified-pass (panel authoritative)',
      input: { provenance: LIVE, rows: [capturedRow('menu', 0.9)], panel: panelWith([['menu', 'pass']]), phashVerdict: { pass: false } },
      kind: 'verified-pass', strictExit: 0, exploratoryExit: 0,
    },
    {
      name: 'AE5 live run, applicable state missing its capture → verified-fail',
      input: { provenance: LIVE, rows: [capturedRow('menu'), missingRow('win')], panel: panelWith([['menu', 'pass']]) },
      kind: 'verified-fail', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'AE11 panel fail → verified-fail',
      input: { provenance: LIVE, rows: [capturedRow('menu')], panel: panelWith([['menu', 'fail']]) },
      kind: 'verified-fail', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'AE11 missing panel state for a captured applicable state → unverified',
      input: { provenance: LIVE, rows: [capturedRow('menu'), capturedRow('level')], panel: panelWith([['menu', 'pass']]) },
      kind: 'unverified', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'AE11 duplicate panel state for a captured applicable state → unverified',
      input: { provenance: LIVE, rows: [capturedRow('menu')], panel: panelWith([['menu', 'pass'], ['menu', 'pass']]) },
      kind: 'unverified', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'unscored panel state for a captured applicable state → unverified',
      input: { provenance: LIVE, rows: [capturedRow('menu')], panel: panelWith([['menu', 'unscored']]) },
      kind: 'unverified', strictExit: 1, exploratoryExit: 0,
    },
    {
      name: 'AE12 viewport assertion failure on otherwise-verified evidence → verified-fail',
      input: { provenance: LIVE, rows: [capturedRow('menu')], panel: panelWith([['menu', 'pass']]), viewportMetricsPass: false },
      kind: 'verified-fail', strictExit: 1, exploratoryExit: 0,
    },
  ];

  for (const c of cases) {
    it(`${c.name} [strict exit ${c.strictExit}]`, () => {
      const strict = classifyRunVerdict({ ...c.input, strict: true });
      expect(strict.kind).toBe(c.kind);
      expect(strict.enforcement).toBe('strict');
      expect(strict.exitCode).toBe(c.strictExit);
      expect(RUN_VERDICT_KINDS).toContain(strict.kind);
    });
    it(`${c.name} [exploratory exit ${c.exploratoryExit}]`, () => {
      const exploratory = classifyRunVerdict({ ...c.input, strict: false });
      expect(exploratory.kind).toBe(c.kind); // kind is evidence-derived, mode-independent
      expect(exploratory.enforcement).toBe('exploratory');
      expect(exploratory.exitCode).toBe(c.exploratoryExit);
    });
  }

  it('reports ignored inapplicable/extra panel states without letting them affect fidelity (AE10)', () => {
    const v = classifyRunVerdict({
      strict: true,
      provenance: LIVE,
      rows: [capturedRow('menu'), noRefRow('pause')],
      panel: panelWith([['menu', 'pass'], ['pause', 'unscored'], ['ghost', 'fail']]),
    });
    expect(v.kind).toBe('verified-pass');
    const ignored = v.ignoredPanelStates.map((p) => p.state).sort();
    expect(ignored).toEqual(['ghost', 'pause']);
    expect(v.applicableCount).toBe(1);
  });
});

// Hard-integrity gates fire in BOTH modes and are independent of the evidence kind
// (a blind or corrupt capture cannot be waved through by an exploratory run).
describe('classifyRunVerdict — hard integrity gates (both modes)', () => {
  const verifiedInput = { provenance: LIVE, rows: [capturedRow('menu')], panel: panelWith([['menu', 'pass']]) };

  it('capture-runner failure exits nonzero in strict and exploratory', () => {
    for (const strict of [true, false]) {
      const v = classifyRunVerdict({ ...verifiedInput, strict, captureFailure: 'xcodebuild test failed' });
      expect(v.exitCode).toBe(1);
      expect(v.blockingReasons.join(' ')).toContain('capture runner failed');
    }
  });

  it('blind (ungated) captures fail by default, and the escape hatch re-opens the gate', () => {
    const blind = classifyRunVerdict({ ...verifiedInput, strict: false, ungatedCaptureStates: ['fail'] });
    expect(blind.exitCode).toBe(1);
    const allowed = classifyRunVerdict({ ...verifiedInput, strict: false, ungatedCaptureStates: ['fail'], allowUngated: true });
    expect(allowed.exitCode).toBe(0);
    expect(allowed.kind).toBe('verified-pass');
  });

  it('indistinguishable states fail by default even outside --strict', () => {
    const v = classifyRunVerdict({
      ...verifiedInput,
      strict: false,
      indistinguishableStatePairs: [{ stateA: 'menu', stateB: 'level' }],
    });
    expect(v.exitCode).toBe(1);
  });

  it('a hard-integrity block does not fabricate a failing evidence kind', () => {
    const v = classifyRunVerdict({ ...verifiedInput, strict: false, captureFailure: 'boom' });
    expect(v.kind).toBe('verified-pass'); // evidence axis unchanged...
    expect(v.exitCode).toBe(1); // ...but the process gate still fires
  });
});
