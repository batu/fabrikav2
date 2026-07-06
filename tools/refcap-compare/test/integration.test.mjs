import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameManifest, buildOfflineRows } from '../src/run.mjs';
import { buildGridHtml } from '../src/grid.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('offline grid build (marble_run manifest)', () => {
  const manifest = loadGameManifest('marble_run', REPO);

  it('loads the canonical states from the committed manifest', () => {
    expect(manifest.game).toBe('marble_run');
    expect(manifest.states.map((s) => s.name)).toEqual(
      ['menu', 'level', 'settings', 'pause', 'win', 'fail'],
    );
    expect(manifest.reference.package).toBe('com.basegamelab.marblerun');
  });

  it('builds one row per state, passing the dedup guard, and marks gaps explicitly', () => {
    const { rows, captures } = buildOfflineRows(manifest);
    expect(rows).toHaveLength(6);
    // pause has no reference; fail has no v2 -> both are documented gaps.
    const pause = rows.find((r) => r.state === 'pause');
    expect(pause.reference.gap).toBeTruthy();
    expect(pause.diff).toBe(null);
    const fail = rows.find((r) => r.state === 'fail');
    expect(fail.v2.gap).toBeTruthy();
    // 6 states * 2 lanes - 2 gaps = 10 real captures
    expect(captures).toHaveLength(10);
  });

  it('stamps package/version/resolution metadata on every real capture', () => {
    const { rows } = buildOfflineRows(manifest);
    const menu = rows.find((r) => r.state === 'menu');
    expect(menu.reference.package).toBe('com.basegamelab.marblerun');
    expect(menu.reference.resolution).toBe('1080x2400');
    expect(menu.reference.sig).toMatch(/^[0-9a-f]{8}$/);
    expect(menu.v2.package).toBe('com.fabrikav2.marble_run');
  });

  it('renders a self-contained HTML grid with inlined images and gap placeholders', () => {
    const { rows } = buildOfflineRows(manifest);
    const html = buildGridHtml({ game: 'marble_run', generatedAt: '2026-07-06', mode: 'offline', rows });
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toMatch(/src="(?!data:)/); // no external image refs
    expect(html).toContain('documented gap');
    expect((html.match(/<h2>/g) || []).length).toBe(6);
  });
});
