import { buildButtonElement } from './Button.ts';
import { mountPageShell } from './PageShell.ts';
import { mountToggleRows, buildSettingsModel, type SettingsModelInput, type SettingKey } from './ToggleRow.ts';
import { type ThemeTokens, type UiHandle } from './internal.ts';

/**
 * SettingsPage — the out-of-game settings surface, COMPOSED (not re-extracted):
 * {@link mountPageShell} (title slot) → wave-A {@link mountToggleRows} fed by
 * {@link buildSettingsModel} → a legal-links slot → an optional privacy-choices
 * slot. Seeds: FTD `HUD.ts:844-963` + marble `sugar3d/src/shell/settings.ts`.
 *
 * Zero baked copy or asset paths: toggle labels, legal-link labels+URLs, and
 * the privacy-choice label are all injected; the open-link action and the
 * privacy SDK call are injected callbacks, never imported singletons. The
 * marble action rows (resume/close/restart/home) are the PauseOverlay's concern,
 * not this out-of-game page (brainstorm ledger).
 */

export interface LegalLink {
  /** Injected visible label (e.g. "Privacy Policy"). */
  label: string;
  /** Injected destination, handed back to `onOpenLink` — never a baked href. */
  url: string;
}

export interface PrivacyChoice {
  /** Injected label for the privacy-options row. */
  label: string;
  /** Injected SDK call (e.g. `privacyConsentService.showPrivacyOptions()`). */
  onInvoke: () => void | Promise<void>;
  /** Optional injected "opening…" label shown while `onInvoke` is pending. */
  pendingLabel?: string;
}

export interface SettingsPageOptions {
  mountInto: HTMLElement;
  /** Injected title slot for the page header. Fresh element. */
  header?: HTMLElement;
  backIcon?: string;
  backLabel?: string;
  /** Toggle state + injected labels (music/sfx/haptics). */
  settings: SettingsModelInput;
  /** Fired on user toggle; the consumer persists + applies side-effects. */
  onToggle: (key: SettingKey, next: boolean) => void;
  /** Injected legal links; rendered as buttons that fire `onOpenLink(url)`. */
  legalLinks?: readonly LegalLink[];
  onOpenLink?: (url: string) => void;
  /** Optional privacy-choices row; omitted → no row. */
  privacyChoice?: PrivacyChoice;
  onDismiss?: () => void;
  swipeDownDismiss?: boolean;
  instant?: boolean;
  theme?: ThemeTokens;
  id?: string;
}

function buildLegalSection(links: readonly LegalLink[], onOpenLink?: (url: string) => void): HTMLElement {
  const section = document.createElement('div');
  section.className = 'fab-settings-legal';
  for (const link of links) {
    const btn = buildButtonElement({
      label: link.label,
      className: 'fab-settings-legal-link',
      onClick: () => onOpenLink?.(link.url),
    });
    btn.dataset.fabLegalUrl = link.url;
    section.appendChild(btn);
  }
  return section;
}

function buildPrivacySection(choice: PrivacyChoice): HTMLElement {
  const section = document.createElement('div');
  section.className = 'fab-settings-privacy';
  const restingLabel = choice.label;
  const btn = buildButtonElement({
    label: restingLabel,
    className: 'fab-settings-privacy-btn',
    onClick: () => {
      // In-place pending/disabled state (v1 "Opening…" affordance). The button
      // guards its own click while disabled, so a second tap is a no-op.
      btn.disabled = true;
      btn.dataset.disabled = 'true';
      if (choice.pendingLabel !== undefined) btn.textContent = choice.pendingLabel;
      const restore = (): void => {
        btn.disabled = false;
        btn.dataset.disabled = 'false';
        btn.textContent = restingLabel;
      };
      let result: void | Promise<void>;
      try {
        result = choice.onInvoke();
      } catch (error) {
        restore();
        throw error;
      }
      if (result instanceof Promise) {
        result.then(restore, restore);
      } else {
        restore();
      }
    },
  });
  section.appendChild(btn);
  return section;
}

export function mountSettingsPage(opts: SettingsPageOptions): UiHandle {
  const togglesSection = document.createElement('div');
  togglesSection.className = 'fab-settings-toggles';

  const body: HTMLElement[] = [togglesSection];
  if (opts.legalLinks && opts.legalLinks.length > 0) {
    body.push(buildLegalSection(opts.legalLinks, opts.onOpenLink));
  }
  if (opts.privacyChoice) {
    body.push(buildPrivacySection(opts.privacyChoice));
  }

  const page = mountPageShell({
    mountInto: opts.mountInto,
    header: opts.header,
    body,
    backIcon: opts.backIcon,
    backLabel: opts.backLabel,
    swipeDownDismiss: opts.swipeDownDismiss,
    instant: opts.instant,
    theme: opts.theme,
    id: opts.id,
    onDismiss: () => {
      toggles.dismiss();
      opts.onDismiss?.();
    },
  });

  // The toggle rows are mounted after the page is in the DOM so `mountInto` is
  // connected. Their handle is disposed when the page closes (onDismiss above).
  const toggles = mountToggleRows({
    mountInto: togglesSection,
    rows: buildSettingsModel(opts.settings).toggles,
    onToggle: (key, next) => opts.onToggle(key as SettingKey, next),
  });

  return page;
}
