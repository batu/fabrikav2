/**
 * Package-internal lifecycle helpers for @fabrikav2/ui components.
 *
 * This module is intentionally not re-exported from the public package subpath.
 */

/**
 * CSS-variable token values a consumer sets, keyed to the `--fab-*` namespace
 * (e.g. an accent-color override under `--fab-color-accent`). Keys are
 * constrained to the `--fab-*` namespace so a stray non-namespaced var is a
 * compile error. (Deliberately NOT a union of exact token names — that would
 * churn every time a component adds a token; the prefix constraint is the
 * v0 contract.)
 */
export type ThemeTokens = Record<`--fab-${string}`, string>;

/** Tag a root with the `.fab-ui` scope and set its `--fab-*` token overrides. */
export function applyTheme(root: HTMLElement, tokens: ThemeTokens): void {
  root.classList.add('fab-ui');
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value);
  }
}

/** Uniform handle every ui component returns. */
export interface UiHandle {
  /** The component's root element. */
  el: HTMLElement;
  /** Remove the component and resolve `dismissed`. Idempotent. */
  dismiss: () => void;
  /** Resolves once the component is dismissed (any path). */
  dismissed: Promise<void>;
}

interface CreateUiRootOptions {
  mountInto: HTMLElement;
  id: string;
  /** Full className for the root, e.g. 'fab-ui fab-modal-backdrop'. */
  className: string;
  theme?: ThemeTokens;
  /** Root tag name. Defaults to div for existing overlay components. */
  tagName?: 'button' | 'div';
  /**
   * Component identity for kind-validated re-entrant reuse. A mount reuses only
   * a live root registered under the same kind. A different owned kind or an
   * untracked element sharing the id is rejected without mutating either root.
   */
  kind: string;
}

export interface UiRootControls {
  el: HTMLElement;
  /** Idempotent dismiss: abort → run cleanups → clear timers → unregister → remove → resolve. */
  close: () => void;
  dismissed: Promise<void>;
  /** Register in MOUNTED, appendChild into mountInto, return the live handle. */
  finalize: (handle?: UiHandle) => UiHandle;
  /** Aborts on close — passed to component callbacks for post-await liveness checks. */
  signal: AbortSignal;
  /** window.setTimeout whose ids are tracked and cleared on close. */
  scheduleTimeout: (cb: () => void, ms: number) => void;
  /** Extra teardown (e.g. clearInterval), run after the root is unregistered/removed. */
  registerCleanup: (fn: () => void) => void;
  /** External dismissal callbacks, run after DOM removal and `dismissed` resolution. */
  registerPostDismiss: (fn: () => void) => void;
}

export type CreateUiRootResult =
  | { reentrant: true; handle: UiHandle }
  | ({ reentrant: false } & UiRootControls);

// Live handles keyed by their mounted root, so a re-entrant mount can return the
// REAL handle (working dismiss / accurate dismissed) instead of a dead no-op.
// The `kind` tags which component registered the root, so a kind-validated mount
// can reject a handle whose methods belong to a different component.
// WeakMap → entries clear when the element is GC'd; close() deletes eagerly.
interface MountRecord {
  handle: UiHandle;
  kind: string;
}
const MOUNTED = new WeakMap<HTMLElement, MountRecord>();

export function createUiRoot(opts: CreateUiRootOptions): CreateUiRootResult {
  // Match by id among direct children — the root is always appendChild'd to
  // mountInto, so a children scan finds it. Avoids a CSS `#${id}` selector,
  // which would throw on ids with CSS-special chars (and CSS.escape isn't
  // available in every DOM env, e.g. jsdom).
  const existing = Array.from(opts.mountInto.children).find(
    (child): child is HTMLElement => child instanceof HTMLElement && child.id === opts.id,
  );
  if (existing) {
    const record = MOUNTED.get(existing);
    if (!record) {
      throw new Error(
        `createUiRoot id collision for "${opts.id}": cannot mount kind "${opts.kind}" over an untracked element.`,
      );
    }
    if (record.kind !== opts.kind) {
      throw new Error(
        `createUiRoot id collision for "${opts.id}": cannot mount kind "${opts.kind}" over owned kind "${record.kind}".`,
      );
    }
    return { reentrant: true, handle: record.handle };
  }

  const el = document.createElement(opts.tagName ?? 'div');
  el.id = opts.id;
  el.className = opts.className;
  if (opts.theme) applyTheme(el, opts.theme);

  const controller = new AbortController();
  const timeoutIds = new Set<number>();
  const cleanups: Array<() => void> = [];
  const postDismissCallbacks: Array<() => void> = [];

  let resolved = false;
  let resolveFn: (() => void) | null = null;
  const dismissed = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  const close = (): void => {
    if (resolved) return;
    resolved = true;
    const errors: unknown[] = [];
    const run = (fn: () => void): void => {
      try {
        fn();
      } catch (error) {
        errors.push(error);
      }
    };

    controller.abort();
    MOUNTED.delete(el);
    el.remove();
    for (const fn of cleanups) run(fn);
    for (const id of timeoutIds) window.clearTimeout(id);
    timeoutIds.clear();
    resolveFn?.();
    for (const fn of postDismissCallbacks) run(fn);
    if (errors.length > 0) {
      throw errors[0];
    }
  };

  const scheduleTimeout = (cb: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      timeoutIds.delete(id);
      cb();
    }, ms);
    timeoutIds.add(id);
  };

  const registerCleanup = (fn: () => void): void => {
    cleanups.push(fn);
  };

  const registerPostDismiss = (fn: () => void): void => {
    postDismissCallbacks.push(fn);
  };

  const finalize = (override?: UiHandle): UiHandle => {
    const handle: UiHandle = override ?? { el, dismiss: close, dismissed };
    MOUNTED.set(el, { handle, kind: opts.kind });
    opts.mountInto.appendChild(el);
    return handle;
  };

  return {
    reentrant: false,
    el,
    close,
    dismissed,
    finalize,
    signal: controller.signal,
    scheduleTimeout,
    registerCleanup,
    registerPostDismiss,
  };
}
