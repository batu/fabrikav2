/**
 * Device-truth telemetry (MRV2-11 U1 / KTD2): the measured geometry of the open
 * modal chain — backdrop, card, and the backdrop's mount container — plus the
 * viewport metrics they should be sized against. Pure read; the harness includes
 * it in the snapshot ONLY while a modal is open so the round-5 device log can
 * prove what made settings/win top-pin/crop/scale and that the fix removed it.
 *
 * Kept in a Phaser-free module so it can be unit-tested (present-when-open /
 * absent-when-closed) without standing up a Phaser game.
 */

/** Computed geometry for one element in the modal chain. */
export interface ModalElementGeometry {
  rect: { x: number; y: number; width: number; height: number; top: number; left: number };
  position: string;
  transform: string;
  zoom: string;
  fontSize: string;
}

export interface ModalGeometrySnapshot {
  backdrop: ModalElementGeometry;
  card: ModalElementGeometry | null;
  container: ModalElementGeometry | null;
  window: { innerWidth: number; innerHeight: number };
  visualViewport: { width: number; height: number; offsetTop: number } | null;
}

function readModalElementGeometry(el: HTMLElement): ModalElementGeometry {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return {
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, left: rect.left },
    position: style.position,
    transform: style.transform,
    zoom: style.getPropertyValue('zoom'),
    fontSize: style.fontSize,
  };
}

/**
 * Snapshot the open modal chain's geometry, or `undefined` when no modal is
 * mounted.
 */
export function readModalGeometry(): ModalGeometrySnapshot | undefined {
  const backdrop = document.querySelector<HTMLElement>('.fab-modal-backdrop');
  if (backdrop === null) return undefined;
  const card = backdrop.querySelector<HTMLElement>('.fab-modal-card');
  const container = backdrop.parentElement;
  const vv = window.visualViewport ?? null;
  return {
    backdrop: readModalElementGeometry(backdrop),
    card: card !== null ? readModalElementGeometry(card) : null,
    container: container instanceof HTMLElement ? readModalElementGeometry(container) : null,
    window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
    visualViewport: vv !== null ? { width: vv.width, height: vv.height, offsetTop: vv.offsetTop } : null,
  };
}
