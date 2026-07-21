import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/scenes/HomeScene.ts'), 'utf8');
const css = readFileSync(join(process.cwd(), 'src/ui/styles.css'), 'utf8');

describe('achievement Home discovery', () => {
  it('keeps Achievements in the two-action left rail and bottom navigation at three cells', () => {
    const rail = source.match(/<aside class="home-rail home-rail-left"[\s\S]*?<\/aside>/)?.[0] ?? '';
    const nav = source.match(/<nav class="home-nav-bar"[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(rail).toContain('id="home-no-ads"');
    expect(rail).toContain('id="home-achievements"');
    expect(rail).toContain('aria-label="Open achievements"');
    expect(nav).not.toContain('home-achievements');
    expect(nav.match(/<button/g)).toHaveLength(3);
    expect([...nav.matchAll(/<span>(Shop|Play|Settings)<\/span>/g)].map((match) => match[1])).toEqual(['Shop', 'Play', 'Settings']);
  });

  it('wires the action to the existing page shell and preserves compact touch sizing', () => {
    expect(source).toContain("openPage('achievements')");
    expect(css).toContain('.home-achievements-btn');
    expect(css).toMatch(/\.home-side-btn\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(css).toContain('@media (max-height: 600px)');
  });
});
