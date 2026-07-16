import Phaser from 'phaser';
import { whenIconsDecoded } from './iconPreload';

const COVER_ID = 'scene-transition-cover';
const COVER_ASSETS_READY_CAP_MS = 1500;
const MIN_VISIBLE_MS = 650;
const PLAY_ENTRY_REVEAL_MS = 900;
const PLAY_ENTRY_CLEANUP_MS = 220;
const PLAY_ENTRY_BLACK_FADE_IN_MS = 260;
const PLAY_ENTRY_HUD_ENTER_MS = 680;
let shownAt = performance.now();
let transitionGeneration = 0;
let hudEnterGeneration = 0;
let hudEnterCleanupTimer: number | null = null;

type TransitionKind = 'generic' | 'play-entry';

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
  cover.innerHTML = `
    <img class="scene-transition-cover-avatar scene-transition-spinner" src="/ui/loading-icon.png" alt="">
  `;
}

/** Play-entry transition: clone the live #home-shell into the cover, then let
 *  CSS fly each home piece off-screen (title up, map up, rails out, nav + play
 *  down) while the veil crossfades to the freshly rendered game behind it. */
export function showPlayEntryTransitionCover(): void {
  const homeShell = document.getElementById('home-shell');
  if (homeShell === null) {
    showSceneTransitionCover();
    return;
  }

  const cover = createOrReuseCover('play-entry');
  const generation = coverGeneration(cover);
  cover.dataset.transitionState = 'arming';
  preparePlayEntryHudEnter();
  const foreground = homeShell.cloneNode(true) as HTMLElement;
  foreground.classList.add('play-entry-home-shell');
  foreground.setAttribute('aria-hidden', 'true');
  foreground.setAttribute('inert', '');
  foreground.querySelectorAll('video').forEach((video) => {
    video.pause();
    video.removeAttribute('src');
    for (const source of Array.from(video.querySelectorAll('source'))) {
      source.removeAttribute('src');
    }
  });
  cover.innerHTML = `
    <div class="play-entry-home-backdrop"></div>
    <div class="play-entry-transition-veil"></div>
  `;
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
  cover.appendChild(foreground);
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
    window.setTimeout(() => hidePlayEntryTransitionCover(cover, generation), reduceMotion ? 1 : PLAY_ENTRY_BLACK_FADE_IN_MS);
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
