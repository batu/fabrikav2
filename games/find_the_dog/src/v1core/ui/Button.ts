import { createUiRoot, type ThemeTokens, type UiHandle } from './internal';

export type ButtonVariant = 'primary' | 'secondary' | 'icon';

export interface ButtonOptions {
  mountInto: HTMLElement;
  label: string;
  onClick: (event: MouseEvent) => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  theme?: ThemeTokens;
  id?: string;
  ariaLabel?: string;
  className?: string;
}

export interface ButtonHandle extends UiHandle {
  el: HTMLButtonElement;
  setDisabled(disabled: boolean): void;
  setLabel(label: string): void;
}

interface BuildButtonOptions {
  label: string;
  onClick: (event: MouseEvent) => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  dataAction?: string;
}

let nextButtonId = 0;

function classForVariant(variant: ButtonVariant): string {
  return variant === 'icon' ? 'fab-btn-icon' : `fab-btn-${variant}`;
}

export function buildV1ButtonElement(opts: BuildButtonOptions): HTMLButtonElement {
  const variant = opts.variant ?? 'primary';
  if (variant === 'icon' && opts.label.length === 0 && !opts.ariaLabel) {
    throw new Error('mountButton icon variant requires a visible label or ariaLabel.');
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = ['fab-btn', classForVariant(variant), opts.className].filter(Boolean).join(' ');
  button.textContent = opts.label;
  if (opts.ariaLabel) button.setAttribute('aria-label', opts.ariaLabel);
  if (opts.dataAction) button.dataset.fabAction = opts.dataAction;
  setButtonDisabled(button, opts.disabled ?? false);
  button.addEventListener('click', (event) => {
    if (button.disabled) return;
    opts.onClick(event);
  });
  return button;
}

function setButtonDisabled(button: HTMLButtonElement, disabled: boolean): void {
  button.disabled = disabled;
  button.dataset.disabled = String(disabled);
}

function isButtonHandle(handle: UiHandle): handle is ButtonHandle {
  return handle.el instanceof HTMLButtonElement && 'setDisabled' in handle && 'setLabel' in handle;
}

function buttonHandleForExisting(handle: UiHandle): ButtonHandle {
  if (isButtonHandle(handle)) return handle;
  if (!(handle.el instanceof HTMLButtonElement)) {
    throw new Error(`mountButton id collision: existing element "${handle.el.id}" is not a button.`);
  }

  return {
    el: handle.el,
    dismiss: handle.dismiss,
    dismissed: handle.dismissed,
    setDisabled(disabled: boolean): void {
      setButtonDisabled(handle.el as HTMLButtonElement, disabled);
    },
    setLabel(label: string): void {
      handle.el.textContent = label;
    },
  };
}

export function mountV1Button(opts: ButtonOptions): ButtonHandle {
  const root = createUiRoot({
    mountInto: opts.mountInto,
    id: opts.id ?? `fab-button-${++nextButtonId}`,
    className: ['fab-ui', 'fab-btn', classForVariant(opts.variant ?? 'primary'), opts.className].filter(Boolean).join(' '),
    theme: opts.theme,
    tagName: 'button',
  });
  if (root.reentrant) return buttonHandleForExisting(root.handle);

  const button = root.el as HTMLButtonElement;
  button.type = 'button';
  button.textContent = opts.label;
  if (opts.ariaLabel) button.setAttribute('aria-label', opts.ariaLabel);
  if ((opts.variant ?? 'primary') === 'icon' && opts.label.length === 0 && !opts.ariaLabel) {
    throw new Error('mountButton icon variant requires a visible label or ariaLabel.');
  }
  setButtonDisabled(button, opts.disabled ?? false);
  button.addEventListener('click', (event) => {
    if (button.disabled) return;
    opts.onClick(event);
  });

  const handle: ButtonHandle = {
    el: button,
    dismiss: root.close,
    dismissed: root.dismissed,
    setDisabled(disabled: boolean): void {
      setButtonDisabled(button, disabled);
    },
    setLabel(label: string): void {
      button.textContent = label;
    },
  };
  root.finalize(handle);
  return handle;
}
