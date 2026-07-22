import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(gameRoot, 'src/scenes/HomeScene.ts'), 'utf8');
const css = readFileSync(join(gameRoot, 'src/ui/styles.css'), 'utf8');

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

  it('preserves compact touch sizing for the rail entry', () => {
    expect(css).toContain('.home-achievements-btn');
    expect(css).toMatch(/\.home-side-btn\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(css).toContain('@media (max-height: 600px)');
  });

  it('opens the achievements page when the home rail button is actually clicked', async () => {
    const { bindHomeNavigation } = await import('../../src/ui/homeNavigation');
    const overlay = document.createElement('div');
    overlay.innerHTML = '<button id="home-achievements" type="button"></button>';
    document.body.appendChild(overlay);
    const openPage = vi.fn();
    bindHomeNavigation(overlay, { triggerNavBounce: vi.fn(), startCurrentLevel: vi.fn(), openPage });

    overlay.querySelector<HTMLButtonElement>('#home-achievements')!.click();
    expect(openPage).toHaveBeenCalledWith('achievements');

    // With a page overlay already open, the click must be a no-op.
    openPage.mockClear();
    const pageOverlay = document.createElement('div');
    pageOverlay.id = 'home-page-overlay';
    document.body.appendChild(pageOverlay);
    overlay.querySelector<HTMLButtonElement>('#home-achievements')!.click();
    expect(openPage).not.toHaveBeenCalled();
    pageOverlay.remove();
    overlay.remove();
  });
});
