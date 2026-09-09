import { copy } from '../../design/copy';
export const TITLE = copy['game.title'];
export const WAVES = 10;
export const LEVELS = ['The Last Knoll', 'Ember Ridge'] as const;
export const TAGS = ['kinetic', 'bullet', 'fire', 'beam', 'electric', 'explosive'] as const;
export type Tag = typeof TAGS[number];
export interface Weapon {
  name: string; icon: string; tags: readonly [Tag, Tag]; description: string;
  damage: number; rate: number; range: number; cost: number; color: number;
}
export const WEAPONS: readonly Weapon[] = [
  { name: 'Rivet gun', icon: '↗', tags: ['kinetic', 'bullet'], description: 'Fast piercing rounds. Aim through a crowd.', damage: 14, rate: 8, range: 85, cost: 0, color: 0xffdb88 },
  { name: 'Flamethrower', icon: '≋', tags: ['fire', 'beam'], description: 'A wide, short-range cone. Burns every enemy it touches.', damage: 6, rate: 6, range: 28, cost: 0, color: 0xff874d },
  { name: 'Arc caster', icon: 'ϟ', tags: ['electric', 'beam'], description: 'Lightning jumps through up to six nearby enemies.', damage: 18, rate: 2.5, range: 44, cost: 55, color: 0x9bdbfa },
  { name: 'Mortar', icon: '✦', tags: ['kinetic', 'explosive'], description: 'Slow shells. Huge blast radius. Break up the swarm.', damage: 38, rate: 1.5, range: 85, cost: 90, color: 0xd9b0ff },
];
export const CHARACTERS = [
  { name: 'The Holdout', subtitle: 'Make every shot count.', passive: '+20% weapon damage', weapon: 0, cost: 0, color: '#f2ca77' },
  { name: 'The Firebrand', subtitle: 'Leave nothing standing.', passive: '+35% fire damage · +20% area', weapon: 1, cost: 65, color: '#ff976b' },
  { name: 'The Engineer', subtitle: 'Build a better last stand.', passive: 'Towers fire 35% faster', weapon: 0, cost: 100, color: '#8ed6c4' },
] as const;
export const META_UPGRADES = [
  { key: 'power', name: 'Heavy ammunition', text: '+10% all damage per rank', base: 20, max: 5 },
  { key: 'learning', name: 'Field experience', text: '+10% XP gain per rank', base: 20, max: 5 },
  { key: 'fortune', name: 'Lucky charm', text: '+10 luck per rank · better card rarity', base: 25, max: 5 },
  { key: 'towers', name: 'Tower permit', text: 'Place one more automatic tower', base: 45, max: 2 },
] as const;
export type MetaKey = typeof META_UPGRADES[number]['key'];
export type Stat = 'damage' | 'rate' | 'area' | 'xp' | 'luck' | 'crit' | 'health';
export const STAT_NAMES: Record<Stat, string> = { damage: 'Damage', rate: 'Fire rate', area: 'Area', xp: 'XP gain', luck: 'Luck', crit: 'Critical chance', health: 'Max health' };
export interface Card { id: string; name: string; stat: Stat; scope: 'all' | Tag | number; rank: number; amount: number }
export const RANKS = ['Common', 'Rare', 'Epic', 'Legendary'] as const;
export const RANK_COLORS = ['#bfc9b8', '#88c9eb', '#c4a0ef', '#f2ca77'] as const;
export const CARD_BASES: readonly Omit<Card, 'rank' | 'amount'>[] = [
  { id: 'power', name: 'Mean business', stat: 'damage', scope: 'all' },
  { id: 'rate', name: 'No breathing room', stat: 'rate', scope: 'all' },
  { id: 'area', name: 'Collateral damage', stat: 'area', scope: 'all' },
  { id: 'xp', name: 'Live and learn', stat: 'xp', scope: 'all' },
  { id: 'luck', name: 'Against the odds', stat: 'luck', scope: 'all' },
  { id: 'crit', name: 'Find the weak spot', stat: 'crit', scope: 'all' },
  { id: 'health', name: 'Dig in', stat: 'health', scope: 'all' },
  ...TAGS.flatMap(tag => [
    { id: `${tag}-power`, name: `${tag[0].toUpperCase()}${tag.slice(1)} specialist`, stat: 'damage' as const, scope: tag },
    { id: `${tag}-rate`, name: `${tag[0].toUpperCase()}${tag.slice(1)} overdrive`, stat: 'rate' as const, scope: tag },
  ]),
  ...WEAPONS.flatMap((w, i) => [
    { id: `weapon-${i}`, name: `${w.name}: heavy duty`, stat: 'damage' as const, scope: i },
    { id: `speed-${i}`, name: `${w.name}: hair trigger`, stat: 'rate' as const, scope: i },
  ]),
];
export function cardScope(card: Card): string {
  return card.scope === 'all' ? 'All weapons' : typeof card.scope === 'number' ? WEAPONS[card.scope].name : `${card.scope} weapons`;
}
export function cardDescription(card: Card): string {
  const gain = card.stat === 'luck' ? `${card.amount} luck` : `${Math.round(card.amount * 100)}% ${STAT_NAMES[card.stat].toLowerCase()}`;
  return `+${gain}${card.stat === 'luck' || card.stat === 'xp' || card.stat === 'health' ? '' : ` · ${cardScope(card)}`}`;
}
