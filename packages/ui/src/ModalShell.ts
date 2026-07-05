import { buildButtonElement, type ButtonVariant } from './Button.ts';
import { createUiRoot, type ThemeTokens, type UiHandle } from './internal.ts';

export interface ModalAction {
  label: string;
  onClick: (event: MouseEvent) => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  ariaLabel?: string;
}

export interface ModalShellOptions {
  mountInto: HTMLElement;
  title?: string;
  body?: HTMLElement | readonly HTMLElement[];
  actions?: readonly ModalAction[] | HTMLElement;
  backdropDismiss?: boolean;
  onDismiss?: () => void;
  theme?: ThemeTokens;
  id?: string;
  labelledById?: string;
  describedById?: string;
  cardClassName?: string;
}

let nextModalId = 0;

function appendBody(card: HTMLElement, body: HTMLElement | readonly HTMLElement[] | undefined): void {
  if (!body) return;
  if (body instanceof HTMLElement) {
    assertFreshSlot(body);
    card.appendChild(body);
  } else {
    for (const child of body) assertFreshSlot(child);
    card.append(...body);
  }
}

function buildActions(actions: readonly ModalAction[] | HTMLElement | undefined): HTMLElement | null {
  if (!actions) return null;
  if (actions instanceof HTMLElement) {
    assertFreshSlot(actions);
    return actions;
  }

  const actionRoot = document.createElement('div');
  actionRoot.className = 'fab-modal-actions';
  for (const action of actions) {
    actionRoot.appendChild(
      buildButtonElement({
        label: action.label,
        onClick: action.onClick,
        variant: action.variant,
        disabled: action.disabled,
        ariaLabel: action.ariaLabel,
      }),
    );
  }
  return actionRoot;
}

function assertFreshSlot(el: HTMLElement): void {
  if (el.parentNode) {
    throw new Error('mountModalShell body/actions slots must be fresh elements without an existing parent.');
  }
}

export function mountModalShell(opts: ModalShellOptions): UiHandle {
  const root = createUiRoot({
    mountInto: opts.mountInto,
    id: opts.id ?? `fab-modal-${++nextModalId}`,
    className: 'fab-ui fab-modal-backdrop',
    theme: opts.theme,
  });
  if (root.reentrant) return root.handle;

  const { el, close } = root;
  const card = document.createElement('div');
  card.className = ['fab-modal-card', opts.cardClassName].filter(Boolean).join(' ');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  if (opts.labelledById) card.setAttribute('aria-labelledby', opts.labelledById);
  if (opts.describedById) card.setAttribute('aria-describedby', opts.describedById);

  if (opts.title) {
    const title = document.createElement('h2');
    title.className = 'fab-modal-title';
    title.textContent = opts.title;
    if (opts.labelledById) {
      title.id = opts.labelledById;
    } else {
      title.id = `${el.id}-title`;
      card.setAttribute('aria-labelledby', title.id);
    }
    card.appendChild(title);
  }

  appendBody(card, opts.body);
  const actions = buildActions(opts.actions);
  if (actions) card.appendChild(actions);

  if (opts.backdropDismiss ?? false) {
    el.addEventListener('click', (event) => {
      if (event.target === el) close();
    });
  }
  card.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  if (opts.onDismiss) {
    root.registerPostDismiss(opts.onDismiss);
  }

  el.appendChild(card);
  return root.finalize();
}

/**
 * Source-parity alias for the v1 `mountModal` name. `mountModalShell` is the
 * canonical wave-A export; this keeps existing call sites (and ported tests)
 * working without churn. Same behavior — no back-stack coupling (see card S1).
 */
export const mountModal = mountModalShell;
