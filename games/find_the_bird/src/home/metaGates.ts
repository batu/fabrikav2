/**
 * Which meta-game tiles are open, and whether their unlock still owes the
 * player a celebration.
 *
 * Both gates are level gates, and the Sanctuary's is chained behind the
 * Collection's so it can never open first. The Sanctuary used to also require
 * an unlocked bird card, on the argument that a Sanctuary with nothing to house
 * is an empty room; that made the tile's promised level a lie for anyone who
 * had not claimed their sparrow, so reaching the level is now the whole test
 * (2026-09-18).
 */

import type { CollectionThresholds } from '../collection/thresholds';

export interface MetaGateInput {
  totalLevelsCompleted: number;
  sparrowCount: number;
  /**
   * Rung of the sparrow card the player has opened. No longer gates anything —
   * kept on the input so the call sites need not change while the Sanctuary's
   * condition is level-only.
   */
  sparrowRungClaimed: number;
  collectionUnlockLevel: number;
  /** The Sanctuary's own level gate; its locked tile advertises this level. */
  sanctuaryUnlockLevel: number;
  thresholds: CollectionThresholds;
  collectionPopShown: boolean;
  sanctuaryPopShown: boolean;
}

export interface MetaGates {
  collectionUnlocked: boolean;
  sanctuaryUnlocked: boolean;
  /** True when the tile is open but has not yet played its one-shot pop. */
  collectionPopPending: boolean;
  sanctuaryPopPending: boolean;
}

export function metaGates(input: MetaGateInput): MetaGates {
  const levels = Number.isFinite(input.totalLevelsCompleted)
    ? Math.max(0, Math.floor(input.totalLevelsCompleted))
    : 0;
  const required = Number.isFinite(input.collectionUnlockLevel)
    ? Math.max(0, Math.floor(input.collectionUnlockLevel))
    : 0;

  // Both tiles open on ARRIVAL at the level their locked pill promises, not on
  // clearing it: a pill reading "Level 10" that produces a card on level 11 is
  // a broken promise, and the two gates disagreeing about it is worse.
  const collectionUnlocked = levels >= Math.max(0, required - 1);
  const sanctuaryLevel = Number.isFinite(input.sanctuaryUnlockLevel)
    ? Math.max(0, Math.floor(input.sanctuaryUnlockLevel))
    : 0;
  // Entering the promised level opens the tile, rather than clearing it: the
  // locked tile advertises "Level 15", so the player must find it open when
  // they arrive at 15, which is one completion earlier than 15 completions.
  const sanctuaryUnlocked = collectionUnlocked && levels >= Math.max(0, sanctuaryLevel - 1);

  return {
    collectionUnlocked,
    sanctuaryUnlocked,
    collectionPopPending: collectionUnlocked && !input.collectionPopShown,
    sanctuaryPopPending: sanctuaryUnlocked && !input.sanctuaryPopShown,
  };
}
