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
 * The four `gameplay-*` states are board-feature captures. The level set is the
 * byte-identical 110-level bundle shared with v1 sugar3d, so v1's baked indices
 * (scanned from `levels.generated.ts` for the feature) apply directly:
 *   - opener → level 1  (the first, simplest onboarding board)
 *   - plugs  → level 8  (first board containing a wooden plug, 'X')
 *   - voids  → level 6  (first board containing a void cell, '#')
 *   - teach  → level 1  driven from a PRISTINE save so the tutorial hand shows
 *              (GameplayController shows the hand only on level 1 when the player
 *              has completed no levels); opener drives level 1 from a SEEDED
 *              save (progress recorded), so no tutorial overlay — the two share
 *              an index but capture visibly different surfaces (see plan U2 /
 *              v1 `driveTo`).
 * A static map (like v1): when level content changes only this map moves, the
 * tour contract does not.
 */
export const PIXELSMITH_STATE_LEVELS: Readonly<Record<
  'gameplay-opener' | 'gameplay-plugs' | 'gameplay-voids' | 'gameplay-teach',
  number
>> = {
  'gameplay-opener': 1,
  'gameplay-plugs': 8,
  'gameplay-voids': 6,
  'gameplay-teach': 1,
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
  // Menu settings = home shell + the Close-variant modal (MRV2-5). Reuses the
  // UI-truth predicate so a page overlay / stray settingsOpen flag never
  // publishes tourstate:settings over the wrong surface.
  settings: (snapshot) => marbleRunDrivePredicates.settings(snapshot),
};

export function snapshotMatchesPixelsmithState(state: PixelsmithState, raw: unknown): boolean {
  const snapshot = (raw ?? {}) as DriveSnapshot;
  const predicate = pixelsmithStatePredicates[state];
  return predicate ? predicate(snapshot) : false;
}
