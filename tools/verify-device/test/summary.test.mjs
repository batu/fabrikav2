import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSummary,
  compareSummaries,
  formatCompareTable,
  formatSummaryTable,
  loadRunSummary,
  normalizeSummary,
  writeSummaryJson,
} from '../src/summary.mjs';

let tmpDirs = [];

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-device-summary-'));
  tmpDirs.push(dir);
  return dir;
}

describe('buildSummary', () => {
  it('emits state-keyed score, major consensus count, and verdict from panel states', () => {
    const summary = buildSummary({
      panel: {
        states: [
          {
            state: 'menu',
            score: 88,
            status: 'fail',
            consensus: [
              { key: 'layout', severity: 'major' },
              { key: 'missing-element', severity: 'blocker' },
              { key: 'spacing', severity: 'minor' },
            ],
          },
          { state: 'pause', score: null, status: 'unscored', consensus: [] },
        ],
      },
      phashVerdict: null,
    });

    expect(summary).toEqual({
      menu: { score: 88, majorConsensusCount: 2, verdict: 'fail' },
      pause: { score: null, majorConsensusCount: 0, verdict: 'unscored' },
    });
  });

  it('falls back to phash verdict states when the panel is skipped', () => {
    const summary = buildSummary({
      panel: { skipped: 'panel disabled by --skip-panel' },
      phashVerdict: {
        states: [
          { state: 'menu', status: 'pass' },
          { state: 'fail', status: 'missing' },
        ],
      },
    });

    expect(summary.menu).toEqual({ score: null, majorConsensusCount: 0, verdict: 'pass' });
    expect(summary.fail).toEqual({ score: null, majorConsensusCount: 0, verdict: 'missing' });
  });

  it('records viewport metrics and metric assertions under each state', () => {
    const summary = buildSummary({
      panel: { states: [{ state: 'menu', score: 91, status: 'pass', consensus: [] }] },
      phashVerdict: null,
      viewportMetrics: {
        menu: { windowInnerHeight: 844, safeAreaInsetTop: 59 },
      },
      viewportMetricAssertions: [
        { state: 'menu', metric: 'windowInnerHeight', value: 844, min: 800, max: 900, status: 'pass' },
      ],
    });

    expect(summary.menu).toEqual({
      score: 91,
      majorConsensusCount: 0,
      verdict: 'pass',
      viewportMetrics: { windowInnerHeight: 844, safeAreaInsetTop: 59 },
      viewportMetricAssertions: [
        { state: 'menu', metric: 'windowInnerHeight', value: 844, min: 800, max: 900, status: 'pass' },
      ],
    });
  });
});

describe('summary persistence', () => {
  it('writes and reloads summary.json', () => {
    const dir = tmpDir();
    const summary = { menu: { score: 90, majorConsensusCount: 1, verdict: 'pass' } };

    const file = writeSummaryJson(dir, summary);

    expect(path.basename(file)).toBe('summary.json');
    expect(loadRunSummary(dir)).toEqual(summary);
  });

  it('loads old runs by falling back to panel.json', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'panel.json'), JSON.stringify({
      states: [
        { state: 'menu', score: 55, status: 'fail', consensus: [{ severity: 'major' }] },
      ],
    }));

    expect(loadRunSummary(dir)).toEqual({
      menu: { score: 55, majorConsensusCount: 1, verdict: 'fail' },
    });
  });

  it('normalizes wrapped summaries for forward compatibility', () => {
    expect(normalizeSummary({
      states: {
        menu: {
          score: 80,
          majorConsensusCount: 2,
          verdict: 'fail',
          viewportMetrics: { windowInnerHeight: 844 },
          viewportMetricAssertions: [{ state: 'menu', metric: 'windowInnerHeight', status: 'pass' }],
        },
      },
    })).toEqual({
      menu: {
        score: 80,
        majorConsensusCount: 2,
        verdict: 'fail',
        viewportMetrics: { windowInnerHeight: 844 },
        viewportMetricAssertions: [{ state: 'menu', metric: 'windowInnerHeight', status: 'pass' }],
      },
    });
  });
});

describe('summary formatting and compare mode', () => {
  it('prints one table row per state', () => {
    const text = formatSummaryTable({
      menu: { score: 75, majorConsensusCount: 2, verdict: 'fail' },
      pause: { score: null, majorConsensusCount: 0, verdict: 'unscored' },
    });

    expect(text).toContain('state');
    expect(text).toContain('menu');
    expect(text).toContain('pause');
    expect(text).toContain('majors');
  });

  it('computes and formats per-state score, major consensus, and verdict deltas', () => {
    const deltas = compareSummaries({
      menu: { score: 75, majorConsensusCount: 1, verdict: 'fail' },
      win: { score: 90, majorConsensusCount: 0, verdict: 'pass' },
    }, {
      menu: { score: 60, majorConsensusCount: 3, verdict: 'fail' },
      win: { score: 80, majorConsensusCount: 1, verdict: 'fail' },
      old: { score: 50, majorConsensusCount: 2, verdict: 'fail' },
    });

    expect(deltas.find((d) => d.state === 'menu')).toMatchObject({
      scoreDelta: 15,
      majorConsensusDelta: -2,
      verdictChanged: false,
    });
    expect(deltas.find((d) => d.state === 'win')).toMatchObject({
      scoreDelta: 10,
      majorConsensusDelta: -1,
      verdictChanged: true,
    });

    const text = formatCompareTable(deltas, 'docs/evidence/prev');
    expect(text).toContain('compare: docs/evidence/prev');
    expect(text).toContain('+15');
    expect(text).toContain('-2');
    expect(text).toContain('fail->pass');
    expect(text).toContain('old');
  });
});
