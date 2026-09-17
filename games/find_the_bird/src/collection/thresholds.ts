/**
 * Collection thresholds: how a raw pickup count becomes a card state.
 *
 * Pure and config-driven so the ladder can be retuned from Remote Config
 * without touching the UI, and so the boundaries are unit-testable without a
 * DOM or a wallet.
 */

/** Visual states of a species card, in unlock order. */
export type CardState = 'silhouette' | 'plain' | 'hat' | 'cardigan';

export const CARD_STATE_ORDER: readonly CardState[] = ['silhouette', 'plain', 'hat', 'cardigan'];

export interface CollectionThresholds {
  /** Pickups that turn the silhouette into the bird and open the Sanctuary. */
  unlock: number;
  /** Pickups that add the beanie. */
  hat: number;
  /** Pickups that add the cardigan and finish the card. */
  cardigan: number;
}

export interface NextThreshold {
  /** What the next rung gives, or 'Complete' when the card is finished. */
  label: 'Unlock' | 'Hat' | 'Cardigan' | 'Complete';
  /** Pickups needed for that rung; null once complete. */
  target: number | null;
  /** Pickups counted so far. */
  current: number;
  /** 0..1 progress towards `target`; 1 when complete. */
  fraction: number;
}

function sanitize(thresholds: CollectionThresholds): CollectionThresholds {
  // A misconfigured ladder must still be monotonic, otherwise a card could
  // unlock its costume before the bird itself.
  const unlock = Math.max(1, Math.floor(thresholds.unlock));
  const hat = Math.max(unlock + 1, Math.floor(thresholds.hat));
  const cardigan = Math.max(hat + 1, Math.floor(thresholds.cardigan));
  return { unlock, hat, cardigan };
}

/** The card art a given pickup count has earned. */
export function cardState(count: number, thresholds: CollectionThresholds): CardState {
  const { unlock, hat, cardigan } = sanitize(thresholds);
  const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (safe >= cardigan) return 'cardigan';
  if (safe >= hat) return 'hat';
  if (safe >= unlock) return 'plain';
  return 'silhouette';
}

/** True once the bird itself is earned — the gate the Sanctuary tile watches. */
export function isUnlocked(count: number, thresholds: CollectionThresholds): boolean {
  return cardState(count, thresholds) !== 'silhouette';
}

/** The rung the card is currently working towards. */
export function nextThreshold(count: number, thresholds: CollectionThresholds): NextThreshold {
  const { unlock, hat, cardigan } = sanitize(thresholds);
  const current = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const rung = (label: NextThreshold['label'], from: number, target: number): NextThreshold => ({
    label,
    target,
    current,
    fraction: target <= from ? 1 : Math.min(1, Math.max(0, (current - from) / (target - from))),
  });
  if (current < unlock) return rung('Unlock', 0, unlock);
  if (current < hat) return rung('Hat', unlock, hat);
  if (current < cardigan) return rung('Cardigan', hat, cardigan);
  return { label: 'Complete', target: null, current, fraction: 1 };
}

/** Rung index into CARD_STATE_ORDER: 0 silhouette, 1 plain, 2 hat, 3 cardigan. */
export type Rung = 0 | 1 | 2 | 3;

export function clampRung(value: unknown): Rung {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, Math.min(3, n)) as Rung;
}

/** The rung the pickup count has EARNED, whether or not the player claimed it. */
export function earnedRung(count: number, thresholds: CollectionThresholds): Rung {
  return CARD_STATE_ORDER.indexOf(cardState(count, thresholds)) as Rung;
}

function rungTarget(rung: 1 | 2 | 3, thresholds: CollectionThresholds): number {
  const { unlock, hat, cardigan } = sanitize(thresholds);
  return rung === 1 ? unlock : rung === 2 ? hat : cardigan;
}

export interface Ladder {
  /** The art the player has claimed. */
  state: CardState;
  claimed: Rung;
  /** The rung waiting to be claimed, null once the card is complete. */
  nextRung: Rung | null;
  label: NextThreshold['label'];
  target: number | null;
  /** Where the current rung starts; counters shown to the player run from here. */
  from: number;
  /** Pickups still needed for `nextRung`; 0 when it is ready to claim. */
  remaining: number;
  /** True when the next rung is earned but not yet claimed. */
  ready: boolean;
  fraction: number;
}

/**
 * Progress is measured against the rung AFTER the one the player claimed, not
 * the one the count has reached: a rung is a reward the player opens, so the
 * card and the counter hold at "ready" until they do.
 */
export function ladder(count: number, claimed: Rung, thresholds: CollectionThresholds): Ladder {
  const current = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const state = CARD_STATE_ORDER[claimed];
  if (claimed >= 3) {
    return { state, claimed, nextRung: null, label: 'Complete', target: null, from: rungTarget(3, thresholds), remaining: 0, ready: false, fraction: 1 };
  }
  const nextRung = (claimed + 1) as 1 | 2 | 3;
  const target = rungTarget(nextRung, thresholds);
  const from = claimed === 0 ? 0 : rungTarget(claimed as 1 | 2 | 3, thresholds);
  const remaining = Math.max(0, target - current);
  const label: NextThreshold['label'] = nextRung === 1 ? 'Unlock' : nextRung === 2 ? 'Hat' : 'Cardigan';
  const fraction = target <= from ? 1 : Math.min(1, Math.max(0, (current - from) / (target - from)));
  return { state, claimed, nextRung, label, target, from, remaining, ready: remaining === 0, fraction };
}
