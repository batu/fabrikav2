/**
 * What the level HUD's bird counters should show.
 *
 * One counter per collecting bird, in chain order, so a player working three
 * ladders at once can see all three climb instead of only the one the HUD
 * happens to be focused on. The view layer owns the markup and the animation;
 * this module owns the question of which pills exist and what they read.
 *
 * The gate is a parameter rather than an import: everything else under
 * `collection/` depends only on the save and the config, and reaching up into
 * the HUD's `currentMetaGates` to ask whether the Collection is open would
 * invert that.
 */

import { BIRDS, BIRD_DEFS, type BirdId } from './birds';
import { isBirdOpen, ladderFor } from './ladders';
import { gameState } from '../core/GameState';
import type { Ladder } from './thresholds';

export interface BirdCounter {
  bird: BirdId;
  /** The pill's element id, so a pickup flight can be aimed at it. */
  elementId: string;
  iconSrc: string;
  /** Pill copy: the per-rung tally, or the call to action when a rung is ready. */
  label: string;
  /** A rung is earned and waiting to be claimed — the pill is the way to the card. */
  ready: boolean;
  /** The ladder is finished; nothing left to collect for this bird. */
  done: boolean;
  ariaLabel: string;
  rung: Ladder;
  /** Lifetime pickups of this species. Moves on every pickup even when the
   *  label does not, so the view can tell which pill to animate. */
  count: number;
}

/** Stable per-bird pill id. The sparrow keeps `sparrow-counter`, which the
 *  stylesheet and the pickup flight's default already name. */
export function birdCounterElementId(bird: BirdId): string {
  return `${bird}-counter`;
}

/**
 * Pill copy. A ready rung shouts instead of counting, a finished ladder says
 * so, and everything else counts within the current rung rather than towards a
 * lifetime total: a fresh rung starts at 0, so 45 of 65 reads as 0 / 20.
 */
export function counterLabel(rung: Ladder, count: number): string {
  if (rung.ready) return 'Unlock!';
  if (rung.target === null) return 'Done';
  const within = Math.max(0, Math.min(count, rung.target) - rung.from);
  return `${String(within)} / ${String(rung.target - rung.from)}`;
}

function counterFor(bird: BirdId): BirdCounter {
  const rung = ladderFor(bird);
  const count = gameState.birdCount(bird);
  const def = BIRD_DEFS[bird];
  return {
    bird,
    elementId: birdCounterElementId(bird),
    // The plain portrait, never the costume: the pill is about the species, and
    // swapping its face mid-ladder would read as a different bird.
    iconSrc: def.portraits.plain,
    label: counterLabel(rung, count),
    ready: rung.ready,
    done: rung.target === null,
    ariaLabel: `${def.species}s collected towards the next unlock`,
    rung,
    count,
  };
}

/**
 * Every collecting bird's counter, in the order the birds open. Empty while the
 * Collection itself is locked, since a counter towards a card the player cannot
 * see yet is noise.
 */
export function visibleBirdCounters(collectionUnlocked: boolean): BirdCounter[] {
  if (!collectionUnlocked) return [];
  return BIRDS.filter((bird) => isBirdOpen(bird)).map(counterFor);
}
