import Phaser from 'phaser';
import { whenIconsDecoded } from './iconPreload';

const COVER_ID = 'scene-transition-cover';
const COVER_ASSETS_READY_CAP_MS = 1500;
const MIN_VISIBLE_MS = 650;
let shownAt = performance.now();

export function showSceneTransitionCover(): void {
  const container = document.getElementById('game-container') ?? document.body;
  let cover = document.getElementById(COVER_ID);
  if (cover === null) {
    cover = document.createElement('div');
    cover.id = COVER_ID;
    cover.setAttribute('aria-hidden', 'true');
    cover.innerHTML = `
      <img class="scene-transition-cover-avatar" src="/ui/mascots/dog-detective-openai.png" alt="">
    `;
    container.appendChild(cover);
  }
  shownAt = performance.now();
  cover.classList.remove('hiding');
}

export function hideSceneTransitionCover(): void {
  const cover = document.getElementById(COVER_ID);
  if (cover === null) return;

  const elapsed = performance.now() - shownAt;
  window.setTimeout(() => {
    cover.classList.add('hiding');
    window.setTimeout(() => {
      if (cover.classList.contains('hiding')) cover.remove();
    }, 220);
  }, Math.max(0, MIN_VISIBLE_MS - elapsed));
}

export function hideSceneTransitionCoverAfterPaint(): void {
  // Hold the cover until fonts AND the preloaded icons are ready, so the home is
  // revealed complete — no font swap (FOUT) on the text and no icon pop-in.
  // Capped so the cover always lifts even if a font/decode never resolves.
  const reveal = (): void => {
    requestAnimationFrame(() => requestAnimationFrame(() => hideSceneTransitionCover()));
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
