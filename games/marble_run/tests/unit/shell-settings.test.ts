import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountSettings } from '../../src/menu/settings';
import { gameState } from '../../src/core/GameState';

function actionLabels(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('.fab-modal-actions .fab-btn')).map(
    (b) => (b as HTMLElement).dataset.fabAction ?? '',
  );
}

describe('mountSettings variants', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    gameState.settings.musicOn = true;
    gameState.settings.soundEffectsOn = true;
    gameState.settings.hapticsOn = true;
  });

  it('menu variant renders the three toggle rows and a single Close action', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountSettings({ mountInto: root, inGame: false });

    const keys = Array.from(root.querySelectorAll('.fab-toggle-row')).map(
      (r) => (r as HTMLElement).dataset.fabToggleKey,
    );
    expect(keys).toEqual(['music', 'sfx', 'haptics']);
    expect(actionLabels(root)).toEqual(['settings-close']);
  });

  it('in-game variant renders Restart + Home instead of Close', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const onRestart = vi.fn();
    const onHome = vi.fn();
    mountSettings({ mountInto: root, inGame: true, onRestart, onHome });

    expect(actionLabels(root)).toEqual(['settings-restart', 'settings-home']);

    root.querySelector<HTMLButtonElement>('[data-fab-action="settings-restart"]')?.click();
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('toggling a row flips the persisted setting', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const saveSpy = vi.spyOn(gameState, 'save');
    mountSettings({ mountInto: root, inGame: false });

    const musicInput = root.querySelector<HTMLInputElement>(
      '.fab-toggle-row[data-fab-toggle-key="music"] input',
    );
    expect(musicInput).not.toBeNull();
    musicInput!.checked = false;
    musicInput!.dispatchEvent(new Event('change'));

    expect(gameState.settings.musicOn).toBe(false);
    expect(saveSpy).toHaveBeenCalled();
    saveSpy.mockRestore();
  });
});
