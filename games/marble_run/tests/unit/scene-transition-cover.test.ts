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

import { showSceneTransitionCover } from '../../src/ui/SceneTransitionCover';

describe('generic scene transition cover', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="game-container"></div>';
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
