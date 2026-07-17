import { FIND_THE_DOG_POLICY } from './policies/find-the-dog.mjs';

const POLICIES = new Map([
  ['find_the_dog', FIND_THE_DOG_POLICY],
]);

export function getGamePolicy(game) {
  const policy = POLICIES.get(game);
  if (!policy) throw new Error(`game-env has no policy for game: ${game}`);
  return policy;
}
