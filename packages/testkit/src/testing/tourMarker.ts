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
  const existing = document.getElementById(TOUR_MARKER_ID);
  if (existing !== null) return existing;

  const marker = document.createElement('div');
  marker.id = TOUR_MARKER_ID;
  marker.setAttribute('role', 'text');
  marker.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;';
  document.body.appendChild(marker);
  return marker;
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
