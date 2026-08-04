import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(gameRoot, 'src/scenes/HomeScene.ts'), 'utf8');
describe('achievement Home discovery', () => {
  it('keeps Play Now as the sole play action and puts Achievements, Shop, and Settings in the bottom bar', () => {
    const rail = source.match(/<aside class="home-rail home-rail-left"[\s\S]*?<\/aside>/)?.[0] ?? '';
    const nav = source.match(/<nav class="home-nav-bar"[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(rail).toContain('id="home-no-ads"');
    expect(rail).not.toContain('id="home-achievements"');
    expect(nav).toContain('id="home-nav-achievements"');
    expect(nav).not.toContain('id="home-nav-play"');
    expect(nav.match(/<button/g)).toHaveLength(3);
    expect([...nav.matchAll(/<span>(Settings|Shop|Achievements)<\/span>/g)].map((match) => match[1])).toEqual([
      'Achievements', 'Shop', 'Settings',
    ]);
  });

  it('opens the achievements page when its bottom-bar button is clicked', async () => {
    const { bindHomeNavigation } = await import('../../src/ui/homeNavigation');
    const overlay = document.createElement('div');
    overlay.innerHTML = '<button id="home-nav-achievements" type="button"></button>';
    document.body.appendChild(overlay);
    const openPage = vi.fn();
    bindHomeNavigation(overlay, { triggerNavBounce: vi.fn(), startCurrentLevel: vi.fn(), openPage });

    overlay.querySelector<HTMLButtonElement>('#home-nav-achievements')!.click();
    expect(openPage).toHaveBeenCalledWith('achievements');

    // With a page overlay already open, the click must be a no-op.
    openPage.mockClear();
    const pageOverlay = document.createElement('div');
    pageOverlay.id = 'home-page-overlay';
    document.body.appendChild(pageOverlay);
    overlay.querySelector<HTMLButtonElement>('#home-nav-achievements')!.click();
    expect(openPage).not.toHaveBeenCalled();
    pageOverlay.remove();
    overlay.remove();
  });
});
