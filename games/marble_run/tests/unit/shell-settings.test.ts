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

  // MRV2-9 U7/U2c root cause: the harness derives the mounted settings variant
  // (menu/ingame) from the modal's action rows. The kit Button primitive renders
  // `dataAction` as `data-fab-action`, so detectSettingsVariant MUST query
  // `data-fab-action`, not `data-action` — the wave-2 `data-action` selectors
  // matched nothing, leaving settingsVariant permanently null on device and both
  // the settings and pause markers MISSING. Pin the emitted attribute so a kit
  // change (or a regression back to `data-action`) is caught here, not on device.
  it('renders settings action hooks as data-fab-action (variant detection contract)', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountSettings({ mountInto: root, inGame: true, onRestart: vi.fn(), onHome: vi.fn() });

    expect(root.querySelector('[data-fab-action="settings-restart"]')).not.toBeNull();
    expect(root.querySelector('[data-fab-action="settings-home"]')).not.toBeNull();
    // The close X is the dismiss hook the drive clicks to clear a stale modal.
    expect(root.querySelector('[data-fab-action="settings-x"]')).not.toBeNull();
    // The pre-fix `data-action` selectors must find nothing.
    expect(root.querySelector('[data-action="settings-restart"]')).toBeNull();
    expect(root.querySelector('[data-action="settings-close"]')).toBeNull();
  });

  it('menu variant exposes the Close action as data-fab-action', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountSettings({ mountInto: root, inGame: false });
    expect(root.querySelector('[data-fab-action="settings-close"]')).not.toBeNull();
    expect(root.querySelector('[data-action="settings-close"]')).toBeNull();
  });

  // MRV2-11 U3 (KTD3, ref refs/settings.png): the close X is the blue square
  // sprite with a RENDERED white × glyph — not the wave-4 empty label + broken
  // color:transparent blob. The glyph text must actually be present so it reads.
  it('renders the close X with a visible × glyph (menu + in-game)', () => {
    const menu = document.createElement('div');
    document.body.appendChild(menu);
    mountSettings({ mountInto: menu, inGame: false });
    const menuX = menu.querySelector<HTMLElement>('[data-fab-action="settings-x"]');
    expect(menuX).not.toBeNull();
    expect(menuX!.textContent).toContain('×');

    const game = document.createElement('div');
    document.body.appendChild(game);
    mountSettings({ mountInto: game, inGame: true, onRestart: vi.fn(), onHome: vi.fn() });
    expect(game.querySelector<HTMLElement>('[data-fab-action="settings-x"]')?.textContent).toContain('×');
  });

  // MRV2-14 U3 (ref refs/pause.png): the in-game Restart/Home sprites were
  // swapped — Restart must be the YELLOW pill (Button_Orange), Home the GREEN
  // pill (Button_Green). The kit paints the sprite as the `--fab-btn-sprite-image`
  // inline custom property.
  it('in-game Restart is the orange sprite and Home is the green sprite', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountSettings({ mountInto: root, inGame: true, onRestart: vi.fn(), onHome: vi.fn() });

    const restart = root.querySelector<HTMLElement>('[data-fab-action="settings-restart"]');
    const home = root.querySelector<HTMLElement>('[data-fab-action="settings-home"]');
    expect(restart!.style.getPropertyValue('--fab-btn-sprite-image')).toContain('Button_Orange');
    expect(home!.style.getPropertyValue('--fab-btn-sprite-image')).toContain('Button_Green');
  });
});
