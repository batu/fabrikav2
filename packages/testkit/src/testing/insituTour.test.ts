// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';

import { maybeRunInsituTour } from './insituTour.ts';
import { TOUR_MARKER_ID } from './tourMarker.ts';

describe('maybeRunInsituTour exception isolation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('publishes FAILED for a throwing drive and still runs the remaining states', async () => {
    const published: string[] = [];
    const observer = new MutationObserver(() => {
      const label = document.getElementById(TOUR_MARKER_ID)?.textContent;
      if (label) published.push(label);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });

    const scenes: Record<string, string> = { menu: 'menu', level: 'playing', settings: 'menu' };
    let current = 'menu';
    await maybeRunInsituTour(
      {
        driveTo: (state: string) => {
          if (state === 'level') throw new Error('engine not ready');
          current = state;
          return Promise.resolve(true);
        },
        snapshot: () => ({ scene: scenes[current] ?? current, settingsOpen: current === 'settings' }),
      },
      {
        script: 'allstates',
        states: ['menu', 'level', 'settings'],
        dwellMs: 1,
        markSettleRecheckMs: 1,
        driveTimeoutMs: 50,
        saveProfile: null,
        logger: () => {},
        snapshotMatchesState: (state, snap) => {
          const s = snap as { scene?: string; settingsOpen?: boolean };
          if (state === 'menu') return s.scene === 'menu';
          if (state === 'settings') return s.settingsOpen === true;
          return false;
        },
      },
    );
    observer.disconnect();

    expect(published).toContain('tourstate:menu');
    expect(published).toContain('tourstate:level-FAILED');
    expect(published).toContain('tourstate:settings');
    const levelIndex = published.indexOf('tourstate:level-FAILED');
    const settingsIndex = published.indexOf('tourstate:settings');
    expect(settingsIndex).toBeGreaterThan(levelIndex);
  });

  it('publishes FAILED instead of dying when snapshot throws during confirm', async () => {
    const published: string[] = [];
    const observer = new MutationObserver(() => {
      const label = document.getElementById(TOUR_MARKER_ID)?.textContent;
      if (label) published.push(label);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    await maybeRunInsituTour(
      {
        driveTo: () => Promise.resolve(true),
        snapshot: () => {
          throw new Error('camera not ready');
        },
      },
      {
        script: 'allstates',
        states: ['menu'],
        dwellMs: 1,
        markSettleRecheckMs: 1,
        driveTimeoutMs: 50,
        saveProfile: null,
        logger: () => {},
      },
    );
    observer.disconnect();
    expect(published).toContain('tourstate:menu-FAILED');
    expect(published).toContain('tourstate:done');
  });
});
