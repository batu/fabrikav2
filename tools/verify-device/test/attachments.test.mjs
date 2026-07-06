import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapAttachmentsToStates, extractFromExportDir, loadCapturesDir } from '../src/attachments.mjs';

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

describe('mapAttachmentsToStates', () => {
  it('maps each canonical state to its attachment file', () => {
    const { byState } = mapAttachmentsToStates(MANIFEST);
    expect(byState.level.file).toBe('b.png');
    expect(byState.settings.file).toBe('c.png');
    expect(byState.pause.file).toBe('d.png');
    expect(byState.win.file).toBe('e.png');
    expect(byState.fail.file).toBe('f.png');
  });

  it('latest timestamp wins for a re-captured state', () => {
    const { byState } = mapAttachmentsToStates(MANIFEST);
    expect(byState.menu.file).toBe('menu-retake.png');
  });

  it('collects non-canonical attachments as unmapped (e.g. 7-final)', () => {
    const { unmapped } = mapAttachmentsToStates(MANIFEST);
    expect(unmapped.map((u) => u.file)).toContain('g.png');
  });

  it('is empty-safe', () => {
    expect(mapAttachmentsToStates([]).byState).toEqual({});
    expect(mapAttachmentsToStates(null).byState).toEqual({});
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
    const { byState } = extractFromExportDir(dir);
    expect(byState.menu).toBe(path.join(dir, 'menu-retake.png'));
    expect(byState.fail).toBe(path.join(dir, 'f.png'));
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
    const byState = loadCapturesDir(cdir);
    expect(Object.keys(byState).sort()).toEqual(['menu', 'win']);
    fs.rmSync(cdir, { recursive: true, force: true });
  });
});
