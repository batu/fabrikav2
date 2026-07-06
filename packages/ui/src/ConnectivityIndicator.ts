import { createUiRoot, type ThemeTokens, type UiHandle } from './internal.ts';

/**
 * Online/offline indicator, ported from FTD `HUD.ts:initConnectivityIndicator`
 * (1426-1441). Tracks `navigator.onLine`, toggles a `--fab-*`-themed dot, and
 * announces transitions through an injected toast callback.
 *
 * De-hardcoded vs v1 (brainstorm D4):
 *  - copy strings (`'Back online'` / `'Offline — playing cached levels'`) are
 *    injected, not literal;
 *  - the toaster is not a hard dependency — v1 called `showToast` directly; here
 *    the caller wires wave A's `mountToaster` through `onToast`;
 *  - owns its own indicator element instead of `getElementById('offline-indicator')`;
 *  - registers the `online`/`offline` window listeners against the root's abort
 *    signal, so `dismiss()` unregisters them (v1 leaked them — SURPRISES S4).
 */

export interface ConnectivityIndicatorOptions {
  /** Element the indicator dot is appended into. */
  mountInto: HTMLElement;
  /** Message announced (via `onToast`) when connectivity is regained. */
  onlineCopy: string;
  /** Message announced (via `onToast`) when connectivity is lost. */
  offlineCopy: string;
  /** Injected sink for the transition announcements (e.g. wave A's toaster). */
  onToast?: (message: string) => void;
  theme?: ThemeTokens;
  id?: string;
  className?: string;
}

export interface ConnectivityIndicatorHandle extends UiHandle {
  /** Current connectivity, read live from `navigator.onLine`. */
  isOnline(): boolean;
}

let nextIndicatorId = 0;

export function mountConnectivityIndicator(
  opts: ConnectivityIndicatorOptions,
): ConnectivityIndicatorHandle {
  const root = createUiRoot({
    mountInto: opts.mountInto,
    id: opts.id ?? `fab-connectivity-${++nextIndicatorId}`,
    className: ['fab-ui', 'fab-connectivity', opts.className].filter(Boolean).join(' '),
    theme: opts.theme,
  });
  if (root.reentrant) return root.handle as ConnectivityIndicatorHandle;

  const dot = root.el;
  dot.setAttribute('role', 'status');

  // Reflect current connectivity onto the dot: visible + flagged when offline,
  // hidden (aria + class) when online. All styling is via the `--offline` class.
  const sync = (): void => {
    const online = navigator.onLine;
    dot.classList.toggle('fab-connectivity--offline', !online);
    dot.setAttribute('aria-hidden', String(online));
  };
  sync();

  // Bind listeners to the abort signal so root.close() removes them (no leak).
  window.addEventListener(
    'online',
    (): void => {
      sync();
      opts.onToast?.(opts.onlineCopy);
    },
    { signal: root.signal },
  );
  window.addEventListener(
    'offline',
    (): void => {
      sync();
      opts.onToast?.(opts.offlineCopy);
    },
    { signal: root.signal },
  );

  const handle: ConnectivityIndicatorHandle = {
    el: dot,
    dismiss: root.close,
    dismissed: root.dismissed,
    isOnline: (): boolean => navigator.onLine,
  };
  root.finalize(handle);
  return handle;
}
