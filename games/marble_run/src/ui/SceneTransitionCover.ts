import Phaser from 'phaser';
import { whenIconsDecoded } from './iconPreload';

const COVER_ID = 'scene-transition-cover';
const OVERLAY_ID = 'hud-overlay';
const COVER_ASSETS_READY_CAP_MS = 1500;
const MIN_VISIBLE_MS = 650;
const PLAY_ENTRY_REVEAL_MS = 520;
const PLAY_ENTRY_HUD_ENTER_MS = 680;
let shownAt = performance.now();
let transitionGeneration = 0;
let hudEnterGeneration = 0;
let hudEnterCleanupTimer: number | null = null;

type TransitionKind = 'generic';

export interface PlayEntryTransitionOptions {
  /**
   * Tears the live home down — dispose the live board-preview canvas, wipe the
   * overlay, and build the game HUD. Called exactly once, AFTER the fade has
   * completed, so the real home keeps painting until it is fully transparent.
   * Also called immediately (as a fallback) when the home shell is absent and
   * the play-entry fade cannot run.
   */
  onTeardown?: () => void;
}

// The live home overlay is faded in place during a play-entry transition. This
// holds the teardown owed to the current fade so it can run once the fade ends
// (or be flushed if a new transition supersedes it).
let playEntryGeneration = 0;
let playEntryTeardown: (() => void) | null = null;

function transitionRoot(): HTMLElement | null {
  return document.getElementById(COVER_ID);
}

function nextTransitionGeneration(): string {
  transitionGeneration += 1;
  return String(transitionGeneration);
}

function coverGeneration(cover: HTMLElement): string {
  return cover.dataset.transitionGeneration ?? '';
}

function isCurrentCover(cover: HTMLElement, generation: string): boolean {
  return transitionRoot() === cover && coverGeneration(cover) === generation;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function hudOverlay(): HTMLElement | null {
  return document.getElementById(OVERLAY_ID);
}

function isCurrentPlayEntry(overlay: HTMLElement, generation: number): boolean {
  return hudOverlay() === overlay
    && overlay.dataset.playEntryGeneration === String(generation)
    && overlay.classList.contains('home-play-entry');
}

function preparePlayEntryHudEnter(): void {
  const overlay = hudOverlay();
  if (overlay === null) return;
  hudEnterGeneration += 1;
  if (hudEnterCleanupTimer !== null) {
    window.clearTimeout(hudEnterCleanupTimer);
    hudEnterCleanupTimer = null;
  }
  overlay.dataset.playEntryHudGeneration = String(hudEnterGeneration);
  overlay.classList.remove('play-entry-hud-entering');
  overlay.classList.add('play-entry-hud-enter-pending');
}

function beginPlayEntryHudEnter(): void {
  const overlay = hudOverlay();
  if (overlay === null || !overlay.classList.contains('play-entry-hud-enter-pending')) return;
  const generation = overlay.dataset.playEntryHudGeneration ?? '';
  overlay.classList.add('play-entry-hud-entering');
  hudEnterCleanupTimer = window.setTimeout(() => {
    if (overlay.dataset.playEntryHudGeneration !== generation) return;
    overlay.classList.remove('play-entry-hud-enter-pending', 'play-entry-hud-entering');
    delete overlay.dataset.playEntryHudGeneration;
    hudEnterCleanupTimer = null;
  }, PLAY_ENTRY_HUD_ENTER_MS);
}

function cancelPlayEntryHudEnter(): void {
  hudEnterGeneration += 1;
  if (hudEnterCleanupTimer !== null) {
    window.clearTimeout(hudEnterCleanupTimer);
    hudEnterCleanupTimer = null;
  }
  const overlay = hudOverlay();
  overlay?.classList.remove('play-entry-hud-enter-pending', 'play-entry-hud-entering');
  if (overlay !== null) delete overlay.dataset.playEntryHudGeneration;
}

function createOrReuseCover(kind: TransitionKind): HTMLElement {
  const container = document.getElementById('game-container') ?? document.body;
  let cover = transitionRoot();
  if (cover === null) {
    cover = document.createElement('div');
    cover.id = COVER_ID;
    cover.setAttribute('aria-hidden', 'true');
    container.appendChild(cover);
  }

  cover.dataset.transitionGeneration = nextTransitionGeneration();
  cover.dataset.transitionKind = kind;
  cover.dataset.transitionState = 'holding';
  cover.className = '';
  cover.classList.add('scene-transition-cover', `scene-transition-cover--${kind}`);
  cover.classList.remove('hiding');
  shownAt = performance.now();
  return cover;
}

export function showSceneTransitionCover(): void {
  const cover = createOrReuseCover('generic');
  // Live v1 swaps directly from the completed level to the next rendered board:
  // it has no loading illustration. Keep v2's cover as an input/readiness shield,
  // but leave it visually empty rather than exposing inherited shell-template art.
  cover.replaceChildren();
}

/**
 * Play-entry transition (renderer-proof): keep the LIVE home overlay mounted and
 * painting, lift it above the freshly mounted game scene, and fade the real home
 * layers as a single frame once the board has rendered. No clone, no reparent —
 * WebKit paints exactly the nodes it already had on screen, so the menu never
 * blanks to an empty purple field mid-transition (MRV2-31). The home is torn
 * down only after the fade completes (options.onTeardown).
 */
export function showPlayEntryTransitionCover(options: PlayEntryTransitionOptions = {}): void {
  const overlay = hudOverlay();
  const homeShell = document.getElementById('home-shell');
  if (overlay === null || homeShell === null) {
    options.onTeardown?.();
    showSceneTransitionCover();
    return;
  }

  // A superseded fade never got to run its teardown; flush it before arming the
  // next one so the previous home cannot leak.
  const stale = playEntryTeardown;
  playEntryTeardown = null;
  stale?.();

  playEntryGeneration += 1;
  playEntryTeardown = options.onTeardown ?? null;
  overlay.dataset.playEntryGeneration = String(playEntryGeneration);
  overlay.dataset.playEntryState = 'holding';
  overlay.classList.add('home-play-entry');
  // Freeze interaction with the fading home; its buttons are already disabled by
  // the launch path, but inert guarantees no stray tap re-enters navigation.
  homeShell.setAttribute('inert', '');
  shownAt = performance.now();
}

export function cancelPlayEntryTransitionCover(): void {
  const overlay = hudOverlay();
  if (overlay === null || !overlay.classList.contains('home-play-entry')) return;
  playEntryGeneration += 1;
  const teardown = playEntryTeardown;
  playEntryTeardown = null;
  cancelPlayEntryHudEnter();
  overlay.classList.remove('home-play-entry');
  delete overlay.dataset.playEntryState;
  delete overlay.dataset.playEntryGeneration;
  teardown?.();
}

export function isPlayEntryTransitionActive(): boolean {
  return hudOverlay()?.classList.contains('home-play-entry') ?? false;
}

function finishPlayEntry(overlay: HTMLElement): void {
  const teardown = playEntryTeardown;
  playEntryTeardown = null;
  overlay.dataset.playEntryState = 'done';
  // Tear the home down while the overlay is still fully transparent and lifted,
  // then drop the lift so the game HUD (built by the teardown) takes over. This
  // ordering prevents the home flashing back at opacity 1 for a frame.
  teardown?.();
  preparePlayEntryHudEnter();
  overlay.classList.remove('home-play-entry');
  delete overlay.dataset.playEntryState;
  delete overlay.dataset.playEntryGeneration;
  beginPlayEntryHudEnter();
}

function revealPlayEntry(overlay: HTMLElement, generation: number): void {
  if (!isCurrentPlayEntry(overlay, generation)) return;
  const state = overlay.dataset.playEntryState;
  if (state === 'revealing' || state === 'done') return;
  const reduceMotion = prefersReducedMotion();
  const minVisibleMs = reduceMotion ? 0 : MIN_VISIBLE_MS;
  const revealMs = reduceMotion ? 1 : PLAY_ENTRY_REVEAL_MS;
  const elapsed = performance.now() - shownAt;
  window.setTimeout(() => {
    if (!isCurrentPlayEntry(overlay, generation)) return;
    // Fade the live home to transparent (CSS opacity transition on the overlay).
    overlay.dataset.playEntryState = 'revealing';
    window.setTimeout(() => {
      if (!isCurrentPlayEntry(overlay, generation)) return;
      finishPlayEntry(overlay);
    }, revealMs);
  }, Math.max(0, minVisibleMs - elapsed));
}

function removeCoverAfterHide(cover: HTMLElement, generation: string, delayMs: number): void {
  window.setTimeout(() => {
    if (isCurrentCover(cover, generation) && cover.classList.contains('hiding')) {
      cover.dataset.transitionState = 'done';
      cover.remove();
    }
  }, delayMs);
}

function hideGenericTransitionCover(cover: HTMLElement): void {
  const generation = coverGeneration(cover);
  const elapsed = performance.now() - shownAt;
  window.setTimeout(() => {
    if (!isCurrentCover(cover, generation)) return;
    cover.dataset.transitionState = 'clearing';
    cover.classList.add('hiding');
    removeCoverAfterHide(cover, generation, 220);
  }, Math.max(0, MIN_VISIBLE_MS - elapsed));
}

export function hideSceneTransitionCover(): void {
  const cover = transitionRoot();
  if (cover === null) return;
  hideGenericTransitionCover(cover);
}

export function hidePlayEntryTransitionCoverAfterSceneRender(scene: Phaser.Scene): void {
  let scheduled = false;
  const scheduleHide = (): void => {
    if (scheduled) return;
    scheduled = true;
    // The board has rendered once. Let the browser paint it behind the live home
    // before starting the home's fade-out.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const overlay = hudOverlay();
      if (overlay !== null && overlay.classList.contains('home-play-entry')) {
        revealPlayEntry(overlay, Number(overlay.dataset.playEntryGeneration));
      } else {
        hideSceneTransitionCoverAfterPaint();
      }
    }));
  };

  scene.events.once(Phaser.Scenes.Events.RENDER, scheduleHide);
  window.setTimeout(scheduleHide, 120);
}

export function hideSceneTransitionCoverAfterPaint(): void {
  // Hold the cover until fonts AND the preloaded icons are ready, so the home is
  // revealed complete — no font swap (FOUT) on the text and no icon pop-in.
  // Capped so the cover always lifts even if a font/decode never resolves.
  const reveal = (): void => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      hideSceneTransitionCover();
    }));
  };
  const fontsReady: Promise<unknown> =
    typeof document !== 'undefined' && document.fonts ? document.fonts.ready : Promise.resolve();

  let revealed = false;
  const go = (): void => {
    if (revealed) return;
    revealed = true;
    reveal();
  };
  void Promise.all([fontsReady, whenIconsDecoded()]).then(go);
  window.setTimeout(go, COVER_ASSETS_READY_CAP_MS);
}

export function hideSceneTransitionCoverAfterSceneRender(scene: Phaser.Scene): void {
  scene.events.once(Phaser.Scenes.Events.RENDER, () => {
    hideSceneTransitionCoverAfterPaint();
  });
}
