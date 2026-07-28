import { gameState } from '../core/GameState';
import { GAMEPLAY } from '../core/Constants';

/**
 * First-time tutorial — sequential state machine:
 *  State 1 "dog": a single bubble ("Tap the dog") anchored near dog_00.
 *  State 2 "hint": after the player taps the right dog, the dog bubble
 *  disappears and a hint bubble ("Now try a hint") reveals above the
 *  hint button. Tapping the hint button advances to state 3; that specific
 *  tap is SUPPRESSED in GameScene.onHintRequested (no hint circle, no hint
 *  spent) so it doesn't clutter the zoom lesson — it teaches where the hint
 *  button is without burning a hint.
 *  State 3 "zoom": the final step teaches the pinch-to-zoom gesture with a
 *  minimal spreading-dots animation (no caption). It completes when the
 *  player performs a real pinch (the scene captures the entry zoom via
 *  `onZoomStateEntered` and completes once the camera zooms in past it), or
 *  via a "Got it" skip button for mouse/desktop players who can't pinch.
 *
 * Edge case: if the player taps the hint button while still in state 1,
 * the overlay silently dismisses (tutorialShown = true) and the hint
 * fires normally. They've already figured out how to ask for help, no
 * need to stage-gate them through the remaining bubbles.
 *
 * Coordinate convention: `anchor.dogScreen` must be in CSS pixel coordinates
 * relative to the viewport. Use `phaserPointToCssPoint()` below to convert.
 */

export interface TutorialAnchor {
  /** CSS-pixel coordinates of a visible dog hitbox (viewport-relative). */
  dogScreen: { x: number; y: number };
  /** CSS-pixel radius of the dog highlight, used to size the spotlight cutout. */
  dogRadius: number;
  /**
   * Invoked when the overlay enters the final zoom step. The scene uses this
   * to start watching for a real pinch-zoom gesture; when the camera zooms
   * past 1.0 it calls `dismiss(true)` to complete the tutorial.
   */
  onZoomStateEntered?: () => void;
}

export interface TutorialHandle {
  /** Resolves when the overlay is dismissed (normally, silently, or programmatically). */
  dismissed: Promise<void>;
  /**
   * Programmatically close the overlay. `markShown=true` (default) persists
   * `gameState.tutorialShown = true`. Pass `false` from scene shutdown paths
   * where the player didn't acknowledge anything.
   */
  dismiss: (markShown?: boolean) => void;
  /**
   * Advance from state 1 (dog bubble) to state 2 (hint bubble). No-op if
   * already advanced or dismissed. Called by the scene when the player
   * taps the correct dog.
   */
  advanceToHintState: () => void;
}

type TutorialState = 'dog' | 'hint' | 'zoom' | 'dismissed';

export function showTutorialOverlay(anchor: TutorialAnchor): TutorialHandle {
  const hudOverlay = document.getElementById('hud-overlay');
  if (!hudOverlay) return noopHandle();
  if (document.getElementById('tutorial-overlay')) return noopHandle();

  const overlay = document.createElement('div');
  overlay.id = 'tutorial-overlay';
  overlay.innerHTML = `
    <div class="tutorial-spotlight"></div>
    <div class="tutorial-bubble tutorial-bubble-dog" style="left:${anchor.dogScreen.x}px;top:${anchor.dogScreen.y}px;">
      <div class="tutorial-arrow tutorial-arrow-up"></div>
      <div class="tutorial-text">Tap the dog</div>
    </div>
  `;
  hudOverlay.appendChild(overlay);

  // Spotlight the dog: a circular hole over the hitbox so the backdrop dims
  // the scene without darkening the dog the bubble points at.
  const spotlight = overlay.querySelector<HTMLElement>('.tutorial-spotlight');
  setCircleSpotlight(spotlight, anchor.dogScreen, anchor.dogRadius + SPOTLIGHT_PADDING_PX);

  let state: TutorialState = 'dog';
  let resolveFn: (() => void) | null = null;
  const dismissed = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });

  const hintBtn = document.getElementById('hint-btn');

  const dismiss = (markShown: boolean = true): void => {
    if (state === 'dismissed') return;
    state = 'dismissed';
    if (markShown) {
      gameState.tutorialShown = true;
      gameState.save();
    }
    hintBtn?.removeEventListener('click', onHintClick, true);
    overlay.remove();
    resolveFn?.();
  };

  // Advance from state 2 (hint bubble) to state 3 (zoom gesture). The hint
  // click that triggers this is suppressed in GameScene.onHintRequested (no
  // circle, no hint spent) — see the onHintClick comment below — so the zoom
  // lesson stays clean and the player keeps all their hints.
  const advanceToZoomState = (): void => {
    if (state !== 'hint') return;
    state = 'zoom';
    overlay.querySelector('.tutorial-bubble-hint')?.remove();

    // Stop treating hint clicks as tutorial input — from here the only ways
    // out are a real pinch (via the scene) or the "Got it" skip button.
    // This lets the player freely spend more hints while learning to zoom.
    hintBtn?.removeEventListener('click', onHintClick, true);

    // Hide the spotlight so the whole image is bright and pinchable; there's
    // no single target to cut out for a viewport-wide gesture.
    if (spotlight) spotlight.style.display = 'none';

    // Minimal pinch gesture: two small cream touch-points spreading apart over
    // a single soft zoom ring — communicates "pinch to zoom" with no caption
    // text and no raster asset. Pure CSS.
    const gesture = document.createElement('div');
    gesture.className = 'tutorial-pinch';
    gesture.innerHTML = `
      <div class="tutorial-zoom-glow"></div>
      <div class="tutorial-zoom-ring"></div>
      <div class="tutorial-zoom-dot"></div>
      <div class="tutorial-zoom-dot tutorial-zoom-dot-r"></div>
    `;
    overlay.appendChild(gesture);

    // Mouse/desktop players can't pinch — give them an explicit way out.
    const skipBtn = document.createElement('button');
    skipBtn.className = 'tutorial-dismiss';
    skipBtn.type = 'button';
    skipBtn.textContent = 'Got it';
    skipBtn.addEventListener('click', () => dismiss(true));
    overlay.appendChild(skipBtn);

    anchor.onZoomStateEntered?.();
  };

  const onHintClick = (): void => {
    // State 2 (hint bubble): the tap advances to the zoom step. The hint itself
    // is suppressed in GameScene.onHintRequested (via a flag set on entering the
    // hint step) so no hint circle pulses during the zoom lesson — see there.
    // Doing it there rather than here is deliberate: at the target element,
    // listeners fire in registration order regardless of capture flag, so we
    // cannot reliably stopImmediatePropagation ahead of HUD's own handler.
    if (state === 'hint') {
      advanceToZoomState();
      return;
    }
    // State 1: player skipped ahead to hints on their own — let the hint fire
    // normally and silently dismiss the tutorial.
    dismiss(true);
  };
  hintBtn?.addEventListener('click', onHintClick, true);

  const advanceToHintState = (): void => {
    if (state !== 'dog') return;
    state = 'hint';
    overlay.querySelector('.tutorial-bubble-dog')?.remove();

    const rect = hintBtn?.getBoundingClientRect();
    if (!rect) {
      // Hint button missing — defensive only. dismiss(false) so the
      // player gets another shot at the tutorial next session rather
      // than burning their one-shot on a degenerate state.
      dismiss(false);
      return;
    }
    // Move the spotlight from the dog to the hint button so it stays bright.
    setRectSpotlight(spotlight, rect, SPOTLIGHT_PADDING_PX);

    const hintBubble = document.createElement('div');
    hintBubble.className = 'tutorial-bubble tutorial-bubble-hint';
    hintBubble.style.right = `${Math.round(window.innerWidth - rect.right + 10)}px`;
    hintBubble.style.bottom = `${Math.round(window.innerHeight - rect.top + 12)}px`;
    hintBubble.innerHTML = `
      <div class="tutorial-text">Now try a hint</div>
      <div class="tutorial-arrow tutorial-arrow-down-right"></div>
    `;
    overlay.appendChild(hintBubble);
  };

  return { dismissed, dismiss, advanceToHintState };
}

/** Slack added around a spotlit target so its edges aren't clipped by the dim. */
const SPOTLIGHT_PADDING_PX = 8;

/** Punch a circular hole (centered on `center`, radius `radius`) in the backdrop. */
function setCircleSpotlight(
  el: HTMLElement | null,
  center: { x: number; y: number },
  radius: number,
): void {
  if (!el) return;
  el.style.left = `${center.x - radius}px`;
  el.style.top = `${center.y - radius}px`;
  el.style.width = `${radius * 2}px`;
  el.style.height = `${radius * 2}px`;
  el.style.borderRadius = '50%';
}

/** Punch a pill-shaped hole around a DOM rect (e.g. the hint button). */
function setRectSpotlight(el: HTMLElement | null, rect: DOMRect, padding: number): void {
  if (!el) return;
  el.style.left = `${rect.left - padding}px`;
  el.style.top = `${rect.top - padding}px`;
  el.style.width = `${rect.width + padding * 2}px`;
  el.style.height = `${rect.height + padding * 2}px`;
  el.style.borderRadius = '999px';
}

function noopHandle(): TutorialHandle {
  return {
    dismissed: Promise.resolve(),
    dismiss: () => {},
    advanceToHintState: () => {},
  };
}

/**
 * Convert a point from Phaser internal coords (e.g. `imgOffsetX + dog.x * imgScale`)
 * to CSS-pixel viewport coords. The Phaser canvas uses FIT scaling with
 * zoom=1/DPR, so its CSS size is not equal to its internal size — using
 * `getBoundingClientRect()` is the robust way to handle retina, desktop,
 * and any letterboxing the FIT scale introduces.
 */
export function phaserPointToCssPoint(
  canvas: HTMLCanvasElement,
  phaserWidth: number,
  phaserHeight: number,
  phaserX: number,
  phaserY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width / phaserWidth;
  const sy = rect.height / phaserHeight;
  return {
    x: rect.left + phaserX * sx,
    y: rect.top + phaserY * sy,
  };
}

export function resetTutorial(): void {
  // Restore hints alongside the tutorial flag. Tutorial state 2 ("Now try a
  // hint") is unreachable when hintsRemaining === 0 — the hint button is
  // disabled and the player softlocks on the bubble. Resetting hints to
  // INITIAL_HINTS guarantees the tutorial can complete its flow.
  gameState.tutorialShown = false;
  gameState.ensureMinimumHints(GAMEPLAY.INITIAL_HINTS, 'tutorial');
  gameState.save();
}
