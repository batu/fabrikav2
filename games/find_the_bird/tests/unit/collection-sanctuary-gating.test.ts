import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemStorage, removeMemStorage } from './support/memStorage';
import { metaGates } from '../../src/home/metaGates';
import { bindHomeNavigation } from '../../src/ui/homeNavigation';
import type { CollectionThresholds } from '../../src/collection/thresholds';

const THRESHOLDS: CollectionThresholds = { unlock: 10, hat: 20, cardigan: 35 };

function gates(levels: number, sparrows: number, shown = { collection: false, sanctuary: false }) {
  return metaGates({
    totalLevelsCompleted: levels,
    sparrowCount: sparrows,
    sparrowRungClaimed: sparrows >= THRESHOLDS.unlock ? 1 : 0,
    // Deliberately DIFFERENT, mirroring the shipped 2 and 7: with both set to
    // the same number the Sanctuary's own gate was never exercised, and the
    // chain rule that keeps it behind the Collection could not fail this file.
    collectionUnlockLevel: 2,
    sanctuaryUnlockLevel: 7,
    thresholds: THRESHOLDS,
    collectionPopShown: shown.collection,
    sanctuaryPopShown: shown.sanctuary,
  });
}

describe('meta tile gates', () => {
  // Both gates are ARRIVAL-based (metaGates, 2026-09-18): a tile promising
  // "Level 5" is open when the player arrives at level 5, which is four
  // completions, not five. These three cases were left asserting the older
  // completion-based rule and the since-removed "sanctuary needs a bird card"
  // rule, so they are restated against what metaGates documents.
  it('keeps both tiles locked before the collection level', () => {
    const result = gates(0, 0);
    expect(result.collectionUnlocked).toBe(false);
    expect(result.sanctuaryUnlocked).toBe(false);
  });

  it('opens the collection on arrival at the configured level', () => {
    expect(gates(0, 0).collectionUnlocked).toBe(false);
    expect(gates(1, 0).collectionUnlocked).toBe(true);
  });

  it('opens the sanctuary on its own later level, with or without a bird claimed', () => {
    // Gate 7 = six completions, five after the Collection's. The bird count is
    // irrelevant to it either way.
    expect(gates(5, 50).sanctuaryUnlocked).toBe(false);
    expect(gates(6, 0).sanctuaryUnlocked).toBe(true);
  });

  it('leaves the collection open while the sanctuary is still shut', () => {
    const between = gates(3, 0);
    expect(between.collectionUnlocked).toBe(true);
    expect(between.sanctuaryUnlocked).toBe(false);
  });

  it('never opens the sanctuary before the collection, however many birds', () => {
    // Levels back-filled from an older save could out-run the level gate.
    expect(gates(1, 50).sanctuaryUnlocked).toBe(false);
  });

  it('reports a pending pop only while it has not been shown', () => {
    expect(gates(6, 10).collectionPopPending).toBe(true);
    expect(gates(6, 10).sanctuaryPopPending).toBe(true);
    const seen = gates(6, 10, { collection: true, sanctuary: true });
    expect(seen.collectionPopPending).toBe(false);
    expect(seen.sanctuaryPopPending).toBe(false);
  });

  it('never claims a pop for a locked tile', () => {
    const result = gates(0, 0);
    expect(result.collectionPopPending).toBe(false);
    expect(result.sanctuaryPopPending).toBe(false);
  });

  it('treats nonsense progress as no progress', () => {
    expect(gates(Number.NaN, 0).collectionUnlocked).toBe(false);
    expect(gates(-3, 0).collectionUnlocked).toBe(false);
  });
});

describe('home nav routing', () => {
  beforeEach(() => { installMemStorage(); });
  afterEach(() => { removeMemStorage(); document.body.innerHTML = ''; });

  function mount(options: { collectionLocked: boolean; sanctuaryLocked: boolean }): {
    overlay: HTMLElement; opened: string[];
  } {
    const overlay = document.createElement('div');
    overlay.innerHTML = `
      <button id="home-nav-sanctuary" class="home-nav-btn${options.sanctuaryLocked ? ' home-nav-btn--locked' : ''}"></button>
      <button id="home-nav-collection" class="home-nav-btn${options.collectionLocked ? ' home-nav-btn--locked' : ''}"></button>
      <button id="home-nav-shop" class="home-nav-btn"></button>
    `;
    document.body.appendChild(overlay);
    const opened: string[] = [];
    bindHomeNavigation(overlay, {
      triggerNavBounce: () => {},
      startCurrentLevel: () => {},
      openPage: ((id: string) => { opened.push(id); }) as never,
    });
    return { overlay, opened };
  }

  it('routes both tiles when they are unlocked', () => {
    const { overlay, opened } = mount({ collectionLocked: false, sanctuaryLocked: false });
    overlay.querySelector<HTMLButtonElement>('#home-nav-collection')?.click();
    overlay.querySelector<HTMLButtonElement>('#home-nav-sanctuary')?.click();
    expect(opened).toEqual(['collection', 'sanctuary']);
  });

  it('refuses to open a locked tile', () => {
    const { overlay, opened } = mount({ collectionLocked: true, sanctuaryLocked: true });
    overlay.querySelector<HTMLButtonElement>('#home-nav-collection')?.click();
    overlay.querySelector<HTMLButtonElement>('#home-nav-sanctuary')?.click();
    expect(opened).toEqual([]);
  });

  it('shakes a locked tile instead of navigating', () => {
    const { overlay } = mount({ collectionLocked: true, sanctuaryLocked: false });
    const locked = overlay.querySelector<HTMLButtonElement>('#home-nav-collection');
    locked?.click();
    expect(locked?.classList.contains('home-nav-btn--shake')).toBe(true);
  });

  it('leaves the existing shop route intact', () => {
    const { overlay, opened } = mount({ collectionLocked: true, sanctuaryLocked: true });
    overlay.querySelector<HTMLButtonElement>('#home-nav-shop')?.click();
    expect(opened).toEqual(['shop']);
  });

  it('opens nothing while a page is already open', () => {
    const { overlay, opened } = mount({ collectionLocked: false, sanctuaryLocked: false });
    const page = document.createElement('div');
    page.id = 'home-page-overlay';
    document.body.appendChild(page);
    overlay.querySelector<HTMLButtonElement>('#home-nav-collection')?.click();
    expect(opened).toEqual([]);
    vi.restoreAllMocks();
  });
});
