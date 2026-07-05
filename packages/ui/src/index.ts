// @fabrikav2/ui — wave A primitives. DOM-only, `--fab-*` token-themed, zero
// literal colors / copy / asset paths (all injected). Import the stylesheet
// once from a consumer: `import '@fabrikav2/ui/ui.css'`.

export { mountButton, buildButtonElement } from './Button.ts';
export type { ButtonVariant, ButtonOptions, ButtonHandle } from './Button.ts';

export { mountModalShell, mountModal } from './ModalShell.ts';
export type { ModalShellOptions, ModalAction } from './ModalShell.ts';

export { mountToaster } from './ToastSystem.ts';
export type { ToasterOptions, ToasterHandle } from './ToastSystem.ts';

export { mountToggleRows, buildSettingsModel } from './ToggleRow.ts';
export type {
  ToggleRow,
  ToggleRowsOptions,
  SettingKey,
  SettingsToggleRow,
  SettingsModelInput,
  SettingsViewModel,
} from './ToggleRow.ts';

export { applyTheme } from './internal.ts';
export type { ThemeTokens, UiHandle } from './internal.ts';
