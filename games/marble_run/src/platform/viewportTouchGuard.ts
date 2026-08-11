/**
 * Stop WKWebView from translating the entire game viewport during a finger
 * drag. Capacitor's native scroll flag and CSS gesture rules are retained as
 * defense in depth, but iOS 26 can still hand an uncancelled touchmove to the
 * web view. Marble Run has no scrollable game surfaces.
 */
export function installViewportTouchGuard(document: Document): () => void {
  const onTouchMove = (event: TouchEvent): void => {
    if (event.cancelable) event.preventDefault();
  };

  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  return (): void => document.removeEventListener('touchmove', onTouchMove, { capture: true });
}
