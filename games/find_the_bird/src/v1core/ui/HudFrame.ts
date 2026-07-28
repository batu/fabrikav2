import { createUiRoot, type ThemeTokens, type UiHandle } from './internal';

/**
 * Slot-based top-bar frame: three caller-provided slots (left / center / right)
 * laid out in a `1fr auto 1fr` grid, owning the `env(safe-area-inset-*)` padding
 * recipe once (copied read-only from the FTD `.hud-top-bar` + marble donors and
 * generalized to three slots). The equal-width side columns keep the center slot
 * at the container's true center regardless of the side slots' widths. A caller
 * passing only `left` + `right` reproduces the donors' two-slot layout — the
 * empty center column collapses to zero width, left flush-left, right flush-right.
 *
 * The frame is a FLOW element: it owns only its internal layout + safe-area
 * padding, NOT its placement. The caller wraps it in whatever shell it needs
 * (a fixed overlay, a header slot, etc.). It carries no hearts/coins/gear/pill
 * widgets — those are caller-supplied elements handed to the slots.
 *
 * Safe-area is tokenized behind an indirection: `--fab-hud-safe-*` default to
 * `env(safe-area-inset-*, 0px)`, so a consumer (or the test harness, or a
 * platform that must override the notch inset) can inject a fixed value and the
 * padding becomes `calc(inset + base)`.
 */
export interface HudFrameOptions {
  /** Element to append the frame into (e.g. the game's HUD overlay root). */
  mountInto: HTMLElement;
  /** Element(s) for the left slot (leading). */
  left?: HTMLElement | readonly HTMLElement[];
  /** Element(s) for the center slot (collapses to zero width when empty). */
  center?: HTMLElement | readonly HTMLElement[];
  /** Element(s) for the right slot (trailing). */
  right?: HTMLElement | readonly HTMLElement[];
  /** Token overrides applied to the frame root (incl. `--fab-hud-safe-*`). */
  theme?: ThemeTokens;
  /** Root element id; also the re-entrancy key. Defaults to a generated id. */
  id?: string;
  /** Extra class(es) appended to the root, after `fab-ui fab-hud-frame`. */
  className?: string;
}

let nextHudFrameId = 0;

function assertFreshSlot(el: HTMLElement): void {
  if (el.parentNode) {
    throw new Error('mountHudFrame slots must be fresh elements without an existing parent.');
  }
}

function fillSlot(container: HTMLElement, content: HTMLElement | readonly HTMLElement[] | undefined): void {
  if (!content) return;
  if (content instanceof HTMLElement) {
    assertFreshSlot(content);
    container.appendChild(content);
  } else {
    for (const child of content) assertFreshSlot(child);
    container.append(...content);
  }
}

/**
 * Mount the HUD top-bar frame. Returns a {@link UiHandle}; `dismiss()` removes
 * the root and resolves `dismissed`. Re-entrant: a mount with an already-open
 * `id` returns that live frame's handle without building a second one.
 *
 * All three slot containers (`.fab-hud-left/-center/-right`) always render; an
 * omitted slot yields an empty (zero-width, collapsing) container so layout and
 * tests have one invariant. Caller-provided slot elements must be fresh
 * (unparented) — core fails fast rather than silently reparent a live node.
 *
 * Pure DOM — no game-state / audio / platform / env coupling.
 */
export function mountHudFrame(opts: HudFrameOptions): UiHandle {
  const root = createUiRoot({
    mountInto: opts.mountInto,
    id: opts.id ?? `fab-hud-frame-${++nextHudFrameId}`,
    className: ['fab-ui', 'fab-hud-frame', opts.className].filter(Boolean).join(' '),
    theme: opts.theme,
  });
  if (root.reentrant) return root.handle;

  const { el } = root;

  const left = document.createElement('div');
  left.className = 'fab-hud-left';
  const center = document.createElement('div');
  center.className = 'fab-hud-center';
  const right = document.createElement('div');
  right.className = 'fab-hud-right';

  fillSlot(left, opts.left);
  fillSlot(center, opts.center);
  fillSlot(right, opts.right);

  el.append(left, center, right);
  return root.finalize();
}
