/* @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractFromExportDir } from '../src/attachments.mjs';
import { maybeRunInsituTour } from '../../../games/find_the_dog/src/testing/insituTour.ts';

function snapshotFor(state) {
  switch (state) {
    case 'level':
      return { activeScene: 'GameScene', status: 'playing', levelDataReady: true, levelComplete: false };
    case 'settings':
      return { activeScene: 'HomeScene', settingsOpen: true };
    case 'pause':
      return { activeScene: 'GameScene', status: 'paused', lifecycleSuspended: true };
    case 'win':
      return { activeScene: 'GameScene', status: 'complete', levelComplete: true };
    case 'fail':
      return { activeScene: 'GameScene', status: 'failed', lives: 0 };
    case 'menu':
    default:
      return { activeScene: 'HomeScene', settingsOpen: false };
  }
}

function makeHarness() {
  let currentState = 'menu';
  return {
    driveTo: async (state) => {
      currentState = state;
      return true;
    },
    snapshot: () => snapshotFor(currentState),
  };
}

function setTourSearch(search) {
  window.history.pushState({}, '', search ? `/${search}` : '/');
}

describe('tour marker DOM to runner attachment round-trip', () => {
  let tourMarkers;
  let viewportMetricLabels;

  beforeEach(() => {
    document.body.innerHTML = '';
    setTourSearch('?insituTour=allstates');
    tourMarkers = [];
    viewportMetricLabels = [];
    vi.useFakeTimers();
    vi.stubEnv('VITE_INSITU_TOUR', '');
    const originalSetAttribute = window.Element.prototype.setAttribute;
    vi.spyOn(window.Element.prototype, 'setAttribute').mockImplementation(function setAttribute(name, value) {
      if (this.id === '__tourstate__' && name === 'aria-label') {
        tourMarkers.push({ label: value, text: this.textContent });
      }
      if (this.id === '__viewportmetrics__' && name === 'aria-label') {
        viewportMetricLabels.push(value);
      }
      return originalSetAttribute.call(this, name, value);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    document.body.innerHTML = '';
    setTourSearch('');
  });

  it('parses the reached DOM marker and viewport metrics under the canonical runner state', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 780;
    canvas.height = 1688;
    canvas.style.width = '390px';
    canvas.style.height = '844px';
    document.body.appendChild(canvas);

    const run = maybeRunInsituTour(makeHarness());
    await vi.runAllTimersAsync();
    await run;

    const reached = tourMarkers.find((marker) => marker.label === 'tourstate:menu');
    const metricsLabel = viewportMetricLabels.find((label) => label.startsWith('viewportmetrics:state=tourstate:menu;'));
    expect(reached).toEqual({ label: 'tourstate:menu', text: 'tourstate:menu' });
    expect(metricsLabel).toBeTruthy();

    const state = reached.label.slice('tourstate:'.length);
    const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-tour-roundtrip-'));
    try {
      fs.writeFileSync(path.join(exportDir, 'manifest.json'), JSON.stringify([{
        attachments: [
          {
            exportedFileName: 'menu.png',
            suggestedHumanReadableName: `1-${state}_0_uuid.png`,
            timestamp: 100,
          },
          {
            exportedFileName: 'menu-viewportmetrics.txt',
            suggestedHumanReadableName: `1-${state}-viewportmetrics_0_uuid.txt`,
            timestamp: 101,
          },
        ],
      }]));
      fs.writeFileSync(path.join(exportDir, 'menu-viewportmetrics.txt'), metricsLabel);

      const parsed = extractFromExportDir(exportDir);

      expect({
        state,
        capture: parsed.byState[state],
        metrics: parsed.viewportMetrics[state],
      }).toMatchObject({
        state: 'menu',
        capture: path.join(exportDir, 'menu.png'),
        metrics: {
          markerState: 'tourstate:menu',
          windowInnerWidth: expect.any(Number),
          windowInnerHeight: expect.any(Number),
          devicePixelRatio: expect.any(Number),
        },
      });
    } finally {
      fs.rmSync(exportDir, { recursive: true, force: true });
    }
  });
});
