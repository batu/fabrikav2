import { createUiRoot, type ThemeTokens, type UiHandle } from './internal.ts';

/**
 * Settings-style toggle rows, extracted from two v1 seeds (research 07 R26):
 * marble_run's decoupled `buildSettingsModel` view-model
 * (`sugar3d/src/shell/settings.ts`) and FTD's `renderSettingsRows` DOM shape
 * (`HUD.ts:852-898`). Both seeds are deliberately de-literalized here: the
 * primitive owns NO copy and NO asset paths — labels and optional icons are
 * injected per row, and the DOM never owns settings state (the caller reflects
 * `onToggle` back into `value`). Built with `createElement`, not the seeds'
 * `innerHTML` templates, so injected content is escape-safe.
 */

export interface ToggleRow {
  /** Stable identifier passed back to `onToggle`; not rendered. */
  key: string;
  /** Injected copy — the visible row label. */
  label: string;
  /** Current on/off state; the caller owns it. */
  value: boolean;
  /** Optional injected icon URL; omitted rows render label-only. */
  icon?: string;
}

export interface ToggleRowsOptions {
  mountInto: HTMLElement;
  rows: readonly ToggleRow[];
  /** Fired on user toggle with the row `key` and its next value. */
  onToggle: (key: string, next: boolean) => void;
  theme?: ThemeTokens;
  id?: string;
  className?: string;
}

let nextToggleRowsId = 0;

function buildRow(row: ToggleRow, onToggle: ToggleRowsOptions['onToggle']): HTMLElement {
  const rowEl = document.createElement('div');
  rowEl.className = 'fab-toggle-row';
  rowEl.dataset.fabToggleKey = row.key;

  const left = document.createElement('div');
  left.className = 'fab-toggle-row-left';
  if (row.icon) {
    const img = document.createElement('img');
    img.className = 'fab-toggle-row-icon';
    img.src = row.icon;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    left.appendChild(img);
  }
  const label = document.createElement('span');
  label.className = 'fab-toggle-row-label';
  label.textContent = row.label;
  left.appendChild(label);
  rowEl.appendChild(left);

  const switchLabel = document.createElement('label');
  switchLabel.className = 'fab-toggle-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'fab-toggle-input';
  input.checked = row.value;
  input.setAttribute('aria-label', row.label);
  input.addEventListener('change', () => {
    onToggle(row.key, input.checked);
  });
  const slider = document.createElement('span');
  slider.className = 'fab-toggle-slider';
  slider.setAttribute('aria-hidden', 'true');
  switchLabel.append(input, slider);
  rowEl.appendChild(switchLabel);

  return rowEl;
}

export function mountToggleRows(opts: ToggleRowsOptions): UiHandle {
  const root = createUiRoot({
    mountInto: opts.mountInto,
    id: opts.id ?? `fab-toggle-rows-${++nextToggleRowsId}`,
    className: ['fab-ui', 'fab-toggle-rows', opts.className].filter(Boolean).join(' '),
    theme: opts.theme,
    kind: 'toggle-rows',
  });
  if (root.reentrant) return root.handle;

  for (const row of opts.rows) {
    root.el.appendChild(buildRow(row, opts.onToggle));
  }
  return root.finalize();
}

/**
 * Pure view-model helper carried from marble_run's `buildSettingsModel`. It
 * gives consumers the canonical music/sfx/haptics shape for free, but — unlike
 * the seed, which hard-coded `TOGGLE_LABELS` — labels are INJECTED (card AC:
 * no hard-coded toggle copy). The result's `toggles` drop straight into
 * `mountToggleRows({ rows })`. Deliberately trimmed to the toggle rows: the
 * seed's action rows (resume/close/restart) are a settings-page concern for a
 * later card, not a wave-A primitive.
 */
export type SettingKey = 'music' | 'sfx' | 'haptics';

export interface SettingsToggleRow {
  key: SettingKey;
  label: string;
  value: boolean;
}

export interface SettingsModelInput {
  music: boolean;
  sfx: boolean;
  haptics: boolean;
  /** Injected copy for each row — never hard-coded in the primitive. */
  labels: Record<SettingKey, string>;
}

export interface SettingsViewModel {
  toggles: SettingsToggleRow[];
}

export function buildSettingsModel(input: SettingsModelInput): SettingsViewModel {
  return {
    toggles: [
      { key: 'music', label: input.labels.music, value: input.music },
      { key: 'sfx', label: input.labels.sfx, value: input.sfx },
      { key: 'haptics', label: input.labels.haptics, value: input.haptics },
    ],
  };
}
