import { describe, it, expect } from 'vitest';
import { computeStrictExitCode, computeVerdict, isVerifiedDeviceLane } from '../src/verdict.mjs';

// Row shapes as produced by compare.buildRows (only the fields verdict reads).
const passRow = (state, cf) => ({ state, device: { base64: 'x' }, reference: { base64: 'y' }, diff: { changedFraction: cf } });
const missingRow = (state) => ({ state, device: { gap: `no device capture for "${state}"` }, reference: { base64: 'y' }, diff: null });
const noRefRow = (state) => ({ state, device: { base64: 'x' }, reference: { gap: 'documented reference gap' }, diff: null });
const skippedRow = (state) => ({
  state,
  device: { base64: 'x' },
  reference: { gap: 'reference skipped by refs manifest at-rest:false', skipJudging: true },
  diff: null,
});

describe('computeVerdict', () => {
  it('passes when every diffed state is under threshold', () => {
    const v = computeVerdict([passRow('menu', 0.01), passRow('level', 0.1)], 0.2);
    expect(v.pass).toBe(true);
    expect(v.summary).toMatch(/^PASS/);
  });

  it('fails a state whose diff exceeds the threshold', () => {
    const v = computeVerdict([passRow('menu', 0.01), passRow('level', 0.5)], 0.2);
    expect(v.pass).toBe(false);
    expect(v.states.find((s) => s.state === 'level').status).toBe('fail');
    expect(v.summary).toMatch(/^FAIL/);
  });

  it('fails when a device capture is missing entirely', () => {
    const v = computeVerdict([passRow('menu', 0.01), missingRow('win')], 0.2);
    expect(v.pass).toBe(false);
    expect(v.states.find((s) => s.state === 'win').status).toBe('missing');
  });

  it('marks a state with no reference as no-reference (not a silent pass)', () => {
    const v = computeVerdict([noRefRow('pause')], 0.2);
    expect(v.pass).toBe(true); // no-reference doesn't fail the gate...
    expect(v.states[0].status).toBe('no-reference'); // ...but is reported explicitly
  });

  it('marks refs manifest exclusions as skipped without failing the phash verdict', () => {
    const v = computeVerdict([passRow('menu', 0.01), skippedRow('fail')], 0.2);
    expect(v.pass).toBe(true);
    expect(v.states.find((s) => s.state === 'fail')).toMatchObject({ status: 'skipped' });
    expect(v.summary).toContain('1 skipped');
  });

  it('threshold boundary: equal to threshold passes', () => {
    const v = computeVerdict([passRow('menu', 0.2)], 0.2);
    expect(v.states[0].status).toBe('pass');
  });
});

describe('strict device exit semantics', () => {
  it('requires a verified device lane under --strict', () => {
    expect(isVerifiedDeviceLane('device')).toBe(true);
    expect(isVerifiedDeviceLane('browser')).toBe(false);
    expect(isVerifiedDeviceLane('provided-captures')).toBe(false);
    expect(computeStrictExitCode({ strict: true, lane: 'device', primary: { pass: true } })).toBe(0);
    expect(computeStrictExitCode({ strict: true, lane: 'browser', primary: { pass: true } })).toBe(1);
    expect(computeStrictExitCode({ strict: true, lane: 'provided-captures', primary: { pass: true } })).toBe(1);
    expect(computeStrictExitCode({
      strict: true,
      lane: 'device',
      primary: { pass: true },
      viewportMetricsPass: false,
    })).toBe(1);
  });

  it('keeps advisory mode advisory except for capture-runner failures', () => {
    expect(computeStrictExitCode({ strict: false, lane: 'browser', primary: { pass: true } })).toBe(0);
    expect(computeStrictExitCode({ strict: false, lane: 'device', primary: { pass: false } })).toBe(0);
    expect(computeStrictExitCode({
      strict: false,
      lane: 'device',
      primary: { pass: true },
      captureFailure: 'xcodebuild test failed',
    })).toBe(1);
  });
});
