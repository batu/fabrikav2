import { describe, expect, it } from 'vitest';
import { marbleRunDrivePredicates } from './drivePredicates.ts';
import type { DriveSnapshot } from '@fabrikav2/testkit/testing';

// Build a snapshot as the harness would emit it; unspecified fields default to
// the "nothing open, on gameplay" baseline so each test isolates one signal.
function snap(overrides: Record<string, unknown>): DriveSnapshot {
  return {
    activeScene: 'GameScene',
    homeShellVisible: false,
    settingsOpen: false,
    settingsVariant: null,
    levelCompleteOverlayVisible: false,
    levelFailedOverlayVisible: false,
    lifecycleSuspended: false,
    status: 'playing',
    inputReady: true,
    lives: 3,
    ...overrides,
  } as DriveSnapshot;
}

describe('marbleRunDrivePredicates.win (UI-truth)', () => {
  it('rejects an internal complete flag with no visible overlay', () => {
    expect(marbleRunDrivePredicates.win(snap({ levelComplete: true, status: 'complete' }))).toBe(false);
  });

  it('accepts only when the level-complete overlay is mounted+visible', () => {
    expect(marbleRunDrivePredicates.win(snap({ levelCompleteOverlayVisible: true }))).toBe(true);
  });

  it('rejects a visible overlay while the home shell is showing', () => {
    expect(marbleRunDrivePredicates.win(snap({ levelCompleteOverlayVisible: true, homeShellVisible: true }))).toBe(false);
  });
});

describe('marbleRunDrivePredicates.pause (UI-truth)', () => {
  it('rejects a merely-suspended lifecycle with no modal', () => {
    expect(marbleRunDrivePredicates.pause(snap({ lifecycleSuspended: true, status: 'paused' }))).toBe(false);
  });

  it('accepts GameScene + in-game settings modal visible', () => {
    expect(marbleRunDrivePredicates.pause(snap({ settingsVariant: 'ingame' }))).toBe(true);
  });

  it('rejects the menu settings variant during gameplay', () => {
    expect(marbleRunDrivePredicates.pause(snap({ settingsVariant: 'menu' }))).toBe(false);
  });
});

describe('marbleRunDrivePredicates.settings (UI-truth, menu Close variant)', () => {
  it('accepts home shell + menu variant modal', () => {
    expect(marbleRunDrivePredicates.settings(snap({ activeScene: 'HomeScene', homeShellVisible: true, settingsVariant: 'menu' }))).toBe(true);
  });

  it('rejects the in-game variant opened over the home screen', () => {
    expect(marbleRunDrivePredicates.settings(snap({ activeScene: 'HomeScene', homeShellVisible: true, settingsVariant: 'ingame' }))).toBe(false);
  });

  it('rejects settingsOpen with no mounted modal variant', () => {
    expect(marbleRunDrivePredicates.settings(snap({ activeScene: 'HomeScene', homeShellVisible: true, settingsOpen: true, settingsVariant: null }))).toBe(false);
  });
});

describe('gameplay predicate still rejects terminal/paused surfaces', () => {
  it('accepts clean playing', () => {
    expect(marbleRunDrivePredicates.level(snap({}))).toBe(true);
  });

  it('rejects when a win overlay is visible', () => {
    expect(marbleRunDrivePredicates.level(snap({ levelCompleteOverlayVisible: true, status: 'complete' }))).toBe(false);
  });

  it('rejects when an in-game settings modal is open (even if status still playing)', () => {
    expect(marbleRunDrivePredicates.level(snap({ settingsVariant: 'ingame', settingsOpen: true }))).toBe(false);
  });
});
