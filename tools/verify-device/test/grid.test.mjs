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
  {
    state: 'fail',
    device: { base64: 'EEEE', alt: 'fail device' },
    reference: {
      gap: 'reference skipped by refs manifest at-rest:false: refs/captures/source/fail.png',
      skipJudging: true,
    },
    diff: null,
  },
];
const verdict = {
  pass: false,
  summary: 'FAIL — 0 pass, 1 over-threshold, 0 missing, 1 no-reference (threshold 20% changed)',
  states: [
    { state: 'menu', status: 'fail', reason: 'diff 12.0% > threshold 20%', changedFraction: 0.12 },
    { state: 'pause', status: 'no-reference', reason: 'documented gap', changedFraction: null },
    { state: 'fail', status: 'skipped', reason: 'at-rest:false', changedFraction: null },
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
    expect(html).toContain('badge skipped');
  });

  it('renders documented gaps explicitly, never a blank', () => {
    expect(html).toContain('documented gap');
  });

  it('documents raw and judged capture artifacts when content inset is configured', () => {
    const h = buildGridHtml({
      game: 'g',
      generatedAt: 'd',
      device: 'd',
      rows,
      verdict,
      captureArtifacts: {
        contentInsetTop: 130,
        contentInsetBottom: 96,
        rawDir: 'docs/evidence/run/raw-captures',
        judgedDir: 'docs/evidence/run/judged-captures',
      },
    });
    expect(h).toContain('raw device captures preserved');
    expect(h).toContain('docs/evidence/run/raw-captures');
    expect(h).toContain('docs/evidence/run/judged-captures');
    expect(h).toContain('130px');
    expect(h).toContain('96px');
  });

  it('documents named-region crop artifacts when manifest regions are present', () => {
    const h = buildGridHtml({
      game: 'g',
      generatedAt: 'd',
      device: 'd',
      rows,
      verdict,
      captureArtifacts: {
        contentInsetTop: 0,
        rawDir: 'docs/evidence/run/raw-captures',
        judgedDir: 'docs/evidence/run/judged-captures',
        crops: {
          dir: 'docs/evidence/run/crops',
          inventory: 'docs/evidence/run/crops/inventory.json',
          count: 12,
          skipped: 3,
        },
      },
    });
    expect(h).toContain('Named-region crops');
    expect(h).toContain('docs/evidence/run/crops');
    expect(h).toContain('docs/evidence/run/crops/inventory.json');
    expect(h).toContain('12 crop files');
    expect(h).toContain('3 skipped rows');
  });

  it('escapes untrusted text', () => {
    const evil = buildGridHtml({
      game: '<script>x</script>', generatedAt: 'd', device: 'd', rows: [], verdict: { pass: true, summary: 's', states: [] },
    });
    expect(evil).not.toContain('<script>x</script>');
    expect(evil).toContain('&lt;script&gt;');
  });

  it('renders a UNVERIFIED panel note when the panel was skipped', () => {
    const h = buildGridHtml({
      game: 'g', generatedAt: 'd', device: 'd', rows: [], verdict: { pass: true, summary: 's', states: [] },
      panel: { skipped: 'no OPENROUTER_API_KEY' },
    });
    expect(h).toContain('UNVERIFIED');
    expect(h).toContain('no OPENROUTER_API_KEY');
    expect(h).toContain('PHASH (panel skipped)'); // phash is the fallback banner
  });

  it('renders the panel as the primary verdict with per-model scores + consensus matrix', () => {
    const panel = {
      models: ['anthropic/claude-opus-4.1', 'google/gemini-3.5-flash'],
      thresholdPct: 85,
      states: [{
        state: 'win', score: 58, status: 'fail', reason: 'panel 58% < 85%',
        models: [
          { model: 'anthropic/claude-opus-4.1', ok: true, fidelity: 55 },
          { model: 'google/gemini-3.5-flash', ok: false, skipped: 'model not found on OpenRouter (404)' },
        ],
        consensus: [{ key: 'missing-element', count: 2, of: 2, severity: 'blocker', descriptions: ['crown absent'] }],
      }],
      verdict: { pass: false, summary: 'FAIL — panel median 58% · 0 pass, 1 fail, 0 unscored (floor 85%)' },
    };
    const h = buildGridHtml({
      game: 'g', generatedAt: 'd', device: 'd', rows: [], verdict: { pass: true, summary: 'phash ok', states: [] }, panel,
    });
    expect(h).toContain('PANEL (primary)');
    expect(h).toContain('FAIL — panel median 58%');
    expect(h).toContain('claude-opus-4.1: 55%');
    expect(h).toContain('gemini-3.5-flash: skip');
    expect(h).toContain('missing-element');
    expect(h).toContain('crown absent');
    expect(h).toContain('Secondary signal'); // phash demoted to advisory
  });

  it('stamps provided captures as device-provenance-unverified', () => {
    const h = buildGridHtml({
      game: 'g',
      generatedAt: 'd',
      device: 'captures dir tmp/shots — DEVICE-PROVENANCE-UNVERIFIED',
      rows,
      verdict,
      lane: 'provided-captures',
    });
    expect(h).toContain('PROVIDED CAPTURES');
    expect(h).toContain('DEVICE-PROVENANCE-UNVERIFIED');
    expect(h).toContain('provided captures (DEVICE-PROVENANCE-UNVERIFIED)');
    expect(h).toContain('Excluded from strict device-pass semantics');
  });
});
