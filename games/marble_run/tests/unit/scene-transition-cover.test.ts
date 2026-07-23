import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Textures: {
      Events: {},
    },
    Scenes: {
      Events: { RENDER: 'render' },
    },
  },
}));

vi.mock('../../src/ui/iconPreload', () => ({
  whenIconsDecoded: () => Promise.resolve(),
}));

import {
  hidePlayEntryTransitionCoverAfterSceneRender,
  isPlayEntryTransitionActive,
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
});

describe('play-entry transition (live-DOM fade)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="game-container">
        <div id="hud-overlay" class="home-mode">
          <div id="home-shell"><button class="marble-level-button">LEVEL 1</button></div>
          <canvas class="marble-home-board-preview"></canvas>
        </div>
      </div>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never clones or reparents the home — it fades the live overlay in place', () => {
    const homeShell = document.getElementById('home-shell')!;
    const board = document.querySelector('.marble-home-board-preview')!;

    showPlayEntryTransitionCover({ onTeardown: () => {} });

    const overlay = document.getElementById('hud-overlay')!;
    // No cover is created for the play-entry path.
    expect(document.getElementById('scene-transition-cover')).toBeNull();
    // The overlay is the fade layer; the real home nodes stay put and inert.
    expect(overlay.classList.contains('home-play-entry')).toBe(true);
    expect(overlay.dataset.playEntryState).toBe('holding');
    expect(isPlayEntryTransitionActive()).toBe(true);
    expect(document.getElementById('home-shell')).toBe(homeShell);
    expect(overlay.contains(homeShell)).toBe(true);
    expect(overlay.contains(board)).toBe(true);
    expect(homeShell.hasAttribute('inert')).toBe(true);
    // No clone was made anywhere in the document.
    expect(document.querySelectorAll('#home-shell')).toHaveLength(1);
    expect(document.querySelectorAll('.marble-home-board-preview')).toHaveLength(1);
  });

  it('holds the live home mounted until the fade ends, then tears it down once', () => {
    vi.useFakeTimers();
    const teardown = vi.fn();
    showPlayEntryTransitionCover({ onTeardown: teardown });

    const overlay = document.getElementById('hud-overlay')!;
    const scene = { events: { once: vi.fn() } } as unknown as Parameters<
      typeof hidePlayEntryTransitionCoverAfterSceneRender
    >[0];

    // rAF is unavailable under fake timers; drive the render-scheduled reveal via
    // its 120ms fallback and stub rAF to run synchronously.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    hidePlayEntryTransitionCoverAfterSceneRender(scene);
    // The 120ms render fallback schedules the reveal; a minimum-visible hold
    // keeps the home fully mounted before the opacity fade begins.
    vi.advanceTimersByTime(120);
    expect(overlay.dataset.playEntryState).toBe('holding');
    expect(teardown).not.toHaveBeenCalled();

    // The fade begins after the minimum-visible hold; the home is still mounted.
    vi.advanceTimersByTime(650);
    expect(overlay.dataset.playEntryState).toBe('revealing');
    expect(teardown).not.toHaveBeenCalled();
    expect(document.getElementById('home-shell')).not.toBeNull();

    // After the reveal window the single teardown fires and the lift is dropped.
    vi.advanceTimersByTime(2_000);
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(overlay.classList.contains('home-play-entry')).toBe(false);
    expect(isPlayEntryTransitionActive()).toBe(false);
  });

  it('falls back to the generic cover when the home shell is absent', () => {
    document.getElementById('home-shell')!.remove();
    const teardown = vi.fn();

    showPlayEntryTransitionCover({ onTeardown: teardown });

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(document.getElementById('scene-transition-cover')?.dataset.transitionKind).toBe('generic');
    expect(isPlayEntryTransitionActive()).toBe(false);
  });

  it('fades the live overlay via a single opacity transition (no per-piece morph)', () => {
    const css = readFileSync(join(process.cwd(), 'src/ui/styles.css'), 'utf8');
    expect(css).toMatch(/#hud-overlay\.home-play-entry \{[\s\S]*?transition: opacity 520ms/);
    expect(css).toMatch(
      /#hud-overlay\.home-play-entry\[data-play-entry-state="revealing"\] \{[\s\S]*?opacity: 0;/,
    );
    // The old clone-into-cover mechanism is gone.
    expect(css).not.toContain('play-entry-home-shell');
    expect(css).not.toContain('play-entry-home-backdrop');
  });
});
