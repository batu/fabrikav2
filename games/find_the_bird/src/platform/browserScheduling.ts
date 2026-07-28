export interface ScheduledIdleWorkOptions {
  delayMs?: number;
  idleTimeoutMs: number;
  shouldRun?: () => boolean;
}

export type CancelScheduledIdleWork = () => void;

interface NavigatorConnectionHints {
  saveData?: boolean;
  effectiveType?: string;
}

let observedUserActivation = false;
let userActivationMarkerInstalled = false;

function recordUserActivation(): void {
  observedUserActivation = true;
}

function installUserActivationMarker(): void {
  if (userActivationMarkerInstalled) return;
  userActivationMarkerInstalled = true;
  window.addEventListener('pointerdown', recordUserActivation, { capture: true, passive: true });
  window.addEventListener('keydown', recordUserActivation, { capture: true });
}

export function hasUserActivated(): boolean {
  installUserActivationMarker();
  if (observedUserActivation) return true;
  const activation = (navigator as Navigator & {
    userActivation?: { hasBeenActive?: boolean; isActive?: boolean };
  }).userActivation;
  return activation?.hasBeenActive === true || activation?.isActive === true;
}

export function hasLowDataConnection(): boolean {
  const connection = (navigator as Navigator & {
    connection?: NavigatorConnectionHints;
  }).connection;
  return connection?.saveData === true || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g';
}

export function runWhenVisibleAndIdle(callback: () => void, options: ScheduledIdleWorkOptions): CancelScheduledIdleWork {
  let cancelled = false;
  let delayTimer: number | null = null;
  let fallbackTimer: number | null = null;
  let idleId: number | null = null;

  const canRun = (): boolean => !cancelled && (options.shouldRun?.() ?? true);

  const cancelVisibilityWait = (): void => {
    document.removeEventListener('visibilitychange', waitForVisible);
  };

  const run = (): void => {
    if (!canRun() || document.visibilityState !== 'visible') return;
    callback();
  };

  const scheduleIdle = (): void => {
    if (!canRun()) return;
    if (document.visibilityState !== 'visible') {
      document.addEventListener('visibilitychange', waitForVisible, { once: true });
      return;
    }

    const idle = (window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (typeof idle === 'function') {
      idleId = idle(run, { timeout: options.idleTimeoutMs });
      return;
    }

    fallbackTimer = window.setTimeout(run, options.idleTimeoutMs);
  };

  function waitForVisible(): void {
    if (!canRun()) return;
    scheduleIdle();
  }

  delayTimer = window.setTimeout(scheduleIdle, options.delayMs ?? 0);

  return (): void => {
    cancelled = true;
    cancelVisibilityWait();
    if (delayTimer !== null) window.clearTimeout(delayTimer);
    if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    if (idleId !== null) {
      const cancelIdle = (window as typeof window & {
        cancelIdleCallback?: (id: number) => void;
      }).cancelIdleCallback;
      if (typeof cancelIdle === 'function') cancelIdle(idleId);
    }
  };
}
