import { mountModalShell, type ModalAction } from './ModalShell.ts';
import { type ThemeTokens, type UiHandle } from './internal.ts';

/**
 * ResultCard — ONE modal shell with win/lose content slots, over wave-A
 * {@link mountModalShell} (backdrop/card/actions/dismiss/ARIA come free).
 * Dedupes the "4 games, 4 divergent win/lose surfaces" finding (research 04
 * claim 7) into a single `variant`-driven shell.
 *
 * It is a SHELL WITH SLOTS, not a re-home of core `mountLevelComplete` — the
 * rich claim-×2 / confetti / message-rotation win-reward surface (and its
 * `--fab-complete-*` tokens) stays for a later dedicated card that FILLS the
 * reward-display slot (brainstorm S6). Here:
 *  - `title` / `messages` are injected copy (win headline; lose "no hearts");
 *  - `rewardDisplay` is the win slot (e.g. a coin display — the consumer can
 *    drive wave-B `animateEconomyTransfer` into it);
 *  - `continueOffer` is the lose slot (the "watch ad to continue" affordance —
 *    the offer content itself comes from the sdk/iap card);
 *  - `actions` are injected `ModalAction[]` — the consumer wires them to
 *    `machine.next(id)` / `retry()` / `toMenu()` (guarding double-fires with
 *    `machine.can(...)`, brainstorm S4).
 */

export type ResultVariant = 'win' | 'lose';

export interface ResultCardOptions {
  mountInto: HTMLElement;
  variant: ResultVariant;
  /** Injected ribbon-banner title copy (e.g. "COMPLETED" / "FAILED"). */
  title?: string;
  /** Injected ribbon eyebrow above the title (e.g. "LEVEL 4"). */
  eyebrow?: string;
  /** Injected ribbon-banner sprite (game owns the bytes; forwarded to the shell). */
  ribbonImage?: string;
  /** Injected card-panel sprite painted as the whole card background. */
  cardImage?: string;
  /** Injected decorative layer behind the card, forwarded to ModalShell. */
  backplateImage?: string;
  /** Extra class(es) for the optional decorative backplate layer. */
  backplateClassName?: string;
  /** Win art shown at the top of the body (e.g. a crown sprite). Fresh element. */
  art?: HTMLElement;
  /** Injected body copy line(s). */
  messages?: string | readonly string[];
  /** Win reward-display slot. Fresh element. */
  rewardDisplay?: HTMLElement;
  /** Lose continue-offer slot. Fresh element. */
  continueOffer?: HTMLElement;
  /** Injected actions (win: Next/Replay/Menu; lose: Retry/Continue/Menu). */
  actions: readonly ModalAction[];
  backdropDismiss?: boolean;
  onDismiss?: () => void;
  theme?: ThemeTokens;
  id?: string;
}

function assertFreshSlot(el: HTMLElement): void {
  if (el.parentNode) {
    throw new Error('mountResultCard reward/continue slots must be fresh elements without an existing parent.');
  }
}

function normalizeMessages(messages: ResultCardOptions['messages']): string[] {
  if (messages === undefined) return [];
  return typeof messages === 'string' ? [messages] : [...messages];
}

export function mountResultCard(opts: ResultCardOptions): UiHandle {
  const body = document.createElement('div');
  body.className = 'fab-result-body';

  if (opts.art) {
    assertFreshSlot(opts.art);
    opts.art.classList.add('fab-result-art');
    body.appendChild(opts.art);
  }

  const messages = normalizeMessages(opts.messages);
  if (messages.length > 0) {
    const messageWrap = document.createElement('div');
    messageWrap.className = 'fab-result-messages';
    for (const line of messages) {
      const p = document.createElement('p');
      p.className = 'fab-result-message';
      p.textContent = line;
      messageWrap.appendChild(p);
    }
    body.appendChild(messageWrap);
  }

  if (opts.rewardDisplay) {
    assertFreshSlot(opts.rewardDisplay);
    opts.rewardDisplay.classList.add('fab-result-reward');
    body.appendChild(opts.rewardDisplay);
  }
  if (opts.continueOffer) {
    assertFreshSlot(opts.continueOffer);
    opts.continueOffer.classList.add('fab-result-continue');
    body.appendChild(opts.continueOffer);
  }

  // The result title lives in a themed ribbon banner (green win, red fail) that
  // replaces the old vestigial 2px top-strip — matching the reference overlay.
  const ribbon =
    opts.title !== undefined || opts.eyebrow !== undefined
      ? {
          title: opts.title ?? '',
          eyebrow: opts.eyebrow,
          tone: opts.variant === 'win' ? ('win' as const) : ('fail' as const),
          image: opts.ribbonImage,
        }
      : undefined;

  return mountModalShell({
    mountInto: opts.mountInto,
    ribbon,
    body,
    actions: opts.actions,
    backdropDismiss: opts.backdropDismiss,
    onDismiss: opts.onDismiss,
    theme: opts.theme,
    id: opts.id,
    cardImage: opts.cardImage,
    backplateImage: opts.backplateImage,
    backplateClassName: opts.backplateClassName,
    cardClassName: `fab-result-card fab-result-card--${opts.variant}`,
  });
}
