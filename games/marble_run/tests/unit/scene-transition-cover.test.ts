import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Textures: {
      Events: {},
    },
  },
}));

vi.mock('../../src/ui/iconPreload', () => ({
  whenIconsDecoded: () => Promise.resolve(),
}));

import {
  hideSceneTransitionCover,
  showPlayEntryTransitionCover,
  showSceneTransitionCover,
} from '../../src/ui/SceneTransitionCover';

describe('generic scene transition cover', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="game-container"></div>';
    Object.defineProperty(document, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
  });

  it('uses v1 Marble Run presentation without inherited loading art', () => {
    showSceneTransitionCover();

    const cover = document.getElementById('scene-transition-cover');
    expect(cover).not.toBeNull();
    expect(cover?.dataset.transitionKind).toBe('generic');
    expect(cover?.children).toHaveLength(0);
    expect(cover?.innerHTML).not.toContain('/ui/loading-icon.png');
    expect(cover?.innerHTML).not.toContain('scene-transition-spinner');
  });

  it('fades one frozen home frame instead of morphing individual shell pieces', () => {
    document.getElementById('game-container')!.innerHTML = `
      <div id="home-shell">
        <div class="home-title-panel"></div>
        <div class="home-map-stage"></div>
        <button class="marble-level-button">LEVEL 1</button>
      </div>
    `;

    showPlayEntryTransitionCover();

    const cover = document.getElementById('scene-transition-cover');
    expect(cover?.dataset.transitionKind).toBe('play-entry');
    expect(cover?.querySelector('.play-entry-home-shell')).not.toBeNull();
    expect(cover?.querySelector('.play-entry-home-shell > #home-shell')).not.toBeNull();
    expect(cover?.querySelector('.play-entry-transition-veil')).toBeNull();

    const css = readFileSync(join(process.cwd(), 'src/ui/styles.css'), 'utf8');
    expect(css).toMatch(
      /#scene-transition-cover\[data-transition-state="revealing"\] \.play-entry-home-shell,[\s\S]*?opacity: 0;/,
    );
    expect(css).not.toMatch(/play-entry-home-shell \.home-title-panel[\s\S]*?translateY/);
    expect(css).not.toMatch(/play-entry-home-shell \.home-map-stage[\s\S]*?translateY/);
    expect(css).not.toMatch(/play-entry-home-shell \.marble-level-button[\s\S]*?transform/);
  });

  it('keeps the live board canvas under the frozen shell until the reveal finishes', async () => {
    document.getElementById('game-container')!.innerHTML = `
      <div id="hud-overlay">
        <div id="home-shell"><button class="marble-level-button">LEVEL 1</button></div>
        <canvas class="marble-home-board-preview"></canvas>
      </div>
    `;
    const board = document.querySelector<HTMLCanvasElement>('.marble-home-board-preview')!;
    const dispose = vi.fn();

    showPlayEntryTransitionCover({ preservedElement: board, disposePreservedElement: dispose });

    const cover = document.getElementById('scene-transition-cover');
    expect(cover?.querySelector('.marble-home-board-preview')).toBe(board);
    expect(dispose).not.toHaveBeenCalled();

    const css = readFileSync(join(process.cwd(), 'src/ui/styles.css'), 'utf8');
    expect(css).toMatch(/#scene-transition-cover > \.marble-home-board-preview \{[\s\S]*?position: fixed;/);
    expect(css).toMatch(
      /#scene-transition-cover\[data-transition-state="revealing"\] > \.marble-home-board-preview,[\s\S]*?opacity: 0;/,
    );

    cover!.dataset.transitionState = 'holding';
    vi.useFakeTimers();
    hideSceneTransitionCover();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(dispose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
