import { describe, it, expect } from 'vitest';
import { buildGridHtml } from '../src/grid.mjs';

const rows = [
  {
    state: 'menu',
    device: { base64: 'AAAA', alt: 'menu device', source: '/tmp/menu.png', resolution: '1170x2532' },
    reference: { base64: 'BBBB', alt: 'menu reference', source: 'refs/menu.png', package: 'com.x', resolution: '1080x2400' },
    diff: { base64: 'CCCC', changedFraction: 0.12 },
  },
  {
    state: 'pause',
    device: { base64: 'DDDD', alt: 'pause device' },
    reference: { gap: 'no reference pause capture — documented gap' },
    diff: null,
  },
];
const verdict = {
  pass: false,
  summary: 'FAIL — 0 pass, 1 over-threshold, 0 missing, 1 no-reference (threshold 20% changed)',
  states: [
    { state: 'menu', status: 'fail', reason: 'diff 12.0% > threshold 20%', changedFraction: 0.12 },
    { state: 'pause', status: 'no-reference', reason: 'documented gap', changedFraction: null },
  ],
};

describe('buildGridHtml', () => {
  const html = buildGridHtml({ game: 'marble_run', generatedAt: '2026-07-06', device: 'iPhone (UDID)', rows, verdict });

  it('is a self-contained HTML doc with inlined images', () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).toContain('data:image/png;base64,CCCC');
  });

  it('renders the verdict banner and per-state badges', () => {
    expect(html).toContain('FAIL — 0 pass');
    expect(html).toContain('verdict bad');
    expect(html).toContain('badge fail');
    expect(html).toContain('badge no-reference');
  });

  it('renders documented gaps explicitly, never a blank', () => {
    expect(html).toContain('documented gap');
  });

  it('escapes untrusted text', () => {
    const evil = buildGridHtml({
      game: '<script>x</script>', generatedAt: 'd', device: 'd', rows: [], verdict: { pass: true, summary: 's', states: [] },
    });
    expect(evil).not.toContain('<script>x</script>');
    expect(evil).toContain('&lt;script&gt;');
  });
});
