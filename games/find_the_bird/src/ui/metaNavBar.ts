/**
 * The three-slot navigation bar, shared by the home shell and by the meta pages
 * that sit on top of it: Sanctuary, Play, Collection.
 *
 * Play sits in the middle because it is the thing a player reaches for most,
 * and the two meta screens flank it. The shop is not here — it is reached from
 * the coin and hint pills, which is where a player is when they want it.
 *
 * One renderer rather than two copies: the bar is the same control wherever it
 * appears, and a second copy would drift from the first the moment a tile's
 * lock rule or artwork changed.
 */

import { gameState } from '../core/GameState';
import { metaGates, type MetaGates } from '../home/metaGates';
import { collectionThresholds, collectionUnlockLevel } from '../collection/config';

export type MetaNavTarget = 'sanctuary' | 'play' | 'collection';

export interface MetaNavOptions {
  /** Which tile reads as the current place; omitted on the home shell. */
  active?: MetaNavTarget;
  /** Achievements occupies a fourth slot when its flag is on. */
  achievements?: { enabled: boolean; claimable: number };
  /** Plays the one-shot unlock pop where a gate has just opened. */
  allowUnlockPop?: boolean;
}

export function currentMetaGates(): MetaGates {
  return metaGates({
    totalLevelsCompleted: gameState.totalLevelsCompleted,
    sparrowCount: gameState.birdCount('sparrow'),
    collectionUnlockLevel: collectionUnlockLevel(),
    thresholds: collectionThresholds(),
    collectionPopShown: gameState.collectionMeta.tileUnlockPopShown,
    sanctuaryPopShown: gameState.sanctuary.tileUnlockPopShown,
  });
}

function tile(options: {
  id: string;
  label: string;
  icon: string;
  locked: boolean;
  active: boolean;
  pop: boolean;
  lockedLabel: string;
}): string {
  const classes = ['home-nav-btn'];
  if (options.locked) classes.push('home-nav-btn--locked');
  if (options.active) classes.push('home-nav-btn--active');
  if (options.pop) classes.push('home-nav-btn--unlock-pop');
  return `
    <button id="${options.id}" class="${classes.join(' ')}" type="button"${options.locked ? ' aria-disabled="true"' : ''}${options.active ? ' aria-current="page"' : ''} aria-label="${options.locked ? options.lockedLabel : options.id === 'home-nav-play' ? 'Play the current level' : `Open ${options.label.toLowerCase()}`}">
      <img src="${options.icon}" alt="" aria-hidden="true">
      <span>${options.label}</span>
    </button>`;
}

/** The bar's markup. Identical on home and on a meta page; only `active` differs. */
export function renderMetaNavBar(options: MetaNavOptions = {}): string {
  const gates = currentMetaGates();
  const achievements = options.achievements ?? { enabled: false, claimable: 0 };
  const pop = options.allowUnlockPop === true;
  const slots = achievements.enabled ? 4 : 3;

  const achievementsTile = achievements.enabled
    ? `<button id="home-nav-achievements" class="home-nav-btn${achievements.claimable > 0 ? ' home-claim-attention' : ''}" type="button" aria-label="Open achievements${achievements.claimable > 0 ? `, ${achievements.claimable} reward${achievements.claimable === 1 ? '' : 's'} to claim` : ''}">
        <img src="/ui/achievements/achievement-shortcut-runtime.png" alt="" aria-hidden="true">
        <span>Achievements</span>
        ${achievements.claimable > 0 ? '<span class="home-claim-dot home-claim-dot--nav" aria-hidden="true"></span>' : ''}
      </button>`
    : '';

  return `
    <nav class="home-nav-bar" data-slots="${slots}" aria-label="Main navigation">
      ${achievementsTile}
      ${tile({
        id: 'home-nav-sanctuary',
        label: 'Sanctuary',
        icon: '/ui/sanctuary/sanctuary-nav-icon.png',
        locked: !gates.sanctuaryUnlocked,
        active: options.active === 'sanctuary',
        pop: pop && gates.sanctuaryPopPending,
        lockedLabel: 'Sanctuary, locked until your first bird is unlocked',
      })}
      ${tile({
        id: 'home-nav-play',
        label: 'Play',
        icon: '/ui/menu-icons/magnifier-runtime.png',
        locked: false,
        active: false,
        pop: false,
        lockedLabel: 'Play',
      })}
      ${tile({
        id: 'home-nav-collection',
        label: 'Collection',
        icon: '/ui/sanctuary/birds-nav-icon.png',
        locked: !gates.collectionUnlocked,
        active: options.active === 'collection',
        pop: pop && gates.collectionPopPending,
        lockedLabel: `Bird collection, locked until level ${String(collectionUnlockLevel())}`,
      })}
    </nav>`;
}
