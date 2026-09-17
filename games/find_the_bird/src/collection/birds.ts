/**
 * The collectable birds, in the order they open. Each has its card art, its
 * copy and its Sanctuary sprites; the chain rule lives here too: a bird starts
 * collecting once the bird before it has claimed its second rung (accessory),
 * so up to three ladders run at once and a maxed bird stops asking for more.
 */

import type { CardState, Rung } from './thresholds';

export const BIRDS = ['sparrow', 'robin', 'bluebird'] as const;
export type BirdId = (typeof BIRDS)[number];

/**
 * What has to happen before a bird starts collecting. The progressions are
 * meant to take turns rather than race: the nest box opens the second bird, and
 * the second bird's hat opens the third, so a Sanctuary upgrade is always worth
 * something in the Collection and the reverse.
 */
export type BirdOpenRule =
  | { kind: 'always' }
  | { kind: 'houseTier'; tier: number }
  | { kind: 'chain'; rung: Rung };

export interface BirdDef {
  id: BirdId;
  name: string;
  species: string;
  lines: readonly string[];
  frame: 'sparrow' | 'robin' | 'bluebird';
  portraits: Record<CardState, string>;
  /** Sanctuary sprites by costume state (plain / hat / cardigan). */
  sprites: Record<'plain' | 'hat' | 'cardigan', string>;
  tabLabels: Record<1 | 2 | 3, string>;
  opensOn: BirdOpenRule;
}

const portraits = (id: BirdId): Record<CardState, string> => ({
  silhouette: `/ui/collection/portrait-${id}-silhouette.webp`,
  plain: `/ui/collection/portrait-${id}-plain.webp`,
  hat: `/ui/collection/portrait-${id}-hat.webp`,
  cardigan: `/ui/collection/portrait-${id}-cardigan.webp`,
});
const sprites = (id: BirdId): Record<'plain' | 'hat' | 'cardigan', string> => ({
  plain: `/ui/sanctuary/birds/${id}-plain.webp`,
  hat: `/ui/sanctuary/birds/${id}-hat.webp`,
  cardigan: `/ui/sanctuary/birds/${id}-cardigan.webp`,
});

/** Rung a bird must claim to open the bird that follows it in the chain. */
export const CHAIN_OPEN_RUNG: Rung = 2;

/** Nest box tier that opens the second bird. */
export const HOUSE_OPEN_TIER = 2;

export const BIRD_DEFS: Record<BirdId, BirdDef> = {
  sparrow: {
    id: 'sparrow', name: 'Chirpy', species: 'House Sparrow', frame: 'sparrow', opensOn: { kind: 'always' },
    lines: ['Loud. Opinionated. Never on time.', 'Will fight a pigeon for a crumb.', 'Loves: your sandwich.'],
    portraits: portraits('sparrow'), sprites: sprites('sparrow'),
    tabLabels: { 1: 'Sparrow', 2: 'Beanie', 3: 'Cardigan' },
  },
  robin: {
    id: 'robin', opensOn: { kind: 'houseTier', tier: HOUSE_OPEN_TIER }, name: 'Rusty', species: 'European Robin', frame: 'robin',
    lines: ['Small. Round. Owns this garden.', 'Sings in December. Nobody asked.', 'Loves: whoever is holding the spade.'],
    portraits: portraits('robin'), sprites: sprites('robin'),
    tabLabels: { 1: 'Robin', 2: 'Bobble hat', 3: 'Scarf & cardigan' },
  },
  bluebird: {
    id: 'bluebird', opensOn: { kind: 'chain', rung: CHAIN_OPEN_RUNG }, name: 'Skye', species: 'Eastern Bluebird', frame: 'bluebird',
    lines: ['Gentle. Polite. Up before you.', 'Has viewed eleven nest boxes. Liked none.', 'Loves: a sunrise, quietly.'],
    portraits: portraits('bluebird'), sprites: sprites('bluebird'),
    tabLabels: { 1: 'Bluebird', 2: 'Sun hat', 3: 'Cardigan' },
  },
};

/** Portrait height inside the arch per costume, so the head stays the same
 *  size whether or not a hat sits on it (a hat adds height, not head). */
export const PORTRAIT_HEIGHT: Record<BirdId, Record<'plain' | 'hat' | 'cardigan', number>> = {
  sparrow: { plain: 0.97, hat: 1.115, cardigan: 1.115 },
  robin: { plain: 0.97, hat: 1.115, cardigan: 1.115 },
  bluebird: { plain: 0.97, hat: 1.036, cardigan: 1.017 },
};

export function isBirdId(value: string): value is BirdId {
  return (BIRDS as readonly string[]).includes(value);
}

/** The rung a bird must reach before the NEXT bird starts collecting. */
/**
 * Which birds are collecting. The first always, once the Collection itself is
 * open; the others when their own rule is met. A species that is not open does
 * not count pickups, so these rules also decide when a ladder starts.
 */
export function birdOpen(
  id: BirdId,
  claimedOf: (bird: BirdId) => Rung,
  houseTier: number,
): boolean {
  const index = BIRDS.indexOf(id);
  if (index <= 0) return true;
  const rule = BIRD_DEFS[id].opensOn;
  if (rule.kind === 'always') return true;
  if (rule.kind === 'houseTier') return houseTier >= rule.tier;
  return claimedOf(BIRDS[index - 1]) >= rule.rung;
}
