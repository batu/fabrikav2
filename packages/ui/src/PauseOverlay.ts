import { mountModalShellWithKind, type ModalAction } from './ModalShell.ts';
import { type ThemeTokens, type UiHandle } from './internal.ts';

/**
 * PauseOverlay — a minimal resume/settings/quit overlay over wave-A
 * {@link mountModalShell}. This is NEW, not a port: v1 had no dedicated pause
 * overlay (marble reused the in-game Settings modal as pause; FTD had none —
 * brainstorm S7). Kept intentionally minimal — no reset-progress two-tap dance
 * (that is SettingsPage's out-of-game concern).
 *
 * All labels are injected. The consumer wires the callbacks to the flow machine
 * (Resume → `machine.resume()`, Quit → `machine.toMenu()`) and pushes
 * SettingsPage onto the PageStack for Settings (orthogonal to the machine).
 * Reference for the callback→transition map: marble's `SettingsActionKey`.
 */

export interface PauseOverlayActions {
  onResume: () => void;
  /** Optional — omit to hide the settings row. Consumer pushes SettingsPage. */
  onSettings?: () => void;
  onQuit: () => void;
}

export interface PauseOverlayLabels {
  /** Injected title copy; omit for a title-less card. */
  title?: string;
  resume: string;
  /** Required only when `actions.onSettings` is supplied. */
  settings?: string;
  quit: string;
}

export interface PauseOverlayOptions {
  mountInto: HTMLElement;
  actions: PauseOverlayActions;
  labels: PauseOverlayLabels;
  backdropDismiss?: boolean;
  onDismiss?: () => void;
  theme?: ThemeTokens;
  id?: string;
}

export function mountPauseOverlay(opts: PauseOverlayOptions): UiHandle {
  return mountModalShellWithKind(
    { mountInto: opts.mountInto, id: opts.id, theme: opts.theme },
    'pause-overlay',
    () => {
      // Stable data-fab-action hooks so SharedShellDriver drives pause
      // navigation for every game via real clicks (attribute-only, no markup
      // change).
      const actions: ModalAction[] = [
        {
          label: opts.labels.resume,
          dataAction: 'pause-resume',
          onClick: () => opts.actions.onResume(),
        },
      ];
      if (opts.actions.onSettings) {
        if (opts.labels.settings === undefined) {
          throw new Error(
            'mountPauseOverlay: labels.settings is required when actions.onSettings is supplied.',
          );
        }
        const onSettings = opts.actions.onSettings;
        actions.push({
          label: opts.labels.settings,
          dataAction: 'pause-settings',
          onClick: () => onSettings(),
        });
      }
      actions.push({
        label: opts.labels.quit,
        dataAction: 'pause-quit',
        onClick: () => opts.actions.onQuit(),
      });

      return {
        mountInto: opts.mountInto,
        title: opts.labels.title,
        actions,
        backdropDismiss: opts.backdropDismiss,
        onDismiss: opts.onDismiss,
        theme: opts.theme,
        id: opts.id,
        cardClassName: 'fab-pause-card',
      };
    },
  );
}
