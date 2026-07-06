import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectRun } from './collectRun.ts';

const tmpDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fab-collectrun-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach((): void => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('collectRun', (): void => {
  test('writes a <date>-<topic> run dir in the evidence shape', (): void => {
    const outDir = scratch();
    const result = collectRun({
      outDir,
      date: '2026-07-06',
      topic: 'menu-nav',
      artifacts: {
        screenshots: [{ name: 'menu', capture: { pngBase64: 'iVBORw0KGgo=', width: 4, height: 4 } }],
        snapshots: [{ fingerprint: { scene: 'menu' }, ts: 1, buildVersion: 'x', packageId: 'com.y' }],
        events: [{ name: 'level_start', params: { level_id: 'l1' }, timestamp: 5 }],
        perf: { buckets: [{ label: '>=60', count: 2 }], worstFrameMs: 16, frameCount: 2 },
      },
    });

    expect(result.dir).toBe(join(outDir, '2026-07-06-menu-nav'));

    // The dir contains exactly the expected top-level entries.
    expect(readdirSync(result.dir).sort()).toEqual([
      'events.json',
      'manifest.json',
      'perf.json',
      'screenshots',
      'snapshots.json',
    ]);
    expect(readdirSync(join(result.dir, 'screenshots'))).toEqual(['menu.png']);

    // The base64 screenshot round-trips to bytes on disk.
    const png = readFileSync(join(result.dir, 'screenshots', 'menu.png'));
    expect(png.equals(Buffer.from('iVBORw0KGgo=', 'base64'))).toBe(true);

    // The manifest indexes what was captured.
    const manifest = JSON.parse(readFileSync(join(result.dir, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ topic: 'menu-nav', date: '2026-07-06', hasPerf: true });
  });

  test('a screenshots-only run omits the empty witness files', (): void => {
    const outDir = scratch();
    const result = collectRun({
      outDir,
      date: '2026-07-06',
      topic: 'shots',
      artifacts: { screenshots: [{ name: 'a', capture: { pngBase64: 'AA==', width: 1, height: 1 } }] },
    });
    expect(readdirSync(result.dir).sort()).toEqual(['manifest.json', 'screenshots']);
  });
});
