/**
 * The collectable birds, in the order they open. Each has its card art, its
 * copy and its Sanctuary sprites; the chain rule lives here too: a bird starts
 * collecting once the bird before it has claimed its second rung (accessory),
 * so up to three ladders run at once and a maxed bird stops asking for more.
 */

import type { CardState, Rung } from './thresholds';

export const BIRDS = ['sparrow', 'robin', 'bluebird'] as const;
export type BirdId = (typeof BIRDS)[number];

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

export const BIRD_DEFS: Record<BirdId, BirdDef> = {
  sparrow: {
    id: 'sparrow', name: 'Chirpy', species: 'House Sparrow', frame: 'sparrow',
    lines: ['Loud. Opinionated. Never on time.', 'Will fight a pigeon for a crumb.', 'Loves: your sandwich.'],
    portraits: portraits('sparrow'), sprites: sprites('sparrow'),
    tabLabels: { 1: 'Sparrow', 2: 'Beanie', 3: 'Cardigan' },
  },
  robin: {
    id: 'robin', name: 'Rusty', species: 'European Robin', frame: 'robin',
    lines: ['Small. Round. Owns this garden.', 'Sings in December. Nobody asked.', 'Loves: whoever is holding the spade.'],
    portraits: portraits('robin'), sprites: sprites('robin'),
    tabLabels: { 1: 'Robin', 2: 'Bobble hat', 3: 'Scarf & cardigan' },
  },
  bluebird: {
    id: 'bluebird', name: 'Skye', species: 'Eastern Bluebird', frame: 'bluebird',
    lines: ['Gentle. Polite. Up before you.', 'Has viewed eleven nest boxes. Liked none.', 'Loves: a sunrise, quietly.'],
    portraits: portraits('bluebird'), sprites: sprites('bluebird'),
    tabLabels: { 1: 'Bluebird', 2: 'Sun hat', 3: 'Cardigan' },
  },
};

export function isBirdId(value: string): value is BirdId {
  return (BIRDS as readonly string[]).includes(value);
}

/** The rung a bird must reach before the NEXT bird starts collecting. */
export const CHAIN_OPEN_RUNG: Rung = 2;

/**
 * Which birds are collecting: the first always (once the Collection itself
 * is open), each later one once its predecessor has claimed the chain rung.
 */
export function birdOpen(id: BirdId, claimedOf: (bird: BirdId) => Rung): boolean {
  const index = BIRDS.indexOf(id);
  if (index <= 0) return true;
  return claimedOf(BIRDS[index - 1]) >= CHAIN_OPEN_RUNG;
}
