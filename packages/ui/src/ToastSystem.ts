import { createUiRoot, type ThemeTokens, type UiHandle } from './internal.ts';

/**
 * Time-boxed text toast, generalized from FTD `HUD.ts:showToast` (research 07
 * R55). The v1 version hard-coded its `#hud-overlay` mount, `hud-toast` class
 * names, and a module-level `activeToast` singleton. Here the mount point is
 * injected, the classes are `--fab-*`-themed, and the queue-of-one state is
 * instance-scoped: two surfaces can host independent toasters (card S6). Each
 * toaster still keeps the "no stacking" guarantee — a new `show()` replaces the
 * in-flight toast rather than stacking a second one.
 */

/** Duration a toast stays visible before fading out, when the token is unset. */
const TOAST_DURATION_FALLBACK_MS = 3000;
/** Fade-out transition duration, when the token is unset (must match the CSS). */
const TOAST_FADE_FALLBACK_MS = 250;

export interface ToasterOptions {
  /** Element the toaster host is appended into (its positioning context). */
  mountInto: HTMLElement;
  theme?: ThemeTokens;
  id?: string;
  className?: string;
}

export interface ToasterHandle extends UiHandle {
  /** Show `message`, replacing any currently-visible toast (no stacking). */
  show(message: string): void;
}

let nextToasterId = 0;

/** Parse a `--fab-*-ms` token off `root` (e.g. "3000ms" / "3000") to a number.
 *  Falls back when the token is absent/unparseable — the no-theme case in a
 *  headless DOM env, where a `@layer` default isn't computed (card S4). */
function readMsToken(root: HTMLElement, name: string, fallback: number): number {
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function mountToaster(opts: ToasterOptions): ToasterHandle {
  const root = createUiRoot({
    mountInto: opts.mountInto,
    id: opts.id ?? `fab-toaster-${++nextToasterId}`,
    className: ['fab-ui', 'fab-toaster', opts.className].filter(Boolean).join(' '),
    theme: opts.theme,
    kind: 'toaster',
  });
  // Kind-validated: a re-entrant handle here is guaranteed to be a live toaster;
  // createUiRoot rejects incompatible owners before this cast can be reached.
  if (root.reentrant) return root.handle as ToasterHandle;

  const host = root.el;
  let active: HTMLElement | null = null;
  let timers: number[] = [];

  const cancelTimers = (): void => {
    for (const id of timers) window.clearTimeout(id);
    timers = [];
  };
  // Clear any pending fade/remove timers when the whole toaster is dismissed.
  root.registerCleanup(cancelTimers);

  const show = (message: string): void => {
    if (root.signal.aborted) return;

    // Queue-of-one: drop any in-flight toast (element + its timers) first.
    cancelTimers();
    if (active) {
      active.remove();
      active = null;
    }

    const el = document.createElement('div');
    el.className = 'fab-toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    host.appendChild(el);
    active = el;

    // Trigger the CSS enter transition on the next frame.
    requestAnimationFrame((): void => {
      el.classList.add('fab-toast--visible');
    });

    const duration = readMsToken(host, '--fab-toast-duration-ms', TOAST_DURATION_FALLBACK_MS);
    const fade = readMsToken(host, '--fab-toast-fade-ms', TOAST_FADE_FALLBACK_MS);

    const fadeTimer = window.setTimeout((): void => {
      el.classList.remove('fab-toast--visible');
    }, duration);
    const removeTimer = window.setTimeout((): void => {
      el.remove();
      if (active === el) active = null;
    }, duration + fade);
    timers.push(fadeTimer, removeTimer);
  };

  const handle: ToasterHandle = {
    el: host,
    dismiss: root.close,
    dismissed: root.dismissed,
    show,
  };
  root.finalize(handle);
  return handle;
}
