import { FIND_THE_DOG_POLICY } from './policies/find-the-dog.mjs';
import { FIND_THE_BIRD_POLICY } from './policies/find-the-bird.mjs';

const POLICIES = new Map([
  ['find_the_dog', FIND_THE_DOG_POLICY],
  ['find_the_bird', FIND_THE_BIRD_POLICY],
]);

export function getGamePolicy(game) {
  const policy = POLICIES.get(game);
  if (!policy) throw new Error(`game-env has no policy for game: ${game}`);
  return policy;
}
