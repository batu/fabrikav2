import {
  type DriveSnapshot,
  type DriveState,
  type DriveStatePredicates,
} from '@fabrikav2/testkit/testing';

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
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    const status = String(snapshot.status ?? '');
    const ready = snapshot.inputReady !== false && snapshot.levelDataReady !== false;
    return ready
      && (scene === 'playing' || scene === 'GameScene')
      && snapshot.levelComplete !== true
      && snapshot.lifecycleSuspended !== true
      && snapshot.homeShellVisible !== true
      && snapshot.levelCompleteOverlayVisible !== true
      && snapshot.levelFailedOverlayVisible !== true
      && status !== 'paused'
      && status !== 'complete'
      && status !== 'failed'
      && snapshot.lives !== 0;
  },
  settings: (snapshot: DriveSnapshot): boolean => snapshot.settingsOpen === true,
  pause: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    const status = String(snapshot.status ?? '');
    return scene === 'paused' || (scene === 'GameScene' && (status === 'paused' || snapshot.lifecycleSuspended === true));
  },
  win: (snapshot: DriveSnapshot): boolean => {
    const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
    const status = String(snapshot.status ?? '');
    const gameplayVisible = snapshot.homeShellVisible !== true;
    return gameplayVisible && (scene === 'complete'
      || snapshot.levelCompleteOverlayVisible === true
      || (scene === 'GameScene' && (status === 'complete' || snapshot.levelComplete === true)));
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
