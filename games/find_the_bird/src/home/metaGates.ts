/**
 * Which meta-game tiles are open, and whether their unlock still owes the
 * player a celebration.
 *
 * The two gates are deliberately chained rather than parallel: Collection opens
 * on level progress, and the Sanctuary only opens once the collection has
 * actually produced a bird to house. A Sanctuary with nothing to put in it is
 * an empty room, so it stays locked until the first card unlocks.
 */

import { isUnlocked, type CollectionThresholds } from '../collection/thresholds';

export interface MetaGateInput {
  totalLevelsCompleted: number;
  sparrowCount: number;
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

  const collectionUnlocked = levels >= required;
  const sanctuaryLevel = Number.isFinite(input.sanctuaryUnlockLevel)
    ? Math.max(0, Math.floor(input.sanctuaryUnlockLevel))
    : 0;
  // The Sanctuary needs a tenant to be worth opening, and the Collection is
  // where tenants come from, so it can never open first.
  // It also carries a level gate of its own: the locked tile promises a level
  // number, and a promise the sparrow count could break is not one to make.
  const sanctuaryUnlocked = collectionUnlocked && levels >= sanctuaryLevel && isUnlocked(input.sparrowCount, input.thresholds);

  return {
    collectionUnlocked,
    sanctuaryUnlocked,
    collectionPopPending: collectionUnlocked && !input.collectionPopShown,
    sanctuaryPopPending: sanctuaryUnlocked && !input.sanctuaryPopShown,
  };
}
