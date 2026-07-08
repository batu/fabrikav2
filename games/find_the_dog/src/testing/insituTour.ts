import { DRIVE_STATES, type DriveState } from './driveTo';
import type { HarnessSaveProfile } from '@fabrikav2/testkit/harness';
import { publishViewportMetricsMarker } from '@fabrikav2/testkit/testing';

export interface TourHarness {
  driveTo: (state: DriveState) => Promise<boolean>;
  snapshot: () => unknown;
  resetSave?: () => void | Promise<void>;
  seedSave?: (profile: HarnessSaveProfile) => void | Promise<void>;
}

const TOUR_MARKER_ID = '__tourstate__';
const ALLSTATES_DWELL_MS = 11000;
const MARK_SETTLE_RECHECK_MS = 500;
const ALLSTATES_SAVE_PROFILE = {
  unlockedLevel: 2,
  coins: 25,
  noAds: false,
  sfx: true,
  music: true,
  haptics: true,
} as const satisfies HarnessSaveProfile;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

export async function maybeRunInsituTour(harness: TourHarness): Promise<void> {
  if (!tourRequested()) return;
  await harness.resetSave?.();
  await harness.seedSave?.(ALLSTATES_SAVE_PROFILE);
  const marker = ensureMarker();
  for (const state of DRIVE_STATES) {
    const ok = await harness.driveTo(state);
    if (!ok) {
      mark(marker, `tourstate:${state}-FAILED`);
      await sleep(ALLSTATES_DWELL_MS);
      continue;
    }
    publishReachedState(marker, state);
    await sleep(MARK_SETTLE_RECHECK_MS);
    const stable = snapshotMatchesState(state, harness.snapshot());
    if (!stable) {
      mark(marker, `tourstate:${state}-FAILED`);
      await sleep(ALLSTATES_DWELL_MS);
      continue;
    }
    publishReachedState(marker, state);
    await sleep(ALLSTATES_DWELL_MS);
    mark(marker, `tourstate:${snapshotMatchesState(state, harness.snapshot()) ? `${state}-DONE` : `${state}-FAILED`}`);
  }
  mark(marker, 'tourstate:done');
}

function tourRequested(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('insituTour') === 'allstates' || import.meta.env.VITE_INSITU_TOUR === 'allstates';
}

function ensureMarker(): HTMLElement {
  const existing = document.getElementById(TOUR_MARKER_ID);
  if (existing !== null) return existing;
  const marker = document.createElement('div');
  marker.id = TOUR_MARKER_ID;
  marker.setAttribute('role', 'text');
  marker.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;';
  marker.textContent = 'tourstate:pending';
  marker.setAttribute('aria-label', 'tourstate:pending');
  document.body.appendChild(marker);
  return marker;
}

function publishReachedState(marker: HTMLElement, state: DriveState): void {
  const value = `tourstate:${state}`;
  mark(marker, value);
  publishViewportMetricsMarker(value);
}

function mark(marker: HTMLElement, value: string): void {
  marker.textContent = value;
  marker.setAttribute('aria-label', value);
}

function snapshotMatchesState(state: DriveState, raw: unknown): boolean {
  const snapshot = (raw ?? {}) as Record<string, unknown>;
  const scene = String(snapshot.scene ?? snapshot.activeScene ?? '');
  const status = String(snapshot.status ?? '');
  const ready = snapshot.inputReady !== false && snapshot.levelDataReady !== false;
  if (state === 'menu') return scene === 'menu' || scene === 'HomeScene';
  if (state === 'level') {
    return ready
      && (scene === 'playing' || scene === 'GameScene')
      && snapshot.levelComplete !== true
      && status !== 'complete'
      && status !== 'failed';
  }
  if (state === 'settings') return snapshot.settingsOpen === true;
  if (state === 'pause') return scene === 'paused' || status === 'paused' || snapshot.lifecycleSuspended === true;
  if (state === 'win') return scene === 'complete' || status === 'complete' || snapshot.levelComplete === true;
  return scene === 'failed' || status === 'failed' || snapshot.lives === 0;
}
