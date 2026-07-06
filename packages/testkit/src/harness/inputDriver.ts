/**
 * The ONE generic input-driver (CONDUCTOR decision 2). A game writes one
 * coordinate ACCESSOR per input verb ({@link GameVerbHandler.clientPoint}); this
 * is the single place that turns a client point into a REAL pointer event.
 *
 * The dead-menu-buttons lesson is load-bearing
 * (`docs/retros/insitu-testing-capability-notes.md` items 2-3): the bug that
 * shipped was an overlay swallowing clicks, and it passed because tests forced
 * engine calls / `el.click()`. This driver deliberately dispatches a full,
 * bubbling pointer sequence at the real client coordinates and hit-tests the
 * topmost element there — so an intercepting layer makes the interaction land on
 * the WRONG element (a detectable failure) instead of being bypassed. NO
 * `{ force: true }`, NO `el.click()`.
 *
 * Browser-side by construction (it touches `document`). It lives in the harness
 * subpath because the in-game harness invokes it; the playwright runner reads a
 * `clientPoint` over the bridge and can dispatch it here via `page.evaluate`.
 */
import type { ClientPoint } from './contract.ts';

/** The element a pointer sequence actually reached — the topmost at the point.
 *  A test asserts this is the intended target, catching interception. */
export interface DriveInputResult {
  /** `document.elementFromPoint(x, y)` at dispatch time; null if nothing there. */
  readonly hitTarget: Element | null;
}

/**
 * Dispatch a real pointerdown → pointerup → click sequence at `point` (client
 * coordinates). Events bubble and carry the client coordinates, so a listener
 * anywhere up the tree sees a genuine user gesture. Returns the hit-tested
 * target so the caller can assert the click landed where intended.
 */
export function driveInputAt(point: ClientPoint): DriveInputResult {
  const target = document.elementFromPoint(point.x, point.y);
  if (target === null) {
    return { hitTarget: null };
  }

  const shared = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
  } as const;

  const canPointer = typeof PointerEvent === 'function';
  if (canPointer) {
    target.dispatchEvent(new PointerEvent('pointerdown', { ...shared, pointerType: 'touch', isPrimary: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { ...shared, pointerType: 'touch', isPrimary: true }));
  }
  // A `click` always follows a real tap; dispatch it so click-only listeners
  // (the common menu-button case) fire without an `el.click()` shortcut.
  target.dispatchEvent(new MouseEvent('click', shared));

  return { hitTarget: target };
}
