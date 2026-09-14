import { expect, it } from 'vitest';
import { isHardBird } from './birdDifficulty';
import type { LevelData } from './levels';

const level: LevelData = {
  id: 'reviewed', name: 'Fixture', width: 100, height: 100, colorImage: 'blob:runtime',
  sourceHashes: { levelJson: 'layout-v1', colorImage: 'art-v1' },
  dogs: Array.from({ length: 10 }, (_, i) => ({ id: String(i), x: i * 10, y: 50, r: 5 })),
};
const reviews = [{ levelId: level.id, levelJsonHash: 'layout-v1', colorImageHash: 'art-v1',
  ratings: { '0': 5, '1': 4.5, '2': 4, '3': 3 } }];

it('requires genuine difficulty and caps hard finds at the hardest fifth', () => {
  expect(level.dogs.filter((bird) => isHardBird(level, bird.id, reviews)).map((bird) => bird.id)).toEqual(['0', '1']);
  expect(isHardBird(level, '3', [{ ...reviews[0], ratings: { '3': 3 } }])).toBe(false);
  expect(isHardBird(level, '3', [{ ...reviews[0], ratings: { '3': 3.5 } }])).toBe(true);
});

it('does not transfer ratings across unreviewed levels, missing provenance, or changed assets', () => {
  expect(isHardBird({ ...level, id: 'unreviewed' }, '0', reviews)).toBe(false);
  expect(isHardBird({ ...level, sourceHashes: undefined }, '0', reviews)).toBe(false);
  expect(isHardBird({ ...level, sourceHashes: { ...level.sourceHashes!, colorImage: 'art-v2' } }, '0', reviews)).toBe(false);
  expect(isHardBird({ ...level, sourceHashes: { ...level.sourceHashes!, levelJson: 'layout-v2' } }, '0', reviews)).toBe(false);
  expect(isHardBird(level, 'missing', reviews)).toBe(false);
});
