/**
 * The Collection deck's view model: everything a card renders, derived from a
 * pickup count. Pure — the page turns this into DOM and nothing else.
 */

import { CARD_STATE_ORDER, ladder, type CardState, type CollectionThresholds, type Rung } from './thresholds';
import { BIRD_DEFS, type BirdId } from './birds';

export type CardKind = 'sparrow' | 'unknown';

/** Hidden copy is rendered as dashes, not as the real line, so an unlocked card
 *  still reveals something the player had not read before. */
export const HIDDEN_LINE = '— — — — — —';

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
  bird: BirdId;
  /** False while the chain has not reached this bird: nothing counts yet. */
  open: boolean;
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
  /** Which bird this card is (undefined for the ? placeholder). */
  bird?: BirdId;
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

const UNKNOWN_PORTRAIT = '/ui/collection/portrait-unknown.webp';

const TAB_ICONS: Record<1 | 2 | 3, string> = {
  1: '/ui/collection/glyph-bird.webp',
  2: '/ui/collection/glyph-hat.webp',
  3: '/ui/collection/glyph-costume.webp',
};

/** The rung the card displays: the chosen one, capped by what is claimed. */
export function displayedRung(claimed: Rung, selected: number): Rung {
  if (claimed === 0) return 0;
  if (selected >= 1 && selected <= claimed) return selected as Rung;
  return claimed;
}

export function birdCard(input: CardInputs): CardViewModel {
  const { count, thresholds, claimed, bird } = input;
  const def = BIRD_DEFS[bird];
  const next = ladder(count, claimed, thresholds);
  const shown = displayedRung(claimed, input.selected);
  const state: CardState = CARD_STATE_ORDER[shown];
  const revealed = claimed >= 1;
  // Stages: hidden (below the tease count) -> silhouette with species ->
  // bird and name -> accessory and the personality lines -> costume. A bird
  // the chain has not reached yet stays at the first stage, meter and all.
  const teased = input.open && count >= Math.max(1, Math.floor(input.teaseCount));
  const linesShown = claimed >= 2;
  const tabs: CardTab[] = ([1, 2, 3] as const).map((rung) => ({
    rung,
    icon: TAB_ICONS[rung],
    unlocked: claimed >= rung,
    selected: revealed && shown === rung,
    label: def.tabLabels[rung],
  }));
  const progress = !input.open || next.target === null
    ? null
    // Per-rung counter: a fresh rung starts at 0, so 45/65 reads as 0/20.
    : { label: next.label, current: Math.max(0, Math.min(count, next.target) - next.from), target: next.target - next.from, fraction: next.fraction };
  return {
    kind: 'sparrow',
    bird,
    // The sparrow keeps the plain locked frame until it is earned; later birds
    // wear their own frame from the start, as a promise of what is coming.
    frame: revealed || bird !== 'sparrow' ? def.frame : 'locked',
    state,
    portraitSrc: revealed ? def.portraits[state] : teased || bird !== 'sparrow' ? def.portraits.silhouette : UNKNOWN_PORTRAIT,
    portraitStyle: revealed ? undefined : bird === 'sparrow' ? undefined : 'height:70%;width:auto;bottom:-1%',
    plaque: revealed ? def.name : '? ? ?',
    ribbon: teased || revealed ? def.species : '?',
    lines: linesShown ? def.lines : [HIDDEN_LINE, HIDDEN_LINE, HIDDEN_LINE],
    progress,
    locked: !revealed,
    claimable: input.open && next.ready,
    tabs: bird === 'sparrow' || revealed || input.open ? tabs : [],
    ariaLabel: !input.open
      ? `${def.species}, not collectable yet`
      : next.ready
        ? `${def.name}, ${next.label.toLowerCase()} ready to unlock`
        : revealed
          ? `${def.name}, ${next.target === null ? 'complete' : `${next.remaining} more towards ${next.label}`}`
          : `Locked bird, ${next.remaining} more to unlock`,
  };
}

/** The placeholder that follows the sparrow: a card exists, its bird does not yet. */
export function unknownCard(): CardViewModel {
  return {
    kind: 'unknown',
    frame: 'locked',
    state: 'unknown',
    // Bare: an empty arch, no species, just the lock.
    portraitSrc: '',
    plaque: '? ? ?',
    ribbon: '',
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
export function collectionDeck(inputs: readonly CardInputs[]): CardViewModel[] {
  return [...inputs.map(birdCard), unknownCard()];
}
