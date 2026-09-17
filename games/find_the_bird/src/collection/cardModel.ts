/**
 * The Collection deck's view model: everything a card renders, derived from a
 * pickup count. Pure — the page turns this into DOM and nothing else.
 */

import { ladder, type CardState, type CollectionThresholds, type Rung } from './thresholds';

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

export interface CardViewModel {
  kind: CardKind;
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

export function sparrowCard(count: number, thresholds: CollectionThresholds, claimed: Rung = 0): CardViewModel {
  const next = ladder(count, claimed, thresholds);
  const state = next.state;
  const revealed = state !== 'silhouette';
  return {
    kind: 'sparrow',
    state,
    portraitSrc: PORTRAITS[state],
    plaque: revealed ? 'Sparrow' : '? ? ?',
    ribbon: 'Garden bird',
    lines: revealed ? SPARROW_LINES : [HIDDEN_LINE, HIDDEN_LINE, HIDDEN_LINE],
    progress: next.target === null
      ? null
      : { label: next.label, current: Math.min(count, next.target), target: next.target, fraction: next.fraction },
    locked: !revealed,
    claimable: next.ready,
    ariaLabel: next.ready
      ? `Sparrow, ${next.label.toLowerCase()} ready to unlock`
      : revealed
        ? `Sparrow, ${next.target === null ? 'complete' : `${next.remaining} more sparrows towards ${next.label}`}`
        : `Locked bird, ${next.remaining} more sparrows to unlock`,
  };
}

/** The placeholder that follows the sparrow: a card exists, its bird does not yet. */
export function unknownCard(): CardViewModel {
  return {
    kind: 'unknown',
    state: 'unknown',
    portraitSrc: UNKNOWN_PORTRAIT,
    plaque: '? ? ?',
    ribbon: 'Coming soon',
    lines: [HIDDEN_LINE, HIDDEN_LINE, HIDDEN_LINE],
    progress: null,
    locked: true,
    claimable: false,
    ariaLabel: 'Locked bird, coming soon',
  };
}

/** The whole release-1 deck, in swipe order. */
export function collectionDeck(count: number, thresholds: CollectionThresholds, claimed: Rung = 0): CardViewModel[] {
  return [sparrowCard(count, thresholds, claimed), unknownCard()];
}
