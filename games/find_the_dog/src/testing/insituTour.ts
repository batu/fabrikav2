import { DRIVE_STATES, type DriveState } from './driveTo';
import { publishViewportMetricsMarker } from './viewportMetrics';

export interface TourHarness {
  driveTo: (state: DriveState) => Promise<boolean>;
  resetSave?: () => void;
  seedSave?: (profile: { unlockedLevel: number; coins: number }) => void;
}

const TOUR_MARKER_ID = '__tourstate__';

export async function maybeRunInsituTour(harness: TourHarness): Promise<void> {
  if (!tourRequested()) return;
  harness.resetSave?.();
  harness.seedSave?.({ unlockedLevel: 2, coins: 25 });
  const marker = ensureMarker();
  for (const state of DRIVE_STATES) {
    mark(marker, `tourstate:${state}`);
    const ok = await harness.driveTo(state);
    mark(marker, `tourstate:${state}-${ok ? 'DONE' : 'FAILED'}`);
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
  marker.style.position = 'fixed';
  marker.style.left = '-10000px';
  marker.style.top = '0';
  marker.textContent = 'tourstate:pending';
  document.body.appendChild(marker);
  return marker;
}

function mark(marker: HTMLElement, value: string): void {
  marker.textContent = value;
  marker.setAttribute('aria-label', value);
  publishViewportMetricsMarker(value);
}
