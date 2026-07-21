import type { DriveSnapshot } from '@fabrikav2/testkit/testing';
import { marbleRunDrivePredicates } from './drivePredicates';

/**
 * The ten deterministic capture states Pixelsmith drives marble_run to, in the
 * card's order. Each is published as a `tourstate:<state>` accessibility marker
 * (see @fabrikav2/testkit `publishTourMarker`) within 25s of a cold launch when
 * built with `VITE_INSITU_TOUR=<state>`. Mechanism is identical to the
 * find_the_dog device-proof lane (its custom `achievements`/`win-achievement`
 * states use the same `snapshotMatches*` + tour path).
 */
export const PIXELSMITH_TOUR_STATES = [
  'home-fresh',
  'level-map',
  'gameplay-opener',
  'gameplay-plugs',
  'gameplay-voids',
  'gameplay-teach',
  'win',
  'pause',
  'shop',
  'settings',
] as const;

export type PixelsmithState = (typeof PIXELSMITH_TOUR_STATES)[number];

/**
 * The four `gameplay-*` states are board-feature captures in v1's vocabulary
 * (opener = first level, plugs/voids/teach = specific board content). v2 levels
 * are still stubs with no `tags`, so each maps to a designated stub level index
 * here; all four currently capture stub gameplay. When real level content lands
 * (later MRV2 cards) only this map (or a future tags lookup) changes — the tour
 * contract does not. See plan KTD-3.
 */
export const PIXELSMITH_STATE_LEVELS: Readonly<Record<
  'gameplay-opener' | 'gameplay-plugs' | 'gameplay-voids' | 'gameplay-teach',
  number
>> = {
  'gameplay-opener': 1,
  'gameplay-plugs': 2,
  'gameplay-voids': 3,
  'gameplay-teach': 4,
};

export function isPixelsmithState(state: string): state is PixelsmithState {
  return (PIXELSMITH_TOUR_STATES as readonly string[]).includes(state);
}

export function isGameplayState(
  state: string,
): state is keyof typeof PIXELSMITH_STATE_LEVELS {
  return Object.prototype.hasOwnProperty.call(PIXELSMITH_STATE_LEVELS, state);
}

/**
 * Per-state acceptance predicate. Gameplay/win/pause/settings reuse the existing
 * marble_run drive predicates so a Pixelsmith capture only fires on the exact
 * surface the default harness already validates. `home-fresh`/`level-map`/`shop`
 * key on the home shell + a distinguishing DOM signal (shop and settings are
 * mutually exclusive so a mis-drive never screenshots the wrong page).
 */
export const pixelsmithStatePredicates: Record<
  PixelsmithState,
  (snapshot: DriveSnapshot) => boolean
> = {
  'home-fresh': (snapshot) =>
    marbleRunDrivePredicates.menu(snapshot)
    && snapshot.settingsOpen !== true
    && snapshot.shopOpen !== true,
  'level-map': (snapshot) =>
    marbleRunDrivePredicates.menu(snapshot)
    && snapshot.levelMapVisible === true
    && snapshot.settingsOpen !== true
    && snapshot.shopOpen !== true,
  'gameplay-opener': (snapshot) => marbleRunDrivePredicates.level(snapshot),
  'gameplay-plugs': (snapshot) => marbleRunDrivePredicates.level(snapshot),
  'gameplay-voids': (snapshot) => marbleRunDrivePredicates.level(snapshot),
  'gameplay-teach': (snapshot) => marbleRunDrivePredicates.level(snapshot),
  win: (snapshot) => marbleRunDrivePredicates.win(snapshot),
  pause: (snapshot) => marbleRunDrivePredicates.pause(snapshot),
  shop: (snapshot) => snapshot.shopOpen === true,
  settings: (snapshot) => snapshot.settingsOpen === true,
};

export function snapshotMatchesPixelsmithState(state: PixelsmithState, raw: unknown): boolean {
  const snapshot = (raw ?? {}) as DriveSnapshot;
  const predicate = pixelsmithStatePredicates[state];
  return predicate ? predicate(snapshot) : false;
}
