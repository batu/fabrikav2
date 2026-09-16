import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installMemStorage, removeMemStorage } from './support/memStorage';
import { GameState } from '../../src/core/GameState';
import {
  birdTypeSnapshot,
  isSparrow,
  resetBirdTypesForTest,
  setBirdTypesForTest,
  type BirdTypeIndex,
} from '../../src/data/birdTypes';

const INDEX: BirdTypeIndex = {
  version: 1,
  levels: {
    lvl_a: { dog_00: 'sparrow', dog_01: 'robin', dog_02: 'sparrow' },
    lvl_untagged: {},
  },
};

/**
 * The counting rule GameScene.onDogFound applies, exercised without Phaser:
 * count once per bird, only on the first accept, only for a tagged sparrow.
 */
function findBird(state: GameState, foundIds: Set<string>, levelId: string, dogId: string): void {
  const isFirstFind = !foundIds.has(dogId);
  foundIds.add(dogId);
  if (!isFirstFind) return;
  const index = birdTypeSnapshot();
  if (index === null || !isSparrow(index, levelId, dogId)) return;
  state.incrementBirdCount('sparrow');
}

describe('collection pickup counting', () => {
  let state: GameState;
  let found: Set<string>;

  beforeEach(() => {
    installMemStorage();
    setBirdTypesForTest(INDEX);
    state = new GameState();
    found = new Set<string>();
  });

  afterEach(() => {
    resetBirdTypesForTest();
    removeMemStorage();
  });

  it('counts a tagged sparrow', () => {
    findBird(state, found, 'lvl_a', 'dog_00');
    expect(state.birdCount('sparrow')).toBe(1);
  });

  it('ignores a bird tagged as another species', () => {
    findBird(state, found, 'lvl_a', 'dog_01');
    expect(state.birdCount('sparrow')).toBe(0);
    expect(state.birdCount('robin')).toBe(0);
  });

  it('ignores an untagged bird and an untagged level', () => {
    findBird(state, found, 'lvl_a', 'dog_99');
    findBird(state, found, 'lvl_untagged', 'dog_00');
    findBird(state, found, 'lvl_missing', 'dog_00');
    expect(state.birdCount('sparrow')).toBe(0);
  });

  it('counts each bird once even when the same find replays', () => {
    findBird(state, found, 'lvl_a', 'dog_00');
    findBird(state, found, 'lvl_a', 'dog_00');
    findBird(state, found, 'lvl_a', 'dog_00');
    expect(state.birdCount('sparrow')).toBe(1);
  });

  it('counts each distinct sparrow in a level', () => {
    findBird(state, found, 'lvl_a', 'dog_00');
    findBird(state, found, 'lvl_a', 'dog_02');
    expect(state.birdCount('sparrow')).toBe(2);
  });

  it('counts nothing at all while the tag index has not loaded', () => {
    resetBirdTypesForTest();
    findBird(state, found, 'lvl_a', 'dog_00');
    expect(state.birdCount('sparrow')).toBe(0);
  });

  it('keeps counting across a fresh level attempt', () => {
    findBird(state, found, 'lvl_a', 'dog_00');
    const retried = new Set<string>(); // level restart clears the found set
    findBird(state, retried, 'lvl_a', 'dog_00');
    expect(state.birdCount('sparrow')).toBe(2);
  });
});
