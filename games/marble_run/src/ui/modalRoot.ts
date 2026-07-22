/**
 * MRV2-11 U2 (KTD1): the single fixed, full-viewport modal layer (declared in
 * index.html as a sibling of #game-container). Every modal — home/pause
 * settings, win/fail result cards, finale — mounts here so no Phaser-managed or
 * container-relative box can misplace or top-crop it. Falls back to #hud-overlay
 * only if the root is somehow absent (defensive; the element ships in the HTML).
 */
export function getModalRoot(): HTMLElement | null {
  return document.getElementById('modal-root') ?? document.getElementById('hud-overlay');
}
