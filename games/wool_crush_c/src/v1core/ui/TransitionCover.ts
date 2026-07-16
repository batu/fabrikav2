import { createUiRoot, type ThemeTokens, type UiHandle } from './internal';

/**
 * A full-bleed scene-transition cover: a solid panel that masks a
 * screen-to-screen swap (e.g. a Phaser scene teardown) so the destination is
 * revealed already-painted, with no half-loaded flash. Copy-and-parameterized
 * from the find_the_dog original (`games/find_the_dog/src/ui/SceneTransitionCover.ts`):
 * generalized to inject asset-readiness and supply its artwork via the content
 * slot + `--fab-transition-*` tokens, with no game-specific assets or imports.
 *
 * Pure DOM — no Phaser / game-state / audio / env coupling. It is an input
 * SHIELD (`pointer-events: auto`), NOT a focus-trapping modal: it carries
 * `aria-hidden="true"` and claims no modal/focus semantics. See README.md.
 */

const DEFAULT_MIN_VISIBLE_MS = 650;
const DEFAULT_ASSETS_READY_CAP_MS = 1500;
// JS removal delay after `.hiding` is added. Pairs with the CSS opacity fade
// (`--fab-transition-cover-fade-ms`, default 180ms): kept a touch longer so the
// element is removed only after the fade has visually completed. Mirrors the
// FTD original's 180ms transition / 220ms removal pair.
const HIDE_REMOVE_MS = 220;

export interface TransitionCoverContent {
  /** Artwork rendered centred in the cover. Omitted → no `<img>` (plain panel). */
  imageSrc?: string;
  /** Accessible alt for the artwork. Defaults to '' (decorative). */
  imageAlt?: string;
}

export interface TransitionCoverOptions {
  /** Element to append the cover into (e.g. the game container / overlay root). */
  mountInto: HTMLElement;
  content?: TransitionCoverContent;
  /** Token overrides applied to the cover root. */
  theme?: ThemeTokens;
  /** Minimum time the cover stays fully visible before `hide()` fades it. Default 650. */
  minVisibleMs?: number;
  /**
   * Extra readiness the cover holds for in `hideAfterPaint()` (e.g. decoded
   * sprites), on top of the always-awaited `document.fonts.ready`. The reveal
   * still fires at `assetsReadyCapMs` even if this never resolves.
   */
  assetsReady?: Promise<unknown>;
  /** Hard cap after which `hideAfterPaint()` reveals regardless. Default 1500. */
  assetsReadyCapMs?: number;
  /** Root element id + re-entrancy key. Defaults to 'fab-transition-cover'. */
  id?: string;
}

export interface TransitionCoverHandle extends UiHandle {
  /**
   * Fade the cover out (respecting `minVisibleMs`), then remove it and resolve
   * `dismissed`. Idempotent; a call after `dismiss()` is a safe no-op.
   */
  hide: () => void;
  /**
   * Hold the cover until fonts + `assetsReady` resolve (capped at
   * `assetsReadyCapMs`), then reveal via a double-rAF and `hide()` — so the
   * destination is painted before the cover lifts.
   */
  hideAfterPaint: () => void;
}

/**
 * Mount a scene-transition cover. Returns a {@link TransitionCoverHandle}.
 * Re-entrant: if a cover with the same `id` is already mounted, returns that
 * live handle without mounting a second one.
 */
export function mountTransitionCover(opts: TransitionCoverOptions): TransitionCoverHandle {
  const root = createUiRoot({
    mountInto: opts.mountInto,
    id: opts.id ?? 'fab-transition-cover',
    className: 'fab-ui fab-transition-cover',
    theme: opts.theme,
  });
  // The only mounts of this id come through mountTransitionCover, so the live
  // handle stored by finalize() below is always a TransitionCoverHandle.
  if (root.reentrant) return root.handle as TransitionCoverHandle;

  const { el, close, signal, scheduleTimeout, dismissed } = root;
  el.setAttribute('aria-hidden', 'true');

  const minVisibleMs = opts.minVisibleMs ?? DEFAULT_MIN_VISIBLE_MS;
  const assetsReadyCapMs = opts.assetsReadyCapMs ?? DEFAULT_ASSETS_READY_CAP_MS;
  const shownAt = performance.now();

  if (opts.content?.imageSrc) {
    const img = document.createElement('img');
    img.className = 'fab-transition-cover-image';
    img.src = opts.content.imageSrc;
    img.alt = opts.content.imageAlt ?? '';
    el.appendChild(img);
  }

  let hideStarted = false;
  const hide = (): void => {
    if (hideStarted || signal.aborted) return;
    hideStarted = true;
    const elapsed = performance.now() - shownAt;
    scheduleTimeout(() => {
      if (signal.aborted) return;
      el.classList.add('hiding');
      scheduleTimeout(() => {
        if (signal.aborted) return;
        // Removal (close) resolves `dismissed`; guarded on `.hiding` so a
        // consumer that re-shows the cover mid-fade isn't torn down.
        if (el.classList.contains('hiding')) close();
      }, HIDE_REMOVE_MS);
    }, Math.max(0, minVisibleMs - elapsed));
  };

  const hideAfterPaint = (): void => {
    const fontsReady: Promise<unknown> =
      typeof document !== 'undefined' && document.fonts ? document.fonts.ready : Promise.resolve();
    let revealed = false;
    const reveal = (): void => {
      if (revealed || signal.aborted) return;
      revealed = true;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!signal.aborted) hide();
        }),
      );
    };
    void Promise.all([fontsReady, opts.assetsReady ?? Promise.resolve()]).then(reveal);
    // Hard cap: the cover always lifts even if a font/decode never resolves.
    scheduleTimeout(reveal, assetsReadyCapMs);
  };

  const handle: TransitionCoverHandle = { el, dismiss: close, dismissed, hide, hideAfterPaint };
  return root.finalize(handle) as TransitionCoverHandle;
}
