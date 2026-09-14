import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameState } from '../../src/core/GameState';

let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('preserves completed users without restarting the tour', () => {
  data.set('ftd_tutorial_shown', '1');
  const state = new GameState();
  expect(state.tutorialShown).toBe(true);
  expect(state.consumeTutorialHint()).toBe(false);
});

it('records the tutorial allowance once across relaunch without granting currency', () => {
  const state = new GameState();
  const wallet = state.walletSnapshot();
  expect(state.consumeTutorialHint()).toBe(true);
  expect(state.consumeTutorialHint()).toBe(false);
  expect(new GameState().consumeTutorialHint()).toBe(false);
  expect(state.walletSnapshot()).toEqual(wallet);
});
