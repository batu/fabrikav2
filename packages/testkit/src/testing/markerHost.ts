/**
 * Shared host resolution for offscreen accessibility marker elements
 * (#__tourstate__, #__viewportmetrics__).
 *
 * An open `aria-modal` dialog hides the rest of the accessibility tree, so a
 * body-level marker vanishes from XCUITest exactly when a state whose proof is
 * a modal (e.g. the fail dialog) is confirmed. Publish markers inside the
 * topmost open modal when one exists; fall back to body otherwise. If the
 * hosting modal is later removed from the DOM, the next ensure call recreates
 * or re-parents the marker, so a stale host self-heals on the next publish.
 */
export function ensureHostedMarker(id: string): HTMLElement {
  const existing = document.getElementById(id);
  const marker = existing ?? document.createElement('div');
  if (existing === null) {
    marker.id = id;
    marker.setAttribute('role', 'text');
    marker.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;';
  }

  // Minimal DOM stubs in consumer tests may lack querySelector; the modal
  // lookup is an enhancement, never a requirement.
  const modal = typeof document.querySelector === 'function'
    ? document.querySelector<HTMLElement>('[aria-modal="true"]')
    : null;
  const host = modal ?? document.body;
  if (marker.parentElement !== host) host.appendChild(marker);
  return marker;
}
