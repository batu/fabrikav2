import { describe, expect, test } from 'vitest';

import { buildFidelityGrid } from './fidelityGrid.ts';

describe('buildFidelityGrid', (): void => {
  test('renders one section per pair with both image srcs and the axes caption', (): void => {
    const html = buildFidelityGrid(
      [
        { name: 'menu', refSrc: 'refs/menu.png', candidateSrc: 'screenshots/menu.png', axes: 'layout · palette' },
        { name: 'settings', refSrc: 'refs/settings.png', candidateSrc: 'screenshots/settings.png' },
      ],
      { title: 'marble_run fidelity', refLabel: 'v1 android', candidateLabel: 'v2 harness', footer: 'run 2026-07-06' },
    );

    // Both states appear as headings.
    expect(html).toContain('<h2>menu</h2>');
    expect(html).toContain('<h2>settings</h2>');
    // Both image srcs are wired for each state.
    expect(html).toContain('src="refs/menu.png"');
    expect(html).toContain('src="screenshots/menu.png"');
    expect(html).toContain('src="refs/settings.png"');
    expect(html).toContain('src="screenshots/settings.png"');
    // Column labels + axes + footer flow through.
    expect(html).toContain('v1 android');
    expect(html).toContain('v2 harness');
    expect(html).toContain('layout · palette');
    expect(html).toContain('run 2026-07-06');
    // A state without axes emits no axes paragraph.
    expect(html.match(/class="axes"/g)?.length).toBe(1);
    // Self-contained: a single inline-styled document.
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<style>');
  });

  test('escapes HTML-significant characters in names and captions', (): void => {
    const html = buildFidelityGrid([{ name: '<x>&"', refSrc: 'r.png', candidateSrc: 'c.png', axes: "a<b'c" }]);
    expect(html).toContain('&lt;x&gt;&amp;&quot;');
    expect(html).toContain("a&lt;b&#39;c");
    expect(html).not.toContain('<h2><x>');
  });

  test('an empty pair list still produces a valid document (no rows)', (): void => {
    const html = buildFidelityGrid([]);
    expect(html).toContain('<!doctype html>');
    expect(html).not.toContain('class="pair"');
  });
});
