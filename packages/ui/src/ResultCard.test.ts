import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFlowMachine } from '@fabrikav2/kernel/flow';
import { mountResultCard, mountModalShell, type UiHandle } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

function installUiCss(): void {
  if (document.getElementById('fab-ui-css-test')) return;
  const style = document.createElement('style');
  style.id = 'fab-ui-css-test';
  style.textContent = readFileSync(resolve('src/ui.css'), 'utf8');
  document.head.appendChild(style);
}

function expectTransparentRibbonContainer(ribbon: HTMLElement): void {
  const style = getComputedStyle(ribbon);
  expect(ribbon.style.backgroundImage).toBe('');
  expect(['none', ''].includes(style.backgroundImage)).toBe(true);
  const alpha = style.backgroundColor.match(/rgba\([^)]*,\s*([0-9.]+)\)$/)?.[1];
  expect(style.backgroundColor === 'transparent' || style.backgroundColor === '' || alpha === '0').toBe(true);
}

describe('mountResultCard', () => {
  it('renders the win variant with reward-display slot and injected copy', () => {
    const reward = document.createElement('div');
    reward.textContent = '+50';
    const handle = mountResultCard({
      mountInto: host(),
      variant: 'win',
      title: 'You win!',
      eyebrow: 'LEVEL 4',
      messages: 'All marbles sorted',
      rewardDisplay: reward,
      actions: [{ label: 'Next', onClick: () => {} }],
      id: 'result',
    });
    const card = handle.el.querySelector<HTMLElement>('.fab-modal-card')!;
    expect(card.classList.contains('fab-result-card--win')).toBe(true);
    // Title renders in a green (win) ribbon banner, not a flat top-strip.
    const ribbon = handle.el.querySelector<HTMLElement>('.fab-modal-ribbon')!;
    expect(ribbon.classList.contains('fab-modal-ribbon--win')).toBe(true);
    expect(ribbon.querySelector('.fab-modal-ribbon-title')?.textContent).toBe('You win!');
    expect(ribbon.querySelector('.fab-modal-ribbon-eyebrow')?.textContent).toBe('LEVEL 4');
    // The card is labelled by the ribbon title.
    expect(card.getAttribute('aria-labelledby')).toBe(ribbon.querySelector('.fab-modal-ribbon-title')?.id);
    // Dimmed backdrop scrim floats the card over the scene.
    expect(handle.el.querySelector('.fab-modal-scrim')).not.toBeNull();
    expect(handle.el.querySelector('.fab-result-message')?.textContent).toBe('All marbles sorted');
    expect(handle.el.querySelector('.fab-result-reward')?.textContent).toBe('+50');
    expect(handle.el.querySelector('.fab-result-continue')).toBeNull();
  });

  it('binds injected ribbon/card sprites and a win-art slot (game owns the bytes)', () => {
    const crown = document.createElement('img');
    const handle = mountResultCard({
      mountInto: host(),
      variant: 'win',
      title: 'Level Complete',
      ribbonImage: 'ribbon-src',
      cardImage: 'card-src',
      backplateImage: 'backplate-src',
      backplateClassName: 'result-backplate',
      art: crown,
      actions: [{ label: 'Next', onClick: () => {} }],
      id: 'result',
    });
    // Ribbon paints the injected sprite; the visible title collapses to an
    // sr-only label (the sprite carries its own baked lettering).
    const ribbon = handle.el.querySelector<HTMLElement>('.fab-modal-ribbon')!;
    expect(ribbon.classList.contains('fab-modal-ribbon--image')).toBe(true);
    expect(ribbon.style.backgroundImage).toBe('');
    expect(ribbon.querySelector<HTMLImageElement>('.fab-modal-ribbon-image')?.src).toContain('ribbon-src');
    // Card panel wears the popup sprite.
    const card = handle.el.querySelector<HTMLElement>('.fab-modal-card')!;
    expect(card.classList.contains('fab-modal-card--image')).toBe(true);
    expect(card.style.backgroundImage).toContain('card-src');
    const backplate = handle.el.querySelector<HTMLElement>('.fab-modal-backplate')!;
    expect(backplate.classList.contains('result-backplate')).toBe(true);
    expect(backplate.style.getPropertyValue('--fab-modal-backplate-image')).toContain('backplate-src');
    // Win art lands at the top of the body.
    const art = handle.el.querySelector<HTMLElement>('.fab-result-art')!;
    expect(art).toBe(crown);
    expect(art.parentElement?.classList.contains('fab-result-body')).toBe(true);
  });

  it('keeps settings, win, and fail image ribbon containers transparent', () => {
    installUiCss();
    const h = host();

    const settings = mountModalShell({
      mountInto: h,
      ribbon: {
        title: 'SETTINGS',
        tone: 'neutral',
        image: 'settings-ribbon-src',
        imageTitleVisibility: 'visible',
      },
      id: 'settings-ribbon-transparent',
    });
    const win = mountResultCard({
      mountInto: h,
      variant: 'win',
      title: 'COMPLETED',
      ribbonImage: 'win-ribbon-src',
      actions: [{ label: 'Next', onClick: () => {} }],
      id: 'win-ribbon-transparent',
    });
    const fail = mountResultCard({
      mountInto: h,
      variant: 'lose',
      title: 'FAILED',
      ribbonImage: 'fail-ribbon-src',
      actions: [{ label: 'Retry', onClick: () => {} }],
      id: 'fail-ribbon-transparent',
    });

    for (const handle of [settings, win, fail]) {
      const ribbon = handle.el.querySelector<HTMLElement>('.fab-modal-ribbon')!;
      expect(ribbon.querySelector('.fab-modal-ribbon-image')).not.toBeNull();
      expectTransparentRibbonContainer(ribbon);
    }
  });

  it('keeps the image-ribbon eyebrow in the sprite upper band while hiding the live title', () => {
    installUiCss();
    const handle = mountResultCard({
      mountInto: host(),
      variant: 'win',
      title: 'COMPLETED',
      eyebrow: 'LEVEL 4',
      ribbonImage: 'win-ribbon-src',
      actions: [{ label: 'Next', onClick: () => {} }],
      id: 'win-image-eyebrow',
    });

    const ribbon = handle.el.querySelector<HTMLElement>('.fab-modal-ribbon')!;
    expect(ribbon.classList.contains('fab-modal-ribbon--image')).toBe(true);
    expect(ribbon.classList.contains('fab-modal-ribbon--image-title-visible')).toBe(false);
    expect(ribbon.querySelector<HTMLImageElement>('.fab-modal-ribbon-image')?.src).toContain('win-ribbon-src');

    const eyebrow = ribbon.querySelector<HTMLElement>('.fab-modal-ribbon-eyebrow')!;
    expect(eyebrow.textContent).toBe('LEVEL 4');

    const title = ribbon.querySelector<HTMLElement>('.fab-modal-ribbon-title')!;
    expect(title.textContent).toBe('COMPLETED');

    const css = readFileSync(resolve('src/ui.css'), 'utf8');
    expect(css).toContain(
      '.fab-modal-ribbon--image:not(.fab-modal-ribbon--image-title-visible) .fab-modal-ribbon-eyebrow',
    );
    expect(css).toContain('top: var(--fab-ribbon-image-eyebrow-top);');
    expect(css).toContain('transform: translate(-50%, -50%);');
    expect(css).toContain(
      '.fab-modal-ribbon--image:not(.fab-modal-ribbon--image-title-visible) .fab-modal-ribbon-title',
    );
  });

  it('forwards a caller-owned action slot for game-specific CTA art', () => {
    const actions = document.createElement('div');
    actions.className = 'custom-result-actions';
    const next = document.createElement('button');
    next.type = 'button';
    next.dataset.fabAction = 'result-next';
    next.textContent = 'Next';
    actions.appendChild(next);

    const handle = mountResultCard({
      mountInto: host(),
      variant: 'win',
      title: 'Level Complete',
      actions,
      id: 'result',
    });

    expect(handle.el.querySelector('.custom-result-actions')).toBe(actions);
    expect(handle.el.querySelector('[data-fab-action="result-next"]')?.textContent).toBe('Next');
  });

  it('renders the lose variant with the continue-offer slot', () => {
    const offer = document.createElement('div');
    offer.textContent = 'Watch ad';
    const handle = mountResultCard({
      mountInto: host(),
      variant: 'lose',
      title: 'Failed',
      messages: ['No hearts left'],
      continueOffer: offer,
      actions: [{ label: 'Retry', onClick: () => {} }],
      id: 'result',
    });
    expect(handle.el.querySelector('.fab-modal-card')?.classList.contains('fab-result-card--lose')).toBe(true);
    // Lose ribbon is the red (fail) tone.
    expect(handle.el.querySelector('.fab-modal-ribbon--fail')).not.toBeNull();
    expect(handle.el.querySelector('.fab-modal-scrim')).not.toBeNull();
    expect(handle.el.querySelector('.fab-result-continue')?.textContent).toBe('Watch ad');
    expect(handle.el.querySelector('.fab-result-reward')).toBeNull();
  });

  it('the three reference overlays (settings/win/fail) all gain a ribbon + scrim', () => {
    const h = host();
    const win = mountResultCard({
      mountInto: h,
      variant: 'win',
      title: 'Completed',
      actions: [{ label: 'Next', onClick: () => {} }],
      id: 'ov-win',
    });
    expect(win.el.querySelector('.fab-modal-ribbon--win')).not.toBeNull();
    expect(win.el.querySelector('.fab-modal-scrim')).not.toBeNull();

    const fail = mountResultCard({
      mountInto: h,
      variant: 'lose',
      title: 'Failed',
      actions: [{ label: 'Retry', onClick: () => {} }],
      id: 'ov-fail',
    });
    expect(fail.el.querySelector('.fab-modal-ribbon--fail')).not.toBeNull();
    expect(fail.el.querySelector('.fab-modal-scrim')).not.toBeNull();

    // settings-style modal (neutral-tone ribbon over the same shell)
    const settings = mountModalShell({
      mountInto: h,
      ribbon: { title: 'Settings' },
      id: 'ov-settings',
    });
    expect(settings.el.querySelector('.fab-modal-ribbon--neutral')).not.toBeNull();
    expect(settings.el.querySelector('.fab-modal-scrim')).not.toBeNull();
  });

  it('mounts on Complete enter and unmounts on leave via a real flow machine', () => {
    const h = host();
    const machine = createFlowMachine();
    let result: UiHandle | null = null;

    const reconcile = (): void => {
      const isResult = machine.state === 'complete' || machine.state === 'failed';
      if (isResult && result === null) {
        const isWin = machine.state === 'complete';
        result = mountResultCard({
          mountInto: h,
          variant: isWin ? 'win' : 'lose',
          actions: isWin
            ? [
                // Next needs the id up front (S2); guard the double-fire (S4).
                { label: 'Next', onClick: () => dispatch(() => machine.can('next') && machine.next('l2')) },
              ]
            : [{ label: 'Retry', onClick: () => dispatch(() => machine.can('retry') && machine.retry()) }],
          id: 'result',
        });
      } else if (!isResult && result !== null) {
        result.dismiss();
        result = null;
      }
    };
    const dispatch = (fn: () => void): void => {
      fn();
      reconcile();
    };

    dispatch(() => machine.start('l1'));
    expect(h.querySelector('#result')).toBeNull();
    dispatch(() => machine.complete());
    expect(machine.state).toBe('complete');
    expect(h.querySelector('.fab-result-card--win')).not.toBeNull();

    // "Next" advances → Playing: the win card unmounts.
    h.querySelector<HTMLButtonElement>('.fab-modal-actions .fab-btn')!.click();
    expect(machine.state).toBe('playing');
    expect(machine.currentLevelId).toBe('l2');
    expect(h.querySelector('#result')).toBeNull();

    machine.dispose();
  });

  it('the can() guard makes a double-fire click a no-op instead of throwing', () => {
    const h = host();
    const machine = createFlowMachine();
    machine.start('l1');
    machine.fail();
    const handle = mountResultCard({
      mountInto: h,
      variant: 'lose',
      actions: [{ label: 'Retry', onClick: () => machine.can('retry') && machine.retry() }],
      id: 'result',
    });
    const retry = handle.el.querySelector<HTMLButtonElement>('.fab-modal-actions .fab-btn')!;
    retry.click(); // Failed→Playing
    expect(machine.state).toBe('playing');
    // Second click: retry is illegal from Playing, but can() short-circuits it.
    expect(() => retry.click()).not.toThrow();
    expect(machine.state).toBe('playing');
    machine.dispose();
  });
});
