import type { LevelData } from './levels';
import ledger from './birdDifficultyRatings.json';

interface ReviewedLevel {
  levelId: string;
  levelJsonHash: string;
  colorImageHash: string;
  ratings: Partial<Record<string, number>>;
}

/** Subjective 1–5 visual ratings; fail closed for unreviewed or replaced artwork. */
export function isHardBird(level: LevelData, birdId: string, reviews: readonly ReviewedLevel[] = ledger.levels): boolean {
  const review = reviews.find((entry) => entry.levelId === level.id);
  if (!review || !level.sourceHashes
    || review.levelJsonHash !== level.sourceHashes.levelJson
    || review.colorImageHash !== level.sourceHashes.colorImage) return false;
  const hard = level.dogs.filter((bird) => (review.ratings[bird.id] ?? 0) >= 3.5)
    .sort((a, b) => (review.ratings[b.id] ?? 0) - (review.ratings[a.id] ?? 0) || a.id.localeCompare(b.id))
    .slice(0, Math.floor(level.dogs.length * 0.2));
  return hard.some((bird) => bird.id === birdId);
}
