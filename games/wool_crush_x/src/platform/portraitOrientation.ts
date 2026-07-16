type PortraitLock = 'portrait-primary' | 'portrait';

interface LockableScreenOrientation extends ScreenOrientation {
  lock?: (orientation: PortraitLock) => Promise<void>;
}

function lockPortrait(): void {
  const orientation = screen.orientation as LockableScreenOrientation | undefined;
  const lock = orientation?.lock?.bind(orientation);
  if (lock === undefined) return;

  void lock('portrait-primary')
    .catch(() => lock('portrait'))
    .catch(() => undefined);
}

export function installPortraitOrientationLock(): void {
  if (typeof window === 'undefined' || typeof screen === 'undefined') return;

  lockPortrait();
  window.addEventListener('orientationchange', lockPortrait, { passive: true });
  document.addEventListener('visibilitychange', (): void => {
    if (document.visibilityState === 'visible') lockPortrait();
  });
}
