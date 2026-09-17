/**
 * Live view of every bird's ladder from the save + config: which birds are
 * collecting, and which one the HUD should be talking about.
 */

import { gameState } from '../core/GameState';
import { collectionTeaseCount, collectionThresholds } from './config';
import { BIRDS, birdOpen, type BirdId } from './birds';
import { clampRung, ladder, type Ladder, type Rung } from './thresholds';
import type { CardInputs } from './cardModel';

export function claimedRungOf(bird: BirdId): Rung {
  return clampRung(gameState.ladderOf(bird).claimedRung);
}

export function isBirdOpen(bird: BirdId): boolean {
  return birdOpen(bird, claimedRungOf);
}

export function ladderFor(bird: BirdId): Ladder {
  return ladder(gameState.birdCount(bird), claimedRungOf(bird), collectionThresholds(bird));
}

export function cardInputsFor(bird: BirdId): CardInputs {
  const meta = gameState.ladderOf(bird);
  return {
    bird,
    open: isBirdOpen(bird),
    count: gameState.birdCount(bird),
    thresholds: collectionThresholds(bird),
    claimed: clampRung(meta.claimedRung),
    selected: meta.selectedRung,
    teaseCount: collectionTeaseCount(),
  };
}

export function allCardInputs(): CardInputs[] {
  return BIRDS.map(cardInputsFor);
}

/**
 * The ladder the HUD follows: among open, unfinished birds, a ready rung wins,
 * else the fewest pickups remaining. Null when nothing is collecting.
 */
export function focusBird(): { bird: BirdId; rung: Ladder } | null {
  let best: { bird: BirdId; rung: Ladder } | null = null;
  for (const bird of BIRDS) {
    if (!isBirdOpen(bird)) continue;
    const rung = ladderFor(bird);
    if (rung.target === null) continue;
    if (best === null || (rung.ready && !best.rung.ready) || (rung.ready === best.rung.ready && rung.remaining < best.rung.remaining)) best = { bird, rung };
  }
  return best;
}
