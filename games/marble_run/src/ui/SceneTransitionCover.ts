import Phaser from 'phaser';
import { whenIconsDecoded } from './iconPreload';

const COVER_ID = 'scene-transition-cover';
const COVER_ASSETS_READY_CAP_MS = 1500;
const MIN_VISIBLE_MS = 650;
const PLAY_ENTRY_REVEAL_MS = 520;
const PLAY_ENTRY_CLEANUP_MS = 40;
const PLAY_ENTRY_HUD_ENTER_MS = 680;
let shownAt = performance.now();
let transitionGeneration = 0;
let hudEnterGeneration = 0;
let hudEnterCleanupTimer: number | null = null;

type TransitionKind = 'generic' | 'play-entry';

export interface PlayEntryTransitionOptions {
  /**
   * The live menu preview canvas is a sibling of #home-shell, so cloning the
   * shell cannot preserve its WebGL pixels. Keep this exact canvas in the cover
   * until the home shell has faded away instead of attempting to clone it.
   */
  preservedElement?: HTMLElement;
  /** Releases the owner of preservedElement after the transition no longer
   * needs it. This is also called if a new transition replaces this one. */
  disposePreservedElement?: () => void;
}

let preservedPlayEntryElement: { readonly cover: HTMLElement; readonly dispose: () => void } | null = null;

function transitionRoot(): HTMLElement | null {
  return document.getElementById(COVER_ID);
}

function disposePreservedPlayEntryElement(cover?: HTMLElement): void {
  if (preservedPlayEntryElement === null) return;
  if (cover !== undefined && preservedPlayEntryElement.cover !== cover) return;
  const preserved = preservedPlayEntryElement;
  preservedPlayEntryElement = null;
  preserved.dispose();
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

function isCurrentTransition(cover: HTMLElement, generation: string, kind: TransitionKind): boolean {
  return isCurrentCover(cover, generation) && cover.dataset.transitionKind === kind;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function hudOverlay(): HTMLElement | null {
  return document.getElementById('hud-overlay');
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
  if (cover !== null) disposePreservedPlayEntryElement(cover);
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

/** Play-entry transition: freeze the live home shell in one overlay and fade it
 *  as a single frame after the game scene has rendered. Live v1 never morphs or
 *  independently moves the title, board, saga nodes, or LEVEL button. */
export function showPlayEntryTransitionCover(options: PlayEntryTransitionOptions = {}): void {
  const homeShell = document.getElementById('home-shell');
  if (homeShell === null) {
    options.disposePreservedElement?.();
    showSceneTransitionCover();
    return;
  }

  const cover = createOrReuseCover('play-entry');
  const generation = coverGeneration(cover);
  cover.dataset.transitionState = 'arming';
  preparePlayEntryHudEnter();
  // Recreate the live overlay's containing block around the clone. The menu
  // itself has several viewport and inherited-font rules, so cloning only its
  // root into the cover changes the layout context and visibly snaps the saga
  // and CTA at t0.
  const foreground = document.createElement('div');
  foreground.className = 'play-entry-home-shell';
  foreground.setAttribute('aria-hidden', 'true');
  foreground.setAttribute('inert', '');
  const frozenHomeShell = homeShell.cloneNode(true) as HTMLElement;
  frozenHomeShell.querySelectorAll('video').forEach((video) => {
    video.pause();
    video.removeAttribute('src');
    for (const source of Array.from(video.querySelectorAll('source'))) {
      source.removeAttribute('src');
    }
  });
  cover.innerHTML = '<div class="play-entry-home-backdrop"></div>';
  // Phase-sync the backdrop's motif drift to the live home pattern so it doesn't
  // jump when this backdrop paints over the real home. The home motif layer
  // drifts via the homePawDrift CSS animation, which is compositor-driven —
  // getComputedStyle returns the base transform, NOT the on-screen position, so
  // we can't just copy the transform. Instead run the SAME animation on the
  // backdrop and align its phase with a negative animation-delay equal to the
  // live animation's currentTime. document.getAnimations() surfaces the
  // ::before animation.
  const motifAnim = document.getAnimations().find(
    (a): a is CSSAnimation => a instanceof CSSAnimation && a.animationName === 'homePawDrift',
  );
  const motifTime = motifAnim?.currentTime ?? null;
  if (typeof motifTime === 'number') {
    cover.querySelector<HTMLElement>('.play-entry-home-backdrop')
      ?.style.setProperty('--home-paw-delay', `${-motifTime}ms`);
  }
  foreground.appendChild(frozenHomeShell);
  cover.appendChild(foreground);
  if (options.preservedElement !== undefined) {
    // Move, never clone: an HTMLCanvasElement clone intentionally has no bitmap
    // backing store. Keeping the live canvas also preserves its exact viewport
    // geometry while the frozen DOM shell fades over the game scene.
    cover.appendChild(options.preservedElement);
    if (options.disposePreservedElement !== undefined) {
      preservedPlayEntryElement = { cover, dispose: options.disposePreservedElement };
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (isCurrentTransition(cover, generation, 'play-entry') && cover.dataset.transitionState === 'arming') {
      cover.dataset.transitionState = 'holding';
    }
  }));
}

export function cancelPlayEntryTransitionCover(): void {
  const cover = transitionRoot();
  if (cover?.dataset.transitionKind !== 'play-entry') return;
  cancelPlayEntryHudEnter();
  disposePreservedPlayEntryElement(cover);
  cover.dataset.transitionState = 'done';
  cover.remove();
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
    if (!isCurrentCover(cover, generation) || cover.dataset.transitionKind === 'play-entry') return;
    cover.dataset.transitionState = 'clearing';
    cover.classList.add('hiding');
    removeCoverAfterHide(cover, generation, 220);
  }, Math.max(0, MIN_VISIBLE_MS - elapsed));
}

function hidePlayEntryTransitionCover(cover: HTMLElement, generation: string = coverGeneration(cover)): void {
  if (!isCurrentTransition(cover, generation, 'play-entry')) return;
  const reduceMotion = prefersReducedMotion();
  if (cover.dataset.transitionState === 'arming') {
    window.setTimeout(() => hidePlayEntryTransitionCover(cover, generation), 1);
    return;
  }
  if (cover.dataset.transitionState === 'revealing' || cover.dataset.transitionState === 'clearing') return;
  const elapsed = performance.now() - shownAt;
  const minVisibleMs = reduceMotion ? 0 : MIN_VISIBLE_MS;
  const revealMs = reduceMotion ? 1 : PLAY_ENTRY_REVEAL_MS;
  const cleanupMs = reduceMotion ? 1 : PLAY_ENTRY_CLEANUP_MS;
  window.setTimeout(() => {
    if (!isCurrentTransition(cover, generation, 'play-entry')) return;
    cover.dataset.transitionState = 'revealing';
    window.setTimeout(() => {
      if (!isCurrentTransition(cover, generation, 'play-entry')) return;
      cover.dataset.transitionState = 'clearing';
      window.setTimeout(() => {
        if (!isCurrentTransition(cover, generation, 'play-entry')) return;
        beginPlayEntryHudEnter();
        // The live board has faded out with the frozen shell. Dispose it only
        // once the game scene is visible, preventing a blank clone at t0 and a
        // ghost canvas after the reveal.
        disposePreservedPlayEntryElement(cover);
        cover.classList.add('hiding');
        removeCoverAfterHide(cover, generation, 240);
      }, cleanupMs);
    }, revealMs);
  }, Math.max(0, minVisibleMs - elapsed));
}

export function hideSceneTransitionCover(): void {
  const cover = transitionRoot();
  if (cover === null) return;
  const generation = coverGeneration(cover);
  if (cover.dataset.transitionKind === 'play-entry') {
    hidePlayEntryTransitionCover(cover, generation);
  } else {
    hideGenericTransitionCover(cover);
  }
}

export function hidePlayEntryTransitionCoverAfterSceneRender(scene: Phaser.Scene): void {
  let scheduled = false;
  const scheduleHide = (): void => {
    if (scheduled) return;
    scheduled = true;
    // The board has rendered once. Let the browser paint it behind the home clone
    // before moving the overlay into its reveal phase.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const cover = transitionRoot();
      if (cover?.dataset.transitionKind === 'play-entry') {
        hidePlayEntryTransitionCover(cover, coverGeneration(cover));
      } else {
        hideSceneTransitionCoverAfterPaint();
      }
    }));
  };

  scene.events.once(Phaser.Scenes.Events.RENDER, scheduleHide);
  window.setTimeout(scheduleHide, 120);
}

export function isPlayEntryTransitionActive(): boolean {
  return transitionRoot()?.dataset.transitionKind === 'play-entry';
}

export function hideSceneTransitionCoverAfterPaint(): void {
  // Hold the cover until fonts AND the preloaded icons are ready, so the home is
  // revealed complete — no font swap (FOUT) on the text and no icon pop-in.
  // Capped so the cover always lifts even if a font/decode never resolves.
  const reveal = (): void => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (transitionRoot()?.dataset.transitionKind === 'play-entry') return;
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
