/**
 * What a finished level offers instead of the next level.
 *
 * Three things can want the completion screen's main button, so the choice
 * lives here rather than being decided at the button: one place to read, one
 * place to change, and a single winner when several apply at once.
 *
 * Precedence, strongest first:
 *  1. the Sanctuary the player just unlocked — offered once, tracked by its own
 *     flag so the home tile keeps its reveal animation;
 *  2. an affordable nest-box upgrade — perishable, because those coins can be
 *     spent on hints before the player ever walks into the Sanctuary;
 *  3. a claimable rung — the safest to defer, since the HUD pill keeps
 *     advertising it and the offer returns on the next completion.
 *
 * Thresholds and prices are read through the config helpers on purpose: they
 * are Remote Config values and have already been retuned several times.
 */

import { gameState } from '../core/GameState';
import { housePrice, MAX_HOUSE_TIER } from '../collection/config';
import { focusBird } from '../collection/ladders';
import { currentMetaGates } from './metaNavBar';

export type CompletionHandOffKind = 'sanctuary-unlock' | 'sanctuary-upgrade' | 'bird-claim';

export interface CompletionHandOff {
  kind: CompletionHandOffKind;
  /** Copy for the completion screen's main button. */
  label: string;
  /** The meta page to open once home is up. */
  page: 'sanctuary' | 'collection';
}

export interface CompletionHandOffInput {
  /** The Sanctuary is open and its completion-screen hand-off is unspent. */
  sanctuaryHandOffPending: boolean;
  sanctuaryUnlocked: boolean;
  collectionUnlocked: boolean;
  houseTier: number;
  coinBalance: number;
  /** Price of the tier above the current one; 0 when the house is maxed. */
  nextTierPrice: number;
  /** An open bird has a rung the player could claim right now. */
  birdClaimReady: boolean;
}

/** Pure form, so the precedence can be read (and tested) without a save. */
export function completionHandOff(input: CompletionHandOffInput): CompletionHandOff | null {
  if (input.sanctuaryHandOffPending) {
    return { kind: 'sanctuary-unlock', label: 'Go to Sanctuary', page: 'sanctuary' };
  }
  const canUpgrade = input.sanctuaryUnlocked
    && input.houseTier < MAX_HOUSE_TIER
    && input.nextTierPrice > 0
    && input.coinBalance >= input.nextTierPrice;
  if (canUpgrade) {
    return { kind: 'sanctuary-upgrade', label: 'Go to Sanctuary', page: 'sanctuary' };
  }
  if (input.collectionUnlocked && input.birdClaimReady) {
    return { kind: 'bird-claim', label: 'Go to Collection', page: 'collection' };
  }
  return null;
}

/**
 * The live read. Call it after the completion is committed and its coins are
 * banked, so an upgrade the level just paid for counts as affordable.
 */
export function currentCompletionHandOff(): CompletionHandOff | null {
  const gates = currentMetaGates();
  const tier = gameState.sanctuary.houseTier;
  return completionHandOff({
    // The hand-off's own one-shot, not the tile pop's: the tile still animates
    // the first time the player reaches home (HomeScene spends that flag).
    sanctuaryHandOffPending: gates.sanctuaryUnlocked && !gameState.sanctuary.unlockHandOffShown,
    sanctuaryUnlocked: gates.sanctuaryUnlocked,
    collectionUnlocked: gates.collectionUnlocked,
    houseTier: tier,
    coinBalance: gameState.coinBalance,
    nextTierPrice: tier < MAX_HOUSE_TIER ? housePrice(tier + 1) : 0,
    // focusBird() already prefers a claimable ladder and ignores finished ones.
    birdClaimReady: focusBird()?.rung.ready === true,
  });
}
