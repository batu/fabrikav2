import { describe, expect, test } from 'vitest';

import { buildRunLayout } from './runLayout.ts';

describe('buildRunLayout', (): void => {
  test('names the dir <date>-<topic> and always emits a manifest', (): void => {
    const layout = buildRunLayout({ date: '2026-07-06', topic: 'menu-nav', artifacts: {} });
    expect(layout.dirName).toBe('2026-07-06-menu-nav');
    const paths = layout.files.map((f) => f.path);
    expect(paths).toEqual(['manifest.json']);
  });

  test('lays out screenshots/, snapshots, events, and perf when present', (): void => {
    const layout = buildRunLayout({
      date: '2026-07-06',
      topic: 'full-run',
      artifacts: {
        screenshots: [
          { name: 'menu', capture: { pngBase64: 'AAAA', width: 2, height: 2 } },
          { name: 'level.png', capture: { pngBase64: 'BBBB', width: 2, height: 2 } },
        ],
        snapshots: [{ fingerprint: { scene: 'menu' }, ts: 1, buildVersion: 'x', packageId: 'y' }],
        events: [{ name: 'level_start', params: { level_id: 'l1' }, timestamp: 1 }],
        perf: { buckets: [{ label: '>=60', count: 1 }], worstFrameMs: 16, frameCount: 1 },
      },
    });

    const paths = layout.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'events.json',
      'manifest.json',
      'perf.json',
      'screenshots/level.png',
      'screenshots/menu.png',
      'snapshots.json',
    ]);

    const menu = layout.files.find((f) => f.path === 'screenshots/menu.png');
    expect(menu).toMatchObject({ content: 'AAAA', encoding: 'base64' });

    const manifest = JSON.parse(layout.files.find((f) => f.path === 'manifest.json')!.content);
    expect(manifest).toMatchObject({
      topic: 'full-run',
      date: '2026-07-06',
      screenshots: ['screenshots/menu.png', 'screenshots/level.png'],
      snapshotCount: 1,
      eventCount: 1,
      hasPerf: true,
    });
  });

  test('omits empty witness files but still records zero counts in the manifest', (): void => {
    const layout = buildRunLayout({
      date: '2026-07-06',
      topic: 'shots-only',
      artifacts: { screenshots: [{ name: 'only', capture: { pngBase64: 'Z', width: 1, height: 1 } }] },
    });
    const paths = layout.files.map((f) => f.path).sort();
    expect(paths).toEqual(['manifest.json', 'screenshots/only.png']);
    const manifest = JSON.parse(layout.files.find((f) => f.path === 'manifest.json')!.content);
    expect(manifest).toMatchObject({ snapshotCount: 0, eventCount: 0, hasPerf: false });
  });
});
