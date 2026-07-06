import { describe, it, expect } from 'vitest';
import { computeVerdict } from '../src/verdict.mjs';

// Row shapes as produced by compare.buildRows (only the fields verdict reads).
const passRow = (state, cf) => ({ state, device: { base64: 'x' }, reference: { base64: 'y' }, diff: { changedFraction: cf } });
const missingRow = (state) => ({ state, device: { gap: `no device capture for "${state}"` }, reference: { base64: 'y' }, diff: null });
const noRefRow = (state) => ({ state, device: { base64: 'x' }, reference: { gap: 'documented reference gap' }, diff: null });

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

  it('threshold boundary: equal to threshold passes', () => {
    const v = computeVerdict([passRow('menu', 0.2)], 0.2);
    expect(v.states[0].status).toBe('pass');
  });
});
