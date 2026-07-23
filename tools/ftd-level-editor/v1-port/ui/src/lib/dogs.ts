import type { DogState } from '../types';

export function hasActiveVariant(dog: DogState): dog is DogState & { activeVariant: number } {
  return dog.activeVariant !== null;
}
