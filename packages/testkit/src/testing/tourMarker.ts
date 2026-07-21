import { ensureHostedMarker } from './markerHost.ts';
import { publishViewportMetricsMarker } from './viewportMetrics.ts';

export const TOUR_MARKER_ID = '__tourstate__';

export interface PublishTourMarkerOptions {
  readonly publishMetrics?: boolean;
  readonly log?: (message: string) => void;
  readonly snapshot?: () => Record<string, unknown>;
}

export function formatTourStateLabel(state: string): string {
  return state.startsWith('tourstate:') ? state : `tourstate:${state}`;
}

export function ensureTourMarker(): HTMLElement {
  return ensureHostedMarker(TOUR_MARKER_ID);
}

export function publishTourMarker(state: string, options: PublishTourMarkerOptions = {}): HTMLElement {
  const marker = ensureTourMarker();
  const label = formatTourStateLabel(state);
  const rawState = label.replace(/^tourstate:/, '');

  document.body.setAttribute('data-tour-state', rawState);
  marker.textContent = label;
  marker.setAttribute('aria-label', label);

  if (options.publishMetrics ?? true) publishViewportMetricsMarker(label);
  options.log?.(`state=${rawState}${sceneSuffix(options.snapshot?.())}`);
  return marker;
}

function sceneSuffix(snapshot: Record<string, unknown> | undefined): string {
  if (snapshot === undefined) return '';
  const scene = snapshot.scene ?? snapshot.activeScene;
  return scene === undefined ? '' : ` scene=${String(scene)}`;
}
