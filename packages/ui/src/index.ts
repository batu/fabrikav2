// @fabrikav2/ui — wave A primitives. DOM-only, `--fab-*` token-themed, zero
// literal colors / copy / asset paths (all injected). Import the stylesheet
// once from a consumer: `import '@fabrikav2/ui/ui.css'`.

export { mountButton, buildButtonElement } from './Button.ts';
export type { ButtonVariant, ButtonOptions, ButtonHandle } from './Button.ts';

export { mountModalShell, mountModal } from './ModalShell.ts';
export type { ModalShellOptions, ModalAction, ModalRibbon, ModalCloseButton } from './ModalShell.ts';

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

export { animateEconomyTransfer } from './EconomyTransfer.ts';
export type { EconomyTransferKind, EconomyTransferOptions } from './EconomyTransfer.ts';

// ---- Screen layer (this card) ----
export { mountSagaMap } from './SagaMap.ts';
export type {
  LevelNodeState,
  LevelMapNode,
  LevelMapState,
  LevelMapActions,
  SagaMapOptions,
} from './SagaMap.ts';

export { mountHomeMenu } from './HomeMenu.ts';
export type { HomeMenuOptions, HomeMenuAction, HomeMenuSagaConfig } from './HomeMenu.ts';

export { mountPageShell } from './PageShell.ts';
export type { PageShellOptions } from './PageShell.ts';

export { mountSettingsPage } from './SettingsPage.ts';
export type { SettingsPageOptions, LegalLink, PrivacyChoice } from './SettingsPage.ts';

export { mountResultCard } from './ResultCard.ts';
export type { ResultVariant, ResultCardOptions } from './ResultCard.ts';

export { mountPauseOverlay } from './PauseOverlay.ts';
export type { PauseOverlayOptions, PauseOverlayActions, PauseOverlayLabels } from './PauseOverlay.ts';

export { createPageStack } from './PageStack.ts';
export type { PageStack, PageStackOptions } from './PageStack.ts';

export { mountShopPage } from './ShopPage.ts';
export type {
  ShopPageOptions,
  ShopPageHandle,
  ShopSection,
  ShopSectionLayout,
  ShopCopy,
  ShopPurchaseCopy,
  ShopRestoreCopy,
} from './ShopPage.ts';

export { resolveDomAnchorToCanvasPoint } from './canvasDomBridge.ts';
export type { CanvasPoint, AnchorFraction } from './canvasDomBridge.ts';

export { mountConnectivityIndicator } from './ConnectivityIndicator.ts';
export type {
  ConnectivityIndicatorOptions,
  ConnectivityIndicatorHandle,
} from './ConnectivityIndicator.ts';

export { prefersReducedMotion, retriggerCssAnimation } from './motion.ts';

export { applyTheme } from './internal.ts';
export type { ThemeTokens, UiHandle } from './internal.ts';
