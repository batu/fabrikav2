import { gameState } from '../core/GameState';
import { GAMEPLAY } from '../core/Constants';

/**
 * First-time tutorial — two beats:
 *  State 1 "dog": a single bubble ("Tap the bird") anchored on the ringed
 *  target bird chosen by the scene.
 *  State 2 "hint": after the player taps that bird, a hint bubble ("Now try
 *  a hint") reveals above the hint button. Tapping the hint button fires a
 *  REAL hint; the tutorial then WAITS silently until the player picks up
 *  that hinted bird before teaching the last gesture.
 *  State 3 "zoom": spreading-dots pinch visual; completes on a real pinch
 *  past the entry baseline (or "Got it"). A side-to-side pan lesson sat
 *  here briefly on 2026-08-07 and was cut.
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
  /** Invoked when the zoom step begins; the scene watches camera zoom and
   *  calls `dismiss(true)` once the player zooms in past the baseline. */
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
  /** Advance from the pan step to the zoom step (scene calls this when the
   *  player has panned far enough). No-op outside the pan step. */
  advanceToZoomState: () => void;
  /**
   * Re-anchor the state-1 spotlight + bubble to a new viewport point. The
   * scene calls this every frame while the camera can pan/zoom so the
   * cutout stays glued to the bird instead of to the screen. No-op outside
   * state 1.
   */
  updateAnchor: (dogScreen: { x: number; y: number }, dogRadius: number) => void;
}

type TutorialState = 'dog' | 'hint' | 'awaiting-hinted-find' | 'zoom' | 'dismissed';

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
      <div class="tutorial-text">Tap the bird</div>
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

  // "Got it" escape hatch for the zoom step: mouse
  // players can't pinch, and nobody should be trapped in a lesson.
  const addSkipButton = (): void => {
    if (overlay.querySelector('.tutorial-dismiss')) return;
    const skipBtn = document.createElement('button');
    skipBtn.className = 'tutorial-dismiss';
    skipBtn.type = 'button';
    skipBtn.textContent = 'Got it';
    skipBtn.addEventListener('click', () => dismiss(true));
    overlay.appendChild(skipBtn);
  };

  // Zoom lesson (restored 2026-08-07): two touch-points spreading over a soft
  // ring. Completes when the scene observes a real pinch past the baseline.
  const advanceToZoomState = (): void => {
    if (state !== 'awaiting-hinted-find') return;
    state = 'zoom';
    const gesture = document.createElement('div');
    gesture.className = 'tutorial-pinch';
    gesture.innerHTML = `
      <div class="tutorial-zoom-glow"></div>
      <div class="tutorial-zoom-ring"></div>
      <div class="tutorial-zoom-dot"></div>
      <div class="tutorial-zoom-dot tutorial-zoom-dot-r"></div>
    `;
    overlay.appendChild(gesture);
    addSkipButton();
    anchor.onZoomStateEntered?.();
  };

  const onHintClick = (): void => {
    // State 2: the hint fires normally (HUD's own handler) AND the tutorial
    // advances to the pan lesson — panning toward the hinted bird is the
    // natural first pan. Any earlier state: the player skipped ahead; let
    // the hint fire and end the tutorial quietly.
    if (state === 'hint') {
      // The hint fires for real; the zoom lesson waits until the player has
      // actually picked up the hinted bird (Batu, 2026-08-07) — teaching a
      // new gesture on top of a live hint buried both.
      state = 'awaiting-hinted-find';
      overlay.querySelector('.tutorial-bubble-hint')?.remove();
      if (spotlight) spotlight.style.display = 'none';
      hintBtn?.removeEventListener('click', onHintClick, true);
      return;
    }
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

  const bubbleDog = overlay.querySelector<HTMLElement>('.tutorial-bubble-dog');
  const updateAnchor = (dogScreen: { x: number; y: number }, dogRadius: number): void => {
    if (state !== 'dog') return;
    // Per-frame tracking: kill the state-change transition or the cutout
    // rubber-bands behind the camera pan.
    if (spotlight) spotlight.style.transition = 'none';
    setCircleSpotlight(spotlight, dogScreen, dogRadius + SPOTLIGHT_PADDING_PX);
    if (bubbleDog) {
      bubbleDog.style.left = `${dogScreen.x}px`;
      bubbleDog.style.top = `${dogScreen.y}px`;
    }
  };

  return { dismissed, dismiss, advanceToHintState, advanceToZoomState, updateAnchor };
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
    advanceToZoomState: () => {},
    updateAnchor: () => {},
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
