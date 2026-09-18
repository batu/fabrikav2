/**
 * The first-launch flag that decides whether BootScene opens the game or the
 * home menu. The branch itself is two lines in BootScene; what is worth pinning
 * is the flag's lifecycle, and above all its migration: an existing player must
 * never be dropped into a level by installing this update.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installMemStorage, removeMemStorage, type MemStorage } from './support/memStorage';
import { GameState } from '../../src/core/GameState';

const FIRST_LAUNCH_DONE = 'ftb_first_launch_done';
const LEVEL = 'ftd_level';

describe('first-launch flag', () => {
  let storage: MemStorage;
  beforeEach(() => { storage = installMemStorage(); });
  afterEach(() => { removeMemStorage(); });

  it('is unset on a fresh install, so the first launch opens the game', () => {
    const state = new GameState();
    state.load();
    expect(state.firstLaunchDone).toBe(false);
  });

  it('is spent once and stays spent across a relaunch', () => {
    const first = new GameState();
    first.load();
    first.markFirstLaunchDone();
    expect(first.firstLaunchDone).toBe(true);
    expect(storage.getItem(FIRST_LAUNCH_DONE)).toBe('1');

    const second = new GameState();
    second.load();
    expect(second.firstLaunchDone).toBe(true);
  });

  it('treats an install that predates the flag as already launched', () => {
    // The upgrade case: a 1.2.7 player has a persisted level index and no flag.
    // Reading it as a fresh install would throw them into a level on update.
    storage.setItem(LEVEL, '23');
    const state = new GameState();
    state.load();
    expect(state.firstLaunchDone).toBe(true);
  });

  it('does not spend the flag twice', () => {
    const state = new GameState();
    state.load();
    state.markFirstLaunchDone();
    storage.removeItem(FIRST_LAUNCH_DONE);
    state.markFirstLaunchDone();
    // Already spent in memory, so the second call is a no-op rather than a
    // second write.
    expect(storage.getItem(FIRST_LAUNCH_DONE)).toBeNull();
  });
});
