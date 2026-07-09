import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapAttachmentsToStates, extractFromExportDir, loadCapturesDir } from '../src/attachments.mjs';
import { buildSummary } from '../src/summary.mjs';

// Manifest shaped like `xcrun xcresulttool export attachments` output — mirrors
// the committed games/marble_run/.work/insitu-runner/*/manifest.json format.
const MANIFEST = [
  {
    testIdentifier: 'InsituTourTests/testAllStates()',
    attachments: [
      { exportedFileName: 'a.png', suggestedHumanReadableName: '1-menu_0_uuid.png', timestamp: 100 },
      { exportedFileName: 'b.png', suggestedHumanReadableName: '2-level_0_uuid.png', timestamp: 110 },
      { exportedFileName: 'c.png', suggestedHumanReadableName: '3-settings_0_uuid.png', timestamp: 120 },
      { exportedFileName: 'd.png', suggestedHumanReadableName: '4-pause_0_uuid.png', timestamp: 130 },
      { exportedFileName: 'e.png', suggestedHumanReadableName: '5-win_0_uuid.png', timestamp: 140 },
      { exportedFileName: 'f.png', suggestedHumanReadableName: '6-fail_0_uuid.png', timestamp: 150 },
      { exportedFileName: 'g.png', suggestedHumanReadableName: '7-final_0_uuid.png', timestamp: 160 },
      // a re-captured menu with a LATER timestamp must supersede a.png
      { exportedFileName: 'menu-retake.png', suggestedHumanReadableName: '1-menu_1_uuid.png', timestamp: 999 },
    ],
  },
];
const STATES = ['menu', 'level', 'settings', 'pause', 'win', 'fail'];

describe('mapAttachmentsToStates', () => {
  it('maps each manifest state to its attachment file', () => {
    const { byState } = mapAttachmentsToStates(MANIFEST, STATES);
    expect(byState.level.file).toBe('b.png');
    expect(byState.level.gated).toBe(true);
    expect(byState.settings.file).toBe('c.png');
    expect(byState.pause.file).toBe('d.png');
    expect(byState.win.file).toBe('e.png');
    expect(byState.fail.file).toBe('f.png');
  });

  it('latest timestamp wins for a re-captured state', () => {
    const { byState } = mapAttachmentsToStates(MANIFEST, STATES);
    expect(byState.menu.file).toBe('menu-retake.png');
  });

  it('collects attachments outside the manifest state list as unmapped', () => {
    const { unmapped } = mapAttachmentsToStates(MANIFEST, STATES);
    expect(unmapped.map((u) => u.file)).toContain('g.png');
  });

  it('uses the effective state list for custom and unknown state names', () => {
    const manifest = [{
      attachments: [
        { exportedFileName: 'shop.png', suggestedHumanReadableName: '03-shop_0_uuid.png', timestamp: 100 },
        { exportedFileName: 'fail.png', suggestedHumanReadableName: '06-fail_0_uuid.png', timestamp: 110 },
        { exportedFileName: 'intro.png', suggestedHumanReadableName: '02-level_intro_0_uuid.png', timestamp: 120 },
      ],
    }];

    const { byState, unmapped } = mapAttachmentsToStates(manifest, ['menu', 'shop', 'level_intro']);

    expect(byState.shop.file).toBe('shop.png');
    expect(byState.level_intro.file).toBe('intro.png');
    expect(byState.fail).toBeUndefined();
    expect(unmapped).toEqual([{ file: 'fail.png', humanName: '06-fail_0_uuid.png' }]);
  });

  it('maps fail-loud *-MISSING runner shots back to their intended state as ungated', () => {
    const manifest = [{
      attachments: [
        { exportedFileName: 'missing.png', suggestedHumanReadableName: '6-fail-MISSING_0_uuid.png', timestamp: 100 },
      ],
    }];
    const { byState, unmapped } = mapAttachmentsToStates(manifest, STATES);
    expect(byState.fail.file).toBe('missing.png');
    expect(byState.fail.gated).toBe(false);
    expect(unmapped).toEqual([]);
  });

  it('is empty-safe', () => {
    expect(mapAttachmentsToStates([], STATES).byState).toEqual({});
    expect(mapAttachmentsToStates(null, STATES).byState).toEqual({});
  });

  it('maps viewport metrics text attachments separately from screenshots', () => {
    const manifest = [{
      attachments: [
        { exportedFileName: 'old.txt', suggestedHumanReadableName: '1-menu-viewportmetrics_0_uuid.txt', timestamp: 100 },
        { exportedFileName: 'new.txt', suggestedHumanReadableName: '1-menu-viewportmetrics_1_uuid.txt', timestamp: 200 },
      ],
    }];

    const { byState, viewportMetricAttachments, unmapped } = mapAttachmentsToStates(manifest, STATES);

    expect(byState).toEqual({});
    expect(viewportMetricAttachments.menu.file).toBe('new.txt');
    expect(unmapped).toEqual([]);
  });
});

describe('extractFromExportDir + loadCapturesDir (fs)', () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-att-'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(MANIFEST));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('resolves attachment files to absolute paths under the export dir', () => {
    const { byState, captureByState } = extractFromExportDir(dir, STATES);
    expect(byState.menu).toBe(path.join(dir, 'menu-retake.png'));
    expect(byState.fail).toBe(path.join(dir, 'f.png'));
    expect(captureByState.menu).toEqual({ gated: true });
    expect(captureByState.fail).toEqual({ gated: true });
  });

  it('returns capture integrity flags from exported attachment names', () => {
    const blindDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-blind-'));
    fs.writeFileSync(path.join(blindDir, 'manifest.json'), JSON.stringify([{
      attachments: [
        { exportedFileName: 'fail.png', suggestedHumanReadableName: '6-fail-MISSING_0_uuid.png', timestamp: 100 },
      ],
    }]));

    const { byState, captureByState } = extractFromExportDir(blindDir, STATES);

    expect(byState.fail).toBe(path.join(blindDir, 'fail.png'));
    expect(captureByState.fail).toEqual({ gated: false });
    fs.rmSync(blindDir, { recursive: true, force: true });
  });

  it('parses viewport metrics text sidecars from the export dir', () => {
    const metricsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-metrics-'));
    fs.writeFileSync(path.join(metricsDir, 'manifest.json'), JSON.stringify([{
      attachments: [{
        exportedFileName: 'menu-metrics.txt',
        suggestedHumanReadableName: '1-menu-viewportmetrics_0_uuid.txt',
        timestamp: 100,
      }],
    }]));
    fs.writeFileSync(
      path.join(metricsDir, 'menu-metrics.txt'),
      'viewportmetrics:state=tourstate:menu;inner=390x844;vv=390x800@1;screen=393x852;safe=59,0,34,0;canvas=390x844/780x1688;dpr=3'
    );

    const { viewportMetrics } = extractFromExportDir(metricsDir, STATES);

    expect(viewportMetrics.menu).toMatchObject({
      markerState: 'tourstate:menu',
      windowInnerWidth: 390,
      windowInnerHeight: 844,
      safeAreaInsetTop: 59,
      canvasBackingHeight: 1688,
      devicePixelRatio: 3,
    });
    fs.rmSync(metricsDir, { recursive: true, force: true });
  });

  it('round-trips runner viewport metrics sidecars into summary metrics', () => {
    const metricsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-metrics-roundtrip-'));
    fs.writeFileSync(path.join(metricsDir, 'manifest.json'), JSON.stringify([{
      attachments: [{
        exportedFileName: 'menu-viewportmetrics.txt',
        suggestedHumanReadableName: '1-menu-viewportmetrics_0_uuid.txt',
        timestamp: 100,
      }],
    }]));
    fs.writeFileSync(
      path.join(metricsDir, 'menu-viewportmetrics.txt'),
      'viewportmetrics:state=tourstate:menu;inner=390x844;vv=390x800@1;screen=393x852;safe=59,0,34,0;canvas=390x844/780x1688;dpr=3'
    );

    const { viewportMetrics } = extractFromExportDir(metricsDir, STATES);
    const summary = buildSummary({
      panel: { states: [{ state: 'menu', score: 91, status: 'pass', consensus: [] }] },
      phashVerdict: null,
      viewportMetrics,
    });

    expect(summary.menu.viewportMetrics).toMatchObject({
      markerState: 'tourstate:menu',
      windowInnerWidth: 390,
      windowInnerHeight: 844,
      visualViewportHeight: 800,
      safeAreaInsetTop: 59,
      canvasBackingHeight: 1688,
      devicePixelRatio: 3,
    });
    fs.rmSync(metricsDir, { recursive: true, force: true });
  });

  it('throws a clear error when the manifest is missing', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-empty-'));
    expect(() => extractFromExportDir(empty)).toThrow(/no manifest.json/);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('loadCapturesDir finds <state>.png files that exist', () => {
    const cdir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-cap-'));
    fs.writeFileSync(path.join(cdir, 'menu.png'), 'x');
    fs.writeFileSync(path.join(cdir, 'win.png'), 'x');
    fs.writeFileSync(path.join(cdir, 'fail.png'), 'x');
    const byState = loadCapturesDir(cdir, ['menu', 'win']);
    expect(Object.keys(byState).sort()).toEqual(['menu', 'win']);
    fs.rmSync(cdir, { recursive: true, force: true });
  });
});
