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
  const marker = existing ?? document.createElement('div');
  if (existing === null) {
    marker.id = TOUR_MARKER_ID;
    marker.setAttribute('role', 'text');
    marker.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;';
  }

  // An open `aria-modal` dialog hides the rest of the accessibility tree, so a
  // body-level marker vanishes from XCUITest exactly when a state whose proof
  // is a modal (e.g. the fail dialog) is confirmed. Publish the marker inside
  // the topmost open modal when one exists; fall back to body otherwise.
  const modal = document.querySelector<HTMLElement>('[aria-modal="true"]');
  const host = modal ?? document.body;
  if (marker.parentElement !== host) host.appendChild(marker);
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
