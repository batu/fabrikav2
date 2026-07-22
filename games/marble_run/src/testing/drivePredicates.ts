import {
  type DriveSnapshot,
  type DriveState,
  type DriveStatePredicates,
} from '@fabrikav2/testkit/testing';

/**
 * Settings-modal variant, derived by the harness from the mounted modal's
 * action rows (`data-action="settings-close"` = menu Close variant;
 * `settings-restart`/`settings-home` = in-game variant). `null` when no
 * settings modal is mounted+visible. This is the UI-truth signal the win/pause/
 * settings predicates assert on — a raw internal flag (lifecycle suspended,
 * `settingsOpen`) is NOT sufficient because the drive could set it without the
 * modal ever mounting (the wave-1 lying-marker defect).
 */
export type SettingsVariant = 'menu' | 'ingame' | null;

/** DriveSnapshot plus the UI-truth fields marble_run's harness reports. */
interface MarbleRunDriveSnapshot extends DriveSnapshot {
  readonly settingsVariant?: SettingsVariant;
  readonly homeShellVisible?: boolean;
  readonly levelCompleteOverlayVisible?: boolean;
  readonly levelFailedOverlayVisible?: boolean;
}

function asMarbleSnapshot(snapshot: DriveSnapshot): MarbleRunDriveSnapshot {
  return snapshot as MarbleRunDriveSnapshot;
}

// Pure snapshot predicates for the default marble_run drive states. Kept free of
// Phaser and game-module imports so both the (Phaser-heavy) TestHarness and the
// pixelsmith state vocabulary can share them without dragging the engine into a
// unit test's import graph.
export const marbleRunDrivePredicates = {
  menu: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    return scene === 'menu' || scene === 'HomeScene' || snapshot.homeShellVisible === true;
  },
  level: (snapshot: DriveSnapshot): boolean => {
    const snap = asMarbleSnapshot(snapshot);
    const scene = String(snap.scene ?? snap.activeScene ?? '');
    const status = String(snap.status ?? '');
    const ready = snap.inputReady !== false && snap.levelDataReady !== false;
    return ready
      && (scene === 'playing' || scene === 'GameScene')
      && snap.levelComplete !== true
      && snap.lifecycleSuspended !== true
      && snap.homeShellVisible !== true
      && snap.levelCompleteOverlayVisible !== true
      && snap.levelFailedOverlayVisible !== true
      // An open settings modal pauses the run without necessarily suspending the
      // lifecycle, so exclude it explicitly — a gameplay capture must be clean.
      && (snap.settingsVariant ?? null) === null
      && status !== 'paused'
      && status !== 'complete'
      && status !== 'failed'
      && snap.lives !== 0;
  },
  /**
   * Menu settings modal — UI-truth. Requires the home shell visible AND the
   * mounted settings modal to be the menu (Close) variant. `settingsOpen`
   * alone is rejected: a page overlay or a stray flag must not screenshot as
   * settings (MRV2-5 ruling: menu settings = Close variant).
   */
  settings: (snapshot: DriveSnapshot): boolean => {
    const snap = asMarbleSnapshot(snapshot);
    return snap.homeShellVisible === true && snap.settingsVariant === 'menu';
  },
  /**
   * In-game pause — UI-truth. Requires GameScene visible AND the in-game
   * settings modal (Restart/Home variant) mounted+visible. `lifecycleSuspended`
   * is NO LONGER sufficient (wave-1 published a gameplay screenshot as
   * `tourstate:pause` because the drive only suspended the lifecycle).
   */
  pause: (snapshot: DriveSnapshot): boolean => {
    const snap = asMarbleSnapshot(snapshot);
    const scene = String(snap.scene ?? snap.activeScene ?? '');
    return scene === 'GameScene' && snap.settingsVariant === 'ingame';
  },
  /**
   * Win — UI-truth. Requires the level-complete overlay to be mounted AND
   * visible (the harness qualifies `levelCompleteOverlayVisible` on actual
   * visibility + the revealed reward card, not mere `getElementById`). Internal
   * `levelComplete`/`status` flags may narrow but never satisfy on their own.
   */
  win: (snapshot: DriveSnapshot): boolean => {
    const snap = asMarbleSnapshot(snapshot);
    return snap.homeShellVisible !== true && snap.levelCompleteOverlayVisible === true;
  },
  fail: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    const status = String(snapshot.status ?? '');
    const gameplayVisible = snapshot.homeShellVisible !== true;
    return gameplayVisible && (scene === 'failed'
      || snapshot.levelFailedOverlayVisible === true
      || (scene === 'GameScene' && (status === 'failed' || snapshot.lives === 0)));
  },
} satisfies DriveStatePredicates;

export function snapshotMatchesMarbleRunDriveState(state: DriveState, raw: unknown): boolean {
  const snapshot = (raw ?? {}) as DriveSnapshot;
  return marbleRunDrivePredicates[state](snapshot);
}
