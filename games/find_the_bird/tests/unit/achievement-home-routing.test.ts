import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(gameRoot, 'src/scenes/HomeScene.ts'), 'utf8');

describe('achievement Home discovery', () => {
  it('puts Sanctuary, Play and Collection in the bottom bar, with Achievements behind its flag', async () => {
    const rail = source.match(/<aside class="home-rail home-rail-left"[\s\S]*?<\/aside>/)?.[0] ?? '';
    // The left rail holds the streak-claim pill (it took the No-Ads slot on
    // 2026-08-07; No-Ads was removed from Home). What matters for routing is
    // that Achievements is NOT a rail entry point.
    expect(rail).toContain('id="home-streak-reward"');
    expect(rail).not.toContain('id="home-achievements"');

    // The bar is built by a shared renderer, because the Collection and
    // Sanctuary pages show it too. Assert on what it RENDERS rather than on
    // HomeScene's source text, so the check survives the markup moving again.
    const { installMemStorage, removeMemStorage } = await import('./support/memStorage');
    const { renderMetaNavBar } = await import('../../src/ui/metaNavBar');
    installMemStorage();
    try {
      // 2026-09-17: Play took the middle slot as the magnifier tile, flanked by
      // the two meta screens; the Shop left the bar and is reached from the
      // coin and hint pills instead.
      const nav = renderMetaNavBar();
      expect(nav).toContain('id="home-nav-play"');
      expect(nav).not.toContain('id="home-nav-shop"');
      expect(nav.match(/<button/g)).toHaveLength(3);
      expect([...nav.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]))
        .toEqual(['Sanctuary', 'Play', 'Collection']);

      // 2026-09-16: Achievements is behind its flag (default off) and takes a
      // fourth slot when enabled.
      const withAchievements = renderMetaNavBar({ achievements: { enabled: true, claimable: 0 } });
      expect(withAchievements).toContain('id="home-nav-achievements"');
      expect(withAchievements).toContain('data-slots="4"');
      expect([...withAchievements.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]))
        .toEqual(['Achievements', 'Sanctuary', 'Play', 'Collection']);
    } finally {
      removeMemStorage();
    }

    // Home wires the flag through to the renderer, and Settings stayed an
    // icon-only corner button above the banner.
    expect(source).toContain('achievements: { enabled: achievementsEnabled');
    expect(source).toContain('id="home-nav-settings" class="home-settings-corner"');
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
