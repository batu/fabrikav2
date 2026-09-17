import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameState } from '../../src/core/GameState';
import { installMemStorage, removeMemStorage } from './support/memStorage';
import {
  cardState,
  isUnlocked,
  nextThreshold,
  type CollectionThresholds,
} from '../../src/collection/thresholds';
import { collectionDeck, sparrowCard, unknownCard, HIDDEN_LINE } from '../../src/collection/cardModel';

const THRESHOLDS: CollectionThresholds = { unlock: 10, hat: 20, cardigan: 35 };

describe('collection counters persist', () => {
  beforeEach(() => { installMemStorage(); });
  afterEach(() => { vi.restoreAllMocks(); removeMemStorage(); });

  it('starts at zero for an unknown species', () => {
    expect(new GameState().birdCount('sparrow')).toBe(0);
  });

  it('counts a pickup and survives a reload', () => {
    const state = new GameState();
    expect(state.incrementBirdCount('sparrow')).toBe(1);
    expect(state.incrementBirdCount('sparrow')).toBe(2);
    state.incrementBirdCount('robin');
    expect(new GameState().birdCount('sparrow')).toBe(2);
    expect(new GameState().birdCount('robin')).toBe(1);
  });

  it('persists a pickup immediately, without waiting for a broad save', () => {
    const state = new GameState();
    state.incrementBirdCount('sparrow');
    // Read storage directly: a crash right here must not cost the bird.
    const raw = JSON.parse(localStorage.getItem('ftb_bird_counts') ?? '{}') as Record<string, number>;
    expect(raw.sparrow).toBe(1);
  });

  it('ignores an empty species name', () => {
    const state = new GameState();
    expect(state.incrementBirdCount('')).toBe(0);
    expect(state.birdCounts).toEqual({});
  });

  it('falls back to defaults when the record is corrupt', () => {
    localStorage.setItem('ftb_bird_counts', '{"sparrow": "many", "robin": -4, "": 2}');
    expect(new GameState().birdCounts).toEqual({});
  });

  it('keeps counting in memory when storage refuses writes', () => {
    const state = new GameState();
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      expect(state.incrementBirdCount('sparrow')).toBe(1);
      expect(state.birdCount('sparrow')).toBe(1);
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('collection one-shot presentation flags', () => {
  beforeEach(() => { installMemStorage(); });
  afterEach(() => { removeMemStorage(); });

  it('records the tile pop and the card flip once each', () => {
    const state = new GameState();
    expect(state.collectionMeta).toEqual({ tileUnlockPopShown: false, plainFlipShown: false });
    state.markCollectionTileUnlockShown();
    state.markPlainFlipShown();
    const reloaded = new GameState();
    expect(reloaded.collectionMeta).toEqual({ tileUnlockPopShown: true, plainFlipShown: true });
  });

  it('treats a corrupt meta record as "nothing shown yet"', () => {
    localStorage.setItem('ftb_collection_meta', '["nope"]');
    expect(new GameState().collectionMeta).toEqual({ tileUnlockPopShown: false, plainFlipShown: false });
  });
});

describe('card state boundaries', () => {
  it.each([
    [0, 'silhouette'],
    [9, 'silhouette'],
    [10, 'plain'],
    [19, 'plain'],
    [20, 'hat'],
    [34, 'hat'],
    [35, 'cardigan'],
    [400, 'cardigan'],
  ])('%i pickups reads as %s', (count, expected) => {
    expect(cardState(count, THRESHOLDS)).toBe(expected);
  });

  it('unlocks exactly at the unlock threshold', () => {
    expect(isUnlocked(9, THRESHOLDS)).toBe(false);
    expect(isUnlocked(10, THRESHOLDS)).toBe(true);
  });

  it('clamps nonsense counts to zero', () => {
    expect(cardState(-5, THRESHOLDS)).toBe('silhouette');
    expect(cardState(Number.NaN, THRESHOLDS)).toBe('silhouette');
    expect(cardState(10.9, THRESHOLDS)).toBe('plain');
  });

  it('keeps the ladder monotonic even when misconfigured', () => {
    const broken: CollectionThresholds = { unlock: 10, hat: 4, cardigan: 1 };
    expect(cardState(10, broken)).toBe('plain');
    expect(cardState(11, broken)).toBe('hat');
    expect(cardState(12, broken)).toBe('cardigan');
  });
});

describe('next threshold', () => {
  it('reports the rung being worked towards', () => {
    expect(nextThreshold(6, THRESHOLDS)).toMatchObject({ label: 'Unlock', target: 10, current: 6 });
    expect(nextThreshold(10, THRESHOLDS)).toMatchObject({ label: 'Hat', target: 20 });
    expect(nextThreshold(25, THRESHOLDS)).toMatchObject({ label: 'Cardigan', target: 35 });
    expect(nextThreshold(35, THRESHOLDS)).toMatchObject({ label: 'Complete', target: null });
  });

  it('measures progress inside the current rung, not from zero', () => {
    // 15 of the way from 10 to 20 is half, not 75%.
    expect(nextThreshold(15, THRESHOLDS).fraction).toBeCloseTo(0.5, 5);
    expect(nextThreshold(5, THRESHOLDS).fraction).toBeCloseTo(0.5, 5);
    expect(nextThreshold(35, THRESHOLDS).fraction).toBe(1);
  });
});

describe('card view model', () => {
  it('hides name and copy while the sparrow is locked', () => {
    const card = sparrowCard({ count: 3, thresholds: THRESHOLDS, claimed: 0, selected: 0, teaseCount: 1 });
    expect(card.locked).toBe(true);
    expect(card.plaque).toBe('? ? ?');
    expect(card.lines).toEqual([HIDDEN_LINE, HIDDEN_LINE, HIDDEN_LINE]);
    expect(card.portraitSrc).toContain('silhouette');
    expect(card.progress).toMatchObject({ label: 'Unlock', target: 10, current: 3 });
  });

  it('reveals name, copy and the plain portrait at the unlock threshold', () => {
    const card = sparrowCard({ count: 10, thresholds: THRESHOLDS, claimed: 0, selected: 0, teaseCount: 1 });
    expect(card.locked).toBe(false);
    expect(card.plaque).toBe('Sparrow');
    expect(card.ribbon).toBe('Garden bird');
    expect(card.lines[0]).toContain('Loud');
    expect(card.portraitSrc).toContain('portrait-sparrow-plain');
  });

  it('swaps the portrait for each costume and drops progress when complete', () => {
    expect(sparrowCard({ count: 20, thresholds: THRESHOLDS, claimed: 0, selected: 0, teaseCount: 1 }).portraitSrc).toContain('portrait-sparrow-hat');
    expect(sparrowCard({ count: 35, thresholds: THRESHOLDS, claimed: 0, selected: 0, teaseCount: 1 }).portraitSrc).toContain('portrait-sparrow-cardigan');
    expect(sparrowCard({ count: 35, thresholds: THRESHOLDS, claimed: 0, selected: 0, teaseCount: 1 }).progress).toBeNull();
  });

  it('describes the unknown card as a locked placeholder', () => {
    const card = unknownCard();
    expect(card.locked).toBe(true);
    expect(card.ribbon).toBe('Coming soon');
    expect(card.progress).toBeNull();
    expect(card.portraitSrc).toContain('portrait-unknown');
  });

  it('builds a two-card deck in swipe order', () => {
    const deck = collectionDeck({ count: 0, thresholds: THRESHOLDS, claimed: 0, selected: 0, teaseCount: 1 });
    expect(deck.map((card) => card.kind)).toEqual(['sparrow', 'unknown']);
  });
});
