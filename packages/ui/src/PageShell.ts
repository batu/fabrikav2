import { buildButtonElement } from './Button.ts';
import { createUiRoot, type ThemeTokens, type UiHandle } from './internal.ts';

/**
 * PageShell — a generic full-screen slide-up page, generalized from FTD's
 * `openPage`/`closePage` (`games/find_the_dog/src/ui/HUD.ts:494-595`). It keeps
 * the mechanics — slide-up on an `--open` class added in `requestAnimationFrame`,
 * CSS-driven staggered child entrance, swipe-down-to-dismiss, and teardown
 * deferred to the slide-DOWN transform `transitionend` (not the faster opacity
 * fade) with a `setTimeout` fallback — and sheds all FTD coupling: hard-coded
 * titles, the back-button asset path, element ids, the `innerHTML` template, and
 * the `playUITap()` singleton. Header copy + the back-icon URL are injected;
 * the swipe threshold and exit timing are `--fab-page-*` tokens with JS numeric
 * fallbacks (happy-dom computes no `@layer` defaults — brainstorm S4).
 *
 * This is the substrate SettingsPage (and later Shop) build on, and the unit a
 * {@link createPageStack} pushes/pops.
 */

export interface PageShellOptions {
  mountInto: HTMLElement;
  /** Injected header slot (title element). Must be a fresh element. */
  header?: HTMLElement;
  /** Page content. Fresh element(s); staggered in on entrance. */
  body: HTMLElement | readonly HTMLElement[];
  /** Fires once after the page is removed (any dismissal path). */
  onDismiss?: () => void;
  /** Injected back-button icon URL. When set (or `backLabel`), a back button
   *  is rendered in the header; clicking it dismisses the page. */
  backIcon?: string;
  /** Accessible name for the back button (defaults required when `backIcon`
   *  set and no visible label — injected copy, never baked). */
  backLabel?: string;
  /** Wire swipe-down-to-dismiss. Default true. */
  swipeDownDismiss?: boolean;
  /** Skip the slide/stagger entrance + exit (e.g. deep-link). Default false. */
  instant?: boolean;
  theme?: ThemeTokens;
  id?: string;
}

// JS fallbacks for the `--fab-page-*` tokens — the ONLY numbers here. happy-dom
// (and any env without the stylesheet) computes no `@layer` token value, so
// these fallbacks are what runs in tests (brainstorm S4). A real browser reads
// the token and overrides them.
const DEFAULT_SWIPE_DISMISS_PX = 80;
const DEFAULT_EXIT_MS = 420;

let nextPageId = 0;

function assertFreshSlot(el: HTMLElement): void {
  if (el.parentNode) {
    throw new Error('mountPageShell header/body slots must be fresh elements without an existing parent.');
  }
}

function readPxToken(el: HTMLElement, token: `--fab-${string}`, fallback: number): number {
  const raw = getComputedStyle(el).getPropertyValue(token).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Package-internal identity override for composed wrappers. Not re-exported. */
export function mountPageShellWithKind(opts: PageShellOptions, kind: string): UiHandle {
  const root = createUiRoot({
    mountInto: opts.mountInto,
    id: opts.id ?? `fab-page-${++nextPageId}`,
    className: 'fab-ui fab-page',
    theme: opts.theme,
    kind,
  });
  if (root.reentrant) return root.handle;

  const { el } = root;
  const instant = opts.instant ?? false;
  if (instant) el.classList.add('fab-page--instant');

  let closing = false;
  const beginClose = (): void => {
    if (closing || root.signal.aborted) return;
    closing = true;
    if (instant) {
      root.close();
      return;
    }
    // Slide back DOWN + fade (mirrors the open). Tear down only once the
    // slide-down (transform) finishes — NOT the faster opacity fade — with a
    // timeout fallback for transitionend latency / envs that never fire it.
    el.classList.remove('fab-page--open');
    const finish = (): void => {
      el.removeEventListener('transitionend', onTransitionEnd);
      root.close(); // idempotent — clears the fallback timeout too
    };
    const onTransitionEnd = (event: TransitionEvent): void => {
      if (event.target === el && event.propertyName === 'transform') finish();
    };
    el.addEventListener('transitionend', onTransitionEnd);
    root.scheduleTimeout(finish, readPxToken(el, '--fab-page-exit-ms', DEFAULT_EXIT_MS));
  };

  const header = document.createElement('div');
  header.className = 'fab-page-header';
  if (opts.backIcon !== undefined || opts.backLabel !== undefined) {
    const backBtn = buildButtonElement({
      label: '',
      ariaLabel: opts.backLabel ?? '',
      className: 'fab-page-back',
      // Stable hook so SharedShellDriver can dismiss any page (settings/shop)
      // via a real click (attribute-only).
      dataAction: 'back',
      onClick: () => beginClose(),
    });
    if (opts.backIcon !== undefined) {
      const art = document.createElement('img');
      art.className = 'fab-page-back-art';
      art.src = opts.backIcon;
      art.alt = '';
      art.setAttribute('aria-hidden', 'true');
      backBtn.appendChild(art);
    }
    header.appendChild(backBtn);
  }
  if (opts.header) {
    assertFreshSlot(opts.header);
    opts.header.classList.add('fab-page-title');
    header.appendChild(opts.header);
  }
  el.appendChild(header);

  const bodyRoot = document.createElement('div');
  bodyRoot.className = 'fab-page-body';
  const bodyChildren = opts.body instanceof HTMLElement ? [opts.body] : opts.body;
  for (const child of bodyChildren) assertFreshSlot(child);
  for (const child of bodyChildren) {
    child.classList.add('fab-page-body-item');
    bodyRoot.appendChild(child);
  }
  el.appendChild(bodyRoot);

  if ((opts.swipeDownDismiss ?? true) && !instant) {
    let touchStartY = 0;
    let startedInBody = false;
    el.addEventListener(
      'touchstart',
      (event: TouchEvent) => {
        touchStartY = event.touches[0]?.clientY ?? 0;
        startedInBody =
          event.target instanceof Element && event.target.closest('.fab-page-body') !== null;
      },
      { passive: true },
    );
    el.addEventListener(
      'touchend',
      (event: TouchEvent) => {
        // A gesture that began inside the scrollable body is a scroll, not a
        // dismiss — leave it to native scrolling.
        if (startedInBody) return;
        const delta = (event.changedTouches[0]?.clientY ?? 0) - touchStartY;
        if (delta >= readPxToken(el, '--fab-page-swipe-dismiss-px', DEFAULT_SWIPE_DISMISS_PX)) {
          beginClose();
        }
      },
      { passive: true },
    );
  }

  if (opts.onDismiss) root.registerPostDismiss(opts.onDismiss);

  const handle: UiHandle = { el, dismiss: beginClose, dismissed: root.dismissed };
  root.finalize(handle);

  if (!instant) {
    requestAnimationFrame(() => {
      if (!root.signal.aborted) el.classList.add('fab-page--open');
    });
  }
  return handle;
}

export function mountPageShell(opts: PageShellOptions): UiHandle {
  return mountPageShellWithKind(opts, 'page-shell');
}
