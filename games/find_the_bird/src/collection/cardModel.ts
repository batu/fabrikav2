/**
 * The Collection deck's view model: everything a card renders, derived from a
 * pickup count. Pure — the page turns this into DOM and nothing else.
 */

import { CARD_STATE_ORDER, ladder, type CardState, type CollectionThresholds, type Rung } from './thresholds';

export type CardKind = 'sparrow' | 'unknown';

/** Hidden copy is rendered as dashes, not as the real line, so an unlocked card
 *  still reveals something the player had not read before. */
export const HIDDEN_LINE = '— — — — — —';

const SPARROW_LINES: readonly string[] = [
  'Loud. Opinionated. Never on time.',
  'Will fight a pigeon for a crumb.',
  'Loves: your sandwich.',
];

export interface CardProgress {
  label: string;
  current: number;
  target: number;
  fraction: number;
}

export interface CardTab {
  rung: 1 | 2 | 3;
  icon: string;
  unlocked: boolean;
  selected: boolean;
  label: string;
}

export interface CardInputs {
  count: number;
  thresholds: CollectionThresholds;
  claimed: Rung;
  /** 0 follows the highest claimed rung. */
  selected: number;
  /** Pickups at which the silhouette and species appear on the locked card. */
  teaseCount: number;
}

export type CardFrame = 'sparrow' | 'robin' | 'bluebird' | 'locked';

export interface CardViewModel {
  kind: CardKind;
  /** Which frame art the card wears. */
  frame: CardFrame;
  /** Card art state; 'silhouette' for a locked sparrow, 'unknown' for the ? card. */
  state: CardState | 'unknown';
  portraitSrc: string;
  /** Wooden name plaque. */
  plaque: string;
  /** Small ribbon under the plaque. */
  ribbon: string;
  /** Three personality lines, replaced by dashes while the card is locked. */
  lines: readonly string[];
  /** Null once the card is complete or for the ? card. */
  progress: CardProgress | null;
  /** True when the card is a locked placeholder (padlock shown). */
  locked: boolean;
  /** True when the next rung is earned and waits for the player's tap. */
  claimable: boolean;
  /** Rung tabs down the card's left side. */
  tabs: readonly CardTab[];
  /** Overrides the frame's default portrait sizing (a wide silhouette sits lower). */
  portraitStyle?: string;
  /** Screen-reader label for the whole card. */
  ariaLabel: string;
}

const PORTRAITS: Record<CardState, string> = {
  silhouette: '/ui/collection/portrait-sparrow-silhouette.webp',
  plain: '/ui/collection/portrait-sparrow-plain.webp',
  hat: '/ui/collection/portrait-sparrow-hat.webp',
  cardigan: '/ui/collection/portrait-sparrow-cardigan.webp',
};

const UNKNOWN_PORTRAIT = '/ui/collection/portrait-unknown.webp';

const TAB_ICONS: Record<1 | 2 | 3, string> = {
  1: '/ui/collection/icon-bird.webp',
  2: '/ui/collection/icon-beanie.webp',
  3: '/ui/collection/icon-cardigan.webp',
};
const TAB_LABELS: Record<1 | 2 | 3, string> = { 1: 'Sparrow', 2: 'Beanie', 3: 'Cardigan' };

/** The rung the card displays: the chosen one, capped by what is claimed. */
export function displayedRung(claimed: Rung, selected: number): Rung {
  if (claimed === 0) return 0;
  if (selected >= 1 && selected <= claimed) return selected as Rung;
  return claimed;
}

export function sparrowCard(input: CardInputs): CardViewModel {
  const { count, thresholds, claimed } = input;
  const next = ladder(count, claimed, thresholds);
  const shown = displayedRung(claimed, input.selected);
  const state: CardState = CARD_STATE_ORDER[shown];
  const revealed = claimed >= 1;
  // Stages: hidden (below the tease count) -> silhouette with species ->
  // bird and name -> accessory and the personality lines -> costume.
  const teased = count >= Math.max(1, Math.floor(input.teaseCount));
  const linesShown = claimed >= 2;
  const tabs: CardTab[] = ([1, 2, 3] as const).map((rung) => ({
    rung,
    icon: TAB_ICONS[rung],
    unlocked: claimed >= rung,
    selected: revealed && shown === rung,
    label: TAB_LABELS[rung],
  }));
  return {
    kind: 'sparrow',
    frame: revealed ? 'sparrow' : 'locked',
    state,
    portraitSrc: revealed ? PORTRAITS[state] : teased ? PORTRAITS.silhouette : UNKNOWN_PORTRAIT,
    plaque: revealed ? 'Chirpy' : '? ? ?',
    ribbon: teased ? 'House Sparrow' : '?',
    lines: linesShown ? SPARROW_LINES : [HIDDEN_LINE, HIDDEN_LINE, HIDDEN_LINE],
    progress: next.target === null
      ? null
      : { label: next.label, current: Math.min(count, next.target), target: next.target, fraction: next.fraction },
    locked: !revealed,
    claimable: next.ready,
    tabs,
    ariaLabel: next.ready
      ? `Sparrow, ${next.label.toLowerCase()} ready to unlock`
      : revealed
        ? `Sparrow, ${next.target === null ? 'complete' : `${next.remaining} more sparrows towards ${next.label}`}`
        : `Locked bird, ${next.remaining} more sparrows to unlock`,
  };
}

/** A bird that is on the roadmap but not collectable yet: the locked frame, nothing known. */
const LOCKED_SILHOUETTES: Record<'robin' | 'bluebird', string> = {
  robin: '/ui/collection/portrait-robin-silhouette.webp',
  bluebird: '/ui/collection/portrait-bluebird-silhouette.webp',
};
const LOCKED_SPECIES: Record<'robin' | 'bluebird', string> = { robin: 'Robin', bluebird: 'Bluebird' };

export function lockedBirdCard(kind: 'robin' | 'bluebird'): CardViewModel {
  return {
    kind: 'sparrow',
    frame: kind,
    state: 'silhouette',
    portraitSrc: LOCKED_SILHOUETTES[kind],
    portraitStyle: 'height:70%;width:auto;bottom:-1%',
    plaque: '? ? ?',
    ribbon: LOCKED_SPECIES[kind],
    lines: [HIDDEN_LINE, HIDDEN_LINE, HIDDEN_LINE],
    progress: null,
    locked: true,
    claimable: false,
    tabs: [],
    ariaLabel: `Locked bird (${kind}), not yet collectable`,
  };
}

/** The placeholder that follows the sparrow: a card exists, its bird does not yet. */
export function unknownCard(): CardViewModel {
  return {
    kind: 'unknown',
    frame: 'locked',
    state: 'unknown',
    portraitSrc: UNKNOWN_PORTRAIT,
    plaque: '? ? ?',
    ribbon: 'Coming soon',
    lines: [HIDDEN_LINE, HIDDEN_LINE, HIDDEN_LINE],
    progress: null,
    locked: true,
    claimable: false,
    // No tabs: they would poke into the sparrow's right peek from the next slide.
    tabs: [],
    ariaLabel: 'Locked bird, coming soon',
  };
}

/** The whole release-1 deck, in swipe order. */
export function collectionDeck(input: CardInputs): CardViewModel[] {
  return [sparrowCard(input), lockedBirdCard('robin'), lockedBirdCard('bluebird'), unknownCard()];
}
