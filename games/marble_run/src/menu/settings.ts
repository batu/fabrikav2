import {
  buildSettingsModel,
  mountModalShell,
  mountToggleRows,
  type ModalAction,
  type UiHandle,
} from '@fabrikav2/ui';
import { gameState } from '../core/GameState';
import { setMusicEnabled, setSoundEffectsEnabled } from '../audio/AudioManager';
import { syncAmbientMusicPreference } from '../audio/AmbientManager';
import { analytics } from '../analytics/AnalyticsService';
import { assetUrls } from '../../design/theme';

/**
 * v1 sugar3d settings surface: one Popup modal with the Music / Sound Effects /
 * Haptics toggle rows, in two variants (KTD2 — v1 has no separate pause menu):
 *  - menu variant: a single Close action.
 *  - in-game variant: Restart + Home action rows (the HUD pause/settings button
 *    opens this same modal).
 * Toggles bind to the scaffold's existing gameState.settings audio/haptics store.
 */

export interface MountSettingsOptions {
  mountInto: HTMLElement;
  /** In-game (pause) variant → Restart + Home rows; otherwise the menu Close row. */
  inGame: boolean;
  /** Restart the active level (in-game variant only). */
  onRestart?: () => void;
  /** Leave the level back to the home menu (in-game variant only). */
  onHome?: () => void;
  /** Fired after the modal is dismissed (any path). */
  onDismiss?: () => void;
}

function bindToggle(key: 'music' | 'sfx' | 'haptics', next: boolean): void {
  if (key === 'music') {
    gameState.settings.musicOn = next;
    gameState.settings.soundOn = gameState.settings.musicOn && gameState.settings.soundEffectsOn;
    gameState.save();
    setMusicEnabled(next);
    syncAmbientMusicPreference();
    void analytics.settingsChanged({ setting_name: 'musicOn', new_value: String(next) });
    return;
  }
  if (key === 'sfx') {
    gameState.settings.soundEffectsOn = next;
    gameState.settings.soundOn = gameState.settings.musicOn && gameState.settings.soundEffectsOn;
    gameState.save();
    setSoundEffectsEnabled(next);
    void analytics.settingsChanged({ setting_name: 'soundEffectsOn', new_value: String(next) });
    return;
  }
  gameState.settings.hapticsOn = next;
  gameState.save();
  void analytics.settingsChanged({ setting_name: 'hapticsOn', new_value: String(next) });
}

export function mountSettings(opts: MountSettingsOptions): UiHandle {
  const model = buildSettingsModel({
    music: gameState.settings.musicOn,
    sfx: gameState.settings.soundEffectsOn,
    haptics: gameState.settings.hapticsOn,
    labels: { music: 'Music', sfx: 'Sound Effects', haptics: 'Haptics' },
  });

  const body = document.createElement('div');
  body.className = 'marble-settings-body';
  const toggleHandle = mountToggleRows({
    mountInto: body,
    rows: model.toggles,
    onToggle: (key, next) => bindToggle(key as 'music' | 'sfx' | 'haptics', next),
  });

  const actions: ModalAction[] = opts.inGame
    ? [
        {
          label: 'Restart',
          dataAction: 'settings-restart',
          className: 'marble-settings-action',
          spriteImage: assetUrls.buttonGreen,
          onClick: () => {
            handle.dismiss();
            opts.onRestart?.();
          },
        },
        {
          label: 'Home',
          dataAction: 'settings-home',
          className: 'marble-settings-action',
          spriteImage: assetUrls.buttonOrange,
          onClick: () => {
            handle.dismiss();
            opts.onHome?.();
          },
        },
      ]
    : [
        {
          label: 'Close',
          dataAction: 'settings-close',
          className: 'marble-settings-action',
          spriteImage: assetUrls.buttonGreen,
          onClick: () => handle.dismiss(),
        },
      ];

  const handle = mountModalShell({
    mountInto: opts.mountInto,
    ribbon: { title: 'Settings', image: assetUrls.ribbonOrange },
    cardImage: assetUrls.popup,
    cardClassName: 'marble-settings-card',
    closeButton: { label: '', ariaLabel: 'Close', dataAction: 'settings-x' },
    body,
    actions,
    backdropDismiss: true,
    onDismiss: () => {
      toggleHandle.dismiss();
      opts.onDismiss?.();
    },
  });
  return handle;
}
