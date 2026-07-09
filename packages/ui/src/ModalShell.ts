import { buildButtonElement } from './Button.ts';
import { createUiRoot, type ThemeTokens, type UiHandle } from './internal.ts';

export interface ModalAction {
  label: string;
  onClick: (event: MouseEvent) => void;
  /** Optional game-owned button sprite. When supplied, it is the button surface. */
  spriteImage?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** Extra class(es) for game-local theming (e.g. a green CLOSE CTA). */
  className?: string;
  /** Stable hook (→ data-fab-action) for real-click e2e / SharedShellDriver. */
  dataAction?: string;
}

/**
 * Ribbon-banner header: one game-owned sprite, with live eyebrow/title text
 * positioned over it. The kit owns the structure; the consumer owns the bytes
 * and copy.
 */
export interface ModalRibbon {
  /** Bold banner title, e.g. "COMPLETED" / "FAILED". Doubles as the aria label. */
  title: string;
  /** Small eyebrow line above the title, e.g. "LEVEL 4". Omit to hide. */
  eyebrow?: string;
  /** Banner sprite the consumer injects (Vite-resolved url). */
  image: string;
}

export interface ModalCloseButton {
  /** Visible glyph/copy injected by the consumer. */
  label: string;
  /** Accessible action label, e.g. "Close". */
  ariaLabel: string;
  /** Optional game-owned button sprite. When supplied, it is the button surface. */
  spriteImage?: string;
  /** Extra class(es) for game-local theming. */
  className?: string;
  /** Stable hook (→ data-fab-action) for real-click e2e / SharedShellDriver. */
  dataAction?: string;
}

export interface ModalShellOptions {
  mountInto: HTMLElement;
  /** Plain modal title. Ignored when `ribbon` is present because the ribbon title labels the dialog. */
  title?: string;
  /** Ribbon-banner header. Takes over the aria label when present. */
  ribbon?: ModalRibbon;
  /** Optional visible close affordance. Omit for action-only modals. */
  closeButton?: ModalCloseButton;
  body?: HTMLElement | readonly HTMLElement[];
  actions?: readonly ModalAction[] | HTMLElement;
  backdropDismiss?: boolean;
  onDismiss?: () => void;
  theme?: ThemeTokens;
  id?: string;
  labelledById?: string;
  describedById?: string;
  cardClassName?: string;
  /**
   * Optional card-panel sprite the consumer injects (Vite-resolved url). Painted
   * as the card's background (the game owns the bytes); the shell drops its own
   * surface fill / border / shadow so the sprite reads as the whole panel.
   */
  cardImage?: string;
  /**
   * Optional decorative layer behind the dialog card. The consumer owns the
   * bytes and any game-specific sizing; the shell only inserts the inert layer.
   */
  backplateImage?: string;
  /** Extra class(es) for the optional decorative backplate layer. */
  backplateClassName?: string;
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
        spriteImage: action.spriteImage,
        disabled: action.disabled,
        ariaLabel: action.ariaLabel,
        className: action.className,
        dataAction: action.dataAction,
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
    kind: 'modal-shell',
  });
  if (root.reentrant) return root.handle;

  const { el, close } = root;

  // Dimmed backdrop scrim as its own (non-interactive) element so overlays float
  // OVER a dimmed scene instead of blanking it. Behind the card; pointer-events
  // off so backdrop-dismiss still targets the backdrop itself.
  const scrim = document.createElement('div');
  scrim.className = 'fab-modal-scrim';
  scrim.setAttribute('aria-hidden', 'true');
  el.appendChild(scrim);

  if (opts.backplateImage) {
    const backplate = document.createElement('div');
    backplate.className = ['fab-modal-backplate', opts.backplateClassName].filter(Boolean).join(' ');
    backplate.setAttribute('aria-hidden', 'true');
    backplate.style.setProperty('--fab-modal-backplate-image', `url(${opts.backplateImage})`);
    el.appendChild(backplate);
  }

  const card = document.createElement('div');
  card.className = ['fab-modal-card', opts.cardClassName].filter(Boolean).join(' ');
  if (opts.cardImage) {
    card.classList.add('fab-modal-card--image');
    card.style.setProperty('--fab-modal-card-image', `url(${opts.cardImage})`);
    card.style.backgroundImage = `url(${opts.cardImage})`;
  }
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  if (opts.labelledById) card.setAttribute('aria-labelledby', opts.labelledById);
  if (opts.describedById) card.setAttribute('aria-describedby', opts.describedById);

  if (opts.closeButton) {
    card.appendChild(
      buildButtonElement({
        label: opts.closeButton.label,
        ariaLabel: opts.closeButton.ariaLabel,
        spriteImage: opts.closeButton.spriteImage,
        className: ['fab-modal-close', opts.closeButton.className].filter(Boolean).join(' '),
        dataAction: opts.closeButton.dataAction,
        onClick: () => close(),
      }),
    );
  }

  if (opts.ribbon) {
    const ribbon = document.createElement('div');
    ribbon.className = 'fab-modal-ribbon';
    const ribbonImage = document.createElement('img');
    ribbonImage.className = 'fab-modal-ribbon-image';
    ribbonImage.src = opts.ribbon.image;
    ribbonImage.alt = '';
    ribbonImage.setAttribute('aria-hidden', 'true');
    ribbon.appendChild(ribbonImage);
    if (opts.ribbon.eyebrow) {
      const eyebrow = document.createElement('span');
      eyebrow.className = 'fab-modal-ribbon-eyebrow';
      eyebrow.textContent = opts.ribbon.eyebrow;
      ribbon.appendChild(eyebrow);
    }
    const ribbonTitle = document.createElement('h2');
    ribbonTitle.className = 'fab-modal-ribbon-title';
    ribbonTitle.textContent = opts.ribbon.title;
    if (opts.labelledById) {
      ribbonTitle.id = opts.labelledById;
    } else {
      ribbonTitle.id = `${el.id}-ribbon-title`;
      card.setAttribute('aria-labelledby', ribbonTitle.id);
    }
    ribbon.appendChild(ribbonTitle);
    card.appendChild(ribbon);
  }

  if (opts.title && !opts.ribbon) {
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
